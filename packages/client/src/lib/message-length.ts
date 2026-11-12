import type { TFunction } from "i18next";
import { formatInt } from "./format";

/** The longest message the server takes, in characters. Mirrors `MAX_MESSAGE_LENGTH` in packages/engine/src/messages.ts. */
export const MAX_MESSAGE_LENGTH = 100_000;

/** A text counted as the server counts it (trimmed) is past the limit. */
export const tooLongToSend = (text: string) => text.trim().length > MAX_MESSAGE_LENGTH;

/** A text returning to a field that may hold another: both stay, the returning one first. */
export const joinDrafts = (returning: string, typed: string) => (typed.trim() ? `${returning}\n\n${typed}` : returning);

/** "A mensagem tem 120.000 caracteres e o limite é 100.000." */
export const tooLongText = (t: TFunction, locale: string, length: number, max = MAX_MESSAGE_LENGTH) =>
  t("channel.tooLong.text", { length: formatInt(locale, length), max: formatInt(locale, max) });

/**
 * How tall a message shows in a conversation before it is clipped, in points (web and phone alike): one taller than
 * `over` shows its first `shows`, faded, and opens whole. The gap between the two keeps "Ver mais" from hiding only
 * a line or two.
 */
export const LONG_MESSAGE = { over: 520, shows: 360 } as const;

/** The height a message of `height` shows at in a conversation: null when it shows whole. */
export const clippedHeight = (height: number): number | null =>
  height > LONG_MESSAGE.over ? LONG_MESSAGE.shows : null;
