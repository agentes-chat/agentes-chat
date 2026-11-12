import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CommandProfile } from "@agenteschat/adapters/command-policy";
import type { AgentScope } from "@agenteschat/adapters/machine-protocol";
import { isAccountId } from "@agenteschat/adapters/machine-protocol";
import { redactSecrets } from "@agenteschat/adapters/secret-box";
import { ACCOUNT_MISSING_MESSAGE, accountEnv, museKeyOf, withoutSignIns } from "./accounts";
import {
  CODEX_TOOL_OUTPUT_MAX,
  type CodexBrainEvent,
  CodexThreads,
  codexProfileOf,
  codexThreadKey,
} from "./brain-codex";
import { RunnerError } from "./errors";
import { killTree } from "./exec";
import { MUSE_BIN, resolveCommand } from "./executors";
import { CODEX_MCP_ENV, CODEX_MCP_SERVER, redactDeep } from "./mcp";
import { resolveForAgent } from "./paths";
import type { Spawn } from "./scope-gate";
import { agentSecrets } from "./secrets";

/**
 * The Muse Code branch of `brain.turn` (protocol 59, ADR 0174): one agent turn as one run of Muse's CLI
 * (`muse exec --json`), its JSONL turn events turned into brain events. Read in the binary at 1.4.18 (`muse exec
 * --help`, `muse schema`, a live echo run) and in the two products that integrated it first (OpenBot's
 * `muse-client.ts`, OpenMausBot's `muse-code.ts`).
 *
 * - `muse exec --json`, an argv with no prompt in it: `exec` reads no standard input at all ("missing prompt"), so
 *   the prompt goes in a file of our own (`--prompt-file`) — no argument limit, and a new session's prompt carries
 *   the engine's context, as Muse has no system prompt flag.
 * - The session: every line's `stream` names it; our session → Muse's lives in `<runner home>/brain/muse-sessions.json`
 *   (per account, like Codex's threads and OpenCode's sessions). A runner that lost it starts a new session, with the
 *   context again.
 * - Everything we set rides in the account's own `settings.json` (`$XDG_CONFIG_HOME/muse`, `schema_version` 1 or every
 *   command fails): our MCP server as `mcp_servers.agentes` (stdio, `required`, so a bridge that does not come up ends
 *   the turn instead of going quiet), no hooks of the machine, and the permission postures.
 * - Postures here are flags, not approvals: `exec` has nobody to ask, so approval is off and the sandbox alone
 *   contains the agent (`--disable-approval`). A plan turn also loses write and shell (`--disable-write
 *   --disable-shell`, measured to be the only path — `--permission-profile read-only` answers "profile does not
 *   exist").
 * - Contributor mode is on for subscriptions by default: every turn turns it off, or the workspace's code trains Meta.
 * - Two things are refused rather than faked: a `chat` turn (there is no tool allow/deny list on this CLI, so the
 *   right-hand guard of ADR 0137 §4 cannot be enforced) and Windows.
 */

const KILL_GRACE_MS = 5000;

/** Muse's own key variable; also what an account sets. */
export const MUSE_KEY_ENV = "META_API_KEY";
/** The launcher installs itself over the version we pinned, mid-turn. */
export const MUSE_NO_AUTO_UPDATE = "1";
/** Its own mark, absent from a plain machine: the same rule as `OPENCODE_RUN_ENV`. */
export const MUSE_RUN_ENV = "AGENTES_MCP_RUN";
/** The brief it gets before its first turn of a session. */
const MUSE_SESSION_GONE = /session not found|unknown session|no such session/i;

export interface MuseBrainTurnRequest {
  runId: string;
  kind: "muse";
  session: { id: string; resume: boolean };
  cwd?: string;
  model?: string;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string; tools?: string };
  agent?: AgentScope;
  account?: string;
  permissions?: { mode?: "plan" | "work" | "chat" };
  keepAlive?: boolean;
}

/** Where our session → Muse session ids live in the runner home. */
export const museSessionsFile = (runnerHome: string) => path.join(runnerHome, "brain", "muse-sessions.json");
/** The account's config folder (Muse reads `$XDG_CONFIG_HOME/muse`; its credential location is undocumented). */
export const museConfigDir = (accountHome: string) => path.join(accountHome, "config");

/** `muse --version` prints `Muse Code 1.4.18 (1.4.18-R8587.1)`. */
export const museVersion = (output: string) => output.match(/\b\d+\.\d+\.\d+-R\d+(?:\.\d+)?\b/)?.[0];

/** The settings document of an account turn: our MCP server, no hooks, and nothing of the machine's. */
export function museSettings(input: {
  mcp: { token: string; url?: string };
  mcpCommand?: string[];
  chat?: boolean;
}): string {
  const env = (name: string) => `\${${name}}`;
  return JSON.stringify({
    // Required, or every command refuses the document ("missing field `schema_version`").
    schema_version: 1,
    // The machine's hooks run outside Muse's sandbox: none of them, from either file.
    hooks: {},
    managed_hooks_path: null,
    mcp_servers: {
      [CODEX_MCP_SERVER]: input.mcp.url
        ? {
            transport: "streamable_http",
            url: input.mcp.url,
            headers: { Authorization: `Bearer ${env(CODEX_MCP_ENV[0])}` },
            mode: "required",
          }
        : {
            transport: "stdio",
            command: input.mcpCommand?.[0] ?? "agentes-runner",
            args: input.mcpCommand?.slice(1) ?? [],
            env: {
              [CODEX_MCP_ENV[0]]: env(CODEX_MCP_ENV[0]),
              [CODEX_MCP_ENV[2]]: env(CODEX_MCP_ENV[2]),
              ...(env(CODEX_MCP_ENV[1]) ? {} : {}),
            },
            mode: "required",
          },
    },
  });
}

/**
 * The turn's argv. No prompt: it goes through `--prompt-file`. A plan turn is read-only by flags, because
 * `--permission-profile read-only` takes a profile id Muse does not ship under that name.
 */
export function museTurnArgs(input: { session?: string; model?: string; profile?: CommandProfile }): string[] {
  return [
    "exec",
    "--json",
    // Nobody answers an approval in `exec`: the sandbox is the guard that is left.
    "--disable-approval",
    "--trust-workspace",
    "--contributor-mode",
    "off",
    ...(input.profile === "plan" ? ["--disable-write", "--disable-shell"] : []),
    ...(input.session ? ["--session-id", input.session] : []),
    ...(input.model ? ["--model", input.model] : []),
  ];
}

const USAGE_LIMIT = /usage limit|allowance (?:is )?(?:exhausted|used up)|out of (?:allowance|credits)/i;
export const MUSE_AUTH = /not logged in|unauthori[sz]ed|invalid api key|401/i;

export function museProblem(problem: string, worked = false): CodexBrainEvent[] {
  if (USAGE_LIMIT.test(problem)) return [{ type: "limit", ...(/reset/i.test(problem) ? { resetsAt: problem } : {}) }];
  if (MUSE_AUTH.test(problem)) return [{ type: "error", code: "not_logged_in", message: problem, retryable: true }];
  return [
    { type: "error", code: "muse_failed", message: problem, retryable: true, ...(worked ? { worked: true } : {}) },
  ];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cut = (text: string) =>
  text.length > CODEX_TOOL_OUTPUT_MAX ? `${text.slice(0, CODEX_TOOL_OUTPUT_MAX)}\n…` : text;

/**
 * One line of `muse exec --json` into brain events. Only four payload families matter here; the rest of the log
 * (task lifecycle, session, runtime commands) is skipped by its `payload_type` **before** its payload is read —
 * a one-word echo turn is twenty-five records.
 */
export class MuseEventMapper {
  /** The Muse session this turn belongs to, once a line names one. */
  session?: string;
  /** The text that streamed, for a `done` that carries none. */
  streamed = "";
  /** Muse's own words about a failure, when it gave any. */
  failed?: string;
  private tokens = { input: 0, output: 0, cacheRead: 0, model: undefined as string | undefined };
  private readonly items = new Map<string, { name: string; args: unknown }>();

  constructor(private readonly opts: { model?: string; redact?: (text: string) => string } = {}) {}

  private clean(text: string) {
    return this.opts.redact ? this.opts.redact(text) : text;
  }

  line(raw: string): CodexBrainEvent[] {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return [];
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }
    const stream = isRecord(ev.stream) ? ev.stream : undefined;
    if (stream && stream.kind === "session" && !this.session) this.session = str(stream.id);
    return this.payload(str(ev.payload_type), isRecord(ev.payload) ? ev.payload : {});
  }

  private payload(type: string, p: Record<string, unknown>): CodexBrainEvent[] {
    switch (type) {
      case "run.output.delta": {
        const text = this.clean(str(p.text));
        if (!text) return [];
        this.streamed += text;
        return [{ type: "text_delta", text }];
      }
      case "item.started":
      case "item.completed": {
        const item = isRecord(p.item) ? p.item : {};
        const kind = str(item.kind);
        if (kind !== "toolCall") return [];
        const id = str(item.itemId);
        const name = this.clean(str(item.tool) || "tool");
        if (type === "item.started") {
          // `args` is model-authored and may not be JSON yet while it streams: never a failure, the input stays raw.
          const raw = str(item.args);
          let parsed: unknown = raw;
          if (raw) {
            try {
              parsed = JSON.parse(raw) as unknown;
            } catch {
              parsed = raw;
            }
          }
          this.items.set(id, { name, args: parsed });
          return [{ type: "tool_started", id, name }];
        }
        const known = this.items.get(id);
        this.items.delete(id);
        const output = str(item.visibleOutput) || str(item.output);
        return [
          {
            type: "tool_call",
            id,
            name: known?.name ?? name,
            input: this.clean(JSON.stringify(known?.args ?? {})),
            ...(output
              ? {
                  executed: {
                    content: cut(this.clean(output)),
                    ...(item.status === "failed" ? { isError: true } : {}),
                  },
                }
              : {}),
          },
        ];
      }
      case "run.usage": {
        for (const model of Array.isArray(p.models) ? p.models : []) {
          if (!isRecord(model)) continue;
          this.tokens.input += num(model.input_tokens);
          this.tokens.output += num(model.output_tokens);
          this.tokens.cacheRead += num(model.cached_tokens);
          if (!this.tokens.model && typeof model.model === "string") this.tokens.model = model.model;
        }
        return [];
      }
      case "run.terminal.completed":
        return [];
      case "run.terminal.failed":
      case "run.terminal.cancelled":
        this.failed = this.clean(str(p.reason) || str(p.text) || type.replace("run.terminal.", ""));
        return [];
      default:
        return [];
    }
  }

  /** The turn's end: its usage (when a step reported tokens), then one `done`, or `error` (after `limit`). */
  finish(input: { exitCode: number | null; sessionId: string; stderr?: string }): CodexBrainEvent[] {
    void input.stderr;
    const { input: read, output, cacheRead } = this.tokens;
    const usage: CodexBrainEvent[] = [
      {
        type: "usage",
        input: read,
        output,
        source: "plan",
        ...((this.opts.model ?? this.tokens.model) ? { model: this.opts.model ?? this.tokens.model } : {}),
        ...(cacheRead ? { cacheRead } : {}),
      },
    ];
    const failed = this.failed;
    if (failed) return [...usage, ...museProblem(failed, Boolean(this.streamed))];
    if (input.exitCode !== 0)
      return [...usage, ...museProblem(`Muse Code exited with code ${input.exitCode ?? "?"}`, Boolean(this.streamed))];
    return [...usage, { type: "done", text: this.streamed, session: { id: input.sessionId } }];
  }
}

export interface MuseTurnInput {
  runId: string;
  sessionId: string;
  cwd: string;
  model?: string;
  system: string;
  prompt: string;
  mcp: { token: string; url?: string };
  /** The account (its sessions are its own): its folder, and its key. */
  account?: { id: string; home: string; key?: string };
  profile?: CommandProfile;
  chat?: boolean;
  freeTier?: boolean;
}

export interface MuseTurnOptions {
  sessions: CodexThreads;
  emit: (event: CodexBrainEvent) => void;
  signal: AbortSignal;
  mcpCommand?: string[];
  socketPath?: string;
  runnerHome: string;
  env?: Record<string, string>;
  redact?: (text: string) => string;
  /** Tests: the executable. */
  bin?: string;
  spawn?: Spawn;
  platform?: NodeJS.Platform;
}

/** Runs one Muse turn and emits its events; ends with exactly one `done` or `error`. Never throws. */
export async function runMuseTurn(input: MuseTurnInput, opts: MuseTurnOptions): Promise<void> {
  const fail = (code: string, message: string, retryable?: boolean) =>
    opts.emit({ type: "error", code, message, ...(retryable ? { retryable } : {}) });
  if ((opts.platform ?? process.platform) === "win32")
    return fail("unsupported", "The Muse Code brain isn't supported on Windows yet.");
  if (input.chat)
    return fail("unsupported", "Muse Code can't hold a right hand yet: its CLI has no way to withhold its own tools.");
  const key = input.account?.key;
  const sessionKey = codexThreadKey(input.sessionId, input.account?.id);
  const inherited: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const home = inherited.HOME || os.homedir();
  // No account: the machine's own sign-in must not answer for a turn that asked for none.
  const base: NodeJS.ProcessEnv = {
    ...(input.freeTier && !input.account ? withoutSignIns(inherited) : inherited),
    [MUSE_RUN_ENV]: input.runId,
    [CODEX_MCP_ENV[0]]: input.mcp.token,
    ...(opts.socketPath ? { [CODEX_MCP_ENV[1]]: opts.socketPath } : {}),
    [CODEX_MCP_ENV[2]]: opts.runnerHome,
    // The launcher upgrades itself: a version must not change under this parser mid-turn.
    MUSE_NO_AUTO_UPDATE: MUSE_NO_AUTO_UPDATE,
  };
  delete base[MUSE_KEY_ENV];
  const env = input.account ? accountEnv("muse", input.account.home, base) : base;
  const configDir = museConfigDir(input.account ? input.account.home : path.join(opts.runnerHome, "brain", "muse"));
  env.XDG_CONFIG_HOME = configDir;
  // The agent's commands inherit XDG_CONFIG_HOME: gh keeps finding its sign-in where it was.
  env.GH_CONFIG_DIR ??= path.join(inherited.XDG_CONFIG_HOME || path.join(home, ".config"), "gh");
  if (key) env[MUSE_KEY_ENV] = key;
  try {
    mkdirSync(path.join(configDir, "muse"), { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(configDir, "muse", "settings.json"),
      museSettings({ mcp: input.mcp, ...(opts.mcpCommand ? { mcpCommand: opts.mcpCommand } : {}) }),
      { mode: 0o600 },
    );
  } catch (err) {
    return fail("muse_failed", err instanceof Error ? err.message : String(err), true);
  }
  // The agent's shell could print the key (its env, its file in the lent folder).
  const redact = key
    ? (text: string) => redactSecrets(opts.redact ? opts.redact(text) : text, [{ name: MUSE_KEY_ENV, value: key }])
    : opts.redact;
  const promptFile = path.join(configDir, `prompt-${input.runId}.md`);
  const prompt =
    input.sessionId && opts.sessions.get(sessionKey)
      ? input.prompt
      : input.system.trim()
        ? `${input.system.trim()}\n\n${input.prompt}`
        : input.prompt;
  try {
    writeFileSync(promptFile, prompt, { mode: 0o600 });
  } catch (err) {
    return fail("muse_failed", err instanceof Error ? err.message : String(err), true);
  }

  const once = async (session: string | undefined) => {
    const args = [
      ...museTurnArgs({
        ...(session ? { session } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
      }),
      "--prompt-file",
      promptFile,
    ];
    const mapper = new MuseEventMapper({
      ...(input.model ? { model: input.model } : {}),
      ...(redact ? { redact } : {}),
    });
    let child: ChildProcess;
    try {
      child = (opts.spawn ?? spawn)(resolveCommand(opts.bin ?? MUSE_BIN, env.PATH), args, {
        cwd: input.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      return { mapper, exit: { code: null, error: err instanceof Error ? err : new Error(String(err)) }, stderr: "" };
    }
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString("utf8")).slice(-2000);
    });
    const lines = createInterface({ input: child.stdout as NonNullable<ChildProcess["stdout"]> });
    (lines as unknown as EventEmitter).on("line", (line: string) => {
      for (const event of mapper.line(line)) opts.emit(event);
      if (mapper.session) opts.sessions.set(sessionKey, mapper.session);
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
    });
    opts.signal.removeEventListener("abort", abort);
    if (killTimer) clearTimeout(killTimer);
    lines.close();
    return { mapper, exit, stderr: stderr.trim() };
  };

  const stored = opts.sessions.get(sessionKey);
  let turn: Awaited<ReturnType<typeof once>>;
  try {
    turn = await once(stored);
    // Muse lost the session (its log lives in the account's folder, our map in the runner home): forget it and start
    // a new one, with the context again.
    if (
      stored &&
      !opts.signal.aborted &&
      turn.exit.code !== 0 &&
      !turn.mapper.streamed &&
      MUSE_SESSION_GONE.test(`${turn.mapper.failed ?? ""}\n${turn.stderr}`)
    ) {
      opts.sessions.delete(sessionKey);
      turn = await once(undefined);
    }
  } finally {
    rmSync(promptFile, { force: true });
  }
  if (opts.signal.aborted) return fail("canceled", "The turn was canceled.");
  const { mapper, exit, stderr } = turn;
  if (exit.error) {
    const missing = (exit.error as NodeJS.ErrnoException).code === "ENOENT";
    return fail(
      missing ? "muse_missing" : "muse_failed",
      missing ? "Muse Code's CLI is not installed on this computer." : exit.error.message,
      true,
    );
  }
  if (!mapper.failed && exit.code !== 0 && stderr && !mapper.streamed) mapper.failed = stderr;
  for (const event of mapper.finish({ exitCode: exit.code, sessionId: input.sessionId, stderr })) opts.emit(event);
}

/** The redactor a turn uses, exported for the tests. */
export const museRedact = redactDeep;
/** Said when an account's folder is gone. */
export const MUSE_ACCOUNT_MISSING = ACCOUNT_MISSING_MESSAGE.muse;

export interface MuseBrainContext {
  folder: string;
  exec: boolean;
  runnerHome: string;
  secretsDir?: string;
  mcp?: { socketPath: string; command: string[] };
  sessions?: CodexThreads;
  bin?: string;
  grants?: string[];
  accounts?: { accountDir(kind: "muse", id: string): string | null };
  spawn?: Spawn;
}

const sessionStores = new Map<string, CodexThreads>();

/** `brain.turn` with `kind: "muse"`: the account and the folder resolved, then one `runMuseTurn`. */
export async function handleMuseBrainTurn(
  ctx: MuseBrainContext,
  req: MuseBrainTurnRequest,
  scope: { signal: AbortSignal; emit: (event: CodexBrainEvent) => void },
): Promise<void> {
  if (!ctx.exec) throw new RunnerError("not_allowed", "Muse Code is turned off on this computer");
  if (!req.agent) throw new RunnerError("bad_request", "A brain turn belongs to an agent");
  if (typeof req.runId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.runId)) {
    throw new RunnerError("bad_request", "runId is invalid");
  }
  if (typeof req.session?.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(req.session.id)) {
    throw new RunnerError("bad_request", "session.id is invalid");
  }
  if (typeof req.mcp?.token !== "string" || !req.mcp.token)
    throw new RunnerError("bad_request", "mcp.token is required");
  let cwd = ctx.folder;
  if (typeof req.cwd === "string" && req.cwd.trim() !== "") {
    const resolved = await resolveForAgent(ctx.folder, ctx.grants, req.cwd);
    if (!resolved.exists) throw new RunnerError("not_found", `The folder ${req.cwd} doesn't exist`);
    cwd = resolved.abs;
  }
  // ADR 0041: the account's folder or nothing (never the machine's own sign-in instead).
  let account: MuseTurnInput["account"];
  const accountId: unknown = req.account;
  if (accountId !== undefined && accountId !== null && accountId !== "") {
    if (!isAccountId(accountId)) throw new RunnerError("bad_request", "Invalid account id");
    const home = ctx.accounts?.accountDir("muse", accountId);
    if (!home) {
      scope.emit({ type: "error", code: "account_missing", message: MUSE_ACCOUNT_MISSING, retryable: false });
      return;
    }
    const key = await museKeyOf(home);
    account = { id: accountId, home, ...(key ? { key } : {}) };
  }
  const secrets = await agentSecrets(ctx.secretsDir, req.agent);
  const file = museSessionsFile(ctx.runnerHome);
  const sessions = ctx.sessions ?? sessionStores.get(file) ?? new CodexThreads(file);
  sessionStores.set(file, sessions);
  await runMuseTurn(
    {
      runId: req.runId,
      sessionId: req.session.id,
      cwd,
      ...(typeof req.model === "string" && req.model ? { model: req.model } : {}),
      system: typeof req.system === "string" ? req.system : "",
      prompt: typeof req.prompt === "string" ? req.prompt : "",
      mcp: { token: req.mcp.token, ...(typeof req.mcp.url === "string" && req.mcp.url ? { url: req.mcp.url } : {}) },
      ...(account ? { account } : {}),
      profile: codexProfileOf(req),
      ...(req.permissions?.mode === "chat" ? { chat: true } : {}),
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
