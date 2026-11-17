/**
 * The MCP sandbox's bridge (ADR 0190, addendum): each WebSocket from the app starts one stdio MCP program here, in a
 * container of its own that holds none of the app's secrets, files or database. The first text frame is the program
 * (`{ command, args, cwd, env }`); after it, each frame is one JSON-RPC message, written to its stdin or read off its
 * stdout's lines. The socket closing stops the program's whole process group, and the program ending closes the socket.
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";

/** The app's own limit on a message (`maxBufferSize` in packages/engine/src/connectors/stdio.ts). */
const MAX = 8 * 1024 * 1024;
/** What a program inherits, as the MCP SDK's own stdio transport does: never the bridge's other variables. */
const BASE_ENV = Object.fromEntries(
  ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "TERM"].flatMap((k) => {
    const v = process.env[k];
    return v ? [[k, v]] : [];
  }),
);

interface Program {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** The app checked it already (`parseStdioConfig`); its shape is checked again at this door. */
export function programOf(text: string): Program | null {
  try {
    const v = JSON.parse(text);
    const args = v?.args ?? [];
    const env = v?.env ?? {};
    if (typeof v?.command !== "string" || !v.command || !strings(args)) return null;
    if (v.cwd !== undefined && typeof v.cwd !== "string") return null;
    if (typeof env !== "object" || Array.isArray(env) || !Object.values(env).every((s) => typeof s === "string"))
      return null;
    return { command: v.command, args, ...(v.cwd ? { cwd: v.cwd } : {}), env };
  } catch {
    return null;
  }
}

/** The program and anything it started: its group (`detached`), asked, then made, to stop. */
function stop(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      // the group is gone
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 2000).unref();
}

export function startBridge(port: number) {
  return Bun.serve<{ child?: ChildProcess }, never>({
    port,
    fetch: (req, server) =>
      server.upgrade(req, { data: {} }) ? undefined : new Response("MCP sandbox: WebSocket only\n", { status: 426 }),
    websocket: {
      maxPayloadLength: MAX,
      // A session can sit idle between tool calls; the server's pings keep it open.
      idleTimeout: 960,
      message(ws, frame) {
        const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
        const running = ws.data.child;
        if (running) {
          running.stdin?.write(text.endsWith("\n") ? text : `${text}\n`);
          return;
        }
        const program = programOf(text);
        if (!program) return ws.close(1008, "invalid program");
        const child: ChildProcess = spawn(program.command, program.args, {
          cwd: program.cwd ?? process.env.HOME,
          env: { ...BASE_ENV, ...program.env },
          // Stderr is dropped, never kept or logged: it can carry credentials.
          stdio: ["pipe", "pipe", "ignore"],
          detached: true,
        });
        ws.data.child = child;
        let line = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          line += chunk;
          for (let end = line.indexOf("\n"); end >= 0; end = line.indexOf("\n")) {
            const message = line.slice(0, end).replace(/\r$/, "");
            line = line.slice(end + 1);
            if (message.trim()) ws.send(message);
          }
          if (line.length > MAX) ws.close(1009, "message too large");
        });
        child.stdin?.on("error", () => {});
        // Bun's types leave EventEmitter off ChildProcess, as apps/server/runner/desktop.ts notes.
        const events = child as unknown as EventEmitter;
        events.on("error", () => ws.close(1011, "the program could not start"));
        events.on("exit", () => ws.close(1000, "the program ended"));
      },
      close(ws) {
        if (ws.data.child) stop(ws.data.child);
      },
    },
  });
}

if (import.meta.main) {
  const server = startBridge(Number(process.env.PORT ?? 7070));
  console.log(`MCP sandbox listening on ${server.port}`);
}
