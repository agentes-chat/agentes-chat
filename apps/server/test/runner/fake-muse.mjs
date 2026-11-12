// A stand-in for `muse serve`: speaks MSP on stdio (NDJSON JSON-RPC), one echo turn, and tells on stderr when asked
// to start without a handshake — the two things the brain must get right.

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const say = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
const v7 = () => randomUUID().replace(/^(.{14})4/, "$17");
const notification = (method, params) => say(params === undefined ? { method } : { method, params });

let initialized = false;
let session;
let commandId = v7();

if (process.env.FAKE_MUSE_REFUSE === "start") {
  process.stderr.write("muse: not logged in: run `muse login` first\n");
  process.exit(1);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.method === "initialize") {
    say({
      id: frame.id,
      result: {
        experimentalApi: false,
        grantedCapabilities: [],
        museHome: "/tmp",
        platformFamily: "posix",
        platformOs: "linux",
        schema: { version: 1, fingerprint: "x" },
      },
    });
    return;
  }
  if (frame.method === "initialized") {
    initialized = true;
    return;
  }
  if (!initialized) {
    say({ id: frame.id, error: { code: -32600, message: "Not initialized" } });
    return;
  }
  // Every command carries a UUIDv7; a v4 is refused, exactly as the host does.
  if (frame.params?.commandId && !/^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(frame.params.commandId)) {
    say({ id: frame.id, error: { code: -32602, message: "invalid commandId: expected UUIDv7" } });
    return;
  }
  if (frame.method === "session/start" || frame.method === "session/resume") {
    // The wire's own names, as the real host refuses anything else.
    const mode = frame.params?.approvalMode;
    if (mode !== undefined && !["allowAll", "promptUnmatched", "onRequest", "denyUnmatched"].includes(mode)) {
      say({ id: frame.id, error: { code: -32602, message: `unknown variant \`${mode}\`` } });
      return;
    }
    session = frame.params?.sessionId ?? "01a1d1a7-03e4-7e51-a6c0-a531c2a9808c";
    if (frame.method === "session/resume" && process.env.FAKE_MUSE_LOST) {
      say({ id: frame.id, error: { code: -32010, message: "sessionNotFound" } });
      return;
    }
    say({
      id: frame.id,
      result: { session: { sessionId: session, approvalMode: { mode: "never" } }, viewCursor: "v1" },
    });
    notification("session/started", { session: { sessionId: session } });
    return;
  }
  if (frame.method === "view/subscribe") {
    say({ id: frame.id, result: {} });
    return;
  }
  if (frame.method === "turn/start") {
    commandId = frame.params?.commandId ?? commandId;
    say({ id: frame.id, result: {} });
    notification("turn/started", { commandId, sessionId: session });
    if (process.env.FAKE_MUSE_TOOL) {
      notification("item/started", {
        sessionId: session,
        item: {
          itemId: "i1",
          kind: "toolCall",
          tool: "bash",
          args: '{"command":"ls"}',
          revision: 1,
          status: "inProgress",
        },
      });
      notification("item/completed", {
        sessionId: session,
        item: {
          itemId: "i1",
          kind: "toolCall",
          tool: "bash",
          visibleOutput: "a.txt",
          status: "completed",
          revision: 2,
        },
      });
    }
    notification("item/started", {
      sessionId: session,
      item: { itemId: "a1", kind: "agentMessage", revision: 1, status: "inProgress" },
    });
    const answer = process.env.FAKE_MUSE_ANSWER ?? "echo: oi";
    notification("item/delta", { sessionId: session, itemId: "a1", field: "text", delta: answer });
    notification("item/completed", {
      sessionId: session,
      item: { itemId: "a1", kind: "agentMessage", revision: 2, status: "completed" },
    });
    notification("session/tokenUsage", {
      sessionId: session,
      promptTokens: 10,
      outputTokens: 4,
      cumulative: { cacheReadTokens: 2 },
    });
    notification("turn/completed", { sessionId: session, commandId });
    return;
  }
  if (frame.method === "turn/interrupt") {
    say({ id: frame.id, result: {} });
    notification("turn/completed", { sessionId: session, commandId });
    return;
  }
  if (frame.id !== undefined) say({ id: frame.id, result: {} });
});
