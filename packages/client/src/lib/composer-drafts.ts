/**
 * What a person typed in a conversation's composer and didn't send, kept on this device so switching
 * conversations or reloading doesn't lose it: the text, and the files already uploaded for it. One book per person
 * (JSON, by conversation key); the app stores it where it likes (`localStorage` on the web). An entry with a blank
 * text and no files goes, old entries go after `DRAFT_TTL_MS`, and the book keeps the `MAX_DRAFTS` most recent ones.
 */
export interface ComposerDraft {
  text: string;
  /** Files attached and already in the Drive, for the next message (absent: none). */
  files?: DraftFile[];
  /** When it was last changed (ms). */
  at: number;
}

/** A file waiting in the composer: its Drive ref, and what its chip shows (name, size, type for its icon). */
export interface DraftFile {
  id: string;
  version: number;
  title: string;
  name: string;
  size: number;
  /** Its MIME type ("" when the browser gave none). */
  type: string;
}

export type DraftBook = Record<string, ComposerDraft>;

export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_DRAFTS = 100;

/** The conversation a composer writes to: a thread's own, else its channel's (a DM is a channel). */
export const draftKeyOf = (channelId: string, threadId?: string | null) =>
  threadId ? `thread:${threadId}` : `channel:${channelId}`;

/** The book saved as `raw` (nothing, broken or anything else: empty), without expired entries. */
export function readDraftBook(raw: string | null, now: number): DraftBook {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const book: DraftBook = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { text, at, files: rawFiles } = value as { text?: unknown; at?: unknown; files?: unknown };
    if (typeof text !== "string" || typeof at !== "number") continue;
    const files = Array.isArray(rawFiles) ? rawFiles.filter(isDraftFile) : [];
    if (!text.trim() && files.length === 0) continue;
    if (now - at > DRAFT_TTL_MS) continue;
    book[key] = files.length ? { text, files, at } : { text, at };
  }
  return book;
}

function isDraftFile(value: unknown): value is DraftFile {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.version === "number" &&
    typeof f.title === "string" &&
    typeof f.name === "string" &&
    typeof f.size === "number" &&
    typeof f.type === "string"
  );
}

/** The book with `key`'s text set, its files kept; trimmed to the most recent `MAX_DRAFTS`. */
export function withDraft(book: DraftBook, key: string, text: string, now: number): DraftBook {
  return withEntry(book, key, text, book[key]?.files ?? [], now);
}

/** The book with `key`'s files set, its text kept; trimmed to the most recent `MAX_DRAFTS`. */
export function withDraftFiles(book: DraftBook, key: string, files: readonly DraftFile[], now: number): DraftBook {
  return withEntry(book, key, book[key]?.text ?? "", files, now);
}

/** An entry with a blank text and no files is removed. */
function withEntry(book: DraftBook, key: string, text: string, files: readonly DraftFile[], now: number): DraftBook {
  const next: DraftBook = { ...book };
  if (files.length) next[key] = { text, files: [...files], at: now };
  else if (text.trim()) next[key] = { text, at: now };
  else delete next[key];
  const keys = Object.keys(next);
  if (keys.length <= MAX_DRAFTS) return next;
  const kept = keys.sort((a, b) => (next[b]?.at ?? 0) - (next[a]?.at ?? 0)).slice(0, MAX_DRAFTS);
  return Object.fromEntries(kept.map((k) => [k, next[k] as ComposerDraft]));
}
