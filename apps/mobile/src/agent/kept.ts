/**
 * What the faces keep across mounts, most recently used last: a face scrolled back into view, the same agent in many
 * rows. Pure: no React Native, no Skia, so it runs in `bun test`.
 */
export const KEPT = 400;

/** `map`'s value for `key` (made and kept on a miss), the least recently used dropped past `limit`. */
export function kept<T>(map: Map<string, T>, key: string, make: () => T, limit = KEPT): T {
  if (map.has(key)) {
    const hit = map.get(key) as T;
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const made = make();
  map.set(key, made);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return made;
}

/** Everything a still face's pixels depend on (the tile's corner and border are its view's, not the picture's). */
export interface StillFace {
  /** What its color draws as now (`drawnKey`). */
  drawn: string;
  eyes: string;
  accessory: string | undefined;
  size: number;
  mode: string;
  seed: number;
  reduced: boolean;
  tile: boolean;
  dark: boolean;
  expression: string | undefined;
  gaze: string | undefined;
  bodyless: boolean;
}

/** One key per look: identical faces share one picture. */
export function stillFaceKey(f: StillFace): string {
  return [
    f.drawn,
    f.eyes,
    f.accessory ?? "",
    f.size,
    f.mode,
    f.seed,
    f.reduced,
    f.tile,
    f.dark,
    f.expression ?? "",
    f.gaze ?? "",
    f.bodyless,
  ].join("|");
}

/** A still face as an image: its look and the screen's pixel ratio (one image per density). */
export function stillImageKey(face: string, ratio: number): string {
  return `${face}@${ratio}`;
}
