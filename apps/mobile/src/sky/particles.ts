import type { FestiveParticles } from "@agenteschat/client/lib/festive";

/**
 * Where a festive mood's particles are at a moment: pure worklets (no React Native imports), so the UI thread draws
 * them and a test reads them. Everything is in cells of the sky's grid, returned as flat rectangles in points
 * ([x, y, w, h, …]) for one of the two colors (`layer`: every other particle takes the second).
 */

/** Particles per kind: few, so the layer costs nearly nothing. */
export const PARTICLE_COUNT: Record<FestiveParticles, number> = {
  snow: 18,
  petals: 12,
  confetti: 16,
  hearts: 9,
  bats: 6,
  sparks: 14,
  fireworks: 3,
};

/** A steady pseudo-random share (0–1) for particle `i`'s trait `k`. */
function rand(i: number, k: number): number {
  "worklet";
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const wrap = (x: number) => {
  "worklet";
  return x - Math.floor(x);
};

/** Pixel shapes, as cell rows ("X" filled). */
const HEART = ["XX.XX", "XXXXX", ".XXX.", "..X.."];
const BAT_UP = ["X...X", "XX.XX", ".XXX."];
const BAT_DOWN = [".XXX.", "XXXXX", "X...X"];
const SPARK = [".X.", "XXX", ".X."];

function pushShape(out: number[], rows: readonly string[], x: number, y: number, cell: number) {
  "worklet";
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as string;
    for (let c = 0; c < row.length; c++) if (row[c] === "X") out.push(x + c * cell, y + r * cell, cell, cell);
  }
}

/** Snapped to the grid, as the sky's own pixels. */
const snap = (v: number, cell: number) => {
  "worklet";
  return Math.round(v / cell) * cell;
};

/**
 * The rectangles of particles of `kind` at `t` seconds over a `width` × `height` box, for color `layer` (0 or 1).
 * Falling kinds come in from above and leave below, rising ones the other way, bats cross, fireworks burst in the
 * upper half; each loops on its own pace, so nothing lines up.
 */
export function particleRects(
  kind: FestiveParticles,
  t: number,
  width: number,
  height: number,
  cell: number,
  layer: number,
): number[] {
  "worklet";
  const out: number[] = [];
  const count = PARTICLE_COUNT[kind];
  for (let i = layer; i < count; i += 2) {
    const a = rand(i, 1);
    const b = rand(i, 2);
    const c = rand(i, 3);
    if (kind === "fireworks") {
      const period = 2.6 + a;
      const k = wrap(t / period + b);
      if (k > 0.8) continue;
      const cx = snap((0.15 + 0.7 * wrap(a * 3 + Math.floor(t / period + b) * 0.37)) * width, cell);
      const cy = snap((0.12 + 0.3 * c) * height, cell);
      const radius = (1 - (1 - k / 0.8) ** 2) * Math.min(width, height) * 0.16;
      const rays = 10;
      // Late in the burst every other ray is gone: it thins out instead of stopping.
      for (let r = 0; r < rays; r++) {
        if (k > 0.6 && r % 2 === 1) continue;
        const angle = (r / rays) * Math.PI * 2 + a;
        out.push(snap(cx + Math.cos(angle) * radius, cell), snap(cy + Math.sin(angle) * radius, cell), cell, cell);
      }
      continue;
    }
    if (kind === "bats") {
      const k = wrap(t * (0.035 + 0.03 * a) + b);
      const x = snap(-6 * cell + k * (width + 12 * cell), cell);
      const y = snap((0.1 + 0.5 * c) * height + Math.sin(t * 1.6 + i) * 3 * cell, cell);
      pushShape(out, Math.floor(t * 5 + i) % 2 === 0 ? BAT_UP : BAT_DOWN, x, y, cell);
      continue;
    }
    const rising = kind === "hearts" || kind === "sparks";
    // Screens a second: confetti falls fastest, petals and hearts drift.
    const speed =
      kind === "confetti"
        ? 0.11 + 0.06 * a
        : kind === "petals" || kind === "hearts"
          ? 0.05 + 0.03 * a
          : 0.06 + 0.04 * a;
    const travel = height + 8 * cell;
    const k = wrap(t * speed + b);
    const y = snap(rising ? height + 4 * cell - k * travel : -4 * cell + k * travel, cell);
    const sway = kind === "petals" ? 5 : kind === "snow" ? 2.5 : 1.5;
    const x = snap(c * width + Math.sin(t * (0.7 + a) + i) * sway * cell, cell);
    if (kind === "hearts") pushShape(out, HEART, x, y, cell);
    else if (kind === "sparks") {
      // A twinkle: the cross for a moment, a single cell the rest of the time.
      if (wrap(t * 0.8 + a) < 0.3) pushShape(out, SPARK, x - cell, y - cell, cell);
      else out.push(x, y, cell, cell);
    } else if (kind === "confetti" || kind === "petals") {
      // A flutter: a bar across, then up, as it turns.
      const across = Math.floor(t * (kind === "confetti" ? 4 : 2) + i) % 2 === 0;
      out.push(x, y, across ? cell * 2 : cell, across ? cell : cell * 2);
    } else {
      // Snow: some flakes twice the size, the nearer ones.
      const size = a > 0.7 ? cell * 2 : cell;
      out.push(x, y, size, size);
    }
  }
  return out;
}
