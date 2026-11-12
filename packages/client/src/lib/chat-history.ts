import { useCallback, useState } from "react";
import type { Message } from "../api/types";
import { lastPostedId, type TimelineItem } from "./timeline";

interface HistoryBoundary {
  /** Server message ids are ordered UUIDv7s, even when a reply is placed earlier in the timeline. */
  id: string;
  pending: string[];
}

export const isClearCommand = (text: string) => text.trim().toLowerCase() === "/clear";

export function readHistoryBoundary(raw: string | null): HistoryBoundary | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const { id, pending } = value as HistoryBoundary;
    return typeof id === "string" && Array.isArray(pending) && pending.every((p) => typeof p === "string")
      ? { id, pending }
      : null;
  } catch {
    return null;
  }
}

export function historyBoundary(messages: readonly Message[]): HistoryBoundary {
  return {
    id: lastPostedId(messages) ?? "",
    pending: messages.filter((m) => m.local).map((m) => m.clientId ?? m.id),
  };
}

export function afterHistoryBoundary(message: Message, boundary: HistoryBoundary | null): boolean {
  if (!boundary) return true;
  if (boundary.pending.includes(message.clientId ?? message.id)) return false;
  return Boolean(message.local) || message.id > boundary.id;
}

/** Hide empty day dividers too, and start a fresh author group after any hidden message. */
export function visibleHistory(items: TimelineItem[], includes: (message: Message) => boolean): TimelineItem[] {
  const shown: TimelineItem[] = [];
  let day: TimelineItem | null = null;
  let grouped = false;
  for (const item of items) {
    if (item.kind === "day") {
      day = item;
      grouped = false;
    } else if (item.kind === "message" && !includes(item.message)) {
      grouped = false;
    } else {
      if (day) shown.push(day);
      day = null;
      shown.push(item.kind === "message" && !grouped ? { ...item, grouped: false } : item);
      grouped = item.kind === "message";
    }
  }
  return shown;
}

/** A view preference on this device, scoped by the caller to a server, person and conversation. */
export function useChatHistory(
  key: string,
  read: (key: string) => string | null,
  write: (key: string, value: string) => void,
) {
  const [saved, setSaved] = useState(() => ({ key, boundary: readHistoryBoundary(read(key)) }));
  if (saved.key !== key) setSaved({ key, boundary: readHistoryBoundary(read(key)) });
  const boundary = saved.key === key ? saved.boundary : readHistoryBoundary(read(key));
  const save = useCallback(
    (next: HistoryBoundary | null) => {
      write(key, JSON.stringify(next));
      setSaved({ key, boundary: next });
    },
    [key, write],
  );
  const clear = useCallback((messages: readonly Message[]) => save(historyBoundary(messages)), [save]);
  const show = useCallback(() => save(null), [save]);
  const includes = useCallback((message: Message) => afterHistoryBoundary(message, boundary), [boundary]);
  return { cleared: boundary !== null, clear, show, includes };
}
