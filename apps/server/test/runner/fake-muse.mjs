// A stand-in for `muse serve`: speaks MSP on stdio (NDJSON JSON-RPC), one echo turn, and tells on stderr when asked
// to start without a handshake — the two things the brain must get right. With `FAKE_MUSE_APPROVAL=1` a turn parks an
// approval first, as the real host does, and only finishes once the client answers it with a `choiceId` it offered.

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const say = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
const v7 = () => randomUUID().replace(/^(.{14})4/, "$17");
const notification = (method, params) => say(params === undefined ? { method } : { method, params });
/** What this host was asked and answered, for the test that reads it (`FAKE_MUSE_APPROVAL_LOG`). */
const log = (entry) => {
  const file = process.env.FAKE_MUSE_APPROVAL_LOG;
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
};

/** The offers a shell ask carries: the four decisions the wire has, once and for the session. */
const OFFERS = [
  { choiceId: "c_approve_once", decision: "approved", scope: "once" },
  { choiceId: "c_approve_session", decision: "approvedForSession", scope: "session" },
  { choiceId: "c_deny", decision: "denied", scope: "once" },
  { choiceId: "c_abort", decision: "abort", scope: "once" },
];

let initialized = false;
let session;
let commandId = v7();
let approval;
let finished = false;

if (process.env.FAKE_MUSE_REFUSE === "start") {
  process.stderr.write("muse: not logged in: run `muse login` first\n");
  process.exit(1);
}

/** The turn's items, its answer and its end: sent once, however the turn got there. */
function finishTurn() {
  if (finished) return;
  finished = true;
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
}

/** Parks an approval the turn waits on, as the host does mid-turn. */
function askApproval() {
  const approvalId = v7();
  approval = { approvalId, offered: OFFERS.map((o) => o.choiceId) };
  notification("approval/requested", {
    sessionId: session,
    approvalId,
    subject: { kind: "command", command: process.env.FAKE_MUSE_APPROVAL_COMMAND ?? "ls" },
    availableChoices: OFFERS,
  });
  log({ requested: approvalId, offered: approval.offered });
  // A client that never answers: the host gives up and ends the turn, so a brain that waits on the reply shows up as
  // a slow test instead of a hung one.
  setTimeout(finishTurn, Number(process.env.FAKE_MUSE_APPROVAL_WAIT ?? 2000)).unref?.();
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
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
      log({ session: { mode: mode ?? null } });
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
      if (process.env.FAKE_MUSE_APPROVAL === "1") {
        askApproval();
        return;
      }
      finishTurn();
      return;
    }
    if (frame.method === "approval/decide") {
      const asked = frame.params ?? {};
      log({ decide: { approvalId: asked.approvalId, choiceId: asked.choiceId, commandId: asked.commandId } });
      if (!approval || asked.approvalId !== approval.approvalId) {
        say({ id: frame.id, error: { code: -32602, message: "unknown approvalId" } });
        finishTurn();
        return;
      }
      // The one rule the client must get right: the choice is one the host offered, never a word of its own.
      if (!approval.offered.includes(asked.choiceId)) {
        log({ rejected: asked.choiceId });
        say({ id: frame.id, error: { code: -32602, message: `choiceId ${asked.choiceId} was never offered` } });
        finishTurn();
        return;
      }
      log({ accepted: asked.choiceId });
      // A host that never answers the reply: the turn still ends, which is what a client must survive.
      if (process.env.FAKE_MUSE_APPROVAL_SILENT !== "1") say({ id: frame.id, result: { accepted: true } });
      finishTurn();
      return;
    }
    if (frame.method === "turn/interrupt") {
      say({ id: frame.id, result: {} });
      notification("turn/completed", { sessionId: session, commandId });
      return;
    }
    if (frame.id !== undefined) say({ id: frame.id, result: {} });
  })
  .on("close", () => process.exit(0));
