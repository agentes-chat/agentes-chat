import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandProfile } from "@agenteschat/adapters/command-policy";
import type { AgentScope, BrainEffort } from "@agenteschat/adapters/machine-protocol";
import { isAccountId } from "@agenteschat/adapters/machine-protocol";
import { redactSecrets } from "@agenteschat/adapters/secret-box";
import { ACCOUNT_MISSING_MESSAGE, accountEnv, commandcodeKeyOf } from "./accounts";
import { ACP_METHOD_NOT_FOUND, ACP_PROTOCOL_VERSION, AcpConnection, AcpError } from "./acp";
import {
  CODEX_TOOL_OUTPUT_MAX,
  type CodexBrainEvent,
  CodexThreads,
  chatFolder,
  codexProfileOf,
  codexThreadKey,
} from "./brain-codex";
import { acpProblem, githubConfigDir, opencodeBridge, opencodePrompt } from "./brain-opencode";
import { RunnerError } from "./errors";
import { killTree } from "./exec";
import { COMMANDCODE_BIN, cliSpawn, envValue } from "./executors";
import { CODEX_MCP_SERVER, redactDeep } from "./mcp";
import { resolveForAgent } from "./paths";
import type { Spawn } from "./scope-gate";
import { agentSecrets } from "./secrets";

/**
 * The Command Code branch of `brain.turn` (protocol 80, ADR 0221): one agent turn as one `command-code acp` process,
 * driven through `acp.ts` as OpenCode's is. Read in Command Code 1.89.1's bundled docs (`permissions.md`, `hooks.md`,
 * `mcp.md`, `sessions.md`) and run against it with a real key (2026-11-15).
 *
 * - Always an account: its folder is the CLI's `HOME` (`accountEnv`), where it keeps everything (`.commandcode`), and
 *   its sealed key is `COMMAND_CODE_API_KEY`, the only way the CLI is signed in (no `cmd login`). A turn without one
 *   is refused: the computer's own sign-in would need our permission rules in the person's own settings.
 * - Before every turn the account's `.commandcode` loses everything but what the CLI itself keeps between runs
 *   (`COMMANDCODE_HOME_KEPT`: sessions, file history, caches), so nothing a turn left there (hooks, mods, skills,
 *   agents, providers, MCP servers, memory, another sign-in) loads in a later turn of another agent or Lodi; then
 *   `settings.json` is written whole with the turn's rules. `--safe-mode` (built-in mods only) and `--no-auto-update`
 *   on every turn, `DO_NOT_TRACK=1` (no telemetry).
 * - Permissions (ADR 0053 §3): rules in `settings.json`, where `deny` wins in every mode. `work` is `default` mode with
 *   our bridge allowed; what the CLI asks (`session/request_permission`: writes, commands, other MCP tools) is allowed
 *   unless it names a path outside the agent's folder and those allowed to it (its fields and the paths its command
 *   names); a refused request ends the turn, and one with nothing said says what it was. `plan` denies edits, writes and the shell. A `chat` turn (the
 *   team's right hand, protocol 41) is `dont-ask` with every built-in denied and our bridge alone allowed, and runs in
 *   an empty folder with no skills. The CLI still shows the model its own tools and refuses each call by those rules
 *   ("Permission denied"), which the model reads and goes on; a tool of its own that finishes anyway (the rules didn't
 *   hold) stops the turn at once, whatever it said.
 * - The session: our session → Command Code's in `<runner home>/brain/commandcode-sessions.json`, per account and
 *   folder, resumed with `session/resume`; one it no longer has starts over with the engine's context leading the
 *   first prompt (ACP has no system prompt). The model and the effort are `session/set_config_option`.
 * - Events: `agent_message_chunk` streams the text; a tool call of its own, once ended, is an executed `tool_call`
 *   (transcript only; our bridge's are the engine's); the prompt's answer carries the tokens, whose `inputTokens`
 *   already holds the cached ones. No live steering: `brain.steer` answers `unsupported`.
 * - Silence: a turn that hears nothing for `COMMANDCODE_SILENCE_MS` with no tool running stops and says why.
 * - Usage is the person's (`source: "plan"`, cost zero for us): Command Code bills their key.
 */

/** After asking the CLI to stop, how long the turn waits for it before the process is killed. */
const STOP_WAIT_MS = 8000;
/** After the turn, how long the process may take to exit by itself (its input closed) before it is killed. */
const EXIT_GRACE_MS = 3000;
/** How long a process told to end (SIGTERM, then SIGKILL) has to go before the turn stops waiting for it. */
const KILL_WAIT_MS = 2000;
/** How long each step of starting (initialize, the session, the model) may take. */
const SETUP_TIMEOUT_MS = 120_000;
/** A turn that hears nothing from the CLI this long, with no tool running, stops (see the header). */
export const COMMANDCODE_SILENCE_MS = 5 * 60_000;

/** `brain.turn` with `kind: "commandcode"`. */
export interface CommandcodeBrainTurnRequest {
  runId: string;
  kind: "commandcode";
  session: { id: string; resume: boolean };
  cwd?: string;
  model?: string;
  effort?: BrainEffort;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string; tools?: string };
  agent?: AgentScope;
  account?: string;
  permissions?: { mode?: "plan" | "work" | "chat" };
  keepAlive?: boolean;
}

/** Where our session → Command Code session ids live in the runner home. */
export const commandcodeSessionsFile = (runnerHome: string) =>
  path.join(runnerHome, "brain", "commandcode-sessions.json");

/** The CLI's folder in its home. */
export const commandcodeDir = (home: string) => path.join(home, ".commandcode");

/**
 * What the CLI keeps in `.commandcode` between runs and reads only as its own data: its sessions (`projects`), the
 * file history its checkpoints restore, caches, its install id and update notes, its first-run flag. Everything else
 * there is removed before a turn.
 */
export const COMMANDCODE_HOME_KEPT: ReadonlySet<string> = new Set([
  "projects",
  "file-history",
  "cache",
  "config.json",
  "history.jsonl",
  "telemetry-install-id",
  "updates.json",
]);

/** What the CLI would read from the home itself, outside `.commandcode`: removed before a turn too. */
const HOME_LOADED = [".agents", "AGENTS.md"] as const;

/** Our bridge's tools as the CLI names them (`mcp__<server>__<tool>`). */
const BRIDGE_PREFIX = `mcp__${CODEX_MCP_SERVER}__`;

/**
 * The CLI's own tools a `chat` turn may finish: `search_tools` only loads the schemas of the bridge's (deferred), and a
 * subagent (`agent`, which the rules don't gate) meets the same rules for every tool it calls.
 */
const CHAT_META_TOOLS: ReadonlySet<string> = new Set(["search_tools", "agent"]);

/** Every built-in a rule can name (`permissions.md`'s friendly names). */
const BUILT_INS = ["Shell", "Read", "Edit", "Write", "WebFetch", "WebSearch"] as const;

/** The turn's `settings.json`: the mode and rules for its profile (see the header). */
export function commandcodeSettings(profile: CommandProfile, chat = false): Record<string, unknown> {
  const allow = [`${BRIDGE_PREFIX}*`];
  if (chat) return { permissions: { defaultMode: "dont-ask", deny: [...BUILT_INS], allow } };
  if (profile === "plan") return { permissions: { defaultMode: "default", deny: ["Edit", "Write", "Shell"], allow } };
  return { permissions: { defaultMode: "default", allow } };
}

/** Written whole, then renamed (600). */
function writeWhole(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The account's home before a turn: emptied of what a turn could have left for the next (see the header). */
export function prepareCommandcodeHome(home: string, settings: Record<string, unknown>) {
  const dir = commandcodeDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(dir)) {
    if (!COMMANDCODE_HOME_KEPT.has(name)) rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  for (const name of HOME_LOADED) rmSync(path.join(home, name), { recursive: true, force: true });
  writeWhole(path.join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

/** The text a settings file holds now (tests). */
export const readCommandcodeSettings = (home: string): unknown =>
  JSON.parse(readFileSync(path.join(commandcodeDir(home), "settings.json"), "utf8"));

/**
 * The model id its session takes for `wanted`: `--list-models` prints ids in lowercase and Claude Haiku 4.5 without its
 * date (`moonshotai/kimi-k3.1-pro`, `claude-haiku-4-5`), but `session/set_config_option` takes only the session's own
 * spelling (`moonshotai/Kimi-K3.1-Pro`, `claude-haiku-4-5-20251001`). The exact id, else one that differs only in case,
 * else the one it begins; `wanted` as is when the session lists none of them (its refusal then says so).
 */
export function commandcodeModelId(wanted: string, options: readonly Record<string, unknown>[]): string {
  const model = options.find((o) => o.id === "model");
  const values = (Array.isArray(model?.options) ? model.options : [])
    .map((o) => (isRecord(o) ? str(o.value) : ""))
    .filter(Boolean);
  const lower = wanted.toLowerCase();
  return (
    values.find((v) => v === wanted) ??
    values.find((v) => v.toLowerCase() === lower) ??
    values.find((v) => v.toLowerCase().startsWith(`${lower}-`)) ??
    wanted
  );
}

/** The CLI's effort levels (`effort` option: `default`, `off`, `low`, `high`, `max`) for ours. */
export const commandcodeEffort = (effort: BrainEffort | undefined): string | undefined =>
  effort === "low" ? "low" : effort === "high" ? "high" : effort === "xhigh" || effort === "max" ? "max" : undefined;

const USAGE_LIMIT =
  /usage limit|rate.?limit|too many requests|\b429\b|quota|insufficient (?:balance|credits|funds)|out of (?:credits|usage)|spend(?:ing)? limit|\b402\b/i;
/** The CLI can't authenticate (a revoked or wrong key). */
export const COMMANDCODE_AUTH =
  /\b401\b|unauthori[sz]ed|invalid 'authorization'|not authenticated|invalid (?:api )?key/i;

/** How a turn that went wrong ends: `limit` then `plan_limit`, `not_logged_in`, or `commandcode_failed`. */
export function commandcodeProblem(problem: string, worked = false): CodexBrainEvent[] {
  // "POST /alpha/generate → 403 error: MODEL_NOT_IN_PLAN: …": Command Code's words after its route.
  const said = problem.replace(/^POST \S+ → /, "");
  if (USAGE_LIMIT.test(said)) return [{ type: "limit" }, { type: "error", code: "plan_limit", message: said, worked }];
  if (COMMANDCODE_AUTH.test(said)) return [{ type: "error", code: "not_logged_in", message: said, retryable: true }];
  return [{ type: "error", code: "commandcode_failed", message: said, retryable: !/MODEL_NOT_IN_PLAN/.test(said) }];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cut = (text: string) =>
  text.length > CODEX_TOOL_OUTPUT_MAX ? `${text.slice(0, CODEX_TOOL_OUTPUT_MAX)}\n…` : text;

/** The text of a tool call's ACP content (`[{ type: "content", content: { type: "text", text } }]`). */
function toolText(update: Record<string, unknown>, failed: boolean): string {
  const blocks = Array.isArray(update.content) ? update.content : [];
  const text = blocks
    .map((b) => (isRecord(b) && isRecord(b.content) && b.content.type === "text" ? str(b.content.text) : ""))
    .filter(Boolean)
    .join("\n");
  return text || (failed ? "The tool failed." : "");
}

/** What a command may name outside its folder: the null device and the process's own streams. */
const DEVICES = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/**
 * The paths a shell command names (`/…`, `~…`, `..…`, also right after a redirection or `=`), from its words as the
 * shell would split them, quotes kept together. A heuristic, as OpenCode's own check of its commands: a path built at
 * run time (`$HOME`, `$(pwd)/..`) isn't seen.
 */
export function commandPaths(command: string): string[] {
  const words = command.match(/"[^"]*"|'[^']*'|[^\s;&|()]+/g) ?? [];
  return words
    .map((w) => w.replace(/^["']|["']$/g, "").replace(/^(?:\d?>>?|<|&>|[\w-]+=)/, ""))
    .filter((w) => /^(?:\/|~|\.\.(?:\/|$))/.test(w));
}

/**
 * A tool call's paths that fall outside `cwd` and every other folder given (`file_path`, `path`, `notebook_path`, the
 * shell's `cwd`, and those its command names): what a `work` turn refuses when the CLI asks. `~` is the computer
 * user's home, never the turn's.
 */
export function outsidePaths(input: unknown, cwd: string | readonly string[], home = os.homedir()): string[] {
  if (!isRecord(input)) return [];
  const roots = (typeof cwd === "string" ? [cwd] : cwd).map((r) => path.resolve(r));
  const root = roots[0] ?? path.resolve(".");
  const named = ["file_path", "path", "notebook_path", "cwd"].map((k) => str(input[k])).filter(Boolean);
  const command = str(input.command);
  return [...named, ...(command ? commandPaths(command) : [])].filter((p) => {
    if (DEVICES.has(p)) return false;
    const abs = p.startsWith("~") ? path.join(home, p.slice(1)) : path.resolve(root, p);
    return !roots.some((r) => abs === r || abs.startsWith(`${r}${path.sep}`));
  });
}

/** What the agent is told, in the same session, after the runner refused a request of its CLI and the turn ended. */
export function refusedPrompt(refused: string): string {
  return [
    `[agentes.chat] Your request to ${refused} was refused: on this computer you may change only your own folder and`,
    "the folders allowed to you. Don't try it another way. Answer the person now, in their language: say what you",
    "couldn't do and why, and that they can allow a folder with `agentes-runner folders allow <folder>`.",
  ].join(" ");
}

/** What the CLI says of a call its rules or the runner refused (1.89.1: "Permission denied by the user."). */
const REFUSED = /^Permission denied\b/i;

/** One turn's `session/update`s → brain events, plus what the turn's end needs. */
export class CommandcodeTurnReader {
  streamed = "";
  /** The text after the turn's last tool call: its answer (what came before was narration). */
  answer = "";
  worked = false;
  /** Tool calls started and not ended (the silence check waits while one runs). */
  readonly running = new Set<string>();
  /** A tool of the CLI's own in a `chat` turn: why the turn stops. */
  breach?: string;
  private readonly tools = new Map<string, { name: string; input: unknown }>();
  private afterTool = false;

  constructor(private readonly opts: { chat?: boolean; redact?: (text: string) => string } = {}) {}

  private clean(text: string) {
    return this.opts.redact ? this.opts.redact(text) : text;
  }

  update(update: unknown): CodexBrainEvent[] {
    if (!isRecord(update)) return [];
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = isRecord(update.content) ? update.content : {};
        if (content.type !== "text") return [];
        const said = this.clean(str(content.text));
        if (!said) return [];
        // Text after a tool call is a paragraph of its own.
        const lead = this.afterTool && this.streamed && !this.streamed.endsWith("\n") ? "\n\n" : "";
        this.afterTool = false;
        this.streamed += lead + said;
        this.answer += said;
        return [{ type: "text_delta", text: lead + said }];
      }
      case "tool_call": {
        const id = str(update.toolCallId);
        if (!id) return [];
        // Its title names the tool (`mcp__…`, `search_tools`, `agent`) or describes the call (`Shell: …`, `Read: …`).
        const title = (str(update.title) || "tool").slice(0, 128);
        this.tools.set(id, { name: title, input: update.rawInput ?? {} });
        this.running.add(id);
        this.answer = "";
        this.afterTool = true;
        return [];
      }
      case "tool_call_update": {
        const id = str(update.toolCallId);
        const tool = this.tools.get(id);
        if (!tool) return [];
        if (update.rawInput !== undefined) tool.input = update.rawInput;
        const status = str(update.status);
        if (status !== "completed" && status !== "failed") return [];
        this.running.delete(id);
        this.tools.delete(id);
        const failed = status === "failed";
        // A call the CLI refused by its rules or our answer never ran: nothing done, nothing for the transcript (the
        // engine would list it as done, not to be repeated).
        if (failed && REFUSED.test(toolText(update, true))) return [];
        this.worked = true;
        const ours = tool.name.startsWith(BRIDGE_PREFIX) || CHAT_META_TOOLS.has(tool.name);
        // A `chat` turn: the CLI refuses its own tools by the settings' rules (the model still sees them, and may try
        // one); one that ran anyway means the rules didn't hold.
        if (this.opts.chat && !ours && status === "completed" && !this.breach) {
          this.breach = `Command Code ran a tool of its own (${tool.name}), so the turn stopped.`;
          return [];
        }
        // Our bridge's tools: the engine records its own calls; `search_tools` only loaded their schemas.
        if (tool.name.startsWith(BRIDGE_PREFIX) || CHAT_META_TOOLS.has(tool.name)) return [];
        return [
          {
            type: "tool_call",
            id,
            name: tool.name,
            input: redactDeep(isRecord(tool.input) ? tool.input : {}, (t) => this.clean(t)),
            executed: { content: cut(this.clean(toolText(update, failed))), ...(failed ? { isError: true } : {}) },
          },
        ];
      }
      default:
        return [];
    }
  }

  /** The prompt's `usage` as our event: its `inputTokens` already count the cached ones, read and written. */
  usage(usage: unknown, model?: string): CodexBrainEvent[] {
    if (!isRecord(usage)) return [];
    const cacheRead = num(usage.cachedReadTokens);
    const cacheWrite = num(usage.cachedWriteTokens);
    const input = Math.max(num(usage.inputTokens), cacheRead + cacheWrite);
    const output = num(usage.outputTokens) + num(usage.thoughtTokens);
    if (!input && !output) return [];
    return [
      {
        type: "usage",
        input,
        output,
        source: "plan",
        ...(model ? { model } : {}),
        ...(cacheRead ? { cacheRead } : {}),
        ...(cacheWrite ? { cacheWrite } : {}),
      },
    ];
  }
}

export interface CommandcodeTurnInput {
  runId: string;
  sessionId: string;
  cwd: string;
  model?: string;
  effort?: BrainEffort;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string };
  /** The account (its sessions are its own): its folder, and its key. */
  account: { id: string; home: string; key: string };
  profile?: CommandProfile;
  /** Folders besides `cwd` the turn may change: the agent's own and those allowed to it (`folders allow`). */
  roots?: string[];
  /** Protocol 41: the team's right hand, every built-in off, stopped at the first one it calls anyway. */
  chat?: boolean;
}

export interface CommandcodeTurnOptions {
  sessions: CodexThreads;
  emit: (event: CodexBrainEvent) => void;
  signal: AbortSignal;
  mcpCommand?: string[];
  socketPath?: string;
  runnerHome: string;
  env?: Record<string, string>;
  redact?: (text: string) => string;
  /** Tests: the executable, how it starts, the system, the silence limit, and the exit grace. */
  bin?: string;
  spawn?: Spawn;
  platform?: NodeJS.Platform;
  silenceMs?: number;
  exitGraceMs?: number;
}

/** The session key: per account and folder (a resumed session keeps the folder it started in). */
export const commandcodeSessionKey = (sessionId: string, account: string, cwd: string) =>
  `${codexThreadKey(sessionId, account)}|${cwd}`;

/** The env one turn's `command-code acp` runs with (see the header). */
export function commandcodeTurnEnv(input: {
  inherited: NodeJS.ProcessEnv;
  cwd: string;
  account: { home: string; key: string };
  platform?: NodeJS.Platform;
}): NodeJS.ProcessEnv {
  const platform = input.platform ?? process.platform;
  const home =
    envValue(input.inherited, "HOME", platform) || envValue(input.inherited, "USERPROFILE", platform) || os.homedir();
  const env = accountEnv("commandcode", input.account.home, input.inherited);
  // The agent's commands run with the account's folder as their home: gh and git keep finding what they had.
  env.GH_CONFIG_DIR = githubConfigDir(input.inherited, home, platform);
  const gitconfig = path.join(home, ".gitconfig");
  if (!envValue(input.inherited, "GIT_CONFIG_GLOBAL", platform) && existsSync(gitconfig))
    env.GIT_CONFIG_GLOBAL = gitconfig;
  env.COMMAND_CODE_API_KEY = input.account.key;
  env.DO_NOT_TRACK = "1";
  env.PWD = input.cwd;
  return env;
}

/** The argv after the executable: ACP, built-in mods only, no self-update; no skills in a `chat` turn. */
export const commandcodeArgs = (chat: boolean) => [
  "acp",
  "--safe-mode",
  "--no-auto-update",
  ...(chat ? ["--no-skills"] : []),
];

/** `p`, or a rejection after `ms` (the timer cleared either way). */
function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Whether the process has exited within `ms`. */
const goneWithin = (exited: Promise<unknown>, ms: number) =>
  within(
    exited.then(() => true),
    ms,
    "",
  ).catch(() => false);

/** An error that carries how the process ended (it closed the connection). */
type ExitError = Error & { exit?: { code: number | null; error?: Error } };

/** Runs one Command Code turn and emits its events; ends with exactly one `done` or `error`. Never throws. */
export async function runCommandcodeTurn(input: CommandcodeTurnInput, opts: CommandcodeTurnOptions): Promise<void> {
  const platform = opts.platform ?? process.platform;
  let ended = false;
  const emit = (event: CodexBrainEvent) => {
    if (ended) return;
    if (event.type === "done" || event.type === "error") ended = true;
    opts.emit(event);
  };
  const fail = (code: string, message: string, retryable?: boolean) =>
    emit({ type: "error", code, message, ...(retryable ? { retryable } : {}) });

  const profile = input.profile ?? "work";
  const chat = Boolean(input.chat);
  try {
    prepareCommandcodeHome(input.account.home, commandcodeSettings(profile, chat));
  } catch (err) {
    return fail("commandcode_failed", err instanceof Error ? err.message : String(err), true);
  }
  const inherited: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const env = commandcodeTurnEnv({ inherited, cwd: input.cwd, account: input.account, platform });
  const key = input.account.key;
  // The agent's shell could print the key (its env, its file in the account's folder).
  const redact = (text: string) =>
    redactSecrets(opts.redact ? opts.redact(text) : text, [{ name: "COMMAND_CODE_API_KEY", value: key }]);

  const run = cliSpawn([opts.bin ?? COMMANDCODE_BIN], commandcodeArgs(chat), envValue(env, "PATH", platform), platform);
  let child: ChildProcess;
  try {
    child = (opts.spawn ?? spawn)(run.file, run.args, {
      cwd: input.cwd,
      env: run.env ? { ...env, ...run.env } : env,
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so `killTree` takes what it started along.
      detached: platform !== "win32",
      windowsHide: true,
      ...(run.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return fail(
      missing ? "commandcode_missing" : "commandcode_failed",
      missing ? "Command Code's CLI is not installed on this computer." : String(err),
      true,
    );
  }

  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => {
    // Its log lines (`[acp] session … created`) are kept only to say why it exited.
    stderr = (stderr + c.toString("utf8")).slice(-2000);
  });
  const reader = new CommandcodeTurnReader({ ...(chat ? { chat: true } : {}), redact });
  const sessionKey = commandcodeSessionKey(input.sessionId, input.account.id, input.cwd);
  const s = {
    sessionId: null as string | null,
    admitted: false,
    refused: null as string | null,
    stopping: null as "canceled" | "silence" | "breach" | null,
    killTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  };
  // The session holds the prompt (and the context it led with) once the CLI took it: kept for the next turn.
  const admit = () => {
    if (s.admitted || !s.sessionId) return;
    s.admitted = true;
    opts.sessions.set(sessionKey, s.sessionId);
  };

  const conn = new AcpConnection(
    child.stdin as NonNullable<ChildProcess["stdin"]>,
    child.stdout as NonNullable<ChildProcess["stdout"]>,
    {
      onNotification(method, params) {
        if (method !== "session/update" || !isRecord(params) || params.sessionId !== s.sessionId) return;
        // A `chat` turn that met a tool of the CLI's own says nothing more: what that tool did goes nowhere.
        if (s.stopping === "breach") return;
        admit();
        const events = reader.update(params.update);
        if (reader.breach) return stop("breach");
        for (const event of events) emit(event);
      },
      onRequest(method, params) {
        if (method !== "session/request_permission") {
          throw new AcpError(ACP_METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
        const p = isRecord(params) ? params : {};
        const call = isRecord(p.toolCall) ? p.toolCall : {};
        const options = Array.isArray(p.options) ? p.options.filter(isRecord) : [];
        const pick = (kind: string) => options.find((o) => str(o.kind) === kind);
        // A `work` turn's own folder is its to change; nothing outside it, and nothing at all in `plan` or `chat`.
        const outside = outsidePaths(call.rawInput, [input.cwd, ...(input.roots ?? [])]);
        const allow = profile === "work" && !chat && !outside.length ? pick("allow_once") : undefined;
        if (allow) return { outcome: { outcome: "selected", optionId: str(allow.optionId) } };
        s.refused ??= outside.length
          ? `${str(call.title) || "use a tool"} outside its folder (${outside[0]})`
          : str(call.title) || "use a tool";
        const reject = pick("reject_once") ?? options.find((o) => str(o.kind).startsWith("reject"));
        return reject
          ? { outcome: { outcome: "selected", optionId: str(reject.optionId) } }
          : { outcome: { outcome: "cancelled" } };
      },
    },
  );

  const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    const proc = child as unknown as EventEmitter;
    proc.on("error", (error: Error) => resolve({ code: null, error }));
    proc.on("close", (code: number | null) => resolve({ code }));
  });
  void exited.then(({ code, error }) => {
    const why =
      error?.message ?? `Command Code exited with code ${code ?? "?"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`;
    const closed: ExitError = new Error(redact(why));
    closed.exit = { code, ...(error ? { error } : {}) };
    conn.close(closed);
  });

  /** Asks the CLI to stop the turn, then kills it if it doesn't. */
  function stop(why: "canceled" | "silence" | "breach") {
    if (s.stopping) return;
    s.stopping = why;
    if (s.sessionId) conn.notify("session/cancel", { sessionId: s.sessionId });
    s.killTimer = setTimeout(() => killTree(child, "SIGKILL"), why === "breach" ? 0 : STOP_WAIT_MS);
  }
  const onAbort = () => stop("canceled");
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener("abort", onAbort, { once: true });
  const silenceMs = opts.silenceMs ?? COMMANDCODE_SILENCE_MS;
  const silence = setInterval(
    () => {
      if (s.sessionId && reader.running.size === 0 && Date.now() - conn.lastHeard > silenceMs) stop("silence");
    },
    Math.min(15_000, Math.max(50, silenceMs / 4)),
  );
  const setup = <T>(p: Promise<T>) => within(p, SETUP_TIMEOUT_MS, "Command Code took too long to start");
  /** A turn we stopped ends with why (true), whatever the CLI answered meanwhile. */
  const stopped = () => {
    if (s.stopping === "canceled") fail("canceled", "The turn was canceled.");
    else if (s.stopping === "breach") {
      fail("tools_not_locked", reader.breach ?? "Command Code ran a tool of its own, so the turn stopped.");
    } else if (s.stopping === "silence") {
      const span =
        silenceMs >= 60_000 ? `${Math.round(silenceMs / 60_000)} minutes` : `${Math.round(silenceMs / 1000)} seconds`;
      fail(
        "commandcode_failed",
        `Command Code said nothing for ${span} with no tool running, so the turn stopped.`,
        true,
      );
    }
    return s.stopping !== null;
  };

  try {
    const init = await setup(
      conn.request<Record<string, unknown> | null>("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "agentes-runner", version: "1" },
      }),
    );
    const caps = isRecord(init?.agentCapabilities) ? init.agentCapabilities : {};
    const sessionCaps = isRecord(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
    const bridge = opencodeBridge({
      runId: input.runId,
      token: input.mcp.token,
      ...(input.mcp.url ? { url: input.mcp.url } : {}),
      ...(opts.mcpCommand ? { command: opts.mcpCommand } : {}),
      ...(opts.socketPath ? { socketPath: opts.socketPath } : {}),
      runnerHome: opts.runnerHome,
    });

    // A stored session is resumed; one the CLI no longer has starts over, with the context.
    const stored = opts.sessions.get(sessionKey);
    let opened: Record<string, unknown> | null = null;
    if (stored && isRecord(sessionCaps.resume) && !s.stopping) {
      s.sessionId = stored;
      opened = await setup(
        conn.request<Record<string, unknown> | null>("session/resume", {
          sessionId: stored,
          cwd: input.cwd,
          mcpServers: [bridge],
        }),
      ).then(
        (r) => r ?? {},
        () => null,
      );
      if (opened) s.admitted = true;
      else {
        s.sessionId = null;
        opts.sessions.delete(sessionKey);
      }
    } else if (stored) opts.sessions.delete(sessionKey);
    const fresh = !opened;
    if (fresh && !s.stopping) {
      opened = await setup(
        conn.request<Record<string, unknown> | null>("session/new", { cwd: input.cwd, mcpServers: [bridge] }),
      );
      s.sessionId = str(opened?.sessionId) || null;
      if (!s.sessionId) throw new Error("Command Code didn't start a session");
    }
    const options = Array.isArray(opened?.configOptions) ? opened.configOptions.filter(isRecord) : [];
    const setOption = async (configId: string, value: string) => {
      if (!s.sessionId || s.stopping) return;
      if (str(options.find((o) => o.id === configId)?.currentValue) === value) return;
      await setup(conn.request("session/set_config_option", { sessionId: s.sessionId, configId, value })).catch(
        (err: unknown) => {
          throw new Error(`Command Code here doesn't offer ${value}: ${acpProblem(err).message}`);
        },
      );
    };
    if (input.model) await setOption("model", commandcodeModelId(input.model, options));
    const effort = commandcodeEffort(input.effort);
    // A model with no effort of its own lists none: the turn runs at its default.
    if (effort && options.some((o) => o.id === "effort")) await setOption("effort", effort).catch(() => undefined);

    if (stopped()) return;
    const ask = async (text: string) => {
      const asked = await conn
        .request<Record<string, unknown> | null>("session/prompt", {
          sessionId: s.sessionId,
          prompt: [{ type: "text", text }],
        })
        .then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      if (asked.ok) {
        admit();
        for (const event of reader.usage(asked.result?.usage, input.model)) emit(event);
      }
      return asked;
    };
    let answer = await ask(opencodePrompt(input.system, input.prompt, fresh));
    if (stopped()) return;
    // A refused request ends the CLI's turn, as a person's "no" does in its terminal, often with nothing said. The
    // agent is told why in the same session, once, and answers the person in its own words.
    const refusal = s.refused;
    if (
      refusal &&
      answer.ok &&
      !(reader.answer || reader.streamed).trim() &&
      str(answer.result?.stopReason) !== "refusal"
    ) {
      answer = await ask(refusedPrompt(refusal));
      if (stopped()) return;
    }
    if (!answer.ok) {
      if ((answer.error as ExitError).exit) throw answer.error;
      const problem = acpProblem(answer.error);
      if (problem.auth) return fail("not_logged_in", problem.message, true);
      for (const event of commandcodeProblem(problem.message, reader.worked)) emit(event);
      return;
    }
    const stopReason = str(answer.result?.stopReason);
    if (stopReason === "cancelled") {
      return fail(
        "commandcode_failed",
        refusal
          ? `Command Code asked for permission to ${refusal}, which this agent may not do here, so the turn stopped.`
          : "Command Code stopped the turn by itself.",
        true,
      );
    }
    const text = reader.answer || reader.streamed;
    if (stopReason === "refusal" && !text.trim()) return fail("model_refused", "The model refused to answer.");
    // Still nothing said after being told: the turn says what was refused.
    if (refusal && !text.trim()) {
      return fail(
        "commandcode_failed",
        `Command Code asked for permission to ${refusal}, which this agent may not do here, so the turn stopped.`,
      );
    }
    emit({ type: "done", text, session: { id: input.sessionId } });
  } catch (err) {
    if (stopped()) return;
    const exit = (err as ExitError).exit;
    if ((exit?.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return fail("commandcode_missing", "Command Code's CLI is not installed on this computer.", true);
    }
    const problem = acpProblem(err);
    if (problem.auth) return fail("not_logged_in", problem.message, true);
    for (const event of commandcodeProblem(problem.message, reader.worked)) emit(event);
  } finally {
    clearInterval(silence);
    clearTimeout(s.killTimer);
    opts.signal.removeEventListener("abort", onAbort);
    conn.close();
    if (!ended) fail("commandcode_failed", "Command Code ended without an answer.", true);
    // Done: its input closed, it exits by itself; still running after the grace, it is ended with its tree. The turn
    // returns once it has gone, so nothing it started (our bridge's process among them) outlives the turn's token.
    child.stdin?.end();
    if (!(await goneWithin(exited, s.stopping === "breach" ? 0 : (opts.exitGraceMs ?? EXIT_GRACE_MS)))) {
      killTree(child, "SIGTERM");
      if (!(await goneWithin(exited, KILL_WAIT_MS))) {
        killTree(child, "SIGKILL");
        await goneWithin(exited, KILL_WAIT_MS);
      }
    }
  }
}

/** What the runner's `brain.turn` handler hands the Command Code branch. */
export interface CommandcodeBrainContext {
  folder: string;
  exec: boolean;
  runnerHome: string;
  secretsDir?: string;
  mcp?: { socketPath: string; command: string[] };
  sessions?: CodexThreads;
  bin?: string;
  grants?: string[];
  accounts?: { accountDir(kind: "commandcode", id: string): string | null };
  spawn?: Spawn;
}

const sessionStores = new Map<string, CodexThreads>();

/** A model id as Command Code names it (`deepseek/deepseek-v4.1-flash`, `claude-sonnet-5-5`). */
const MODEL_ID = /^[\w.-]{1,40}(?:\/[\w.:-]{1,79})?$/;

/** `brain.turn` with `kind: "commandcode"`: its account, the turn's folder, its secrets, then the turn. */
export async function handleCommandcodeBrainTurn(
  ctx: CommandcodeBrainContext,
  req: CommandcodeBrainTurnRequest,
  scope: { signal: AbortSignal; emit: (event: CodexBrainEvent) => void },
): Promise<void> {
  if (!ctx.exec) throw new RunnerError("not_allowed", "Command Code is turned off on this computer");
  if (!req.agent) throw new RunnerError("bad_request", "A brain turn belongs to an agent");
  if (typeof req.runId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.runId)) {
    throw new RunnerError("bad_request", "runId is invalid");
  }
  if (typeof req.session?.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.session.id)) {
    throw new RunnerError("bad_request", "session.id is invalid");
  }
  if (typeof req.mcp?.token !== "string" || !req.mcp.token)
    throw new RunnerError("bad_request", "mcp.token is required");
  if (typeof req.model === "string" && req.model && !MODEL_ID.test(req.model)) {
    throw new RunnerError("bad_request", "model is a Command Code model id");
  }
  // Always an account (see the header).
  const accountId: unknown = req.account;
  if (accountId === undefined || accountId === null || accountId === "") {
    scope.emit({
      type: "error",
      code: "not_logged_in",
      message:
        "Command Code thinks only with a Command Code account added in agentes.chat. Add one on the agent's page.",
      retryable: false,
    });
    return;
  }
  if (!isAccountId(accountId)) throw new RunnerError("bad_request", "Invalid account id");
  const home = ctx.accounts?.accountDir("commandcode", accountId);
  if (!home) {
    scope.emit({
      type: "error",
      code: "account_missing",
      message: ACCOUNT_MISSING_MESSAGE.commandcode,
      retryable: false,
    });
    return;
  }
  const key = await commandcodeKeyOf(home);
  if (!key) {
    scope.emit({
      type: "error",
      code: "not_logged_in",
      message: "This Command Code account has no key on this computer. Add the key again on the agent's page.",
      retryable: true,
    });
    return;
  }
  const chat = req.permissions?.mode === "chat";
  // A `chat` turn starts in an empty folder of its own, whatever the request names.
  let cwd = chat ? chatFolder(ctx.runnerHome, String(req.agent.id)) : ctx.folder;
  if (!chat && typeof req.cwd === "string" && req.cwd.trim() !== "") {
    const resolved = await resolveForAgent(ctx.folder, ctx.grants, req.cwd);
    if (!resolved.exists) throw new RunnerError("not_found", `The folder ${req.cwd} doesn't exist`);
    cwd = resolved.abs;
  }
  const secrets = chat ? null : await agentSecrets(ctx.secretsDir, req.agent);
  const file = commandcodeSessionsFile(ctx.runnerHome);
  const sessions = ctx.sessions ?? sessionStores.get(file) ?? new CodexThreads(file);
  sessionStores.set(file, sessions);
  await runCommandcodeTurn(
    {
      runId: req.runId,
      sessionId: req.session.id,
      cwd,
      ...(typeof req.model === "string" && req.model ? { model: req.model } : {}),
      ...(req.effort ? { effort: req.effort } : {}),
      system: typeof req.system === "string" ? req.system : "",
      prompt: typeof req.prompt === "string" ? req.prompt : "",
      mcp: { token: req.mcp.token, ...(typeof req.mcp.url === "string" && req.mcp.url ? { url: req.mcp.url } : {}) },
      account: { id: accountId, home, key },
      profile: codexProfileOf(req),
      ...(chat ? {} : { roots: [ctx.folder, ...(ctx.grants ?? [])] }),
      ...(chat ? { chat } : {}),
    },
    {
      sessions,
      emit: scope.emit,
      signal: scope.signal,
      runnerHome: ctx.runnerHome,
      ...(ctx.mcp ? { mcpCommand: ctx.mcp.command, socketPath: ctx.mcp.socketPath } : {}),
      ...(secrets ? { env: secrets.env, redact: secrets.redact } : {}),
      ...(ctx.bin ? { bin: ctx.bin } : {}),
      ...(ctx.spawn ? { spawn: ctx.spawn } : {}),
    },
  );
}
