import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type CommandProfile,
  type CommandScope,
  commandKind,
  forbiddenReason,
  gitPushes,
  localVerdict,
  PLAN_MESSAGE,
} from "@agenteschat/adapters/command-policy";
import { type AgentScope, isAccountId } from "@agenteschat/adapters/machine-protocol";
import { redactSecrets } from "@agenteschat/adapters/secret-box";
import { ACCOUNT_MISSING_MESSAGE, accountEnv, museKeyOf } from "./accounts";
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
import { CODEX_MCP_ENV, CODEX_MCP_SERVER } from "./mcp";
import { resolveForAgent } from "./paths";
import { resetFromWords } from "./plan-usage";
import type { Spawn } from "./scope-gate";
import { agentSecrets } from "./secrets";

/**
 * The Muse Code brain (protocol 59, ADR 0174): a turn of Meta's agent on the agent's computer, driven over **MSP** —
 * one `muse serve` host per turn, which speaks the protocol on its stdio — under a person's signed-in subscription.
 *
 * Why `serve` and not `muse exec`: a subscription turn needs a session that outlives the turn (the next message
 * continues instead of restating everything) and somewhere for an approval to be answered. `exec` offers neither,
 * and a one-shot process can be neither steered nor interrupted either. Read in the SDK's own protocol documentation
 * (`@muse-code/sdk` 1.4.15: `msp.d.ts`, `connection.d.ts`) and in a live handshake against
 * `muse serve --provider echo`, whose frames the tests replay.
 *
 * - Frames are NDJSON of JSON-RPC 2.0. `initialize` is answered and then the `initialized` notification unlocks
 *   every other method, which is why a handshake without it answers `notInitialized` to everything. Every command
 *   carries a **UUIDv7** `commandId`; a v4 is refused ("expected UUIDv7").
 * - The turn ends at `turn/completed`, whose `terminal` is `completed | failed | cancelled` (an open enum) and whose
 *   `error` carries the settled `{kind, message, retryable, quota?}` of a failure; the notification says the record
 *   landed, not that the turn went well, so its status decides between `done` and an error.
 * - The session: our session → Muse's lives in `<runner home>/brain/muse-sessions.json`, per account. A stored one is
 *   resumed (`session/resume`), so the agent keeps its thread; a lost one starts a new session and the engine's
 *   context leads the prompt again, as every other brain does with a new session.
 * - The account is a **sign-in**, not a key: `META_API_KEY` is deleted from the host's environment, or a key would
 *   answer in the person's place, and the account's own `XDG_CONFIG_HOME` keeps its credential and sessions apart.
 * - Approvals are answered on the wire. The session's mode is `promptUnmatched` (the wire's own names are
 *   `allowAll`, `promptUnmatched`, `onRequest`, `denyUnmatched`; there is no `never`), so the host asks
 *   `approval/requested` for what its own policy doesn't match, and the turn decides with the command policy every
 *   brain follows and answers `approval/decide` with a `choiceId` the host offered. `allowAll`, which an unanswered
 *   turn needed, let every call through unseen. The sandbox, which is what actually contains the agent, stays on.
 * - No `--trust-workspace`: measured against `muse serve` 1.4.18 (`--provider echo`), the flag alone loads nothing — a
 *   session's workspace is declared on the wire (`session/start.workspaceRoots`), and this brain declares none, so
 *   `session/started` answers `workspaceRoot: null` and a workspace's `.muse/hooks.json` never runs, flag or not. With
 *   the flag *and* a declared root, a `SessionStart` hook in `.muse/hooks.json` ran and wrote outside the workspace
 *   with the host's own rights; without the flag the same file was never read, and the turn still completed. This
 *   brain needs nothing from the workspace (the engine's context leads the prompt), so the flag bought nothing and
 *   armed a hole: a cloned repo must not reach a hook.
 * - Contributor mode is on for subscriptions by default; every host turns it off, or the workspace's code trains Meta.
 * - Locked rather than refused: a `chat` turn (the team's right hand) is started read-only and with `denyUnmatched`,
 *   and its own Bash and Write are refused at the wire while the bridge's tools — a subject this can't read — are
 *   allowed. The same "our tools and nothing else" `--tools ""` gives Claude. Windows is still refused.
 */

const KILL_GRACE_MS = 5000;
const INIT_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5000;
/** A host that took a turn answers `turn/start` at once; one that doesn't is gone or wedged, not busy. */
const TURN_START_TIMEOUT_MS = 60_000;
/**
 * The turn's outer bound, not its work budget: the host's own step limits end a real turn long before, and this only
 * catches a host that will never speak again — a run (and a person) waiting on a process that is already dead inside.
 */
const TURN_DEADLINE_MS = 30 * 60_000;

/** Muse's key variable: an account may carry one, and it must not answer for the sign-in. */
export const MUSE_KEY_ENV = "META_API_KEY";
/** The launcher upgrades itself: a version must not change under a live host. */
export const MUSE_NO_AUTO_UPDATE = "1";
/** Its own mark, absent from a plain machine: the same rule as `OPENCODE_RUN_ENV`. */
export const MUSE_RUN_ENV = "AGENTES_MCP_RUN";

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
/** The account's config folder: Muse reads `$XDG_CONFIG_HOME/muse`, and its sign-in rests beside it. */
export const museConfigDir = (accountHome: string) => path.join(accountHome, "config");

/** `muse --version` prints `Muse Code 1.4.18 (1.4.18-R8587.1)`. */
export const museVersion = (output: string) => output.match(/\b\d+\.\d+\.\d+-R\d+(?:\.\d+)?\b/)?.[0];

/** A UUIDv7, which every MSP command requires. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The host's argv. The sandbox posture is decided here (the wire cannot change it); the approval mode is decided on
 * the wire, which is why no approval flag appears. `--trust-workspace` (load the workspace's rules, skills and hooks)
 * is deliberately absent: what it would load is a cloned repo's own `.muse/hooks.json`, which the host runs as itself
 * and outside the shell sandbox, and this brain never declares a workspace root, so the flag loads nothing today.
 */
export function museServeArgs(input: { profile?: CommandProfile; chat?: boolean } = {}): string[] {
  const readOnly = input.chat === true || input.profile === "plan";
  return ["serve", ...(readOnly ? ["--disable-write", "--disable-shell"] : [])];
}

/** The host's environment: no key to answer in the person's place, no self-upgrade, no contributor mode. */
export function museHostEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env[MUSE_KEY_ENV];
  env.MUSE_NO_AUTO_UPDATE = MUSE_NO_AUTO_UPDATE;
  env.MUSE_CONTRIBUTOR_MODE = "0";
  return env;
}

/** The account's settings document: our MCP server in it, and none of the machine's hooks (they run unsandboxed). */
export function museSettings(input: { mcp: { token: string; url?: string }; mcpCommand?: string[] }): string {
  const env = (name: string) => `\${${name}}`;
  return JSON.stringify({
    // Required: without it every command refuses the document ("missing field `schema_version`").
    schema_version: 1,
    hooks: {},
    managed_hooks_path: null,
    // `mcpServers` is the key the host reads; `mcp_servers` is silently ignored and the turn then has no tools at
    // all — `muse mcp list` answers "no MCP servers" and says nothing about the near miss.
    mcpServers: {
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
            // `agentes-runner mcp` needs the run: it is an argument, not only the environment.
            args: [...(input.mcpCommand?.slice(1) ?? ["mcp"]), "--run", env(MUSE_RUN_ENV)],
            env: {
              [CODEX_MCP_ENV[0]]: env(CODEX_MCP_ENV[0]),
              [CODEX_MCP_ENV[2]]: env(CODEX_MCP_ENV[2]),
              [MUSE_RUN_ENV]: env(MUSE_RUN_ENV),
            },
            mode: "required",
          },
    },
  });
}

const USAGE_LIMIT = /usage limit|allowance (?:is )?(?:exhausted|used up)|out of (?:allowance|credits)/i;
export const MUSE_AUTH = /not logged in|signed out|unauthori[sz]ed|invalid api key|401/i;

/** A `quota.resetsAtMs` as the ISO time the engine's `limit` event carries, and nothing when it isn't one. */
const isoAt = (ms: unknown) =>
  typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;

/**
 * How a Muse turn that went wrong ends, as `codexProblem` and `opencodeProblem` do: a usage limit is `limit` and then
 * `plan_limit` (both in `UNAVAILABLE_CODES`), a refused sign-in `not_logged_in`, anything else `muse_failed`. The
 * typed `quota` detail the host settles on a failed turn is the signal; the words are the fallback for a host that
 * sends none. `resetsAt` is a time or absent — never the sentence it was read from.
 */
export function museProblem(problem: string, worked = false, quota?: { resetsAtMs?: number }): CodexBrainEvent[] {
  if (quota || USAGE_LIMIT.test(problem)) {
    const resetsAt = isoAt(quota?.resetsAtMs) ?? resetFromWords(problem);
    return [
      { type: "limit", ...(resetsAt ? { resetsAt } : {}) },
      { type: "error", code: "plan_limit", message: problem, worked },
    ];
  }
  if (MUSE_AUTH.test(problem)) return [{ type: "error", code: "not_logged_in", message: problem, retryable: true }];
  return [
    { type: "error", code: "muse_failed", message: problem, retryable: true, ...(worked ? { worked: true } : {}) },
  ];
}

/** What `turn/completed` said the turn ended as. */
export type MuseTerminal = "completed" | "failed" | "cancelled";

/** One turn's end, as its own terminal record states it. */
export interface MuseTurnOutcome {
  terminal: MuseTerminal;
  /** The settled failure text (`error.message`, else `reason`), when the host gave one. */
  message?: string;
  /** The typed quota detail of the stopping failure: `resetsAtMs`, when present. */
  quota?: { resetsAtMs?: number };
}

/**
 * `turn/completed` params → what the turn ended as. `terminal` is the field (`status` the older spelling); the enum is
 * open, so a terminal this code doesn't know is a failure, never a success, and a `failed` with no words still names
 * the `error.kind`. No terminal and no error at all: the host said the record landed and nothing else, which is the
 * `completed` the notification's own name promises.
 */
export function museTurnOutcome(params: Record<string, unknown>): MuseTurnOutcome {
  const said = (str(params.terminal) || str(params.status)).trim().toLowerCase();
  const error = isRecord(params.error) ? params.error : undefined;
  const message = str(error?.message) || str(params.reason);
  const resetsAtMs = isRecord(error?.quota) ? error.quota.resetsAtMs : undefined;
  const terminal: MuseTerminal =
    said === "completed"
      ? "completed"
      : said === "cancelled" || said === "canceled"
        ? "cancelled"
        : said || error
          ? "failed"
          : "completed";
  const kind = str(error?.kind);
  return {
    terminal,
    ...(message ? { message } : kind ? { message: `The Muse turn failed (${kind}).` } : {}),
    ...(isoAt(resetsAtMs) ? { quota: { resetsAtMs: Number(resetsAtMs) } } : {}),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cut = (text: string) =>
  text.length > CODEX_TOOL_OUTPUT_MAX ? `${text.slice(0, CODEX_TOOL_OUTPUT_MAX)}\n…` : text;

// ── Approvals on the wire ────────────────────────────────────────────────────

/**
 * What a refusal tells the agent. A brain turn has no card to open and nobody reading it live, so a refusal must not
 * describe one (the prompt tools' `ASK_IN_CHAT` does, where a person is a message away).
 */
export const MUSE_ASK = "Nobody can approve it in this turn: do the work another way, or leave it for a person.";

/** The subject an `approval/requested` names: a command, a file it writes, or a kind this can't read. */
export interface MuseApprovalSubject {
  kind: string;
  command?: string;
  path?: string;
  access?: string;
  toolName?: string;
}

/** One offer of `availableChoices`: the host's own `decision` and `scope` words, and the `choiceId` it answers with. */
export interface MuseApprovalChoice {
  choiceId: string;
  decision: string;
  scope?: string;
}

/** What one ask was decided to mean; the thread shows it, and the host only ever hears a `choiceId` it offered. */
export interface MuseApprovalVerdict {
  allow: boolean;
  /** A session-wide offer may be taken: only for a kind the agent's computer may run for good (`commandKind`). */
  always: boolean;
  why: string;
}

/**
 * One approval decided by the policy every brain follows (`localVerdict`, `forbiddenReason`, `gitPushes`), with
 * nobody to ask: a read is allowed at once; the deny list, a secret, a write or a command outside the turn's folder
 * and every push are refused; what the policy can't read is the profile's call — a `plan` turn refuses it, and a
 * `work` turn approves it once. That last one is the only place this is wider than a person's card, and it is what
 * the turn was asked for: `plan` reads, `work` works.
 *
 * The folders are the turn's and the ones the agent was granted (`ctx.grants`), as the delegated tools build them
 * (`[...cwd, folder, ...grants]`): a grant is a folder the person handed over, and the same write is allowed there.
 */
export function museApprovalVerdict(input: {
  subject: MuseApprovalSubject;
  cwd: string;
  profile: CommandProfile;
  chat?: boolean;
  home?: string;
  runnerHome?: string;
  grants?: readonly string[];
}): MuseApprovalVerdict {
  const scope: CommandScope = {
    cwd: input.cwd,
    folders: [...new Set([input.cwd, ...(input.grants ?? [])])],
    ...(input.home ? { home: input.home } : {}),
    ...(input.runnerHome ? { runnerHome: input.runnerHome } : {}),
  };
  const { kind } = input.subject;
  // Read by the field the subject carries, not by the host's name for its kind: a `command` is a Bash call and a
  // `path` a write, whatever the wire calls them, and one that names neither is a kind this can't read.
  const command = (input.subject.command ?? "").trim();
  const file = (input.subject.path ?? "").trim();
  const called = (input.subject.toolName ?? "").trim();
  const tool = kind === "shell" || command ? "Bash" : kind === "fileAccess" || file ? "Write" : "";
  const call = tool === "Bash" ? { command } : { file_path: file };
  // A `chat` turn (the right hand) is our bridge's tools and nothing else, as `--tools ""` is for Claude: a `tool`
  // subject is one of ours and runs, and its own Bash and Write are refused with the turn going on without them. The
  // bridge's servers are all named for this install, so the name is the test, not a guess about the kind.
  if (input.chat && !tool)
    return called.startsWith("mcp__")
      ? { allow: true, always: false, why: "a tool of our bridge, which a right hand runs" }
      : {
          allow: false,
          always: false,
          why: `\`${called || kind}\` is not of the bridge, and a right hand runs its own tools only`,
        };
  if (input.chat && tool)
    return {
      allow: false,
      always: false,
      why: `\`${tool}\` is the host's own, and a right hand runs the bridge's tools only`,
    };
  if (tool) {
    // Deny list, secrets and a `plan` turn's everything: the same first verdict the prompt tools ask (`localVerdict`).
    const verdict = localVerdict(tool, call, scope, input.profile, MUSE_ASK);
    if (verdict?.behavior === "deny") return { allow: false, always: false, why: verdict.message };
    if (verdict?.behavior === "allow")
      return { allow: true, always: false, why: "it only reads, which the policy allows at once" };
    // What code never lets a judge approve either: a write outside the folder, the system, another host, inline code.
    const forbidden = forbiddenReason(tool, call, scope);
    if (forbidden) return { allow: false, always: false, why: forbidden };
    if (tool === "Bash") {
      // A push leaves the computer, and where it goes waits for a person (`heldPush`): there is none in a turn.
      const pushes = gitPushes(command);
      if (pushes === null || pushes.length > 0)
        return { allow: false, always: false, why: "a push leaves the computer, and where it goes waits for a person" };
      // "Always" only where the agent's computer could offer it for good: the kind, without arguments (`bun test`).
      return { allow: true, always: commandKind(command) !== null, why: "it works inside the turn's folder" };
    }
    return { allow: true, always: false, why: "it writes inside the turn's folder" };
  }
  // A subject this can't read is the class the host asked about *because* nothing matched it (egress, a third-party
  // MCP server, a kind newer than this code): with nobody to look, it is refused rather than waved through.
  if (input.profile === "plan") return { allow: false, always: false, why: PLAN_MESSAGE };
  return {
    allow: false,
    always: false,
    why: `the policy reads no \`${(kind || "unknown").slice(0, 32)}\` subject, and nobody is here to look`,
  };
}

/**
 * The offer taken: `approved` for once, and `approvedForSession` only when the verdict says `always` (never the other
 * way round, so a narrow decision can't become a session-wide one); a refusal takes `denied`, else `abort`, where a
 * shell ask offers no deny (ADR 0174). Undefined: the host offered nothing that says this, so nothing is sent.
 */
export function museChoice(
  choices: readonly MuseApprovalChoice[],
  verdict: Pick<MuseApprovalVerdict, "allow" | "always">,
): MuseApprovalChoice | undefined {
  const offered = choices.filter((c) => c.choiceId.length > 0);
  const pick = (decision: string) => offered.find((c) => c.decision === decision);
  if (!verdict.allow) return pick("denied") ?? pick("abort");
  return verdict.always ? (pick("approvedForSession") ?? pick("approved")) : pick("approved");
}

/** The offers of one `approval/requested`, as the host wrote them (a malformed one names no choice and is dropped). */
function offersOf(params: Record<string, unknown>): MuseApprovalChoice[] {
  const list = Array.isArray(params.availableChoices) ? params.availableChoices : [];
  return list
    .filter(isRecord)
    .map((c) => ({
      choiceId: str(c.choiceId),
      decision: str(c.decision),
      ...(str(c.scope) ? { scope: str(c.scope) } : {}),
    }))
    .filter((c) => c.choiceId && c.decision);
}

/**
 * One MSP notification into brain events. Three families matter; everything else (task lifecycle, reminders, view
 * bookkeeping) is skipped by its method before its payload is read.
 */
export class MuseEventMapper {
  private readonly items = new Map<string, { name: string; args: unknown }>();
  usage = { input: 0, output: 0, cacheRead: 0, model: undefined as string | undefined };
  /** The turn called a tool: a failure after that loses work the API couldn't see, so a retry is the person's call. */
  worked = false;

  constructor(private readonly opts: { model?: string; redact?: (text: string) => string } = {}) {}

  private clean(text: string) {
    return this.opts.redact ? this.opts.redact(text) : text;
  }

  event(method: string, p: Record<string, unknown>): CodexBrainEvent[] {
    switch (method) {
      case "item/delta": {
        // Only the answer's own text: reasoning and summaries have fields of their own.
        const field = str(p.field);
        if (field && field !== "text") return [];
        const text = this.clean(str(p.delta));
        return text ? [{ type: "text_delta", text }] : [];
      }
      case "item/started":
      case "item/completed": {
        const item = isRecord(p.item) ? p.item : {};
        if (str(item.kind) !== "toolCall") return [];
        const id = str(item.itemId);
        const name = this.clean(str(item.tool) || "tool");
        if (method === "item/started") {
          // `args` is model-authored JSON that may still be incomplete: the raw string is kept, never a failure.
          this.worked = true;
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
        const failed = str(item.status) === "failed";
        return [
          {
            type: "tool_call",
            id,
            name: known?.name ?? name,
            input: known?.args ?? {},
            // A completed call is a result whichever way it went; a failed one with no words still says it failed.
            ...(output || failed
              ? { executed: { content: cut(this.clean(output)), ...(failed ? { isError: true } : {}) } }
              : {}),
          },
        ];
      }
      case "session/tokenUsage": {
        // The wire carries `promptTokens` (counted once) and the raw counters under `usage`; `outputTokens` is only
        // ever the raw one, so it is read there — a host that puts it on top too is read either way.
        const raw = isRecord(p.usage) ? p.usage : {};
        this.usage.input += num(p.promptTokens) || num(raw.inputTokens);
        this.usage.output += num(p.outputTokens) || num(raw.outputTokens);
        const cumulative = isRecord(p.cumulative) ? p.cumulative : {};
        this.usage.cacheRead += num(cumulative.cacheReadTokens);
        if (!this.usage.model && typeof p.modelId === "string") this.usage.model = p.modelId;
        return [];
      }
      default:
        return [];
    }
  }

  /** The turn's usage and its one `done`. */
  finish(sessionId: string): CodexBrainEvent[] {
    const { input, output, cacheRead, model } = this.usage;
    const named = this.opts.model ?? model;
    return [
      {
        type: "usage",
        input,
        output,
        source: "plan",
        ...(named ? { model: named } : {}),
        ...(cacheRead ? { cacheRead } : {}),
      },
      { type: "done", text: "", session: { id: sessionId } },
    ];
  }
}

type Reply = { result?: Record<string, unknown>; error?: { code: number; message: string } };

/** A request the host never answered: named so the turn can say which one, instead of "timed out". */
export class MuseTimeout extends Error {
  constructor(
    readonly method: string,
    readonly ms: number,
  ) {
    super(`no reply to ${method} within ${ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`}`);
    this.name = "MuseTimeout";
  }
}

/** A `muse serve` host: NDJSON frames on stdio, one request table, notifications routed out. */
export class MuseHost {
  private buffer = "";
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: Reply) => void>();
  private closed = false;
  private ended = false;
  stderr = "";

  constructor(
    private readonly child: ChildProcess,
    private readonly onNotification: (method: string, params: Record<string, unknown>) => void,
  ) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.read(chunk));
    child.stdin?.on("error", () => undefined);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    // A host that dies mid-handshake leaves requests unanswered: they fail now, with what it said.
    (child as unknown as EventEmitter).on("close", () => {
      this.ended = true;
      for (const [, waiting] of this.waiting)
        waiting({ error: { code: -1, message: this.stderr.trim() || "The Muse host ended." } });
      this.waiting.clear();
    });
  }

  private read(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at < 0) return;
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (!line.trim()) continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = typeof frame.id === "number" ? frame.id : undefined;
      const waiting = id === undefined ? undefined : this.waiting.get(id);
      if (waiting !== undefined && id !== undefined) {
        this.waiting.delete(id);
        waiting(frame.error ? { error: frame.error as Reply["error"] } : { result: frame.result as Reply["result"] });
        continue;
      }
      if (typeof frame.method === "string") {
        // A request the host sends us is answered empty: we subscribe to views, we do not serve methods.
        if (id !== undefined) this.write({ jsonrpc: "2.0", id, result: {} });
        this.onNotification(frame.method, isRecord(frame.params) ? frame.params : {});
      }
    }
  }

  private write(frame: Record<string, unknown>) {
    if (this.closed) return;
    this.child.stdin?.write(`${JSON.stringify(frame)}\n`);
  }

  request(method: string, params?: Record<string, unknown>, timeoutMs = 0): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.waiting.delete(id);
            reject(new MuseTimeout(method, timeoutMs));
          }, timeoutMs)
        : undefined;
      this.waiting.set(id, (reply) => {
        if (timer) clearTimeout(timer);
        if (reply.error) reject(new Error(reply.error.message));
        else resolve(reply.result ?? {});
      });
      this.write(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
    });
  }

  /** Fails every in-flight request: the host is gone and nothing will answer. */
  fail(message: string) {
    for (const [, waiting] of this.waiting) waiting({ error: { code: -1, message } });
    this.waiting.clear();
  }

  notify(method: string) {
    this.write({ jsonrpc: "2.0", method });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin?.end();
    if (this.ended) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killTree(this.child, "SIGKILL");
        resolve();
      }, CLOSE_TIMEOUT_MS);
      (this.child as unknown as { on: (event: string, fn: () => void) => void }).on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
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
  /** The account (its sessions and its sign-in are its own): its folder, and a key when it carries one. */
  account?: { id: string; home: string; key?: string };
  profile?: CommandProfile;
  chat?: boolean;
  /** Folders the agent was granted: writes there are the person's, and the approval policy reads them as its own. */
  grants?: readonly string[];
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
  /** Tests: how long `turn/start` may go unanswered, and how long the whole turn may live. */
  turnStartMs?: number;
  deadlineMs?: number;
}

/** The turn's outcome, once its host is gone. */
export interface MuseTurnEnd {
  done: boolean;
  canceled: boolean;
  failure?: string;
}

/** Runs one Muse turn and emits its events; ends with exactly one `done` or `error`. Never throws. */
export async function runMuseTurn(input: MuseTurnInput, opts: MuseTurnOptions): Promise<void> {
  const fail = (code: string, message: string, retryable?: boolean) =>
    opts.emit({ type: "error", code, message, ...(retryable ? { retryable } : {}) });
  if ((opts.platform ?? process.platform) === "win32")
    return fail("unsupported", "The Muse Code brain isn't supported on Windows yet.");
  // A right-hand turn: the CLI has no tool allow/deny list, so the posture withholds the shell and the write, and a
  // call that is not ours ends the turn (below). `chat` is a posture, not a profile: it wins over `work`.

  const key = input.account?.key;
  const sessionKey = codexThreadKey(input.sessionId, input.account?.id);
  const inherited: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const home = inherited.HOME || os.homedir();
  const base: NodeJS.ProcessEnv = {
    ...museHostEnv(inherited),
    [MUSE_RUN_ENV]: input.runId,
    [CODEX_MCP_ENV[0]]: input.mcp.token,
    ...(opts.socketPath ? { [CODEX_MCP_ENV[1]]: opts.socketPath } : {}),
    [CODEX_MCP_ENV[2]]: opts.runnerHome,
  };
  const configDir = museConfigDir(input.account ? input.account.home : path.join(opts.runnerHome, "brain", "muse"));
  const env = input.account ? accountEnv("muse", configDir, base) : { ...base, XDG_CONFIG_HOME: configDir };
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

  let child: ChildProcess;
  try {
    child = (opts.spawn ?? spawn)(
      resolveCommand(opts.bin ?? MUSE_BIN, env.PATH),
      museServeArgs({
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.chat ? { chat: true } : {}),
      }),
      { cwd: input.cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true },
    );
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return fail(
      missing ? "muse_missing" : "muse_failed",
      missing ? "Muse Code's CLI is not installed on this computer." : (err as Error).message,
      true,
    );
  }

  // What the host says reaches the thread and the logs: the same redactor the events get.
  const clean = (text: string) => (redact ? redact(text) : text);
  const mapper = new MuseEventMapper({
    ...(input.model ? { model: input.model } : {}),
    ...(redact ? { redact } : {}),
  });
  const profile = input.profile ?? "work";
  const shown = (text: string) => (redact ? redact(text) : text);
  /** Approvals already answered: a host that asks again for one gets no second decision in the thread. */
  const answered = new Set<string>();
  let finished = false;
  let missingHost = false;
  let failure: string | undefined;
  /** What the host said the turn ended as, read the moment `turn/completed` arrives — before its `done()`. */
  let ended: MuseTurnOutcome | undefined;
  let sessionId: string | undefined;
  let done: () => void = () => undefined;
  const turnOver = new Promise<void>((resolve) => {
    done = resolve;
  });

  const host = new MuseHost(child, (method, params) => {
    if (method === "turn/completed") {
      // The status is read here, not after `turnOver` resolves: the notification also resolves it, and a failed or
      // cancelled turn would otherwise be decided as the success its `done` reports.
      ended = museTurnOutcome(params);
      finished = true;
      done();
      return;
    }
    if (method === "approval/requested") {
      // The ask answered here, by the policy every brain follows: the host hears one of its own `choiceId`s, and the
      // thread gets the subject and the decision as a call, so a refusal is visible instead of silent.
      const approvalId = str(params.approvalId);
      const subject = isRecord(params.subject) ? params.subject : {};
      const kind = str(subject.kind);
      const command = str(subject.command);
      const file = str(subject.path);
      const offered = offersOf(params);
      // Nothing to answer without an id, and one decision per ask: a host that repeats an approval gets no second.
      if (!approvalId || answered.has(approvalId)) return;
      const verdict = museApprovalVerdict({
        subject: { kind, ...(command ? { command } : {}), ...(file ? { path: file } : {}) },
        cwd: input.cwd,
        profile,
        ...(input.chat ? { chat: true } : {}),
        ...(home ? { home } : {}),
        runnerHome: opts.runnerHome,
        ...(input.grants?.length ? { grants: input.grants } : {}),
      });
      // Never a decision of our own: the narrowest offer that says this, else its own refusal, so the host stops
      // waiting; when not even a refusal was offered the ask is left to the host.
      const choice = museChoice(offered, verdict);
      if (!choice) return;
      answered.add(approvalId);
      // The reply is nobody's business: a host that doesn't answer it must not hold the turn.
      void host
        .request("approval/decide", { approvalId, choiceId: choice.choiceId, commandId: uuidv7() })
        .catch(() => undefined);
      const takenScope = choice.scope ?? "once";
      opts.emit({
        type: "tool_call",
        id: approvalId,
        name: "approval",
        input: {
          approvalId,
          ...(kind ? { kind } : {}),
          ...(command ? { command: shown(command) } : {}),
          ...(file ? { path: file } : {}),
          decision: verdict.allow ? "allow" : "deny",
          scope: takenScope,
          choiceId: choice.choiceId,
          offered: offered.map((c) => c.choiceId),
        },
        executed: {
          content: `${verdict.allow ? "allowed" : "denied"} (${takenScope}): ${shown(verdict.why)}`,
          ...(verdict.allow ? {} : { isError: true }),
        },
      });
      return;
    }
    for (const event of mapper.event(method, params)) opts.emit(event);
  });
  (child as unknown as EventEmitter).on("error", (err: Error) => {
    if (finished) return;
    missingHost = (err as NodeJS.ErrnoException).code === "ENOENT";
    failure = missingHost ? "ENOENT: Muse Code's CLI is not installed on this computer." : clean(err.message);
    host.fail(failure);
    done();
  });
  (child as unknown as EventEmitter).on("close", () => {
    if (finished) return;
    failure = clean(host.stderr.trim()) || "Muse Code's host ended before the turn did.";
    done();
  });

  const abort = () => {
    if (sessionId) void host.request("turn/interrupt", { commandId: uuidv7(), sessionId }).catch(() => undefined);
    setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
  };
  if (opts.signal.aborted) abort();
  else opts.signal.addEventListener("abort", abort, { once: true });

  // A host that takes the turn and then goes quiet would hold the run for as long as it lives: the deadline closes it
  // and says so, instead of a thread (and a person) waiting on a process that will never speak again.
  const deadlineMs = opts.deadlineMs ?? TURN_DEADLINE_MS;
  const deadline = setTimeout(() => {
    if (finished) return;
    finished = true;
    const span = deadlineMs >= 60_000 ? `${Math.round(deadlineMs / 60_000)}-minute` : `${deadlineMs}ms`;
    failure = `The Muse turn ran past its ${span} deadline, and its host was closed.`;
    killTree(child, "SIGKILL");
    done();
  }, deadlineMs);

  try {
    await host.request("initialize", { clientInfo: { name: "agentes_chat", version: "1" } }, INIT_TIMEOUT_MS);
    host.notify("initialized");
    const stored = opts.sessions.get(sessionKey);
    const resumed = stored
      ? await host
          .request("session/resume", { commandId: uuidv7(), sessionId: stored }, INIT_TIMEOUT_MS)
          .catch(() => undefined)
      : undefined;
    const session = isRecord(resumed?.session) ? resumed?.session : undefined;
    if (session) sessionId = str(session.sessionId);
    const resumedOk = Boolean(sessionId);
    if (!sessionId) {
      // Muse lost it (its log is in the account's folder, our map in the runner home): a new session, context again.
      opts.sessions.delete(sessionKey);
      const started = await host.request("session/start", {
        commandId: uuidv7(),
        // The host asks for what its own policy doesn't match, and this turn answers every ask (ADR 0174).
        approvalMode: input.chat ? "denyUnmatched" : "promptUnmatched",
        ...(input.model ? { modelId: input.model } : {}),
      });
      sessionId = str(isRecord(started.session) ? started.session.sessionId : "");
      if (!sessionId) throw new Error("The Muse host started no session.");
      opts.sessions.set(sessionKey, sessionId);
    }
    // The view is what streams the turn's items; without a subscription a turn runs blind.
    await host.request("view/subscribe", { commandId: uuidv7(), sessionId }).catch(() => undefined);
    // The context goes with the first prompt of a session. `stored` is not the answer: a resume that failed starts a
    // new session a few lines above, and that one needs the context too.
    const prompt = resumedOk
      ? input.prompt
      : input.system.trim()
        ? `${input.system.trim()}\n\n${input.prompt}`
        : input.prompt;
    await host.request(
      "turn/start",
      { commandId: uuidv7(), sessionId, input: [{ type: "text", text: prompt }] },
      opts.turnStartMs ?? TURN_START_TIMEOUT_MS,
    );
  } catch (err) {
    if (!finished) {
      // A host that never answered a request we waited on is not a host that refused: it is gone or wedged, and the
      // error says which request, so the person reads what happened instead of "timed out".
      const message =
        err instanceof MuseTimeout
          ? `The Muse host stopped answering (${err.message}), so the turn was closed.`
          : err instanceof Error
            ? err.message
            : String(err);
      // A host that refused the handshake (no sign-in, another version) says why on stderr.
      const said = clean(host.stderr.trim()) || message;
      await host.close().catch(() => undefined);
      clearTimeout(deadline);
      const missing = /ENOENT|not installed/i.test(said);
      opts.emit({
        ...museProblem(missing ? "Muse Code's CLI is not installed on this computer." : said)[0],
        ...(missing ? { code: "muse_missing" } : {}),
      } as CodexBrainEvent);
      return;
    }
  } finally {
    opts.signal.removeEventListener("abort", abort);
  }

  await turnOver;
  clearTimeout(deadline);
  await host.close().catch(() => undefined);
  if (opts.signal.aborted) return fail("canceled", "The turn was canceled.");
  if (missingHost) return fail("muse_missing", "Muse Code's CLI is not installed on this computer.", true);
  if (failure) {
    for (const event of museProblem(failure)) opts.emit(event);
    return;
  }
  // The notification said the record landed; its own status says how the turn went, and only `completed` is a `done`.
  if (ended?.terminal === "cancelled")
    return fail("canceled", ended.message ?? "The Muse host ended the turn as cancelled.");
  if (ended?.terminal === "failed") {
    for (const event of museProblem(ended.message ?? "The Muse turn failed.", mapper.worked, ended.quota))
      opts.emit(event);
    return;
  }
  for (const event of mapper.finish(input.sessionId)) opts.emit(event);
}

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
      scope.emit({ type: "error", code: "account_missing", message: ACCOUNT_MISSING_MESSAGE.muse, retryable: false });
      return;
    }
    const key = await museKeyOf(home).catch(() => null);
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
      ...(ctx.grants?.length ? { grants: ctx.grants } : {}),
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
