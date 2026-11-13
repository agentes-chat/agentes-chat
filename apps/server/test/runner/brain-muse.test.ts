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
  museProblem,
  museServeArgs,
  museSessionsFile,
  museSettings,
  museTurnOutcome,
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
    "FAKE_MUSE_APPROVAL_PATH",
    "FAKE_MUSE_APPROVAL_LOG",
    "FAKE_MUSE_APPROVAL_SILENT",
    "FAKE_MUSE_SILENT",
    "FAKE_MUSE_STATUS",
    "FAKE_MUSE_REASON",
    "FAKE_MUSE_ERROR",
    "FAKE_MUSE_ERROR_KIND",
    "FAKE_MUSE_RESETS_MS",
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
async function turn(
  extra: Partial<Parameters<typeof runMuseTurn>[0]> = {},
  opts: Partial<Parameters<typeof runMuseTurn>[1]> = {},
) {
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

/** The fake host's ask: about `command`, or about `file` when it names one. What it is asked and answers lands in the log. */
function askAbout(command?: string, file?: string) {
  const home = tempDir();
  dirs.push(home);
  const log = path.join(home, "approval.log");
  process.env.FAKE_MUSE_APPROVAL = "1";
  process.env.FAKE_MUSE_APPROVAL_LOG = log;
  if (command !== undefined) process.env.FAKE_MUSE_APPROVAL_COMMAND = command;
  if (file !== undefined) process.env.FAKE_MUSE_APPROVAL_PATH = file;
  return { file: log };
}

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the host's argv: serve, never exec, no approval flag, and no workspace trust to run its hooks", () => {
  expect(museServeArgs()).toEqual(["serve"]);
  // `--trust-workspace` is what lets a cloned repo's `.muse/hooks.json` run as the host, outside the sandbox.
  expect(museServeArgs()).not.toContain("--trust-workspace");
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
  // The wire's shape (measured against 1.4.18): `promptTokens` counted once, the raw counters under `usage`.
  mapper.event("session/tokenUsage", {
    promptTokens: 10,
    totalTokens: 14,
    usage: { inputTokens: 10, outputTokens: 4, cachedTokens: 0, reasoningTokens: 0 },
    cumulative: { cacheReadTokens: 2 },
  });
  const end = mapper.finish(SESSION);
  expect(end).toEqual([
    { type: "usage", input: 10, output: 4, source: "plan", cacheRead: 2 },
    { type: "done", text: "", session: { id: SESSION } },
  ]);
});

test("turn/completed says how the turn went: completed is done, failed and cancelled are errors", async () => {
  // The terminal record's own fields, as 1.4.18 sends them: `terminal` (open enum), and the settled `error` on a loss.
  expect(museTurnOutcome({ terminal: "completed", sessionId: SESSION })).toEqual({ terminal: "completed" });
  expect(museTurnOutcome({ status: "completed" })).toEqual({ terminal: "completed" });
  expect(museTurnOutcome({ terminal: "failed", error: { kind: "modelError", message: "no answer" } })).toMatchObject({
    terminal: "failed",
    message: "no answer",
  });
  // A failed turn with only a kind still names the failure; a terminal this code doesn't know is never a success.
  expect(museTurnOutcome({ terminal: "failed", error: { kind: "contextOverflow" } }).message).toContain(
    "contextOverflow",
  );
  expect(museTurnOutcome({ terminal: "interrupted" }).terminal).toBe("failed");
  expect(museTurnOutcome({ terminal: "cancelled", reason: "interrupted" })).toEqual({
    terminal: "cancelled",
    message: "interrupted",
  });

  const ok = await turn();
  expect(ok.events.at(-1)?.type).toBe("done");

  // A failed turn: the host's words reach the thread, and no `done` ever says it worked.
  process.env.FAKE_MUSE_STATUS = "failed";
  process.env.FAKE_MUSE_ERROR = "the model call failed: context overflow";
  const failed = await turn();
  expect(failed.events.at(-1)).toMatchObject({ type: "error", code: "muse_failed" });
  expect((failed.events.at(-1) as { message: string }).message).toContain("context overflow");
  expect(failed.events.some((e) => e.type === "done")).toBe(false);

  // A turn that had already run a tool says so: a retry would lose the work the API never saw.
  process.env.FAKE_MUSE_TOOL = "1";
  const worked = await turn();
  expect(worked.events.at(-1)).toMatchObject({ type: "error", code: "muse_failed", worked: true });
  delete process.env.FAKE_MUSE_TOOL;

  // A cancelled turn is the cancel it says, not a success.
  delete process.env.FAKE_MUSE_ERROR;
  process.env.FAKE_MUSE_STATUS = "cancelled";
  process.env.FAKE_MUSE_REASON = "the person stopped it";
  const cancelled = await turn();
  expect(cancelled.events.at(-1)).toMatchObject({ type: "error", code: "canceled" });
  expect((cancelled.events.at(-1) as { message: string }).message).toContain("the person stopped it");
  expect(cancelled.events.some((e) => e.type === "done")).toBe(false);
});

test("a usage limit is `limit` then `plan_limit`, with a time for the reset and never the sentence", () => {
  const now = Date.now();
  const limited = museProblem("Your usage limit is exhausted. Resets in 2h 5m.");
  expect(limited[0]).toMatchObject({ type: "limit" });
  // `resetsAt` is an ISO instant — not the whole error text, which used to land there.
  const resetsAt = (limited[0] as { resetsAt?: string }).resetsAt;
  expect(resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const at = Date.parse(resetsAt as string);
  expect(at).toBeGreaterThan(now + 2 * 3_600_000 - 60_000);
  expect(at).toBeLessThan(now + 2 * 3_600_000 + 6 * 60_000);
  // Both events, as `codexProblem` and `opencodeProblem` end a limited turn: the engine knows the code.
  expect(limited[1]).toMatchObject({ type: "error", code: "plan_limit", worked: false });
  expect(limited[1]).not.toBe(undefined);

  // No reset words: `limit` without a made-up time.
  expect(museProblem("usage limit reached")[0]).toEqual({ type: "limit" });

  // The typed quota detail a failed turn settles is the signal, and its instant is the reset.
  const quota = { resetsAtMs: Date.parse("2026-11-13T10:00:00Z") };
  expect(museProblem("out of allowance", true, quota)).toEqual([
    { type: "limit", resetsAt: "2026-11-13T10:00:00.000Z" },
    { type: "error", code: "plan_limit", message: "out of allowance", worked: true },
  ]);
});

test("a turn the host ends on a usage limit is limit + plan_limit, and never a done", async () => {
  process.env.FAKE_MUSE_STATUS = "failed";
  process.env.FAKE_MUSE_ERROR = "You are out of allowance.";
  process.env.FAKE_MUSE_RESETS_MS = String(Date.parse("2026-11-13T10:00:00Z"));
  const { events } = await turn();
  expect(events).toContainEqual({ type: "limit", resetsAt: "2026-11-13T10:00:00.000Z" });
  expect(events.at(-1)).toMatchObject({ type: "error", code: "plan_limit" });
  expect(events.some((e) => e.type === "done")).toBe(false);
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

test("the folders the agent was granted are its own: a write there is allowed, outside them it isn't", async () => {
  const home = tempDir();
  const granted = tempDir();
  dirs.push(home, granted);
  const writable = (grants?: string[]) =>
    museApprovalVerdict({
      subject: { kind: "path", path: path.join(granted, "notes.txt") },
      cwd: home,
      profile: "work",
      home,
      ...(grants ? { grants } : {}),
    });
  // Without the grant the folder is somebody else's: refused, in the policy's own words.
  expect(writable()).toMatchObject({ allow: false, why: "it changes files outside the mission folder" });
  // With it, the same write is inside a folder the person handed over (`ctx.grants`).
  expect(writable([granted])).toMatchObject({ allow: true });
  // The command form reads the same scope, and the grant doesn't cover anything beside it.
  expect(
    museApprovalVerdict({
      subject: { kind: "command", command: `echo hi > ${path.join(granted, "notes.txt")}` },
      cwd: home,
      profile: "work",
      home,
      grants: [granted],
    }),
  ).toMatchObject({ allow: true });
  expect(writable([path.join(granted, "other")]).allow).toBe(false);

  // And the turn reads the same grants: the host asks about a write in the granted folder and hears `allow`.
  askAbout(undefined, path.join(granted, "notes.txt"));
  const allowed = await turn({ grants: [granted] });
  const [call] = approvalCalls(allowed.events);
  expect(call?.input).toMatchObject({ kind: "path", decision: "allow", scope: "once" });
  expect(call?.executed?.content).toContain("allowed (once)");
  expect(allowed.events.at(-1)?.type).toBe("done");
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

test("a host that never accepts the turn ends it with a named reason instead of hanging", async () => {
  process.env.FAKE_MUSE_SILENT = "1";
  const started = Date.now();
  const { events } = await turn({}, { turnStartMs: 250, deadlineMs: 20_000 });
  // The turn/start deadline is the one that fires, long before the turn's own: the run is not held.
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "muse_failed", retryable: true });
  const said = (events.at(-1) as { message: string }).message;
  expect(said).toContain("stopped answering");
  expect(said).toContain("turn/start");
  expect(events.some((e) => e.type === "done")).toBe(false);
});

test("a turn that is accepted and then goes quiet hits its deadline, and its host is closed", async () => {
  process.env.FAKE_MUSE_SILENT = "turn";
  const started = Date.now();
  const { events } = await turn({}, { turnStartMs: 5_000, deadlineMs: 400 });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "muse_failed" });
  expect((events.at(-1) as { message: string }).message).toContain("deadline");
  expect(events.some((e) => e.type === "done")).toBe(false);
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

test("a right-hand turn runs read-only, and a tool of the CLI's own stops it", async () => {
  // A `chat` turn takes the read-only posture whatever the profile says.
  expect(museServeArgs({ chat: true })).toEqual(["serve", "--disable-write", "--disable-shell"]);
  expect(museServeArgs({ chat: true, profile: "work" })).toContain("--disable-shell");
  // With no tool of its own it is a normal turn.
  const clean = await turn({ chat: true });
  expect(clean.events.at(-1)?.type).toBe("done");
  // Our bridge's tools are `mcp__…`; one of the CLI's own is a breach, and the turn stops.
  process.env.FAKE_MUSE_TOOL = "1";
  const breach = await turn({ chat: true });
  expect(breach.events.at(-1)).toMatchObject({ type: "error", code: "tools_not_locked" });
});

test("Windows is refused before anything runs", async () => {
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
  const { found } = await detectExecutors(run as never, {}, {}, async () => []);
  expect(found.muse?.version).toContain("1.4.18-R8587.1");
});
