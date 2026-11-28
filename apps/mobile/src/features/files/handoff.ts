import type { VideoThumbnail } from "expo-video";

/**
 * What a video's tile in a message hands the viewer it opens, under the viewer page's key (`pictureKey` with
 * `viewerVersion`): the cover the tile showed, and the link it already holds while that link has life ahead. The page
 * opens on that cover and starts its player from that link at once, instead of asking for the file's details and a
 * new link first and showing black meanwhile. Handed on the touch, taken once by the page; what nobody takes goes.
 */
export interface HandedVideo {
  /** The tile's link, or null when it is too old to play from (the page reads a new one). */
  source: { uri: string; headers?: Record<string, string> } | null;
  frame: VideoThumbnail | null;
}

/** The server's links live 5 minutes: one read longer ago than this isn't handed (the player could outlive it). */
export const HANDED_LINK_MS = 3 * 60_000;
/** A hand-off nobody took (a touch that didn't open) goes after this long. */
const KEPT_MS = 10_000;

const handed = new Map<string, HandedVideo & { at: number }>();

/** Hands a video to the viewer about to open it (`readAt`: when the tile read its link). */
export function handVideo(
  key: string,
  source: HandedVideo["source"],
  readAt: number,
  frame: VideoThumbnail | null,
  now = Date.now(),
) {
  for (const [k, v] of handed) if (now - v.at > KEPT_MS) handed.delete(k);
  handed.set(key, { source: source && now - readAt < HANDED_LINK_MS ? source : null, frame, at: now });
}

/** The page's hand-off, once: undefined when its tile handed nothing (opened from the Drive, a link, a notice). */
export function takeVideo(key: string, now = Date.now()): HandedVideo | undefined {
  const got = handed.get(key);
  handed.delete(key);
  return got && now - got.at <= KEPT_MS ? { source: got.source, frame: got.frame } : undefined;
}
