import { expect, test } from "bun:test";
import type { Message } from "../src/api/types";
import {
  afterHistoryBoundary,
  historyBoundary,
  isClearCommand,
  readHistoryBoundary,
  visibleHistory,
} from "../src/lib/chat-history";
import { buildTimeline } from "../src/lib/timeline";

const message = (id: string, patch: Partial<Message> = {}): Message => ({
  id,
  channelId: "channel",
  threadId: null,
  author: { type: "person", id: "person" },
  body: "topic",
  mentionedAgentIds: [],
  agentRunId: null,
  createdAt: "2026-11-12T12:00:00.000Z",
  ...patch,
});

test("clear only handles the standalone command", () => {
  expect(isClearCommand("  /clear \n")).toBe(true);
  expect(isClearCommand("/CLEAR")).toBe(true);
  for (const text of ["/clear my messages", "hi /clear", "/clearing"]) expect(isClearCommand(text)).toBe(false);
});

test("a saved boundary hides paginated history and keeps new posts even when placed earlier", () => {
  const old = message("01a1ce56-d315-730e-b701-41fb61149384");
  const next = message("01a1ce56-d315-730e-b701-41fb61149385", { createdAt: "2026-11-12T11:59:00.000Z" });
  const boundary = readHistoryBoundary(JSON.stringify(historyBoundary([old])));
  expect(afterHistoryBoundary(old, boundary)).toBe(false);
  expect(afterHistoryBoundary(message("01a1ce56-d314-730e-b701-41fb61149384"), boundary)).toBe(false);
  expect(afterHistoryBoundary(next, boundary)).toBe(true);
  expect(afterHistoryBoundary(old, null)).toBe(true);
});

test("pending messages stay hidden after acknowledgement, and new pending messages show", () => {
  const pending = message("local-1", { local: "pending", clientId: "send-1" });
  const boundary = historyBoundary([message("m-1"), pending]);
  expect(afterHistoryBoundary(pending, boundary)).toBe(false);
  expect(afterHistoryBoundary(message("m-2", { clientId: "send-1" }), boundary)).toBe(false);
  expect(afterHistoryBoundary(message("local-2", { local: "pending", clientId: "send-2" }), boundary)).toBe(true);
});

test("empty days disappear and the first visible message keeps its author header", () => {
  const old = message("m-1");
  const next = message("m-2");
  const items = buildTimeline([old, next], [], []);
  expect(visibleHistory(items, () => false)).toEqual([]);
  const shown = visibleHistory(items, (m) => m.id === next.id);
  expect(shown.map((i) => i.kind)).toEqual(["day", "message"]);
  expect(shown[1]).toMatchObject({ message: next, grouped: false });
});

test("invalid stored preferences leave the history visible", () => {
  for (const raw of [null, "", "broken", "null", "[]", '{"id":3,"pending":[]}', '{"id":"x","pending":[3]}'])
    expect(readHistoryBoundary(raw)).toBeNull();
});
