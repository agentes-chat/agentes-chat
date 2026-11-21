import type { LiveRef, LiveSelection } from "@agenteschat/client";
import { useSyncExternalStore } from "react";

/*
 * What travels between a live file's screen and its conversation's (ADR 0199), which a route can't carry: the part
 * of the file the conversation opens about (the quote over its composer, sent as the next message's `meta.liveRef`),
 * and the part a message's line names, shown when the file's screen is in view again. With the conversation in its
 * sheet over the file (ADR 0208), where the sheet stands, which the file behind follows, and what the file asks of it.
 */

const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The quote waiting over each conversation's composer, by its channel. */
const abouts = new Map<string, LiveRef>();

/** The conversation `channelId` opens about this part of its file: its quote over the composer. */
export function setTalkAbout(channelId: string, ref: LiveRef): void {
  abouts.set(channelId, ref);
  changed();
}

/** The quote goes (its × or the message that carried it). */
export function dropTalkAbout(channelId: string): void {
  if (!abouts.delete(channelId)) return;
  changed();
}

export const talkAboutOf = (channelId: string): LiveRef | null => abouts.get(channelId) ?? null;

/** The quote over `channelId`'s composer, live. */
export const useTalkAbout = (channelId: string): LiveRef | null =>
  useSyncExternalStore(subscribe, () => talkAboutOf(channelId));

/** The part of each file to show once its screen is in view, by file. */
const reveals = new Map<string, { selection: LiveSelection; messageId?: string }>();

/** Shows `selection` (a message's line, or its pin) the next time the file's screen is in view. */
export function revealOnOpen(fileId: string, selection: LiveSelection, messageId?: string): void {
  reveals.set(fileId, messageId ? { selection, messageId } : { selection });
  changed();
}

/** What waits to be shown on `fileId`, live: the file's screen takes it once it is in view (`takeReveal`). */
export const useRevealFor = (fileId: string) => useSyncExternalStore(subscribe, () => reveals.get(fileId) ?? null);

export function takeReveal(fileId: string): void {
  if (!reveals.delete(fileId)) return;
  changed();
}

// ── The conversation's sheet over its file (ADR 0208) ───────────────────────────────────────────────────────────

/** The file whose conversation is up in the sheet over it, and how the sheet sits. */
export interface TalkSheet {
  /** Which sheet (one route each time it opens): a sheet still leaving never clears the one opened after it. */
  id: number;
  fileId: string;
  channelId: string;
  /** Which height it rests at: 0 the first (the file in sight above it), 1 the whole screen. */
  detent: number;
  /** How much of the screen's bottom it takes at its first height (`talkSheetReserve`), which the file keeps clear. */
  reserve: number;
}

let sheetShown: TalkSheet | null = null;
/** Sheets of a file's conversation mounted (one at a time; counted, so a quick close and open never cross). */
let sheetsMounted = 0;

/** The sheet tells where it is: up over `fileId` at that height, or leaving (null). */
export function showTalkSheet(next: TalkSheet | null): void {
  const now = sheetShown;
  if (
    now === next ||
    (now &&
      next &&
      now.id === next.id &&
      now.fileId === next.fileId &&
      now.channelId === next.channelId &&
      now.detent === next.detent &&
      now.reserve === next.reserve)
  )
    return;
  sheetShown = next;
  changed();
}

export const talkSheetNow = (): TalkSheet | null => sheetShown;

/** The sheet, live, whichever file it is over (null while none is up). */
export const useAnyTalkSheet = (): TalkSheet | null => useSyncExternalStore(subscribe, () => sheetShown);

/** The sheet over this file, live: null while none is up over it (or it is over another file). */
export const useTalkSheet = (fileId: string | null | undefined): TalkSheet | null =>
  useSyncExternalStore(subscribe, () => (fileId && sheetShown?.fileId === fileId ? sheetShown : null));

/** What the file under the sheet asks of it: come down to its first height, go to a message, take another file, go. */
export type TalkSheetAsk =
  | { kind: "lower" }
  | { kind: "message"; messageId: string }
  | { kind: "file"; fileId: string; channelId: string; rootId: string; messageId?: string }
  | { kind: "close" };

let ask: (TalkSheetAsk & { at: number }) | null = null;
let asks = 0;

export function askTalkSheet(next: TalkSheetAsk): void {
  asks += 1;
  ask = { ...next, at: asks };
  changed();
}

/** The latest ask, live: the sheet acts on each one once (by its `at`). */
export const useTalkSheetAsk = () => useSyncExternalStore(subscribe, () => ask);

/** Waiting for the sheet's route to be gone (`afterTalkSheet`). */
const goneWaiters = new Set<() => void>();

/** The sheet's route mounted; the cleanup it returns runs as it goes. */
export function mountTalkSheet(): () => void {
  sheetsMounted += 1;
  return () => {
    sheetsMounted = Math.max(0, sheetsMounted - 1);
    if (sheetsMounted > 0) return;
    for (const done of [...goneWaiters]) done();
    goneWaiters.clear();
  };
}

/** Whether a file's conversation is up in its sheet now (or still leaving). */
export const talkSheetMounted = () => sheetsMounted > 0;

/** The longest the screen under the sheet waits for it to leave before going on anyway (ms). */
const GONE_MAX_MS = 900;

/**
 * Once the sheet's route is gone: what closes the screen under it waits for that, since a step back while the sheet
 * is up (or still leaving) takes the sheet, never the screen under it.
 */
export function afterTalkSheet(): Promise<void> {
  if (sheetsMounted === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      goneWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, GONE_MAX_MS);
    goneWaiters.add(done);
  });
}
