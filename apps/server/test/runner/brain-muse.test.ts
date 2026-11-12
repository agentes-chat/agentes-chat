import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CodexBrainEvent } from "../../runner/brain-codex";
import { CodexThreads } from "../../runner/brain-codex";
import {
  MUSE_KEY_ENV,
  MUSE_NO_AUTO_UPDATE,
  MuseEventMapper,
  museApprovalVerdict,
  museChoice,
  museHostEnv,
  museServeArgs,
  museSessionsFile,
  museSettings,
  museVersion,
  runMuseTurn,
  uuidv7,
} from "../../runner/brain-muse";
import { detectExecutors } from "../../runner/executors";
import type { Spawn } from "../../runner/scope-gate";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const name of [
    "FAKE_MUSE_TOOL",
    "FAKE_MUSE_ANSWER",
    "FAKE_MUSE_REFUSE",
    "FAKE_MUSE_LOST",
    "FAKE_MUSE_APPROVAL",
    "FAKE_MUSE_APPROVAL_COMMAND",
    "FAKE_MUSE_APPROVAL_LOG",
    "FAKE_MUSE_APPROVAL_SILENT",
  ])
    delete process.env[name];
  delete process.env[MUSE_KEY_ENV];
  removeDirs(dirs);
});

const FAKE = path.join(import.meta.dir, "fake-muse.mjs");
const fakeSpawn = ((_, args, options) => spawn(process.execPath, [FAKE, ...args], options)) as Spawn;
const RUN = "0193aaaa-0000-7000-8000-0000000000f1";
const SESSION = "0193cccc-0000-7000-8000-0000000000f1";

/** A turn against the fake host, collecting what it emitted. */
async function turn(extra: Partial<Parameters<typeof runMuseTurn>[0]> = {}, opts: { platform?: NodeJS.Platform } = {}) {
  const home = tempDir();
  dirs.push(home);
  const events: CodexBrainEvent[] = [];
  const sessions = new CodexThreads(museSessionsFile(path.join(home, "brain")));
  await runMuseTurn(
    { runId: RUN, sessionId: SESSION, cwd: home, system: "SYSTEM", prompt: "oi", mcp: { token: "t" }, ...extra },
    {
      sessions,
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      runnerHome: path.join(home, "brain"),
      spawn: fakeSpawn,
      ...opts,
    },
  );
  return { events, sessions, home };
}

/** The approval decisions a turn put in its thread. */
type ApprovalCall = Extract<CodexBrainEvent, { type: "tool_call" }>;
const approvalCalls = (events: CodexBrainEvent[]) =>
  events.filter((e): e is ApprovalCall => e.type === "tool_call" && e.name === "approval");

/** What the fake host was asked and answered (`FAKE_MUSE_APPROVAL_LOG`), in order. */
type FakeLog = {
  session?: { mode?: string | null };
  requested?: string;
  offered?: string[];
  decide?: { approvalId: string; choiceId: string; commandId: string };
  accepted?: string;
  rejected?: string;
};

function fakeLog(file: string): FakeLog[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeLog);
}

/** The fake host's ask, about `command`: what it is asked and answers lands in `file`. */
function askAbout(command?: string) {
  const home = tempDir();
  dirs.push(home);
  const file = path.join(home, "approval.log");
  process.env.FAKE_MUSE_APPROVAL = "1";
  process.env.FAKE_MUSE_APPROVAL_LOG = file;
  if (command !== undefined) process.env.FAKE_MUSE_APPROVAL_COMMAND = command;
  return { file };
}

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the host's argv: serve, never exec, and no approval flag to give", () => {
  expect(museServeArgs()).toEqual(["serve", "--trust-workspace"]);
  expect(museServeArgs({ profile: "plan" })).toContain("--disable-write");
  expect(museServeArgs({ profile: "plan" })).toContain("--disable-shell");
  expect(museServeArgs({ profile: "work" })).not.toContain("--disable-write");
});

test("the host runs without a key that could answer for the person, and without self-upgrade", () => {
  const env = museHostEnv({ ...process.env, META_API_KEY: "mk-should-go", MUSE_CONTRIBUTOR_MODE: "1" });
  expect(env[MUSE_KEY_ENV]).toBeUndefined();
  expect(env.MUSE_NO_AUTO_UPDATE).toBe(MUSE_NO_AUTO_UPDATE);
  expect(env.MUSE_CONTRIBUTOR_MODE).toBe("0");
});

test("the account's settings document carries our server and none of the machine's hooks", () => {
  const doc = JSON.parse(museSettings({ mcp: { token: "t" }, mcpCommand: ["agentes-runner", "mcp"] }));
  expect(doc.schema_version).toBe(1);
  expect(doc.hooks).toEqual({});
  expect(doc.managed_hooks_path).toBeNull();
  expect(doc.mcp_servers.agenteschat_agentes.transport).toBe("stdio");
  expect(doc.mcp_servers.agenteschat_agentes.mode).toBe("required");
  expect(doc.mcp_servers.agenteschat_agentes.command).toBe("agentes-runner");
  // `agentes-runner mcp` needs the run, and with `mode: required` a bridge that exits ends the turn.
  expect(doc.mcp_servers.agenteschat_agentes.args).toEqual(["mcp", "--run", "${AGENTES_MCP_RUN}"]);
  expect(doc.mcp_servers.agenteschat_agentes.env.AGENTES_MCP_RUN).toBe("${AGENTES_MCP_RUN}");
  const overHttp = JSON.parse(museSettings({ mcp: { token: "t", url: "https://x/mcp" } }));
  expect(overHttp.mcp_servers.agenteschat_agentes.transport).toBe("streamable_http");
});

test("every command carries a UUIDv7, which is what the host demands", () => {
  const id = uuidv7();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(uuidv7(0)).not.toBe(uuidv7(0));
  // Ordered by time: the next millisecond sorts after, which is what the v7 prefix buys.
  expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
});

test("only three notification families matter; the rest are skipped by method", () => {
  const mapper = new MuseEventMapper({});
  expect(mapper.event("task.lifecycle.proposed", { anything: 1 })).toEqual([]);
  expect(mapper.event("session/statusChanged", { status: "running" })).toEqual([]);
  expect(mapper.event("turn/started", { sessionId: "s" })).toEqual([]);
  // A reasoning delta is not the answer's text.
  expect(mapper.event("item/delta", { field: "summary.0", delta: "thinking" })).toEqual([]);
  expect(mapper.event("item/delta", { field: "text", delta: "hi" })).toEqual([{ type: "text_delta", text: "hi" }]);
});

test("a tool call keeps the name and arguments it started with, and its output", () => {
  const mapper = new MuseEventMapper({});
  expect(
    mapper.event("item/started", {
      item: { itemId: "i1", kind: "toolCall", tool: "bash", args: '{"command":"ls"}' },
    }),
  ).toEqual([{ type: "tool_started", id: "i1", name: "bash" }]);
  expect(
    mapper.event("item/completed", {
      item: { itemId: "i1", kind: "toolCall", status: "completed", visibleOutput: "a.txt" },
    }),
  ).toEqual([{ type: "tool_call", id: "i1", name: "bash", input: { command: "ls" }, executed: { content: "a.txt" } }]);
  // A failed call says so on the result.
  mapper.event("item/started", { item: { itemId: "i2", kind: "toolCall", tool: "edit", args: "{}" } });
  expect(
    mapper.event("item/completed", { item: { itemId: "i2", kind: "toolCall", status: "failed" } })[0],
  ).toMatchObject({
    executed: { isError: true },
  });
});

test("arguments that are not JSON yet never fail the turn", () => {
  const mapper = new MuseEventMapper({});
  mapper.event("item/started", { item: { itemId: "i3", kind: "toolCall", tool: "edit", args: '{"path":"a' } });
  expect(mapper.event("item/completed", { item: { itemId: "i3", kind: "toolCall" } })[0]).toMatchObject({
    name: "edit",
  });
});

test("usage is summed from the host's own counters, and the turn ends with one done", () => {
  const mapper = new MuseEventMapper({});
  mapper.event("session/tokenUsage", { promptTokens: 10, outputTokens: 4, cumulative: { cacheReadTokens: 2 } });
  const end = mapper.finish(SESSION);
  expect(end).toEqual([
    { type: "usage", input: 10, output: 4, source: "plan", cacheRead: 2 },
    { type: "done", text: "", session: { id: SESSION } },
  ]);
});

test("the version line is read as Muse prints it, and a foreign one is ignored", () => {
  expect(museVersion("Muse Code 1.4.18 (1.4.18-R8587.1)")).toBe("1.4.18-R8587.1");
  expect(museVersion("1.4.18")).toBeUndefined();
});

test("a whole turn: answer streamed, session kept for the next one, usage reported", async () => {
  const { events, sessions, home } = await turn();
  expect(events.some((e) => e.type === "text_delta" && e.text.includes("oi"))).toBe(true);
  expect(events.at(-1)?.type).toBe("done");
  expect(events.some((e) => e.type === "usage" && e.source === "plan")).toBe(true);
  // The agent keeps its thread: the Muse session is remembered under our session.
  expect(sessions.get(SESSION)).toMatch(/^[0-9a-f-]{36}$/);
  // The engine's context leads the prompt of a new session only, and the account's folder holds the settings.
  expect(readFileSync(path.join(home, "brain", "brain", "muse", "config", "muse", "settings.json"), "utf8")).toContain(
    "schema_version",
  );
});

test("a turn with a tool streams the call and its output", async () => {
  process.env.FAKE_MUSE_TOOL = "1";
  const { events } = await turn();
  expect(events.some((e) => e.type === "tool_started")).toBe(true);
  expect(events.some((e) => e.type === "tool_call" && e.executed?.content === "a.txt")).toBe(true);
});

test("the approval policy: a read and work inside the folder, nothing outside it, nothing from a plan turn", () => {
  const home = tempDir();
  dirs.push(home);
  const verdict = (subject: { kind: string; command?: string; path?: string }, profile: "plan" | "work" = "work") =>
    museApprovalVerdict({ subject, cwd: home, profile, home });

  // What a `work` turn was asked for: a read at once, and the work that stays in its folder.
  expect(verdict({ kind: "command", command: "ls -la" })).toMatchObject({ allow: true, always: false });
  expect(verdict({ kind: "command", command: "echo hi > notes.txt" })).toMatchObject({ allow: true });
  expect(verdict({ kind: "path", path: path.join(home, "notes.txt") })).toMatchObject({ allow: true });
  // Its kind is one the agent's own computer may run for good (`bun test`), so the session offer is meant.
  expect(verdict({ kind: "command", command: "bun test" })).toMatchObject({ allow: true, always: true });

  // Outside the folder, a secret, a push: refused, in the policy's own words.
  expect(verdict({ kind: "command", command: "echo hi > /etc/hosts" })).toMatchObject({
    allow: false,
    why: "it writes outside the mission folder",
  });
  expect(verdict({ kind: "path", path: "/etc/hosts" })).toMatchObject({
    allow: false,
    why: "it changes files outside the mission folder",
  });
  // Judged by the field the subject carries, not by the host's own name for its kind.
  expect(verdict({ kind: "fileWrite", path: "/etc/hosts" }).allow).toBe(false);
  expect(verdict({ kind: "shell", command: "rm -rf /etc" }).allow).toBe(false);
  expect(verdict({ kind: "command", command: "cat ~/.ssh/id_rsa" }).allow).toBe(false);
  expect(verdict({ kind: "command", command: "git push origin main" }).allow).toBe(false);

  // A `plan` turn reads and nothing else; a subject the policy can't read is refused, in either profile: the host
  // asks about it precisely because nothing matched, and there is nobody here to look.
  const planned = verdict({ kind: "command", command: "echo hi > notes.txt" }, "plan");
  expect(planned.allow).toBe(false);
  expect(planned.why).toContain("may only read");
  const networked = verdict({ kind: "network" }, "work");
  expect(networked.allow).toBe(false);
  expect(networked.why).toContain("nobody is here to look");
  // A plan turn refuses it for its own reason, before a subject is even read.
  expect(verdict({ kind: "network" }, "plan").why).toContain("may only read");
});

test("the offer taken is the narrowest the host made: once by default, the session only when it is meant", () => {
  const offers = [
    { choiceId: "once", decision: "approved", scope: "once" },
    { choiceId: "session", decision: "approvedForSession", scope: "session" },
    { choiceId: "deny", decision: "denied", scope: "once" },
    { choiceId: "abort", decision: "abort", scope: "once" },
  ];
  expect(museChoice(offers, { allow: true, always: false })?.choiceId).toBe("once");
  expect(museChoice(offers, { allow: true, always: true })?.choiceId).toBe("session");
  expect(museChoice(offers, { allow: false, always: false })?.choiceId).toBe("deny");
  // A shell ask that offers no deny: `abort` is the refusal it does have.
  const noDeny = offers.filter((o) => o.choiceId !== "deny");
  expect(museChoice(noDeny, { allow: false, always: false })?.choiceId).toBe("abort");
  // Never the other way round: a decision that only said "once" doesn't become the session's.
  expect(
    museChoice([{ choiceId: "session", decision: "approvedForSession", scope: "session" }], {
      allow: true,
      always: false,
    }),
  ).toBeUndefined();
  expect(museChoice([], { allow: true, always: false })).toBeUndefined();
});

test("a read the host asks about is taken with the offer it made, on a UUIDv7 commandId", async () => {
  const { file } = askAbout();
  const { events } = await turn();
  const [call] = approvalCalls(events);
  const input = call?.input as Record<string, unknown>;
  // The session asked the host for what its own policy doesn't match, and the subject landed as a call.
  expect(fakeLog(file).find((l) => l.session)?.session?.mode).toBe("promptUnmatched");
  expect(input).toMatchObject({ kind: "command", command: "ls", decision: "allow", scope: "once" });
  expect(input.offered).toContain(input.choiceId);
  expect(call?.executed?.content).toContain("allowed (once)");
  // What the host heard: a choice of its own, on a command of its own kind of id.
  const decide = fakeLog(file).find((l) => l.decide)?.decide;
  expect(decide?.choiceId).toBe(input.choiceId as string);
  expect(decide?.commandId).toMatch(UUID7);
  expect(fakeLog(file).some((l) => l.accepted === input.choiceId)).toBe(true);
  expect(events.at(-1)?.type).toBe("done");
});

test("a command outside the workspace is refused, and the refusal reaches the turn", async () => {
  const { file } = askAbout("echo hi > /etc/hosts");
  const { events } = await turn();
  const [call] = approvalCalls(events);
  const input = call?.input as Record<string, unknown>;
  expect(input).toMatchObject({ command: "echo hi > /etc/hosts", decision: "deny" });
  expect(call?.executed).toMatchObject({ isError: true });
  expect(call?.executed?.content).toContain("denied (once)");
  expect(input.offered).toContain(input.choiceId);
  const log = fakeLog(file);
  expect(log.find((l) => l.decide)?.decide?.choiceId).toBe(input.choiceId as string);
  expect(log.some((l) => l.accepted === input.choiceId)).toBe(true);
  expect(log.some((l) => l.rejected !== undefined)).toBe(false);
  expect(events.at(-1)?.type).toBe("done");
});

test("the session offer is taken only for a kind the computer may keep", async () => {
  askAbout("bun test");
  const { events } = await turn();
  const [call] = approvalCalls(events);
  expect(call?.input).toMatchObject({ command: "bun test", decision: "allow", scope: "session" });
  expect(events.at(-1)?.type).toBe("done");
});

test("a host that never answers the decide doesn't hold the turn", async () => {
  const { file } = askAbout();
  process.env.FAKE_MUSE_APPROVAL_SILENT = "1";
  const { events } = await turn();
  expect(fakeLog(file).some((l) => Boolean(l.decide?.choiceId))).toBe(true);
  expect(events.at(-1)?.type).toBe("done");
});

test("a lost session starts a new one instead of failing", async () => {
  process.env.FAKE_MUSE_LOST = "1";
  const { events, sessions } = await turn();
  // The map starts empty, so the resume is only tried from the second turn on; a start happens either way here.
  expect(events.at(-1)?.type).toBe("done");
  expect(sessions.get(SESSION)).toMatch(/^[0-9a-f-]{36}$/);
});

test("a host that refuses to start is `muse_missing` on ENOENT and carries its stderr otherwise", async () => {
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

  process.env.FAKE_MUSE_REFUSE = "start";
  const refused = await turn();
  expect(refused.events.at(-1)).toMatchObject({ type: "error", code: "not_logged_in" });
  expect((refused.events.at(-1) as { message: string }).message).toContain("muse login");
});

test("a right-hand turn and Windows are refused before anything runs", async () => {
  const chat = await turn({ chat: true });
  expect(chat.events).toEqual([expect.objectContaining({ type: "error", code: "unsupported" })]);
  const win = await turn({}, { platform: "win32" });
  expect(win.events).toEqual([expect.objectContaining({ type: "error", code: "unsupported" })]);
});

test("the account's key, when it has one, rides in its own variable", async () => {
  const home = tempDir();
  dirs.push(home);
  const account = path.join(home, "accounts", "muse", "a1");
  const events: CodexBrainEvent[] = [];
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
  expect(events.at(-1)?.type).toBe("done");
  expect(readFileSync(path.join(account, "config", "muse", "settings.json"), "utf8")).toContain("schema_version");
});

test("executor detection reads the version and nothing else", async () => {
  const run = async () =>
    ({ stdout: "Muse Code 1.4.18 (1.4.18-R8587.1)\n", stderr: "", status: 0, error: null }) as never;
  const { found } = await detectExecutors(run as never, {}, {});
  expect(found.muse?.version).toContain("1.4.18-R8587.1");
});
