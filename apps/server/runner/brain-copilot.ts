import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CommandProfile } from "@agenteschat/adapters/command-policy";
import type { AgentScope, BrainEffort } from "@agenteschat/adapters/machine-protocol";
import { isAccountId, isBrainEffort } from "@agenteschat/adapters/machine-protocol";
import { ACCOUNT_MISSING_MESSAGE, accountEnv } from "./accounts";
import { LIMIT_TEXT } from "./brain";
import {
  CODEX_TOOL_OUTPUT_MAX,
  type CodexBrainEvent,
  CodexThreads,
  codexProfileOf,
  codexThreadKey,
} from "./brain-codex";
import { prepareCopilotHome, writeWhole } from "./copilot-home";
import { RunnerError } from "./errors";
import { killTree } from "./exec";
import { COPILOT_BIN, cliSpawn } from "./executors";
import { CODEX_MCP_ENV, CODEX_MCP_SERVER, redactDeep } from "./mcp";
import { resolveForAgent } from "./paths";
import type { Spawn } from "./scope-gate";
import { agentSecrets } from "./secrets";

/**
 * The Copilot branch of `brain.turn` (protocol 65, ADR 0174): one agent turn as one run of GitHub's Copilot CLI
 * (`copilot --output-format json`, the prompt on its standard input), whose JSONL events are its own. Flags and files
 * as `copilot --help` and `copilot help config|mcp|permissions|sessions|environment` list them, and its events as it
 * printed them, on Copilot CLI 1.0.109 (2026-11-12).
 *
 * - Always an account: `COPILOT_HOME` is the account's folder (its sign-in, its sessions). Its `settings.json` is
 *   written whole before every turn and what a turn could leave there for a later one to load is removed
 *   (`copilot-home.ts`). No account (the computer's own sign-in): refused.
 * - Our MCP server goes in a file of the account's folder passed with `--additional-mcp-config`: stdio
 *   (`agentes-runner mcp`, which inherits the run, the token, the socket and the home from the CLI's env) or the
 *   bridge's URL with the token as a bearer, in a file of the turn's own that is removed with it.
 * - The chat: `session.start` names Copilot's session; our session → that session lives in
 *   `<runner home>/brain/copilot-chats.json` (per account). The first turn of a chat leads its prompt with the
 *   engine's context; a runner that lost it, or a resume Copilot can't find, starts a new chat with it again.
 * - ADR 0053 §3: with no terminal the CLI denies whatever no rule allows. `work` allows every tool and URL (paths
 *   stay checked: the turn's folder and the temp directory); `plan` allows reads and our bridge and denies writes.
 *   The CLI's own command sandbox is off: the agent's OS user is the boundary, as for OpenCode.
 * - `chat` (the team's right hand, ADR 0137 §4) is refused: the CLI lists its tools nowhere before its first model
 *   call, so a turn can't be checked to hold only ours.
 * - Our bridge's calls are not repeated as `tool_call`: the engine ran them. Copilot's own tools are, with what they
 *   answered. Usage is the plan's (`source: "plan"`); the CLI counts it over the whole session, so a turn's is what
 *   the session added since the turn before.
 * - Our server failing to start (`session.mcp_server_status_changed`, `failed`) ends the turn: the CLI would go on
 *   with its own tools alone.
 * - No live steering: the CLI takes nothing mid-turn (`brain.steer` answers `unsupported`).
 */

const KILL_GRACE_MS = 5000;

/** `brain.turn` with `kind: "copilot"`. */
export interface CopilotBrainTurnRequest {
  runId: string;
  kind: "copilot";
  session: { id: string; resume: boolean };
  cwd?: string;
  model?: string;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string; tools?: string };
  agent?: AgentScope;
  account?: string;
  effort?: BrainEffort;
  permissions?: { mode?: "plan" | "work" | "chat" };
  keepAlive?: boolean;
}

export const copilotChatsFile = (runnerHome: string) => path.join(runnerHome, "brain", "copilot-chats.json");

export const COPILOT_RUN_ENV = "AGENTES_MCP_RUN";

/**
 * `--additional-mcp-config`'s file with our server alone (`copilot help mcp`): stdio (`agentes-runner mcp`; a local
 * server inherits the CLI's env, where the run, the token, the socket and the home are) or the bridge's URL with the
 * token as a bearer.
 */
export function copilotMcpConfig(input: { command?: string[]; url?: string; token?: string }): string {
  const [command, ...args] = input.command ?? [];
  const server = input.url
    ? { type: "http", url: input.url, headers: { Authorization: `Bearer ${input.token ?? ""}` }, tools: ["*"] }
    : { type: "local", command: command ?? "agentes-runner", args: [...args, "mcp"], tools: ["*"] };
  return `${JSON.stringify({ mcpServers: { [CODEX_MCP_SERVER]: server } }, null, 2)}\n`;
}

/** `--reasoning-effort`: `xhigh` and `max` as `high` (which levels a model takes depends on the model). */
const copilotEffort = (effort?: BrainEffort) => (effort === "xhigh" || effort === "max" ? "high" : effort);

export function copilotTurnArgs(input: {
  mcpConfig: string;
  chat?: string;
  model?: string;
  effort?: BrainEffort;
  profile?: CommandProfile;
}): string[] {
  const effort = copilotEffort(input.effort);
  return [
    "--output-format",
    "json",
    "--no-custom-instructions",
    "--disable-builtin-mcps",
    "--no-auto-update",
    "--no-ask-user",
    "--sync-session=off",
    "--additional-mcp-config",
    `@${input.mcpConfig}`,
    ...(input.profile === "plan"
      ? ["--allow-tool", "read", "--allow-tool", CODEX_MCP_SERVER, "--deny-tool", "write"]
      : ["--allow-all-tools", "--allow-all-urls"]),
    ...(input.model ? ["--model", input.model] : []),
    ...(effort ? ["--reasoning-effort", effort] : []),
    ...(input.chat ? [`--resume=${input.chat}`] : []),
  ];
}

/** The turn's message: a new chat's leads with the engine's context (the CLI takes no system prompt). */
export function copilotPrompt(system: string, prompt: string, newChat: boolean): string {
  const context = newChat ? system.trim() : "";
  return context ? `${context}\n\n${prompt}` : prompt;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The CLI's words when a plan's limit stops a turn (`copilot help limits`, `billing`). */
const COPILOT_LIMIT =
  /rate.?limit|usage limit|weekly limit|quota|out of (?:ai )?credits|ai credit limit|premium requests?[^\n]{0,40}(?:limit|exceeded|used up|exhausted)|\b429\b/i;
export const COPILOT_AUTH =
  /no authentication information found|authentication required|could not be validated|bad credentials|not (?:authenticated|logged in|signed in)|copilot login|unauthori[sz]ed|\b401\b|token (?:has )?expired/i;
const SESSION_GONE = /no session, task, or name matched/i;
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** cmd.exe when the CLI isn't on the PATH (Windows runs it through cmd.exe). */
const NOT_ON_PATH = /is not recognized as an internal or external command/i;

export function copilotProblem(problem: string, worked = false): CodexBrainEvent[] {
  if (COPILOT_LIMIT.test(problem) || LIMIT_TEXT.test(problem)) {
    return [{ type: "limit" }, { type: "error", code: "plan_limit", message: problem, retryable: true, worked }];
  }
  if (COPILOT_AUTH.test(problem)) return [{ type: "error", code: "not_logged_in", message: problem, retryable: true }];
  return [{ type: "error", code: "copilot_failed", message: problem, retryable: true }];
}

/** What a session used so far, as the CLI counts it (input with the cache it read and wrote). */
export interface CopilotTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const NO_TOTALS: CopilotTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const totalsText = (t: CopilotTotals) => [t.input, t.output, t.cacheRead, t.cacheWrite].join(",");
export function totalsOf(text: string | undefined): CopilotTotals | null {
  const parts = (text ?? "").split(",").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  const [input = 0, output = 0, cacheRead = 0, cacheWrite = 0] = parts;
  return { input, output, cacheRead, cacheWrite };
}

export const usageKey = (chatKey: string) => `${chatKey}#usage`;

/**
 * The CLI's JSONL events → the engine's. Text comes as `assistant.message_delta`s, or whole in `assistant.message`
 * when none were streamed; each message is a paragraph apart from the one before. A tool the CLI ran itself is a
 * `tool_call` with what it answered, once it ends; our bridge's (`mcpServerName` ours) are skipped. The answer is the
 * text after the last tool, else everything said.
 */
export class CopilotEventMapper {
  session = "";
  failed = "";
  worked = false;
  bridgeDown = "";
  /** The CLI opened or resumed its session: from here on a run of it may have had effects. */
  started = false;
  /** The assistant said or called something: the session holds this turn. */
  acted = false;
  private streamed = "";
  private answer = "";
  private readonly live = new Set<string>();
  private lastMessage = "";
  private readonly calls = new Map<string, { name: string; input: unknown; ours: boolean }>();
  private totals: CopilotTotals | null = null;
  private model = "";
  private sawResult = false;

  private say(messageId: string, text: string): CodexBrainEvent[] {
    if (!text) return [];
    const apart = messageId !== this.lastMessage && this.streamed !== "" && !this.streamed.endsWith("\n");
    this.lastMessage = messageId;
    const delta = apart ? `\n\n${text}` : text;
    this.streamed += delta;
    this.answer += this.answer === "" ? text : delta;
    return [{ type: "text_delta", text: delta }];
  }

  push(ev: Record<string, unknown>): CodexBrainEvent[] {
    const data = isRecord(ev.data) ? ev.data : {};
    switch (ev.type) {
      case "session.start": {
        this.started = true;
        this.session = str(data.sessionId) || this.session;
        return [];
      }
      case "session.resume": {
        this.started = true;
        return [];
      }
      case "session.model_change": {
        this.model = str(data.newModel) || this.model;
        return [];
      }
      case "assistant.message_delta": {
        const id = str(data.messageId);
        this.live.add(id);
        if (str(data.deltaContent)) this.acted = true;
        return this.say(id, str(data.deltaContent));
      }
      case "assistant.message": {
        const id = str(data.messageId);
        const out = this.live.has(id) ? [] : this.say(id, str(data.content));
        const calls = Array.isArray(data.toolRequests) && data.toolRequests.length > 0;
        if (calls || str(data.content)) this.acted = true;
        if (calls) this.answer = "";
        return out;
      }
      case "tool.execution_start": {
        const id = str(data.toolCallId);
        if (!id) return [];
        const ours = str(data.mcpServerName) === CODEX_MCP_SERVER;
        this.calls.set(id, { name: str(data.toolName) || "tool", input: data.arguments ?? {}, ours });
        this.acted = true;
        this.answer = "";
        return [];
      }
      case "tool.execution_complete": {
        const id = str(data.toolCallId);
        const call = this.calls.get(id);
        this.calls.delete(id);
        if (!call || call.ours) return [];
        this.worked = true;
        const result = isRecord(data.result) ? data.result : {};
        const error = isRecord(data.error) ? str(data.error.message) : str(data.error);
        const content = (str(result.content) || error).slice(0, CODEX_TOOL_OUTPUT_MAX);
        return [
          {
            type: "tool_call",
            id,
            name: call.name,
            input: call.input,
            executed: { content, ...(data.success === false ? { isError: true } : {}) },
          },
        ];
      }
      case "session.mcp_server_status_changed": {
        if (str(data.serverName) === CODEX_MCP_SERVER && data.status === "failed") {
          this.bridgeDown = (str(data.error).split("\n")[0] ?? "").slice(0, 300) || "it failed to start";
        }
        return [];
      }
      case "session.error": {
        this.failed = str(data.message) || "Copilot CLI reported an error";
        return [];
      }
      case "session.usage_checkpoint": {
        const snapshot = isRecord(data.accountingSnapshot) ? data.accountingSnapshot : {};
        const metrics = isRecord(snapshot.modelMetrics) ? snapshot.modelMetrics : {};
        const totals: CopilotTotals = { ...NO_TOTALS };
        let most = -1;
        let best = "";
        for (const [model, m] of Object.entries(metrics)) {
          const usage = isRecord(m) && isRecord(m.usage) ? m.usage : {};
          totals.input += num(usage.inputTokens);
          totals.output += num(usage.outputTokens);
          totals.cacheRead += num(usage.cacheReadTokens);
          totals.cacheWrite += num(usage.cacheWriteTokens);
          if (num(usage.inputTokens) > most) {
            most = num(usage.inputTokens);
            best = model;
          }
        }
        // One usage per turn: the turn's own model's, else (a resume says none) the one that read most.
        this.model = this.model || best;
        this.totals = totals;
        return [];
      }
      case "result": {
        this.sawResult = true;
        this.session = str(ev.sessionId) || this.session;
        return [];
      }
      default:
        return [];
    }
  }

  get used(): CopilotTotals | null {
    return this.totals;
  }

  finish(input: {
    exitCode: number | null;
    stderr: string;
    sessionId: string;
    /** What the session had used before this turn (zero for a new chat); null: not known, so no usage is reported. */
    before: CopilotTotals | null;
  }): CodexBrainEvent[] {
    const usage: CodexBrainEvent[] = [];
    if (this.totals && input.before) {
      const turn = {
        input: Math.max(0, this.totals.input - input.before.input),
        output: Math.max(0, this.totals.output - input.before.output),
        cacheRead: Math.max(0, this.totals.cacheRead - input.before.cacheRead),
        cacheWrite: Math.max(0, this.totals.cacheWrite - input.before.cacheWrite),
      };
      if (turn.input > 0 || turn.output > 0) {
        usage.push({
          type: "usage",
          input: turn.input,
          output: turn.output,
          source: "plan",
          ...(this.model ? { model: this.model } : {}),
          ...(turn.cacheRead ? { cacheRead: turn.cacheRead } : {}),
          ...(turn.cacheWrite ? { cacheWrite: turn.cacheWrite } : {}),
        });
      }
    }
    const said = input.stderr.trim();
    const problem =
      this.failed ||
      (input.exitCode === 0
        ? this.sawResult
          ? this.acted
            ? ""
            : "Copilot CLI ended without an answer"
          : "Copilot CLI ended without finishing the turn"
        : `Copilot CLI exited with code ${input.exitCode ?? "?"}${said ? `: ${said}` : ""}`);
    if (problem) return [...usage, ...copilotProblem(problem, this.worked)];
    return [...usage, { type: "done", text: this.answer || this.streamed, session: { id: input.sessionId } }];
  }
}

export interface CopilotTurnInput {
  runId: string;
  sessionId: string;
  cwd: string;
  model?: string;
  effort?: BrainEffort;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string };
  account: { id: string; home: string };
  profile?: CommandProfile;
}

export interface CopilotTurnOptions {
  chats: CodexThreads;
  emit: (event: CodexBrainEvent) => void;
  signal: AbortSignal;
  mcpCommand?: string[];
  socketPath?: string;
  runnerHome?: string;
  env?: Record<string, string>;
  redact?: (text: string) => string;
  redactHold?: number;
  bin?: readonly string[];
  spawn?: Spawn;
}

/** Runs one Copilot turn and emits its events; ends with exactly one `done` or `error`. Never throws. */
export async function runCopilotTurn(input: CopilotTurnInput, opts: CopilotTurnOptions): Promise<void> {
  const fail = (code: string, message: string, retryable?: boolean) =>
    opts.emit({ type: "error", code, message, ...(retryable ? { retryable } : {}) });
  const home = input.account.home;
  const mcpFile = path.join(home, input.mcp.url ? `agentes-mcp-${input.runId}.json` : "agentes-mcp.json");
  try {
    prepareCopilotHome(home);
    writeWhole(
      mcpFile,
      copilotMcpConfig(
        input.mcp.url ? { url: input.mcp.url, token: input.mcp.token } : { command: opts.mcpCommand ?? [] },
      ),
    );
  } catch (err) {
    return fail("copilot_failed", `Couldn't set up the agent's tools for Copilot: ${(err as Error).message}`, true);
  }
  const chatKey = codexThreadKey(input.sessionId, input.account.id);
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    [COPILOT_RUN_ENV]: input.runId,
    [CODEX_MCP_ENV[0]]: input.mcp.token,
    ...(opts.socketPath ? { [CODEX_MCP_ENV[1]]: opts.socketPath } : {}),
    ...(opts.runnerHome ? { [CODEX_MCP_ENV[2]]: opts.runnerHome } : {}),
  };
  const env = accountEnv("copilot", home, base);
  const clean = (text: string) => (opts.redact ? opts.redact(text) : text);
  const hold = opts.redact ? (opts.redactHold ?? 0) : 0;

  try {
    for (let attempt = 0; ; attempt++) {
      // An argument of the command line: only an id the CLI itself gave.
      const kept = opts.chats.get(chatKey);
      const chat = kept && CHAT_ID.test(kept) ? kept : undefined;
      const before = chat ? totalsOf(opts.chats.get(usageKey(chatKey))) : NO_TOTALS;
      const args = copilotTurnArgs({
        mcpConfig: mcpFile,
        ...(chat ? { chat } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        profile: input.profile ?? "work",
      });
      const mapper = new CopilotEventMapper();
      const run = cliSpawn(opts.bin ?? [COPILOT_BIN], args, env.PATH);
      let child: ChildProcess;
      try {
        child = (opts.spawn ?? spawn)(run.file, run.args, {
          cwd: input.cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
          windowsVerbatimArguments: run.windowsVerbatimArguments,
        });
      } catch (err) {
        return fail("copilot_failed", err instanceof Error ? err.message : String(err));
      }
      let stderr = "";
      child.stderr?.on("data", (c: Buffer) => {
        stderr = (stderr + c.toString("utf8")).slice(-2000);
      });
      let tail = "";
      const flush = (text: string, whole: boolean) => {
        const out = clean(tail + text);
        const at = whole ? out.length : Math.max(0, out.length - hold);
        tail = out.slice(at);
        if (at > 0) opts.emit({ type: "text_delta", text: out.slice(0, at) });
      };
      const lines = createInterface({ input: child.stdout as NonNullable<ChildProcess["stdout"]> });
      (lines as unknown as EventEmitter).on("line", (line: string) => {
        let ev: unknown;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (!isRecord(ev) || mapper.bridgeDown) return;
        const events = mapper.push(ev);
        if (mapper.bridgeDown) {
          killTree(child, "SIGKILL");
          return;
        }
        for (const event of events) {
          if (event.type === "text_delta") {
            flush(event.text, false);
            continue;
          }
          flush("", true);
          opts.emit(
            event.type === "tool_call"
              ? {
                  ...event,
                  input: redactDeep(event.input, clean),
                  ...(event.executed
                    ? { executed: { ...event.executed, content: clean(event.executed.content) } }
                    : {}),
                }
              : event,
          );
        }
      });
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => {
        killTree(child, "SIGTERM");
        killTimer = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
      };
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener("abort", abort, { once: true });
      const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
        let settled = false;
        const proc = child as unknown as EventEmitter;
        proc.on("error", (error: Error) => {
          if (!settled) {
            settled = true;
            resolve({ code: null, error });
          }
        });
        proc.on("close", (code: number | null) => {
          if (!settled) {
            settled = true;
            resolve({ code });
          }
        });
        // The message: a CLI that ended before reading it (not found, a bad flag) closes the pipe first.
        const stdin = child.stdin as NonNullable<ChildProcess["stdin"]>;
        (stdin as unknown as EventEmitter).on("error", () => {});
        stdin.end(copilotPrompt(input.system, input.prompt, !chat));
      });
      opts.signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      lines.close();
      if (opts.signal.aborted) return fail("canceled", "The turn was canceled.");
      const missing =
        (exit.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ||
        (!mapper.started && (exit.code === 127 || exit.code === 9009 || NOT_ON_PATH.test(stderr)));
      if (missing)
        return fail("copilot_missing", "The Copilot CLI, GitHub's, is not installed on this computer.", true);
      if (exit.error) return fail("copilot_failed", exit.error.message, true);
      if (mapper.bridgeDown) {
        return fail(
          "copilot_failed",
          `The agent's tools didn't start in the Copilot CLI, so the turn stopped: ${clean(mapper.bridgeDown)}`,
          true,
        );
      }
      if (chat && !mapper.started && attempt === 0 && SESSION_GONE.test(stderr)) {
        opts.chats.delete(chatKey);
        opts.chats.delete(usageKey(chatKey));
        continue;
      }
      flush("", true);
      // Kept only now: a turn that was canceled, lost its bridge or never spoke left no chat to resume, so the next
      // one starts it again with the context.
      if (mapper.session && mapper.acted) opts.chats.set(chatKey, mapper.session);
      // What a kept chat has used moves on with every usage told, a failed turn's too, or the next would tell it again.
      if (mapper.used && opts.chats.get(chatKey)) opts.chats.set(usageKey(chatKey), totalsText(mapper.used));
      for (const event of mapper.finish({
        exitCode: exit.code,
        stderr: clean(stderr),
        sessionId: input.sessionId,
        before,
      })) {
        opts.emit(
          event.type === "done"
            ? { ...event, text: clean(event.text) }
            : event.type === "error"
              ? { ...event, message: clean(event.message) }
              : event,
        );
      }
      return;
    }
  } finally {
    if (input.mcp.url) rmSync(mcpFile, { force: true });
  }
}

/** What the runner's `brain.turn` handler hands the Copilot branch. */
export interface CopilotBrainContext {
  folder: string;
  exec: boolean;
  runnerHome: string;
  secretsDir?: string;
  mcp?: { socketPath: string; command: string[] };
  chats?: CodexThreads;
  bin?: readonly string[];
  grants?: string[];
  accounts?: { accountDir(kind: "copilot", id: string): string | null };
  spawn?: Spawn;
}

const chatStores = new Map<string, CodexThreads>();

export async function handleCopilotBrainTurn(
  ctx: CopilotBrainContext,
  req: CopilotBrainTurnRequest,
  scope: { signal: AbortSignal; emit: (event: CodexBrainEvent) => void },
): Promise<void> {
  if (!ctx.exec) throw new RunnerError("not_allowed", "The Copilot CLI is turned off on this computer");
  if (!req.agent) throw new RunnerError("bad_request", "A brain turn belongs to an agent");
  if (typeof req.runId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.runId)) {
    throw new RunnerError("bad_request", "runId is invalid");
  }
  if (typeof req.session?.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.session.id)) {
    throw new RunnerError("bad_request", "session.id is invalid");
  }
  if (typeof req.mcp?.token !== "string" || !req.mcp.token)
    throw new RunnerError("bad_request", "mcp.token is required");
  // An argument of the CLI's command line, which on Windows goes through cmd.exe: an id's characters only.
  if (typeof req.model === "string" && req.model && !/^[\w.:/-]{1,80}$/.test(req.model)) {
    throw new RunnerError("bad_request", "model is invalid");
  }
  // The team's right hand: nothing in the CLI's output says which tools a turn holds before it uses one.
  if (req.permissions?.mode === "chat") {
    scope.emit({
      type: "error",
      code: "tools_not_locked",
      message: "The Copilot CLI can't be kept to the right hand's tools, so the turn didn't start.",
      retryable: false,
    });
    return;
  }
  // ADR 0041: the account's folder or nothing (the computer's own sign-in is whoever uses the computer's).
  const accountId: unknown = req.account;
  if (accountId === undefined || accountId === null || accountId === "") {
    scope.emit({
      type: "error",
      code: "not_logged_in",
      message:
        "Copilot thinks only with a GitHub Copilot account connected for the agent. Connect one on the agent's page.",
      retryable: false,
    });
    return;
  }
  if (!isAccountId(accountId)) throw new RunnerError("bad_request", "Invalid account id");
  const home = ctx.accounts?.accountDir("copilot", accountId);
  if (!home) {
    scope.emit({ type: "error", code: "account_missing", message: ACCOUNT_MISSING_MESSAGE.copilot, retryable: false });
    return;
  }
  let cwd = ctx.folder;
  if (typeof req.cwd === "string" && req.cwd.trim() !== "") {
    const resolved = await resolveForAgent(ctx.folder, ctx.grants, req.cwd);
    if (!resolved.exists) throw new RunnerError("not_found", `The folder ${req.cwd} doesn't exist`);
    cwd = resolved.abs;
  }
  const secrets = await agentSecrets(ctx.secretsDir, req.agent);
  const file = copilotChatsFile(ctx.runnerHome);
  const chats = ctx.chats ?? chatStores.get(file) ?? new CodexThreads(file);
  chatStores.set(file, chats);
  await runCopilotTurn(
    {
      runId: req.runId,
      sessionId: req.session.id,
      cwd,
      ...(typeof req.model === "string" && req.model ? { model: req.model } : {}),
      ...(isBrainEffort(req.effort) ? { effort: req.effort } : {}),
      system: typeof req.system === "string" ? req.system : "",
      prompt: typeof req.prompt === "string" ? req.prompt : "",
      mcp: { token: req.mcp.token, ...(typeof req.mcp.url === "string" && req.mcp.url ? { url: req.mcp.url } : {}) },
      account: { id: accountId, home },
      profile: codexProfileOf(req),
    },
    {
      chats,
      emit: scope.emit,
      signal: scope.signal,
      runnerHome: ctx.runnerHome,
      ...(ctx.mcp ? { mcpCommand: ctx.mcp.command, socketPath: ctx.mcp.socketPath } : {}),
      ...(secrets ? { env: secrets.env, redact: secrets.redact, redactHold: secrets.hold } : {}),
      ...(ctx.bin ? { bin: ctx.bin } : {}),
      ...(ctx.spawn ? { spawn: ctx.spawn } : {}),
    },
  );
}
