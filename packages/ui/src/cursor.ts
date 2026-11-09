/**
 * An agent's pointer drawn over a picture of its screen (`AgentCursor`, and the phone's own): how it glides from
 * one place to the next, how long, and how long its words and its presence stay. Pure, for both apps.
 */

/** A place on the screen, in its own pixels. */
export interface CursorPoint {
  x: number;
  y: number;
}

export const CURSOR = {
  /** A glide as a person's hand makes it: a short one quick, a long one never slow (Fitts). */
  glideMinMs: 180,
  glideMaxMs: 480,
  /** How far its path bends off the straight line, as a share of the way. */
  bend: 0.12,
  /** Points along its path. */
  pathPoints: 24,
  /** A press, the gap between a double click's two, and the ripple it leaves. */
  pressMs: 200,
  pressGapMs: 140,
  rippleMs: 420,
  /** The step's words stay this long after it, then fade; the tag morphs to and from its words. */
  wordsMs: 1600,
  wordsOutMs: 140,
  morphMs: 180,
  /** Quiet this long, it rests (fainter); this long, it goes until the next step. */
  restMs: 3000,
  goneMs: 30_000,
  /** How faint it rests. */
  rest: 0.6,
} as const;

/** How long the pointer takes from `a` to `b`. */
export function glideMs(a: CursorPoint, b: CursorPoint): number {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const fitts = 60 + 100 * Math.log2(d / 20 + 1);
  return Math.round(Math.min(CURSOR.glideMaxMs, Math.max(CURSOR.glideMinMs, fitts)));
}

/** The control point of the curve from `a` to `b`: its middle, `CURSOR.bend` of the way off the straight line. */
export function glideControl(a: CursorPoint, b: CursorPoint): CursorPoint {
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * CURSOR.bend, y: (a.y + b.y) / 2 + (b.x - a.x) * CURSOR.bend };
}

/** The pointer's way from `a` to `b`, `a` and `b` included: a gentle curve (`glideControl`), as a hand moves a mouse. */
export function glidePath(a: CursorPoint, b: CursorPoint, points: number = CURSOR.pathPoints): CursorPoint[] {
  const c = glideControl(a, b);
  const n = Math.max(2, points);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/** How far the name's tag stands from the tip: its near corner right of and below it, or (turned) left of and above it. */
export interface TagGap {
  right: number;
  below: number;
  left: number;
  above: number;
}

/**
 * Which way the tag turns at a point of the picture (its pixels as drawn, from its top left, in a picture of `room`):
 * right and below the tip while it fits there, else to the side with more room.
 */
export function tagSide(
  at: CursorPoint,
  tag: { width: number; height: number },
  room: { width: number; height: number },
  gap: TagGap,
): { west: boolean; north: boolean } {
  const east = room.width - at.x - gap.right;
  const south = room.height - at.y - gap.below;
  return {
    west: tag.width > east && at.x - gap.left > east,
    north: tag.height > south && at.y - gap.above > south,
  };
}

/** Where a picture of `size` is drawn in a box of `outer`: as large as it fits whole, centred (CSS `contain`). */
export function fitBox(
  outer: { width: number; height: number },
  size: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  if (outer.width <= 0 || outer.height <= 0 || size.width <= 0 || size.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const k = Math.min(outer.width / size.width, outer.height / size.height);
  const width = size.width * k;
  const height = size.height * k;
  return { left: (outer.width - width) / 2, top: (outer.height - height) / 2, width, height };
}
