/*
 * The agent's cursor over the picture of its page or its desktop (ADR 0040 §7.2), shared by the web and the phone:
 * its pixel arrow, its timing, and where it lands on a view. Points are shares (0 to 1) of the picture. The functions
 * the phone runs on its UI thread carry the "worklet" directive, a plain string anywhere else.
 */
import { fitFrame } from "./input";
import { type BrowserPointer, parseBrowserPointer } from "./live";

/** The arrow, one character a pixel: `X` its edge, `o` its body in the agent's color. Its tip is the top left pixel. */
export const AGENT_ARROW = [
  "X.......",
  "XX......",
  "XoX.....",
  "XooX....",
  "XoooX...",
  "XooooX..",
  "XoooooX.",
  "XooooooX",
  "XoooXXXX",
  "XoXoX...",
  "XX.XoX..",
  "....XX..",
] as const;

/** After this long with no gesture the cursor fades; the next one brings it back where it was. */
export const CURSOR_IDLE_MS = 4000;
/** Past this share of the width the name opens to the arrow's left, so the picture's edge never cuts it. */
export const CURSOR_FLIP_AT = 0.74;

export type CursorSpot = { x: number; y: number };

/**
 * A pointer and how many gestures came before it: `n` changes with every one, also two clicks on one point. `at` is
 * when it came (ms), so a view that shows it later can tell a gesture long over from one under way.
 */
export type CountedPointer = BrowserPointer & { n: number; at: number };

export const nextPointer = (was: CountedPointer | null, to: BrowserPointer, at = Date.now()): CountedPointer => ({
  ...to,
  n: (was?.n ?? 0) + 1,
  at,
});

/** The pointer in a desktop's `agent.desktop.pointer` user event (ADR 0062), for that agent only. */
export function desktopPointerOf(
  event: { type: string; agentId?: unknown; pointer?: unknown },
  agentId: string,
): BrowserPointer | null {
  if (event.type !== "agent.desktop.pointer" || event.agentId !== agentId) return null;
  return parseBrowserPointer(event.pointer);
}

/** How long the cursor takes to cross `dist` (a share of the picture's width): 0.28 s to 0.64 s. */
export const glideMs = (dist: number) => Math.min(640, 280 + dist * 620);

/**
 * Where the cursor is `t` (0 to 1) of the way from `from` to `to`, both as shares of the picture: eased, on a
 * slight arc. `ratio` is the picture's height over its width, so the arc bends the same on any shape.
 */
export function glidePoint(from: CursorSpot, to: CursorSpot, t: number, ratio: number): CursorSpot {
  "worklet";
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const dx = to.x - from.x;
  const dy = (to.y - from.y) * ratio;
  const dist = Math.hypot(dx, dy) || 1;
  const arc = Math.sin(Math.PI * e) * dist * 0.14 * (dx >= 0 ? 1 : -1);
  return {
    x: from.x + dx * e - (dy / dist) * arc,
    y: from.y + (to.y - from.y) * e + ((dx / dist) * arc) / ratio,
  };
}

/** Its first gesture comes in from a little off the point, not from a corner it never was in. */
export const glideStart = (at: CursorSpot | null, to: CursorSpot): CursorSpot =>
  at ?? { x: Math.min(1, to.x + 0.1), y: Math.min(1, to.y + 0.14) };

/** Where the pointer is, as a share of the screen it was said on. */
export const pointerShare = (p: BrowserPointer): CursorSpot => ({ x: p.x / p.width, y: p.y / p.height });

/**
 * How a view shows the picture: `width`×`height` in the picture's units, `x`,`y` the picture point at the view's top
 * left, `s` points per unit. A desktop under a pinch and pan is its camera; a letterboxed page is drawn at scale 1.
 */
export interface PointerView {
  s: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A share of the picture → a point on the view, where the picture draws it. */
export function pointerInView(share: CursorSpot, view: PointerView): CursorSpot {
  "worklet";
  return { x: (share.x * view.width - view.x) * view.s, y: (share.y * view.height - view.y) * view.s };
}

/** A page picture drawn `contain` in `box`: its drawn size, offset by the letterbox bands. */
export function frameView(
  box: { width: number; height: number },
  meta: { deviceWidth: number; deviceHeight: number },
): PointerView {
  const drawn = fitFrame(box, meta);
  return { s: 1, x: -drawn.left, y: -drawn.top, width: drawn.width, height: drawn.height };
}
