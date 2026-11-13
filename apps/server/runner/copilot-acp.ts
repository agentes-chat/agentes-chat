import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CursorModelInfo } from "@agenteschat/adapters/machine-protocol";
import { killTree } from "./exec";
import { cliSpawn } from "./executors";

/**
 * Whether an account's Copilot CLI sign-in works and which models it offers, without a prompt (ADR 0174, protocol 65). The CLI
 * has no status or models command; its Agent Client Protocol server (`copilot --acp --stdio`, `copilot help acp`)
 * answers both when a session opens: `session/new` lists the models, or fails with "Authentication required" (-32000)
 * signed out. Both requests go on its standard input at once and it exits when that closes, so one run is the whole
 * look. Run against Copilot CLI 1.0.109 (2026-11-12).
 *
 * The session it opens for the look stays in `$COPILOT_HOME/session-state/<id>`: removed here, by its id alone.
 */

export const COPILOT_LOOK_ARGS = [
  "--acp",
  "--stdio",
  "--no-auto-update",
  "--disable-builtin-mcps",
  "--no-custom-instructions",
] as const;

export const COPILOT_LOOK_TIMEOUT_MS = 20_000;
/** What one line of the CLI's answers may weigh (its command list alone is tens of kilobytes). */
const LINE_MAX = 512 * 1024;
const MODELS_MAX = 60;

/** `initialize` and `session/new`, one JSON-RPC message per line: nothing is granted, no MCP server, no tool. */
export function copilotLookInput(cwd: string): string {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientInfo: { name: "agentes-runner", version: "1" },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    },
    { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, mcpServers: [] } },
  ];
  return `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
}

export interface CopilotLook {
  /** True with models listed, false when the CLI asked for a sign-in, null when it didn't say (timed out, crashed). */
  signedIn: boolean | null;
  models: CursorModelInfo[];
  session?: string;
  said?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_ID = /^[a-z0-9][\w.:/-]{0,79}$/i;

/**
 * The CLI's answer to `session/new` (the line with `id: 2`): its models, each with the name it shows; a refusal
 * naming the sign-in is signed out; any other refusal, or no answer, says nothing.
 */
export function parseCopilotLook(lines: readonly string[]): CopilotLook {
  for (const line of lines) {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(msg) || msg.id !== 2 || typeof msg.method === "string") continue;
    if (isRecord(msg.error)) {
      const said = typeof msg.error.message === "string" ? msg.error.message.slice(0, 300) : "";
      const auth = msg.error.code === -32000 || /authenticat|sign.?in|log.?in|unauthori[sz]ed/i.test(said);
      return { signedIn: auth ? false : null, models: [], ...(said ? { said } : {}) };
    }
    const result = isRecord(msg.result) ? msg.result : {};
    const session = typeof result.sessionId === "string" && SESSION_ID.test(result.sessionId) ? result.sessionId : "";
    const listed = isRecord(result.models) && Array.isArray(result.models.availableModels) ? result.models : null;
    const models: CursorModelInfo[] = [];
    for (const m of (listed?.availableModels as unknown[] | undefined) ?? []) {
      const id = isRecord(m) && typeof m.modelId === "string" ? m.modelId : "";
      if (!MODEL_ID.test(id) || models.some((x) => x.id === id)) continue;
      const label = isRecord(m) && typeof m.name === "string" ? m.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      models.push({ id, ...(label ? { label } : {}) });
      if (models.length >= MODELS_MAX) break;
    }
    return { signedIn: models.length > 0 ? true : null, models, ...(session ? { session } : {}) };
  }
  return { signedIn: null, models: [] };
}

export function dropCopilotLookSession(home: string, session: string | undefined) {
  if (!session || !SESSION_ID.test(session)) return;
  rmSync(path.join(home, "session-state", session), { recursive: true, force: true });
}

export interface CopilotLookOptions {
  command: readonly string[];
  env: NodeJS.ProcessEnv;
  home: string;
  timeoutMs?: number;
  spawn?: typeof spawn;
}

/**
 * One look, with the account's env (`accountEnv`, where a `gh` sign-in kept in a file never answers for the account):
 * starts the CLI in an empty folder of its own, sends both requests, reads its answer. Never throws.
 */
export async function copilotLook(opts: CopilotLookOptions): Promise<CopilotLook & { started: boolean }> {
  let cwd: string;
  try {
    cwd = mkdtempSync(path.join(tmpdir(), "agentes-copilot-look-"));
  } catch {
    return { signedIn: null, models: [], started: false };
  }
  try {
    const run = cliSpawn(opts.command, COPILOT_LOOK_ARGS, opts.env.PATH);
    let child: ChildProcess;
    try {
      child = (opts.spawn ?? spawn)(run.file, run.args, {
        cwd,
        env: opts.env,
        stdio: ["pipe", "pipe", "ignore"],
        detached: process.platform !== "win32",
        windowsHide: true,
        windowsVerbatimArguments: run.windowsVerbatimArguments,
      });
    } catch {
      return { signedIn: null, models: [], started: false };
    }
    const lines: string[] = [];
    const reader = createInterface({ input: child.stdout as NonNullable<ChildProcess["stdout"]> });
    (reader as unknown as EventEmitter).on("line", (line: string) => {
      // Only the answers to our two requests matter; its session updates are large and many.
      if (line.length <= LINE_MAX && /"id"\s*:\s*[12]\b/.test(line.slice(0, 200))) lines.push(line);
    });
    const started = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        // The whole tree: on Windows the CLI is cmd.exe's child.
        killTree(child, "SIGKILL");
        finish(true);
      }, opts.timeoutMs ?? COPILOT_LOOK_TIMEOUT_MS);
      timer.unref?.();
      const proc = child as unknown as EventEmitter;
      proc.on("error", () => finish(false));
      proc.on("close", () => finish(true));
      const stdin = child.stdin as NonNullable<ChildProcess["stdin"]>;
      (stdin as unknown as EventEmitter).on("error", () => {});
      stdin.end(copilotLookInput(cwd));
    });
    reader.close();
    const look = parseCopilotLook(lines);
    dropCopilotLookSession(opts.home, look.session);
    return { ...look, started };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
