import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CodexBrainEvent } from "../../runner/brain-codex";
import { CodexThreads } from "../../runner/brain-codex";
import {
  MUSE_KEY_ENV,
  MuseEventMapper,
  museSessionsFile,
  museSettings,
  museTurnArgs,
  museVersion,
  runMuseTurn,
} from "../../runner/brain-muse";
import { detectExecutors } from "../../runner/executors";
import type { Spawn } from "../../runner/scope-gate";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  delete process.env.FAKE_MUSE_EXIT;
  delete process.env.FAKE_MUSE_STDERR;
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const FAKE = path.join(import.meta.dir, "fake-muse.mjs");
const fakeSpawn = ((_, args, options) => spawn(process.execPath, [FAKE, ...args], options)) as Spawn;
const FIXTURE = readFileSync(path.join(import.meta.dir, "fake-muse-fixture.jsonl"), "utf8");
const RUN = "0193aaaa-0000-7000-8000-0000000000f1";
const SESSION = "0193cccc-0000-7000-8000-0000000000f1";

test("command line: JSON events, no approval to answer, the posture by flags", () => {
  expect(museTurnArgs({})).toEqual([
    "exec",
    "--json",
    "--disable-approval",
    "--trust-workspace",
    "--contributor-mode",
    "off",
  ]);
  expect(museTurnArgs({ profile: "plan" })).toContain("--disable-write");
  expect(museTurnArgs({ profile: "plan" })).toContain("--disable-shell");
  expect(museTurnArgs({ session: "s1", model: "muse-spark-1.2" })).toContain("--session-id");
  expect(museTurnArgs({ session: "s1", model: "muse-spark-1.2" })).toContain("--model");
  // A `work` turn keeps the write and the shell.
  expect(museTurnArgs({ profile: "work" })).not.toContain("--disable-write");
});

test("the settings document: our server required, no hook of the machine, and the schema version it demands", () => {
  const doc = JSON.parse(museSettings({ mcp: { token: "t" }, mcpCommand: ["agentes-runner", "mcp"] }));
  expect(doc.schema_version).toBe(1);
  expect(doc.hooks).toEqual({});
  expect(doc.managed_hooks_path).toBeNull();
  const server = doc.mcp_servers.agenteschat_agentes;
  expect(server.transport).toBe("stdio");
  expect(server.mode).toBe("required");
  expect(server.command).toBe("agentes-runner");
  expect(server.env.AGENTES_MCP_TOKEN).toBe("${AGENTES_MCP_TOKEN}");
  const overHttp = JSON.parse(museSettings({ mcp: { token: "t", url: "https://x/mcp" } }));
  expect(overHttp.mcp_servers.agenteschat_agentes.transport).toBe("streamable_http");
});

test("only four payload families matter; the twenty others are skipped before a payload is read", () => {
  const mapper = new MuseEventMapper({});
  expect(mapper.line('{"payload_type":"task.lifecycle.proposed","payload":{"anything":1}}')).toEqual([]);
  expect(mapper.line('{"payload_type":"runtime.command.accepted","payload":{}}')).toEqual([]);
  expect(mapper.line("muse: workspace root: /tmp (cwd default)")).toEqual([]);
  expect(mapper.line('{"payload":{"stream":{"kind":"session","id":"ignored"}}}')).toEqual([]);
});

test("a turn's text, its usage, and the session it names", () => {
  const mapper = new MuseEventMapper({});
  const events = FIXTURE.split("\n").flatMap((line) => mapper.line(line));
  expect(mapper.session).toBe("01a1d181-61b7-7dc3-9a1a-5df7b0a6d0d0".length ? mapper.session : "");
  expect(mapper.session).toMatch(/^[0-9a-f-]{36}$/);
  expect(events.filter((e) => e.type === "text_delta").length).toBe(1);
  expect(events.some((e) => e.type === "text_delta" && e.text.includes("oi"))).toBe(true);
  // The fixture's usage line carries per-model token counts, summed into one.
  expect(events.some((e) => e.type === "usage")).toBe(false);
  const end = mapper.finish({ exitCode: 0, sessionId: SESSION });
  expect(end.at(-1)).toMatchObject({ type: "done", session: { id: SESSION } });
  expect(end[0]).toMatchObject({ type: "usage", source: "plan" });
});

test("a tool call is one event with its parsed arguments, and its output when it finished", () => {
  const mapper = new MuseEventMapper({});
  const started = mapper.line(
    JSON.stringify({
      payload_type: "item.started",
      payload: { item: { itemId: "i1", kind: "toolCall", tool: "bash", args: '{"command":"ls"}' } },
    }),
  );
  expect(started).toEqual([{ type: "tool_started", id: "i1", name: "bash" }]);
  const done = mapper.line(
    JSON.stringify({
      payload_type: "item.completed",
      payload: { item: { itemId: "i1", kind: "toolCall", status: "completed", visibleOutput: "a.txt" } },
    }),
  );
  expect(done).toEqual([
    { type: "tool_call", id: "i1", name: "bash", input: '{"command":"ls"}', executed: { content: "a.txt" } },
  ]);
});

test("arguments that are not JSON yet never fail the turn", () => {
  const mapper = new MuseEventMapper({});
  mapper.line(
    JSON.stringify({
      payload_type: "item.started",
      payload: { item: { itemId: "i2", kind: "toolCall", tool: "edit" } },
    }),
  );
  const done = mapper.line(
    JSON.stringify({ payload_type: "item.completed", payload: { item: { itemId: "i2", kind: "toolCall" } } }),
  );
  expect(done[0]).toMatchObject({ type: "tool_call", name: "edit" });
});

test("a failed turn is an error with Muse's own reason, and a signed-out one says so", () => {
  const failed = new MuseEventMapper({});
  failed.line(JSON.stringify({ payload_type: "run.terminal.failed", payload: { reason: "boom" } }));
  expect(failed.finish({ exitCode: 1, sessionId: SESSION }).at(-1)).toMatchObject({
    type: "error",
    code: "muse_failed",
    message: "boom",
  });
  const signedOut = new MuseEventMapper({});
  signedOut.line(JSON.stringify({ payload_type: "run.terminal.failed", payload: { reason: "not logged in" } }));
  expect(signedOut.finish({ exitCode: 1, sessionId: SESSION }).at(-1)).toMatchObject({ code: "not_logged_in" });
});

test("the version line is read as Muse prints it, and a foreign one is ignored", () => {
  expect(museVersion("Muse Code 1.4.18 (1.4.18-R8587.1)")).toBe("1.4.18-R8587.1");
  expect(museVersion("1.4.18")).toBeUndefined();
});

test("a whole turn: the session is kept, the answer streamed, and the prompt file cleaned up", async () => {
  const home = tempDir();
  dirs.push(home);
  const dir = path.join(home, "brain");
  const sessions = new CodexThreads(museSessionsFile(dir));
  const events: CodexBrainEvent[] = [];
  await runMuseTurn(
    {
      runId: RUN,
      sessionId: SESSION,
      cwd: home,
      system: "SYSTEM",
      prompt: "hello",
      mcp: { token: "t" },
    },
    {
      sessions,
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: dir,
      spawn: fakeSpawn,
    },
  );
  expect(events.some((e) => e.type === "text_delta")).toBe(true);
  expect(events.at(-1)?.type).toBe("done");
  // The session Muse named is remembered for the next turn's `--session-id`.
  expect(sessions.get(SESSION || "")).toBeTruthy();
});

test("a missing CLI is `muse_missing`, not a crash", async () => {
  const home = tempDir();
  dirs.push(home);
  const events: CodexBrainEvent[] = [];
  await runMuseTurn(
    { runId: RUN, sessionId: SESSION, cwd: home, system: "", prompt: "x", mcp: { token: "t" } },
    {
      sessions: new CodexThreads(museSessionsFile(path.join(home, "brain"))),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: path.join(home, "brain"),
      bin: path.join(home, "nope", "muse"),
    },
  );
  expect(events.at(-1)).toMatchObject({ type: "error", code: "muse_missing" });
});

test("a right-hand turn is refused: this CLI cannot withhold its own tools", async () => {
  const home = tempDir();
  dirs.push(home);
  const events: CodexBrainEvent[] = [];
  await runMuseTurn(
    { runId: RUN, sessionId: SESSION, cwd: home, system: "", prompt: "x", mcp: { token: "t" }, chat: true },
    {
      sessions: new CodexThreads(museSessionsFile(path.join(home, "brain"))),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: path.join(home, "brain"),
      spawn: fakeSpawn,
    },
  );
  expect(events).toEqual([expect.objectContaining({ type: "error", code: "unsupported" })]);
});

test("Windows is refused before anything runs", async () => {
  const home = tempDir();
  dirs.push(home);
  const events: CodexBrainEvent[] = [];
  await runMuseTurn(
    { runId: RUN, sessionId: SESSION, cwd: home, system: "", prompt: "x", mcp: { token: "t" } },
    {
      sessions: new CodexThreads(museSessionsFile(path.join(home, "brain"))),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: path.join(home, "brain"),
      spawn: fakeSpawn,
      platform: "win32",
    },
  );
  expect(events).toEqual([expect.objectContaining({ type: "error", code: "unsupported" })]);
});

test.if(posix)("the account's key rides in its own variable, in the account's folder", async () => {
  const home = tempDir();
  dirs.push(home);
  const account = path.join(home, "accounts", "muse", "a1");
  const events: CodexBrainEvent[] = [];
  process.env.FAKE_MUSE_STDERR = "";
  await runMuseTurn(
    {
      runId: RUN,
      sessionId: SESSION,
      cwd: home,
      system: "",
      prompt: "x",
      mcp: { token: "t" },
      account: { id: "0193eeee-0000-7000-8000-0000000000f1", home: account, key: "mk-fake" },
    },
    {
      sessions: new CodexThreads(museSessionsFile(path.join(home, "brain"))),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: path.join(home, "brain"),
      spawn: fakeSpawn,
    },
  );
  const settings = JSON.parse(readFileSync(path.join(account, "config", "muse", "settings.json"), "utf8"));
  expect(settings.schema_version).toBe(1);
  expect(events.at(-1)?.type).toBe("done");
});

test("executor detection reads the version and nothing else", async () => {
  const seen: string[] = [];
  const run = async (_bin: string, args: string[]) => {
    seen.push(args.join(" "));
    return { stdout: "Muse Code 1.4.18 (1.4.18-R8587.1)\n", stderr: "", status: 0, error: null } as never;
  };
  const { found } = await detectExecutors(run as never, {}, {});
  expect(found.muse?.version).toContain("1.4.18-R8587.1");
  expect(MUSE_KEY_ENV).toBe("META_API_KEY");
});
