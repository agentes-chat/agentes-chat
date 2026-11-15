/**
 * Living stickers (ADR 0091): one shared loop draws every sticker on screen, about 25 times a second, and only the
 * ones in view (a picker full of them, or a long conversation, costs what is visible). With reduced motion the loop
 * stands still: each sticker is drawn once, at its still frame, and again when what it shows changes. A timer waits
 * out the gap and the browser is asked for a frame only when one is due; with no sticker in view the loop stops
 * until one comes back into view.
 */
import { drawSticker, STICKER_STILL_T, type StickerLook, type StickerMood } from "./stickers";

export interface LiveSticker {
  canvas: HTMLCanvasElement;
  /**
   * Read at each frame: what to draw, and the canvas's side in CSS pixels. With `end`, it plays once: `seed` is minus
   * the moment it started, and from `end` seconds in it holds that frame.
   */
  spec: () => { look: StickerLook; mood: StickerMood; size: number; seed: number; end?: number };
}

const stickers = new Set<LiveSticker>();
const visible = new WeakSet<HTMLCanvasElement>();
// The loop's one handle: a timer waiting out the gap to the next frame, then the frame asked for once it is due.
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let raf = 0;
let last = 0;
let observer: IntersectionObserver | null = null;
/** The gap between frames (ms). */
const FRAME_MS = 40;

let motionQuery: MediaQueryList | null | undefined;
const reduced = () => {
  if (motionQuery === undefined) {
    motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    // Motion allowed again: the loop starts; asked to stop: every sticker stands at its still frame.
    motionQuery?.addEventListener?.("change", () => {
      if (!motionQuery?.matches) start();
      else {
        cancelLoop();
        for (const s of stickers) drawLiveSticker(s, STICKER_STILL_T);
      }
    });
  }
  return motionQuery?.matches === true;
};

/** The loop's clock, in seconds. */
export const stickerNow = () => (typeof performance === "object" ? performance.now() : Date.now()) / 1000;

/** How many stickers the loop is drawing (tests). */
export function liveStickerCount() {
  return stickers.size;
}

/** Draws one sticker now, at `t` seconds (its seed added), sizing its canvas to the screen's pixels. */
export function drawLiveSticker(sticker: LiveSticker, t: number) {
  const { canvas } = sticker;
  const { look, mood, size, seed, end } = sticker.spec();
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!ctx) return;
  const dpr = Math.min(2, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const side = Math.max(1, Math.round(size * dpr));
  if (canvas.width !== side || canvas.height !== side) {
    canvas.width = side;
    canvas.height = side;
  }
  ctx.clearRect(0, 0, side, side);
  const at = end === undefined ? t + seed : Math.min(Math.max(0, t + seed), end);
  drawSticker(ctx, look, mood, reduced() ? STICKER_STILL_T : at, side);
}

const anyVisible = () => {
  for (const s of stickers) if (visible.has(s.canvas)) return true;
  return false;
};

function cancelLoop() {
  if (timer) clearTimeout(timer);
  if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  timer = 0;
  raf = 0;
}

/**
 * Asks for the next frame only when one is due: a timer waits out the gap, then the browser is asked once. Asking at
 * every refresh and dropping the early ones keeps the compositor awake on a high-refresh screen. With no sticker in
 * view, or with reduced motion, no frame is asked for; `start` brings the loop back.
 */
function schedule() {
  if (typeof requestAnimationFrame !== "function") return;
  if (timer || raf || reduced() || !anyVisible()) return;
  timer = setTimeout(
    () => {
      timer = 0;
      raf = requestAnimationFrame(tick);
    },
    Math.max(0, FRAME_MS - (stickerNow() * 1000 - last)),
  );
}

function tick(time: number) {
  raf = 0;
  last = time;
  const t = time / 1000;
  for (const s of stickers) if (visible.has(s.canvas)) drawLiveSticker(s, t);
  schedule();
}

function start() {
  schedule();
}

/** Starts drawing a sticker (in view only); returns the cleanup. */
export function addLiveSticker(sticker: LiveSticker): () => void {
  stickers.add(sticker);
  if (typeof IntersectionObserver === "function") {
    observer ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        const canvas = e.target as HTMLCanvasElement;
        if (!e.isIntersecting) {
          visible.delete(canvas);
          continue;
        }
        visible.add(canvas);
        // The loop stops with nothing in view: a sticker coming into view starts it again.
        start();
        // Standing still: drawn once as it comes into view (it may have changed while away).
        if (reduced()) for (const s of stickers) if (s.canvas === canvas) drawLiveSticker(s, STICKER_STILL_T);
      }
    });
    observer.observe(sticker.canvas);
  } else visible.add(sticker.canvas);
  drawLiveSticker(sticker, stickerNow());
  start();
  return () => {
    stickers.delete(sticker);
    observer?.unobserve(sticker.canvas);
    visible.delete(sticker.canvas);
    if (!anyVisible()) cancelLoop();
  };
}
