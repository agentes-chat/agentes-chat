import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MachineRequest } from "@agenteschat/adapters";
import { isReservedSecretName } from "@agenteschat/adapters/secret-box";
import { AccountManager, accountEnv, parseCopilotLogin } from "../../runner/accounts";
import { type CodexBrainEvent, CodexThreads } from "../../runner/brain-codex";
import {
  type CopilotBrainTurnRequest,
  CopilotEventMapper,
  copilotChatsFile,
  copilotMcpConfig,
  copilotProblem,
  copilotPrompt,
  copilotTurnArgs,
  handleCopilotBrainTurn,
  runCopilotTurn,
  totalsOf,
  totalsText,
} from "../../runner/brain-copilot";
import { copilotLook, copilotLookInput, parseCopilotLook } from "../../runner/copilot-acp";
import { COPILOT_PLANTED, COPILOT_SETTINGS, prepareCopilotHome } from "../../runner/copilot-home";
import { detectExecutors } from "../../runner/executors";
import { handleRequest } from "../../runner/handlers";
import { CODEX_MCP_SERVER } from "../../runner/mcp";
import { removeDirs, tempDir, waitFor } from "./helpers";

const dirs: string[] = [];
const managers: AccountManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.close();
  delete process.env.FAKE_COPILOT_LOG;
  delete process.env.FAKE_SECRET;
  removeDirs(dirs);
});

const FAKE = path.join(import.meta.dir, "fake-copilot.mjs");
/** The fake as a launcher and what it runs: no shell on any platform. */
const BIN = [process.execPath, FAKE] as const;
const RUN = "0193aaaa-0000-7000-8000-0000000000c1";
const SESSION = "0193cccc-0000-7000-8000-0000000000c1";
const AGENT = { id: "0193aaaa-bbbb-7ccc-8ddd-eeeeffff00c1", handle: "dev" };
const ACCOUNT = "0193eeee-0000-7000-8000-0000000000c1";
const ORG = "0193dddd-0000-7000-8000-000000000001";
const FIRST = "c0c0c0c0-0000-4000-8000-000000000001";

test("command line: JSONL out, our MCP file, no prompt in it; work allows every tool and URL, plan reads and denies writes", () => {
  const work = copilotTurnArgs({
    mcpConfig: "/acc/agentes-mcp.json",
    model: "gpt-6.1-terra",
    chat: FIRST,
    effort: "max",
  });
  expect(work.slice(0, 2)).toEqual(["--output-format", "json"]);
  const line = work.join(" ");
  expect(line).toContain("--additional-mcp-config @/acc/agentes-mcp.json");
  expect(line).toContain("--no-custom-instructions --disable-builtin-mcps --no-auto-update --no-ask-user");
  expect(line).toContain("--sync-session=off");
  expect(line).toContain("--allow-all-tools --allow-all-urls");
  // Paths stay checked, and nothing trusts the folder.
  expect(line).not.toContain("--allow-all-paths");
  expect(line).not.toContain("--yolo");
  expect(line).not.toContain("--trust-folder");
  expect(line).toContain("--model gpt-6.1-terra");
  expect(line).toContain("--reasoning-effort high");
  expect(line).toContain(`--resume=${FIRST}`);
  expect(work).not.toContain("-p");
  const plan = copilotTurnArgs({ mcpConfig: "/acc/agentes-mcp.json", profile: "plan" }).join(" ");
  expect(plan).toContain(`--allow-tool read --allow-tool ${CODEX_MCP_SERVER} --deny-tool write`);
  expect(plan).not.toContain("--allow-all-tools");
  expect(plan).not.toContain("--resume");
});

test("a new chat's message leads with the engine's context, whole; a known chat's is the message alone", () => {
  const context = "c".repeat(300_000);
  expect(copilotPrompt(context, "oi", true)).toBe(`${context}\n\noi`);
  expect(copilotPrompt(context, "oi", false)).toBe("oi");
  expect(copilotPrompt("  ", "oi", true)).toBe("oi");
});

test("our server in the MCP file: stdio with nothing of the run in it, or the bridge's URL with the token as a bearer", () => {
  const stdio = JSON.parse(copilotMcpConfig({ command: ["/usr/bin/agentes-runner", "--home", "/h"] }));
  expect(stdio).toEqual({
    mcpServers: {
      [CODEX_MCP_SERVER]: {
        type: "local",
        command: "/usr/bin/agentes-runner",
        args: ["--home", "/h", "mcp"],
        tools: ["*"],
      },
    },
  });
  const http = JSON.parse(copilotMcpConfig({ url: "https://bridge.example/mcp", token: "tok_run" }));
  expect(http.mcpServers[CODEX_MCP_SERVER]).toEqual({
    type: "http",
    url: "https://bridge.example/mcp",
    headers: { Authorization: "Bearer tok_run" },
    tools: ["*"],
  });
});

test("the account's folder before a turn: what an earlier turn planted is gone, the settings are ours, the sign-in stays", () => {
  const home = tempDir("copilot-home-");
  dirs.push(home);
  for (const name of ["mcp-config.json", "copilot-instructions.md", "permissions-config.json", "providers.json"]) {
    writeFileSync(path.join(home, name), "x");
  }
  for (const name of ["agents", "skills", "hooks", "installed-plugins", "extensions"]) {
    mkdirSync(path.join(home, name, "evil"), { recursive: true });
  }
  writeFileSync(path.join(home, "config.json"), '{"signedIn":true}');
  writeFileSync(path.join(home, "settings.json"), '{"storeTokenPlaintext":false,"hooks":{"sessionStart":[]}}');
  prepareCopilotHome(home);
  for (const name of COPILOT_PLANTED) expect(existsSync(path.join(home, name))).toBe(false);
  expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe('{"signedIn":true}');
  const settings = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"));
  expect(settings).toEqual(JSON.parse(JSON.stringify(COPILOT_SETTINGS)));
  expect(settings).toMatchObject({ storeTokenPlaintext: true, autoUpdate: false, remoteExport: false, memory: false });
  expect(settings.disableAllHooks).toBe(true);
  expect(settings.hooks).toBeUndefined();
});

test("the CLI's events: text streamed or whole, its own tools on the transcript, ours not, the answer after the last tool", () => {
  const m = new CopilotEventMapper();
  const ev = (type: string, data: Record<string, unknown>) => m.push({ type, data });
  expect(ev("session.start", { sessionId: FIRST })).toEqual([]);
  expect(m.session).toBe(FIRST);
  expect(ev("assistant.message_delta", { messageId: "m1", deltaContent: "Let me " })).toEqual([
    { type: "text_delta", text: "Let me " },
  ]);
  expect(ev("assistant.message_delta", { messageId: "m1", deltaContent: "check." })).toEqual([
    { type: "text_delta", text: "check." },
  ]);
  // The whole message after its deltas says nothing twice.
  expect(
    ev("assistant.message", { messageId: "m1", content: "Let me check.", toolRequests: [{ name: "bash" }] }),
  ).toEqual([]);
  ev("tool.execution_start", { toolCallId: "c1", toolName: "bash", arguments: { command: "ls" } });
  expect(ev("tool.execution_complete", { toolCallId: "c1", success: false, result: { content: "denied" } })).toEqual([
    {
      type: "tool_call",
      id: "c1",
      name: "bash",
      input: { command: "ls" },
      executed: { content: "denied", isError: true },
    },
  ]);
  ev("tool.execution_start", {
    toolCallId: "c2",
    toolName: `${CODEX_MCP_SERVER}-post_message`,
    arguments: {},
    mcpServerName: CODEX_MCP_SERVER,
  });
  expect(ev("tool.execution_complete", { toolCallId: "c2", success: true, result: { content: "posted" } })).toEqual([]);
  // A message with no deltas comes whole, a paragraph apart.
  expect(ev("assistant.message", { messageId: "m2", content: "All good.", toolRequests: [] })).toEqual([
    { type: "text_delta", text: "\n\nAll good." },
  ]);
  ev("session.usage_checkpoint", {
    accountingSnapshot: {
      modelMetrics: {
        "claude-sonnet-5.5": {
          usage: { inputTokens: 5000, outputTokens: 90, cacheReadTokens: 3000, cacheWriteTokens: 500 },
        },
      },
    },
  });
  ev("session.model_change", { newModel: "claude-sonnet-5.5" });
  m.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  // The session had used some before this turn: the turn's usage is what it added.
  const before = { input: 4000, output: 50, cacheRead: 2600, cacheWrite: 400 };
  expect(m.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before })).toEqual([
    {
      type: "usage",
      input: 1000,
      output: 40,
      source: "plan",
      model: "claude-sonnet-5.5",
      cacheRead: 400,
      cacheWrite: 100,
    },
    { type: "done", text: "All good.", session: { id: SESSION } },
  ]);
  // What a resumed chat used before isn't known: no usage is made up.
  expect(m.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before: null })).toEqual([
    { type: "done", text: "All good.", session: { id: SESSION } },
  ]);
  expect(totalsOf(totalsText(before))).toEqual(before);
  expect(totalsOf("1,2,x,4")).toBeNull();
  expect(totalsOf(undefined)).toBeNull();
});

test("a turn that went wrong: a limit, a sign-in that ended, anything else; words about tokens or authors aren't a sign-in", () => {
  expect(copilotProblem("Execution failed: You've hit your rate limit.", true)).toEqual([
    { type: "limit" },
    {
      type: "error",
      code: "plan_limit",
      message: "Execution failed: You've hit your rate limit.",
      retryable: true,
      worked: true,
    },
  ]);
  expect(copilotProblem("You've reached your weekly rate limit.")[1]).toMatchObject({ code: "plan_limit" });
  expect(copilotProblem("Error: No authentication information found.")[0]).toMatchObject({ code: "not_logged_in" });
  expect(
    copilotProblem("Error: Authentication token found but could not be validated.\nBad credentials")[0],
  ).toMatchObject({ code: "not_logged_in" });
  expect(copilotProblem('Execution failed: Model "x" is not available.')[0]).toMatchObject({ code: "copilot_failed" });
  expect(copilotProblem("The response hit max tokens for this author's request")[0]).toMatchObject({
    code: "copilot_failed",
  });
  const m = new CopilotEventMapper();
  m.push({ type: "session.error", data: { message: 'Execution failed: Model "x" is not available.' } });
  expect(m.finish({ exitCode: 1, stderr: "", sessionId: SESSION, before: null })).toEqual([
    {
      type: "error",
      code: "copilot_failed",
      message: 'Execution failed: Model "x" is not available.',
      retryable: true,
    },
  ]);
  // It ended with nothing at all: never an empty answer.
  expect(
    new CopilotEventMapper().finish({ exitCode: 0, stderr: "", sessionId: SESSION, before: null })[0],
  ).toMatchObject({ type: "error", code: "copilot_failed" });
});

test("the CLI's words: its device sign-in, and what a new session says of the sign-in and the models", () => {
  const login =
    "To authenticate, visit https://github.com/login/device and enter code 56AB-681F\nWaiting for authorization...\n";
  expect(parseCopilotLogin(login)).toEqual({ url: "https://github.com/login/device", userCode: "56AB-681F" });
  expect(parseCopilotLogin("To authenticate, visit https://github.com/login/device")).toBeNull();
  expect(parseCopilotLogin("visit https://evil.example/github.com and enter code 56AB-681F\n", true)).toBeNull();
  const requests = copilotLookInput("/tmp/look")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(requests.map((r) => r.method)).toEqual(["initialize", "session/new"]);
  expect(requests[1].params).toEqual({ cwd: "/tmp/look", mcpServers: [] });
  const session = "5e551011-0000-4000-8000-0000000000aa";
  const models = {
    availableModels: [
      { modelId: "auto", name: "Auto" },
      { modelId: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
      { modelId: "claude-sonnet-5.5", name: "again" },
      { modelId: "bad id; rm -rf", name: "x" },
    ],
  };
  expect(
    parseCopilotLook([
      "not json",
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { sessionId: session, models } }),
    ]),
  ).toEqual({
    signedIn: true,
    models: [
      { id: "auto", label: "Auto" },
      { id: "claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
    ],
    session,
  });
  expect(
    parseCopilotLook([
      JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "Authentication required" } }),
    ]),
  ).toEqual({ signedIn: false, models: [], said: "Authentication required" });
  // Any other refusal, or no answer at all, says nothing about the sign-in.
  expect(
    parseCopilotLook([JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32603, message: "Internal error" } })])
      .signedIn,
  ).toBeNull();
  expect(parseCopilotLook([]).signedIn).toBeNull();
});

test("an account folder is COPILOT_HOME, and no token or switch of the computer's or the agent's reaches the CLI", () => {
  const env = accountEnv("copilot", "/acc/x", {
    PATH: "/bin",
    COPILOT_HOME: "/root/.copilot",
    COPILOT_GITHUB_TOKEN: "github_pat_machine",
    COPILOT_ALLOW_ALL: "true",
    COPILOT_PROVIDER_BASE_URL: "https://elsewhere.example",
    GH_TOKEN: "gho_agent",
    GITHUB_TOKEN: "ghs_agent",
    KEEP: "1",
  });
  expect(env).toMatchObject({
    COPILOT_HOME: "/acc/x",
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_TELEMETRY_DISABLED: "true",
  });
  expect(env.KEEP).toBe("1");
  for (const name of [
    "COPILOT_GITHUB_TOKEN",
    "COPILOT_ALLOW_ALL",
    "COPILOT_PROVIDER_BASE_URL",
    "GH_TOKEN",
    "GITHUB_TOKEN",
  ]) {
    expect(env[name]).toBeUndefined();
  }
  // GitHub's own tokens still reach an agent on another CLI.
  expect(accountEnv("grok", "/acc/y", { GH_TOKEN: "gho_agent" }).GH_TOKEN).toBe("gho_agent");
  expect(isReservedSecretName("COPILOT_GITHUB_TOKEN")).toBe(true);
  expect(isReservedSecretName("GH_TOKEN")).toBe(false);
});

test("detection: the Copilot CLI's version line, and nothing else is run; another `copilot` is skipped", async () => {
  const ran: string[][] = [];
  const run = (version: string) => (command: string, args: string[]) => {
    if (command === "copilot") ran.push(args);
    return command === "copilot" ? { status: 0, stdout: `${version}\n` } : { status: 1, stdout: "" };
  };
  expect((await detectExecutors(run("GitHub Copilot CLI 1.0.109."))).found.copilot).toEqual({
    version: "GitHub Copilot CLI 1.0.109.",
  });
  // The computer's own Copilot is never opened to list models: only its version is asked.
  expect(ran).toEqual([["--version"]]);
  expect((await detectExecutors(run("copilot 0.1 (an editor's launcher)"))).found.copilot).toBeUndefined();
});

function turnContext(root: string) {
  const ws = path.join(root, "ws");
  const home = path.join(root, "home");
  const accountDir = path.join(root, "accounts", "copilot", ACCOUNT);
  for (const d of [ws, home, accountDir]) mkdirSync(d, { recursive: true });
  return {
    home,
    accountDir,
    ctx: {
      folder: ws,
      exec: true,
      runnerHome: home,
      mcp: { socketPath: path.join(home, "mcp.sock"), command: ["/usr/bin/agentes-runner"] },
      accounts: {
        accountDir: (kind: string, id: string) => (kind === "copilot" && id === ACCOUNT ? accountDir : null),
      },
      bin: BIN,
    },
  };
}

const turn = (over: Record<string, unknown> = {}) =>
  ({
    runId: RUN,
    kind: "copilot",
    session: { id: SESSION, resume: false },
    cwd: "",
    system: "You are Dev, the team's developer.",
    prompt: "run the tests",
    mcp: { token: "tok_run" },
    agent: AGENT,
    account: ACCOUNT,
    ...over,
  }) as CopilotBrainTurnRequest;

interface Logged {
  args: string[];
  cwd: string;
  home: string;
  run: string;
  token: string;
  ghToken: string | null;
  allowAll: string | null;
  autoUpdate: string | null;
  ghConfig: string | null;
  pid: number;
  settings: string | null;
  mcp: string | null;
  stdin: string;
}
const logOf = (file: string) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Logged);

async function runTurn(ctx: object, request: CopilotBrainTurnRequest) {
  const events: CodexBrainEvent[] = [];
  await handleCopilotBrainTurn(ctx as never, request, {
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  });
  return { events, final: events.at(-1) };
}
const textOf = (events: CodexBrainEvent[]) =>
  events
    .filter((e) => e.type === "text_delta")
    .map((e) => (e as { text: string }).text)
    .join("");

test("a fake Copilot: the first turn starts a session with the context on standard input and our bridge, the next resumes it with the new message only", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, home, accountDir } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const log = path.join(root, "copilot.log");
  process.env.FAKE_COPILOT_LOG = log;
  const saved = { gh: process.env.GH_TOKEN, all: process.env.COPILOT_ALLOW_ALL };
  process.env.GH_TOKEN = "gho_of_the_computer";
  process.env.COPILOT_ALLOW_ALL = "true";
  try {
    const { events, final } = await runTurn(ctx, turn());
    expect(final).toEqual({ type: "done", text: "All good.", session: { id: SESSION } });
    expect(textOf(events)).toBe("Let me check.\n\nAll good.");
    // Copilot's shell call is on the transcript with what it answered; the call to our bridge isn't (the engine ran it).
    expect(events.filter((e) => e.type === "tool_call")).toEqual([
      { type: "tool_call", id: "call_1", name: "bash", input: { command: "bun test" }, executed: { content: "ok" } },
    ]);
    expect(events.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      input: 1000,
      output: 40,
      source: "plan",
      model: "claude-sonnet-5.5",
      cacheRead: 400,
      cacheWrite: 100,
    });

    const [first] = logOf(log);
    // The message is on standard input, never an argument; the run and its token only in the env.
    expect(first?.stdin).toBe("You are Dev, the team's developer.\n\nrun the tests");
    expect(first?.args.join(" ")).not.toContain("run the tests");
    expect(first?.args.join(" ")).not.toContain("tok_run");
    expect(first?.args.some((a) => a.startsWith("--resume"))).toBe(false);
    expect(first).toMatchObject({ home: accountDir, run: RUN, token: "tok_run", autoUpdate: "false" });
    // The computer's own GitHub token and allow-all never reach the CLI.
    expect(first?.ghToken).toBeNull();
    expect(first?.allowAll).toBeNull();
    // Nor does the GitHub CLI's own sign-in: its config is a folder of the account's that every turn empties.
    expect(first?.ghConfig).toBe(path.join(accountDir, "no-gh"));
    expect(path.resolve(first?.cwd ?? "")).toBe(path.resolve(root, "ws"));
    expect(JSON.parse(first?.settings ?? "{}")).toMatchObject({ storeTokenPlaintext: true, disableAllHooks: true });
    expect(JSON.parse(first?.mcp ?? "{}").mcpServers[CODEX_MCP_SERVER]).toMatchObject({
      type: "local",
      command: "/usr/bin/agentes-runner",
      args: ["mcp"],
    });
    expect(first?.mcp).not.toContain("tok_run");
    const chats = JSON.parse(readFileSync(copilotChatsFile(home), "utf8"));
    expect(chats[`${ACCOUNT}:${SESSION}`]).toBe(FIRST);

    const next = await runTurn(ctx, turn({ runId: RUN.replace(/1$/, "2"), prompt: "and now?" }));
    expect(next.final).toMatchObject({ type: "done" });
    const second = logOf(log)[1];
    expect(second?.args).toContain(`--resume=${FIRST}`);
    expect(second?.stdin).toBe("and now?");
    // The CLI counts usage over the whole session: the second turn reports only what it added.
    expect(next.events.find((e) => e.type === "usage")).toMatchObject({ input: 1000, output: 40, cacheRead: 400 });

    // A session Copilot no longer has (another runner home, whose chats file names one): a new one, with the context.
    const other = turnContext(path.join(root, "other"));
    writeFileSync(path.join(other.accountDir, "fake-auth.json"), "{}");
    mkdirSync(path.dirname(copilotChatsFile(other.home)), { recursive: true });
    writeFileSync(
      copilotChatsFile(other.home),
      JSON.stringify({ [`${ACCOUNT}:${SESSION}`]: "c0c0c0c0-0000-4000-8000-0000000000ff" }),
    );
    const again = await runTurn(other.ctx, turn({ runId: RUN.replace(/1$/, "3"), prompt: "still there?" }));
    expect(again.final).toMatchObject({ type: "done" });
    expect(logOf(log).at(-1)?.stdin).toBe("You are Dev, the team's developer.\n\nstill there?");
    expect(
      logOf(log)
        .at(-1)
        ?.args.some((a) => a.startsWith("--resume")),
    ).toBe(false);
  } finally {
    if (saved.gh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = saved.gh;
    if (saved.all === undefined) delete process.env.COPILOT_ALLOW_ALL;
    else process.env.COPILOT_ALLOW_ALL = saved.all;
  }
}, 30_000);

test("an account's turn: none or gone refused, signed out is not_logged_in, a limit is plan_limit, the bridge by URL leaves no token behind", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, accountDir } = turnContext(root);
  const final = async (over: Record<string, unknown>, c: object = ctx) => (await runTurn(c, turn(over))).final;
  expect(await final({ account: undefined })).toMatchObject({ type: "error", code: "not_logged_in", retryable: false });
  // The folder is there but nobody signed in: the CLI's own words.
  expect(await final({ runId: RUN.replace(/1$/, "4") })).toMatchObject({ type: "error", code: "not_logged_in" });
  const gone = { ...ctx, accounts: { accountDir: () => null } };
  expect(await final({ runId: RUN.replace(/1$/, "5") }, gone)).toEqual({
    type: "error",
    code: "account_missing",
    message: expect.stringContaining("GitHub Copilot account"),
    retryable: false,
  });
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const limit = await runTurn(ctx, turn({ runId: RUN.replace(/1$/, "6"), prompt: "LIMIT" }));
  expect(limit.events.at(-2)).toEqual({ type: "limit" });
  expect(limit.final).toMatchObject({ type: "error", code: "plan_limit", retryable: true });

  const log = path.join(root, "copilot.log");
  process.env.FAKE_COPILOT_LOG = log;
  const run7 = RUN.replace(/1$/, "7");
  const http = await final({ runId: run7, mcp: { token: "tok_run", url: "https://bridge.example/mcp" } });
  expect(http).toMatchObject({ type: "done" });
  const seen = logOf(log).at(-1);
  expect(JSON.parse(seen?.mcp ?? "{}").mcpServers[CODEX_MCP_SERVER]).toMatchObject({
    type: "http",
    url: "https://bridge.example/mcp",
    headers: { Authorization: "Bearer tok_run" },
  });
  // The turn's own file went with it.
  expect(existsSync(path.join(accountDir, `agentes-mcp-${run7}.json`))).toBe(false);
  // The turn at its limit never spoke, so it left no chat: this one began it, with the context.
  expect(seen?.args.some((a) => a.startsWith("--resume"))).toBe(false);
  expect(seen?.stdin).toStartWith("You are Dev, the team's developer.");
}, 30_000);

test("our bridge failing to start stops the turn: an agent never answers without its tools", async () => {
  const m = new CopilotEventMapper();
  const status = (serverName: string, s: string) =>
    m.push({
      type: "session.mcp_server_status_changed",
      data: { serverName, status: s, error: "exited (exit code 1)" },
    });
  status(CODEX_MCP_SERVER, "pending");
  status(CODEX_MCP_SERVER, "connected");
  status("another-server", "failed");
  expect(m.bridgeDown).toBe("");
  status(CODEX_MCP_SERVER, "failed");
  expect(m.bridgeDown).toContain("exit code 1");

  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, accountDir } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const log = path.join(root, "copilot.log");
  process.env.FAKE_COPILOT_LOG = log;
  const { events, final } = await runTurn(ctx, turn({ prompt: "NO_BRIDGE hi" }));
  expect(final).toMatchObject({ type: "error", code: "copilot_failed", retryable: true });
  expect((final as { message: string }).message).toContain("tools didn't start");
  expect(events.some((e) => e.type === "done")).toBe(false);
  // The chat never began: the next turn starts it, with the context, and reports its usage.
  const next = await runTurn(ctx, turn({ runId: RUN.replace(/1$/, "9"), prompt: "second" }));
  expect(next.final).toMatchObject({ type: "done" });
  const second = logOf(log).at(-1);
  expect(second?.stdin).toBe("You are Dev, the team's developer.\n\nsecond");
  expect(second?.args.some((a) => a.startsWith("--resume"))).toBe(false);
  expect(next.events.find((e) => e.type === "usage")).toMatchObject({ input: 1000, output: 40 });
}, 30_000);

test("the team's right hand is refused before the CLI starts, and so is a model that isn't an id", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, accountDir } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const log = path.join(root, "copilot.log");
  process.env.FAKE_COPILOT_LOG = log;
  expect((await runTurn(ctx, turn({ permissions: { mode: "chat" } }))).final).toMatchObject({
    type: "error",
    code: "tools_not_locked",
    retryable: false,
  });
  await expect(runTurn(ctx, turn({ model: "gpt %PATH% & calc" }))).rejects.toMatchObject({ code: "bad_request" });
  expect(existsSync(log)).toBe(false);
  // An effort that isn't one of the levels never reaches the command line.
  const odd = await runTurn(ctx, turn({ effort: "%PATH%" as never }));
  expect(odd.final).toMatchObject({ type: "done" });
  expect(logOf(log).at(-1)?.args.join(" ")).not.toContain("--reasoning-effort");
});

test("the mapper: usage goes to the model that used most, a resumed session has started, and no words at all is no answer", () => {
  const usage = (inputTokens: number) => ({ usage: { inputTokens, outputTokens: 1 } });
  const m = new CopilotEventMapper();
  m.push({ type: "session.resume", data: {} });
  expect(m.started).toBe(true);
  m.push({ type: "assistant.message", data: { messageId: "a", content: "ok", toolRequests: [] } });
  m.push({
    type: "session.usage_checkpoint",
    data: { accountingSnapshot: { modelMetrics: { "gpt-small": usage(10), "claude-big": usage(9000) } } },
  });
  m.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  const before = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  expect(m.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before })[0]).toMatchObject({
    type: "usage",
    model: "claude-big",
  });
  expect(new CopilotEventMapper().started).toBe(false);
  // The CLI ended well and said nothing, used nothing: an update that renamed its events, not an answer.
  const silent = new CopilotEventMapper();
  silent.push({ type: "session.start", data: { sessionId: FIRST } });
  silent.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  expect(silent.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before })).toEqual([
    { type: "error", code: "copilot_failed", message: "Copilot CLI ended without an answer", retryable: true },
  ]);
});

test("usage is told once: a resumed turn that spent and then died moves on what the next turn starts from", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, accountDir } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const usageOf = async (n: string, prompt: string) => {
    const { events, final } = await runTurn(ctx, turn({ runId: RUN.replace(/1$/, n), prompt }));
    return { final, input: (events.find((e) => e.type === "usage") as { input?: number } | undefined)?.input };
  };
  expect(await usageOf("a", "first")).toMatchObject({ final: { type: "done" }, input: 1000 });
  expect(await usageOf("b", "CRASH")).toMatchObject({ final: { type: "error", code: "copilot_failed" }, input: 1000 });
  // The session has used 3000 by now; this turn's part is its own 1000, not the dead turn's again.
  expect(await usageOf("c", "third")).toMatchObject({ final: { type: "done" }, input: 1000 });
}, 30_000);

test("the mapper: this turn's model takes its usage, and a message with no words and no call isn't an answer", () => {
  const m = new CopilotEventMapper();
  m.push({ type: "session.resume", data: {} });
  m.push({ type: "session.model_change", data: { newModel: "gpt-small" } });
  m.push({ type: "assistant.message", data: { messageId: "a", content: "ok", toolRequests: [] } });
  m.push({
    type: "session.usage_checkpoint",
    data: {
      accountingSnapshot: {
        modelMetrics: {
          "claude-big": { usage: { inputTokens: 9000, outputTokens: 1 } },
          "gpt-small": { usage: { inputTokens: 300, outputTokens: 1 } },
        },
      },
    },
  });
  m.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  const before = { input: 9000, output: 1, cacheRead: 0, cacheWrite: 0 };
  expect(m.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before })[0]).toMatchObject({
    type: "usage",
    input: 300,
    model: "gpt-small",
  });
  const empty = new CopilotEventMapper();
  empty.push({ type: "session.start", data: { sessionId: FIRST } });
  empty.push({ type: "assistant.message_delta", data: { messageId: "a", deltaContent: "" } });
  empty.push({ type: "assistant.message", data: { messageId: "a", content: "", toolRequests: [] } });
  empty.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  expect(empty.acted).toBe(false);
  expect(empty.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before: null })[0]).toMatchObject({
    type: "error",
    code: "copilot_failed",
  });
  // A turn that only called our bridge did act: its answer may be empty.
  const called = new CopilotEventMapper();
  called.push({ type: "session.start", data: { sessionId: FIRST } });
  called.push({
    type: "tool.execution_start",
    data: { toolCallId: "c", toolName: "x", mcpServerName: CODEX_MCP_SERVER },
  });
  called.push({ type: "result", sessionId: FIRST, exitCode: 0 });
  expect(called.finish({ exitCode: 0, stderr: "", sessionId: SESSION, before: null })).toEqual([
    { type: "done", text: "", session: { id: SESSION } },
  ]);
});

test("the agent's secrets never leave: not in a tool's output, not in words split across two deltas, not in the answer", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { accountDir, home } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const secret = "s3cr3t-value-0123456789";
  const events: CodexBrainEvent[] = [];
  await runCopilotTurn(
    {
      runId: RUN,
      sessionId: SESSION,
      cwd: path.join(root, "ws"),
      system: "",
      prompt: "SAY_SECRET",
      mcp: { token: "tok_run" },
      account: { id: ACCOUNT, home: accountDir },
    },
    {
      chats: new CodexThreads(copilotChatsFile(home)),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
      env: { FAKE_SECRET: secret },
      redact: (text) => text.split(secret).join("[redacted]"),
      redactHold: secret.length - 1,
      bin: BIN,
    },
  );
  expect(events.at(-1)).toMatchObject({ type: "done" });
  expect(JSON.stringify(events)).not.toContain(secret);
  expect(textOf(events)).toStartWith("key [redacted]. Let me check.");
  expect(events.find((e) => e.type === "tool_call")).toMatchObject({
    input: { command: "bun test [redacted]" },
    executed: { content: "ok [redacted]" },
  });
  expect(events.at(-1)).toMatchObject({ text: "All good. [redacted]" });
}, 30_000);

test("a canceled turn ends as canceled, its process is gone, and the chat it never finished isn't kept", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, accountDir, home } = turnContext(root);
  writeFileSync(path.join(accountDir, "fake-auth.json"), "{}");
  const log = path.join(root, "copilot.log");
  process.env.FAKE_COPILOT_LOG = log;
  const abort = new AbortController();
  const events: CodexBrainEvent[] = [];
  const started = Date.now();
  await handleCopilotBrainTurn(ctx as never, turn({ prompt: "SLOW" }), {
    signal: abort.signal,
    emit: (e) => {
      events.push(e);
      // Its first words are out: the person stops it there.
      if (e.type === "text_delta") abort.abort();
    },
  });
  expect(events.at(-1)).toEqual({ type: "error", code: "canceled", message: "The turn was canceled." });
  expect(Date.now() - started).toBeLessThan(20_000);
  const pid = logOf(log).at(-1)?.pid ?? 0;
  expect(pid).toBeGreaterThan(0);
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  await waitFor(() => !alive(), 10_000);
  expect(existsSync(copilotChatsFile(home)) ? readFileSync(copilotChatsFile(home), "utf8") : "{}").not.toContain(
    SESSION,
  );
}, 40_000);

test("Copilot turned off on the computer refuses the turn", async () => {
  const root = tempDir("brain-copilot-");
  dirs.push(root);
  const { ctx, home } = turnContext(root);
  const off = {
    workspaceReal: ctx.folder,
    exec: true,
    token: "agm_x",
    codex: { runnerHome: home, runs: new Map(), accounts: ctx.accounts, mcp: ctx.mcp },
    access: () => ({ folders: [], tools: { claude: true, codex: true, copilot: false, commands: true } }),
  };
  const request = { op: "brain.turn", ...turn() } as MachineRequest;
  const scope = { signal: new AbortController().signal, output: () => {}, emit: () => {} };
  await expect(handleRequest(off as never, request, scope as never)).rejects.toMatchObject({ code: "not_allowed" });
});

test("a look at an account's sign-in: models when signed in, a sign-in asked for when not, and its session is removed", async () => {
  const home = tempDir("copilot-look-");
  dirs.push(home);
  const log = path.join(home, "look.log");
  process.env.FAKE_COPILOT_LOG = log;
  const env = accountEnv("copilot", home, process.env);
  expect(await copilotLook({ command: BIN, env, home })).toMatchObject({ signedIn: false, models: [], started: true });
  writeFileSync(path.join(home, "fake-auth.json"), "{}");
  const seen = await copilotLook({ command: BIN, env, home });
  expect(seen).toMatchObject({
    signedIn: true,
    models: [
      { id: "auto", label: "Auto" },
      { id: "claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
    ],
  });
  expect(existsSync(path.join(home, "session-state", seen.session ?? "x"))).toBe(false);
  const asked = logOf(log).at(-1) as unknown as { args: string[]; ghConfig: string | null };
  expect(asked.args).toEqual([
    "--acp",
    "--stdio",
    "--no-auto-update",
    "--disable-builtin-mcps",
    "--no-custom-instructions",
  ]);
  // An account's look never reads the GitHub CLI's own sign-in file.
  expect(asked.ghConfig).toBe(path.join(home, "no-gh"));
}, 30_000);

test("sign-in on the computer: GitHub's device page and code, then signed in, with the sign-in kept in the folder", async () => {
  const home = tempDir("copilot-accounts-");
  dirs.push(home);
  const log = path.join(home, "login.log");
  process.env.FAKE_COPILOT_LOG = log;
  const m = new AccountManager({
    root: path.join(home, "accounts"),
    orgId: () => ORG,
    commands: { copilot: [...BIN] },
  });
  managers.push(m);
  const id = "0193eeee-0000-7000-8000-0000000000d2";
  const begun = await m.begin("copilot", id);
  expect(begun).toMatchObject({ url: "https://github.com/login/device", userCode: "56AB-681F" });
  expect(begun.publicKey).toBeUndefined();
  await waitFor(() => m.status(id).state === "done", 10_000);
  expect(m.status(id).account).toMatchObject({ kind: "copilot", loggedIn: true });
  const dir = path.join(home, "accounts", "copilot", id);
  expect(m.accountDir("copilot", id)).toBe(dir);
  // The CLI found our settings before it signed in.
  const login = logOf(log).find((l) => l.args[0] === "login");
  expect(login?.args).toEqual(["login", "--device-code"]);
  expect(JSON.parse(login?.settings ?? "{}")).toMatchObject({ storeTokenPlaintext: true });
  expect(login?.home).toBe(dir);
}, 30_000);
