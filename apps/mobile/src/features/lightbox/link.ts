/** A video's link a tile holds, and when it was read. */
export interface TileLink {
  uri: string;
  headers?: Record<string, string>;
  readAt: number;
}

/** The server's links live 5 minutes: one read longer ago than this isn't played from (the player could outlive it). */
export const TILE_LINK_MS = 3 * 60_000;

/** A tile's video link while it has life ahead, else null (the viewer reads a new one). */
export function freshLink(
  link: TileLink | null | undefined,
  now: number,
): { uri: string; headers?: Record<string, string> } | null {
  if (!link || now - link.readAt >= TILE_LINK_MS) return null;
  return link.headers ? { uri: link.uri, headers: link.headers } : { uri: link.uri };
}
