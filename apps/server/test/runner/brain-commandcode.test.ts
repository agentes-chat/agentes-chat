import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MachineRequest } from "@agenteschat/adapters";
import { accountCodeAad, COMMANDCODE_KEY_PROVIDER } from "@agenteschat/adapters/machine-protocol";
import { sealSecret } from "@agenteschat/adapters/secret-box";
import { AccountManager, accountEnv, commandcodeKeyOf, withoutSignIns } from "../../runner/accounts";
import type { CodexBrainEvent } from "../../runner/brain-codex";
import {
  CommandcodeTurnReader,
  commandcodeArgs,
  commandcodeEffort,
  commandcodeModelId,
  commandcodeProblem,
  commandcodeSettings,
  outsidePaths,
  prepareCommandcodeHome,
  readCommandcodeSettings,
  refusedPrompt,
} from "../../runner/brain-commandcode";
import { effectiveAccess } from "../../runner/config";
import { detectExecutors, parseCommandcodeModels } from "../../runner/executors";
import { handleRequest } from "../../runner/handlers";
import type { Spawn } from "../../runner/scope-gate";
import { removeDirs, tempDir } from "./helpers";

const dirs: string[] = [];
const managers: AccountManager[] = [];
const realHome = process.env.HOME;
afterEach(async () => {
  for (const m of managers.splice(0)) await m.close();
  delete process.env.FAKE_COMMANDCODE_LOG;
  delete process.env.CMD_LOCAL_ONLY;
  process.env.HOME = realHome;
  removeDirs(dirs);
});

const posix = process.platform !== "win32";
const FAKE = path.join(import.meta.dir, "fake-commandcode.mjs");
const RUN = "0193aaaa-0000-7000-8000-0000000000c1";
const SESSION = "0193cccc-0000-7000-8000-0000000000c1";
const AGENT = { id: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff00c1", handle: "dev" };
const ACCOUNT = "0193eeee-0000-7000-8000-0000000000c1";
const ORG = "0193dddd-0000-7000-8000-000000000001";
const KEY = `user_${"A1b2C3d4".repeat(11)}`;
const BRIDGE = "mcp__agenteschat_agentes__";

// ── What a turn sets up ─────────────────────────────────────────────────────────

test("each profile's settings: work asks the runner, plan can't change anything, chat has our bridge alone", () => {
  expect(commandcodeSettings("work")).toEqual({ permissions: { defaultMode: "default", allow: [`${BRIDGE}*`] } });
  expect(commandcodeSettings("plan")).toEqual({
    permissions: { defaultMode: "default", deny: ["Edit", "Write", "Shell"], allow: [`${BRIDGE}*`] },
  });
  expect(commandcodeSettings("work", true)).toEqual({
    permissions: {
      defaultMode: "dont-ask",
      deny: ["Shell", "Read", "Edit", "Write", "WebFetch", "WebSearch"],
      allow: [`${BRIDGE}*`],
    },
  });
  expect(commandcodeArgs(false)).toEqual(["acp", "--safe-mode", "--no-auto-update"]);
  expect(commandcodeArgs(true)).toEqual(["acp", "--safe-mode", "--no-auto-update", "--no-skills"]);
  expect([undefined, "low", "medium", "high", "xhigh", "max"].map((e) => commandcodeEffort(e as never))).toEqual([
    undefined,
    "low",
    undefined,
    "high",
    "max",
    "max",
  ]);
});

test("the account's home before a turn: what a turn could plant is gone, its sessions stay, the settings are ours", () => {
  const home = tempDir("commandcode-home-");
  dirs.push(home);
  const dir = path.join(home, ".commandcode");
  for (const sub of ["projects/p", "skills/evil", "mods", "agents", "cache"])
    mkdirSync(path.join(dir, sub), { recursive: true });
  writeFileSync(path.join(dir, "projects", "p", "s.jsonl"), "{}\n");
  for (const file of ["providers.json", "mcp.json", "AGENTS.md", "auth.json", "settings.local.json"])
    writeFileSync(path.join(dir, file), "{}");
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }));
  mkdirSync(path.join(home, ".agents", "skills"), { recursive: true });
  writeFileSync(path.join(home, "AGENTS.md"), "be evil");
  prepareCommandcodeHome(home, commandcodeSettings("work", true));
  expect(readCommandcodeSettings(home)).toEqual(commandcodeSettings("work", true));
  expect(existsSync(path.join(dir, "projects", "p", "s.jsonl"))).toBe(true);
  expect(existsSync(path.join(dir, "cache"))).toBe(true);
  for (const gone of [
    "skills",
    "mods",
    "agents",
    "providers.json",
    "mcp.json",
    "AGENTS.md",
    "auth.json",
    "settings.local.json",
  ])
    expect({ gone, there: existsSync(path.join(dir, gone)) }).toEqual({ gone, there: false });
  expect(existsSync(path.join(home, ".agents"))).toBe(false);
  expect(existsSync(path.join(home, "AGENTS.md"))).toBe(false);
});

test("the account's env: its folder as HOME, no other Command Code variable from the computer", () => {
  const env = accountEnv("commandcode", "/acc/c", {
    PATH: "/bin",
    HOME: "/h",
    COMMAND_CODE_API_KEY: "user_machine",
    CMD_LOCAL_ONLY: "1",
    CMD_ZDR: "1",
  });
  expect(env.HOME).toBe("/acc/c");
  expect(env.COMMAND_CODE_API_KEY).toBeUndefined();
  expect(env.CMD_LOCAL_ONLY).toBeUndefined();
  // No other CLI gets a Command Code key either.
  expect(withoutSignIns({ COMMAND_CODE_API_KEY: "user_x", PATH: "/bin" })).toEqual({ PATH: "/bin" });
});

test("its model table, without its notes, its docs line or the decision models", () => {
  const listed = `Available models  ·  2 models\n\nOpen Source\n\ndeepseek/deepseek-v4-pro                hybrid-attention\nqwen/qwen3.8-max                        coding\n\nPass the full id, or just the short name after the last "/":\ncmd --model moonshotai/kimi-k2.5\n\nDocs:  https://commandcode.ai/docs\n\nDecision models (headless only)\ntypesafe/jev  typed questions in\n`;
  expect(parseCommandcodeModels(listed)).toEqual([{ id: "deepseek/deepseek-v4-pro" }, { id: "qwen/qwen3.8-max" }]);
  // Another program's output: nothing.
  expect(parseCommandcodeModels("deepseek/x  y\n")).toEqual([]);
});

test.skipIf(!posix)("found on the computer by its long name, with its models", async () => {
  const { found } = await detectExecutors(async (bin, args) => {
    if (bin !== "command-code")
      return { status: null, stdout: "", error: Object.assign(new Error("x"), { code: "ENOENT" }) };
    const r = Bun.spawnSync([process.execPath, FAKE, ...args]);
    return { status: r.exitCode, stdout: r.stdout.toString() };
  });
  expect(found.commandcode).toEqual({
    version: "1.89.1",
    models: [{ id: "deepseek/deepseek-v4.1-flash" }, { id: "moonshotai/kimi-k3.1-pro" }, { id: "claude-sonnet-5-5" }],
  });
});

test("a model as its session spells it: the CLI's list lowercases ids and drops Haiku 4.5's date", () => {
  const options = [
    {
      id: "model",
      options: [
        { value: "moonshotai/Kimi-K3.1-Pro" },
        { value: "claude-haiku-4-5-20251001" },
        { value: "deepseek/deepseek-v4.1-flash" },
      ],
    },
  ];
  expect(commandcodeModelId("moonshotai/kimi-k3.1-pro", options)).toBe("moonshotai/Kimi-K3.1-Pro");
  expect(commandcodeModelId("claude-haiku-4-5", options)).toBe("claude-haiku-4-5-20251001");
  expect(commandcodeModelId("deepseek/deepseek-v4.1-flash", options)).toBe("deepseek/deepseek-v4.1-flash");
  expect(commandcodeModelId("nobody/x", options)).toBe("nobody/x");
  expect(commandcodeModelId("moonshotai/kimi-k3.1-pro", [])).toBe("moonshotai/kimi-k3.1-pro");
});

test("its errors: a refused key signs out, a limit waits, a model above the plan says so and isn't retried", () => {
  expect(commandcodeProblem("POST /alpha/generate → 401 error: Invalid 'Authorization' header or token.")).toEqual([
    {
      type: "error",
      code: "not_logged_in",
      message: "401 error: Invalid 'Authorization' header or token.",
      retryable: true,
    },
  ]);
  expect(commandcodeProblem("POST /alpha/generate → 429 error: usage limit reached", true)).toEqual([
    { type: "limit" },
    { type: "error", code: "plan_limit", message: "429 error: usage limit reached", worked: true },
  ]);
  expect(
    commandcodeProblem("403 error: MODEL_NOT_IN_PLAN: Claude Opus 5.5 available in Provider and above plans"),
  ).toEqual([
    {
      type: "error",
      code: "commandcode_failed",
      message: "403 error: MODEL_NOT_IN_PLAN: Claude Opus 5.5 available in Provider and above plans",
      retryable: false,
    },
  ]);
});

test("a work turn's own folder is its to change, nothing outside it", () => {
  expect(outsidePaths({ file_path: "notes.md" }, "/w/dev")).toEqual([]);
  expect(outsidePaths({ file_path: "/w/dev/a/b.md", cwd: "/w/dev" }, "/w/dev")).toEqual([]);
  expect(outsidePaths({ file_path: "../other/x" }, "/w/dev")).toEqual(["../other/x"]);
  expect(outsidePaths({ path: "/etc" }, "/w/dev")).toEqual(["/etc"]);
  // What its command names: a redirection out of the folder, a parent, a home path; the null device is fine.
  expect(outsidePaths({ command: "printf 'teste\\n' > /tmp/teste.txt && cat x" }, "/w/dev")).toEqual([
    "/tmp/teste.txt",
  ]);
  expect(outsidePaths({ command: "cp a.md ../other/ 2>/dev/null" }, "/w/dev")).toEqual(["../other/"]);
  expect(outsidePaths({ command: "rm ~/.bashrc" }, "/w/dev", "/home/p")).toEqual(["~/.bashrc"]);
  expect(outsidePaths({ command: "git add . && git commit -m 'fix /tmp handling'" }, "/w/dev")).toEqual([]);
  expect(outsidePaths({ command: "echo hi > /w/dev/notes.md" }, "/w/dev")).toEqual([]);
  // A folder allowed to the agent is its to change too.
  expect(outsidePaths({ command: "cp a.md /data/shared/" }, ["/w/dev", "/data/shared"])).toEqual([]);
  expect(outsidePaths({ file_path: "/data/other/x" }, ["/w/dev", "/data/shared"])).toEqual(["/data/other/x"]);
});

test("the reader: text, its own tools in the transcript, ours and search_tools left out, tokens counted once", () => {
  const reader = new CommandcodeTurnReader();
  const events = [
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Let me check." } },
    { sessionUpdate: "tool_call", toolCallId: "1", title: "Shell: ls", rawInput: { command: "ls" } },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "a.md" } }],
    },
    { sessionUpdate: "tool_call", toolCallId: "2", title: "search_tools", rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId: "2", status: "completed" },
    { sessionUpdate: "tool_call", toolCallId: "3", title: `${BRIDGE}post_message`, rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId: "3", status: "completed" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } },
  ].flatMap((u) => reader.update(u));
  expect(events).toEqual([
    { type: "text_delta", text: "Let me check." },
    { type: "tool_call", id: "1", name: "Shell: ls", input: { command: "ls" }, executed: { content: "a.md" } },
    { type: "text_delta", text: "\n\nDone." },
  ]);
  expect(reader.answer).toBe("Done.");
  expect(
    reader.usage({ inputTokens: 1000, outputTokens: 20, cachedReadTokens: 400, cachedWriteTokens: 0 }, "m"),
  ).toEqual([{ type: "usage", input: 1000, output: 20, source: "plan", model: "m", cacheRead: 400 }]);
  const chat = new CommandcodeTurnReader({ chat: true });
  chat.update({ sessionUpdate: "tool_call", toolCallId: "1", title: "search_tools" });
  chat.update({ sessionUpdate: "tool_call", toolCallId: "2", title: `${BRIDGE}x` });
  expect(chat.breach).toBeUndefined();
  // A tool of its own the rules refused: the model reads the refusal and goes on.
  chat.update({ sessionUpdate: "tool_call", toolCallId: "3", title: "Read: /etc/hosts" });
  chat.update({ sessionUpdate: "tool_call_update", toolCallId: "3", status: "failed" });
  // A subagent meets the same rules for each tool it calls.
  chat.update({ sessionUpdate: "tool_call", toolCallId: "4", title: "agent" });
  chat.update({ sessionUpdate: "tool_call_update", toolCallId: "4", status: "completed" });
  expect(chat.breach).toBeUndefined();
  // A refused call never ran: nothing for the transcript, nothing done.
  const refused = new CommandcodeTurnReader();
  refused.update({ sessionUpdate: "tool_call", toolCallId: "9", title: "Shell: printf x > /tmp/y" });
  expect(
    refused.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "9",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "Permission denied by the user." } }],
    }),
  ).toEqual([]);
  expect(refused.worked).toBe(false);
  chat.update({ sessionUpdate: "tool_call", toolCallId: "5", title: "read_directory" });
  chat.update({ sessionUpdate: "tool_call_update", toolCallId: "5", status: "completed" });
  expect(chat.breach).toBe("Command Code ran a tool of its own (read_directory), so the turn stopped.");
});

test("stored before Command Code's switch, it follows Codex's", () => {
  const stored = (tools: Record<string, boolean>) =>
    ({ access: { folders: [], tools: { claude: true, commands: true, ...tools } } }) as never;
  expect(effectiveAccess(stored({ codex: false })).tools.commandcode).toBe(false);
  expect(effectiveAccess(stored({ codex: true, commandcode: false })).tools.commandcode).toBe(false);
});

// ── Turns against a fake Command Code (ACP, as 1.89.1) ─────────────────────────

const fakeSpawn: Spawn = ((_file, args, options) => spawn(process.execPath, [FAKE, ...args], options)) as Spawn;

interface Logged {
  start?: boolean;
  method?: string;
  params?: Record<string, unknown>;
  text?: string;
  args?: string[];
  cwd?: string;
  home?: string;
  entries?: string[];
  homeEntries?: string[];
  settings?: unknown;
  apiKey?: string | null;
  stray?: string | null;
  dnt?: string | null;
  pwd?: string | null;
  permissionAnswer?: { outcome?: { optionId?: string } };
}
const logOf = (file: string): Logged[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Logged)
    : [];

function setup(withKey = true) {
  const root = tempDir("brain-commandcode-");
  dirs.push(root);
  const ws = path.join(root, "ws");
  const home = path.join(root, "home");
  const account = path.join(root, "accounts", "commandcode", ACCOUNT);
  process.env.HOME = path.join(root, "agent-home");
  for (const d of [ws, home, account, process.env.HOME]) mkdirSync(d, { recursive: true });
  if (withKey) writeFileSync(path.join(account, "commandcode-key.json"), JSON.stringify({ key: KEY }));
  const log = path.join(root, "cmd.log");
  process.env.FAKE_COMMANDCODE_LOG = log;
  const refused: string[] = [];
  const ctx = {
    workspaceReal: ws,
    exec: true,
    token: "agm_x",
    accounts: {
      accountDir: (kind: string, id: string) => (kind === "commandcode" && id === ACCOUNT ? account : null),
      refused: async (_kind: string, id: string) => void refused.push(id),
      invalidate: () => {},
      refresh: async () => [],
    },
    codex: { runnerHome: home, runs: new Map(), spawn: fakeSpawn },
  };
  return { root, ws, home, account, log, ctx, refused };
}

const turn = (over: Record<string, unknown> = {}) =>
  ({
    op: "brain.turn",
    runId: RUN,
    kind: "commandcode",
    session: { id: SESSION, resume: false },
    cwd: "",
    system: "You are Dev, the team's developer.",
    prompt: "run the tests",
    mcp: { token: "tok_run" },
    agent: AGENT,
    account: ACCOUNT,
    ...over,
  }) as MachineRequest;

async function runTurn(ctx: object, req: MachineRequest, signal = new AbortController().signal) {
  const events: CodexBrainEvent[] = [];
  const scope = {
    signal,
    output: () => {},
    emit: (f: { type: string; event?: CodexBrainEvent }) => f.type === "brain.event" && f.event && events.push(f.event),
  };
  const reply = (await handleRequest(ctx as never, req, scope as never)) as { final: CodexBrainEvent };
  return { final: reply.final, events };
}

test.skipIf(!posix)(
  "a work turn: the account's home and key, our settings, a session with the context; the next resumes it",
  async () => {
    process.env.CMD_LOCAL_ONLY = "1";
    const { ctx, ws, account, log } = setup();
    const { final, events } = await runTurn(ctx, turn({ model: "moonshotai/kimi-k3.1-pro", effort: "xhigh" }));
    expect(final).toEqual({ type: "done", text: "All good.", session: { id: SESSION } });
    expect(events.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name)).toEqual([
      "Shell: ls",
    ]);
    expect(events.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      input: 1000,
      output: 20,
      source: "plan",
      model: "moonshotai/kimi-k3.1-pro",
      cacheRead: 400,
    });
    const [start] = logOf(log).filter((l) => l.start);
    // The agent's own folder in the workspace.
    const folder = start?.cwd ?? "";
    expect(folder.startsWith(`${ws}${path.sep}`)).toBe(true);
    expect(start).toMatchObject({
      args: ["acp", "--safe-mode", "--no-auto-update"],
      home: account,
      apiKey: KEY,
      stray: null,
      dnt: "1",
      pwd: folder,
      settings: commandcodeSettings("work"),
    });
    const calls = logOf(log).filter((l) => l.method);
    expect(calls.find((l) => l.method === "session/new")?.params).toMatchObject({
      cwd: folder,
      mcpServers: [{ name: "agenteschat_agentes", args: expect.arrayContaining(["mcp", "--run", RUN]) }],
    });
    expect(calls.filter((l) => l.method === "session/set_config_option").map((l) => l.params)).toEqual([
      expect.objectContaining({ configId: "model", value: "moonshotai/kimi-k3.1-pro" }),
      expect.objectContaining({ configId: "effort", value: "max" }),
    ]);
    expect(calls.find((l) => l.method === "session/prompt")?.text).toBe(
      "You are Dev, the team's developer.\n\nrun the tests",
    );

    writeFileSync(path.join(account, ".commandcode", "mcp.json"), "{}");
    const next = await runTurn(ctx, turn({ prompt: "and again" }));
    expect(next.final).toMatchObject({ type: "done" });
    const second = logOf(log).filter((l) => l.start)[1];
    expect(second?.entries).not.toContain("mcp.json");
    const methods = logOf(log)
      .map((l) => l.method)
      .filter(Boolean);
    expect(methods.filter((m) => m === "session/resume")).toHaveLength(1);
    expect(
      logOf(log)
        .filter((l) => l.method === "session/prompt")
        .at(-1)?.text,
    ).toBe("and again");
  },
);

test.skipIf(!posix)(
  "a chat turn: an empty folder, no skills, our bridge alone; a tool of its own stops it",
  async () => {
    const { ctx, ws, log } = setup();
    const locked = await runTurn(ctx, turn({ permissions: { mode: "chat" } }));
    expect(locked.final).toEqual({ type: "done", text: "All good.", session: { id: SESSION } });
    const [start] = logOf(log).filter((l) => l.start);
    expect(start?.args).toEqual(["acp", "--safe-mode", "--no-auto-update", "--no-skills"]);
    expect(start?.cwd?.startsWith(ws)).toBe(false);
    expect(start?.settings).toEqual(commandcodeSettings("work", true));
    // A tool of its own the rules refuse: the turn goes on and answers.
    const refused = await runTurn(
      ctx,
      turn({
        permissions: { mode: "chat" },
        prompt: "OWNTOOL",
        session: { id: `${SESSION.slice(0, -1)}2`, resume: false },
      }),
    );
    expect(refused.final).toMatchObject({ type: "done", text: "I can't read files here." });
    // One that ran anyway: stopped, whatever it said.
    const breach = await runTurn(
      ctx,
      turn({
        permissions: { mode: "chat" },
        prompt: "OWNTOOL RAN",
        session: { id: `${SESSION.slice(0, -1)}4`, resume: false },
      }),
    );
    expect(breach.final).toEqual({
      type: "error",
      code: "tools_not_locked",
      message: "Command Code ran a tool of its own (Read: /etc/hosts), so the turn stopped.",
    });
  },
);

test.skipIf(!posix)("what it asks: a write in its folder goes, one outside is refused", async () => {
  const { ctx, log } = setup();
  const inside = await runTurn(ctx, turn({ prompt: "ASKIN" }));
  expect(inside.final).toMatchObject({ type: "done", text: "Saved." });
  const outside = await runTurn(
    ctx,
    turn({ prompt: "ASKOUT", session: { id: `${SESSION.slice(0, -1)}3`, resume: false } }),
  );
  expect(outside.final).toMatchObject({ type: "done", text: "No." });
  expect(logOf(log).flatMap((l) => (l.permissionAnswer ? [l.permissionAnswer.outcome?.optionId] : []))).toEqual([
    "allow_once",
    "reject_once",
  ]);
  // Refused, and nothing said: told why in the same session, the agent answers in its own words.
  const quiet = await runTurn(
    ctx,
    turn({ prompt: "ASKOUT QUIET", session: { id: `${SESSION.slice(0, -1)}5`, resume: false } }),
  );
  expect(quiet.final).toMatchObject({ type: "done", text: "I can't write outside my folder." });
  const told = logOf(log)
    .filter((l) => l.method === "session/prompt")
    .at(-1);
  expect(told?.text).toBe(refusedPrompt("Write: /etc/agentes-test.txt outside its folder (/etc/agentes-test.txt)"));
  // Still nothing: the turn says what was asked, never an empty answer.
  const mute = await runTurn(
    ctx,
    turn({ prompt: "ASKOUT QUIET MUTE", session: { id: `${SESSION.slice(0, -1)}6`, resume: false } }),
  );
  expect(mute.final).toMatchObject({ type: "error", code: "commandcode_failed" });
  expect((mute.final as { message: string }).message).toContain("outside its folder (/etc/agentes-test.txt)");
});

test.skipIf(!posix)("its failures in its own words; a refused key marks the account; the key never shows", async () => {
  const { ctx, refused } = setup();
  const bad = await runTurn(ctx, turn({ prompt: "BADKEY" }));
  expect(bad.final).toMatchObject({ type: "error", code: "not_logged_in" });
  expect(refused).toEqual([ACCOUNT]);
  const plan = await runTurn(ctx, turn({ prompt: "NOTINPLAN" }));
  expect(plan.final).toMatchObject({ type: "error", code: "commandcode_failed", retryable: false });
  expect((plan.final as { message: string }).message).toStartWith("403 error: MODEL_NOT_IN_PLAN");
  const leak = await runTurn(ctx, turn({ prompt: "ENV" }));
  expect(JSON.stringify(leak.events)).not.toContain(KEY);
});

test.skipIf(!posix)("always an account: none, one gone, or one without its key", async () => {
  const { ctx } = setup(false);
  expect((await runTurn(ctx, turn({ account: undefined }))).final).toMatchObject({
    type: "error",
    code: "not_logged_in",
  });
  expect((await runTurn(ctx, turn({ account: "0193eeee-0000-7000-8000-0000000000c9" }))).final).toMatchObject({
    type: "error",
    code: "account_missing",
  });
  expect((await runTurn(ctx, turn())).final).toMatchObject({ type: "error", code: "not_logged_in" });
});

test.skipIf(!posix)("a Command Code account is its sealed key, of Command Code's shape", async () => {
  const home = tempDir("commandcode-accounts-");
  dirs.push(home);
  const m = new AccountManager({
    root: path.join(home, "accounts"),
    orgId: () => ORG,
    commands: { commandcode: [process.execPath, FAKE] },
  });
  managers.push(m);
  const id = "0193eeee-0000-7000-8000-0000000000e2";
  await expect(m.begin("commandcode", id)).rejects.toMatchObject({ code: "bad_request" });
  const begun = await m.begin("commandcode", id, false, undefined, COMMANDCODE_KEY_PROVIDER);
  expect(begun.publicKey).toBeString();
  const aad = accountCodeAad(id, ORG);
  await expect(
    m.code(id, aad, await sealSecret(begun.publicKey as string, "oc_sk_not_a_command_code_key", aad)),
  ).rejects.toMatchObject({ message: "That doesn't look like a Command Code API key. Copy the whole key." });
  await m.code(id, aad, await sealSecret(begun.publicKey as string, KEY, aad));
  expect(m.status(id).account).toMatchObject({
    kind: "commandcode",
    loggedIn: true,
    provider: "commandcode",
    keyHint: KEY.slice(-4),
  });
  expect(await commandcodeKeyOf(path.join(home, "accounts", "commandcode", id))).toBe(KEY);
});
