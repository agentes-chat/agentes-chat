/**
 * A canvas on a page whose animation frames run by hand, for tests of drawing loops: `frames(ms)` runs that long
 * of a screen (60 Hz, or `hz`; `performance.now()` follows) and the timers that fall due on the same clock, each
 * step running the due timers before its frame as a browser's timer fires before the next refresh. The canvas's 2D
 * context counts what it draws and keeps the last frame (`image`), the intersection observer's answer is the
 * test's (`onScreen`), and `resize` gives the canvas's parent a new size as a resize observer would see it. With
 * `reduced`, `matchMedia` says the person asked for reduced motion; `motion` switches that while the page is open.
 * Needs the DOM (`setupDom`); `close` puts everything back.
 */
import { spyOn } from "bun:test";

type Entries = { isIntersecting: boolean; target: Element }[];

let lastClock = 0;
/**
 * Intersection observers made while a page was open, kept past its `close`: a loop keeps its observer for the whole
 * run (a module's own), so the next page's `onScreen` still reaches it.
 */
const watchers = new Set<{ cb: (entries: Entries) => void; targets: Set<Element> }>();

export function canvasPage({
  width,
  height,
  reduced = false,
  hz = 60,
}: {
  width: number;
  height: number;
  reduced?: boolean;
  /** The screen's refresh rate (default 60): a loop asking for a frame at every refresh is called this often. */
  hz?: number;
}) {
  let size = { width, height };
  // The clock goes on from where the last page left it, as a browser's does: loops keep their last frame's time.
  let clock = lastClock;
  let nextId = 1;
  let queue = new Map<number, FrameRequestCallback>();
  // Timers run by the same clock only: one fires when `frames` moves the clock past it, never by real time, so what a
  // test sees does not depend on how fast the machine is.
  const timers = new Map<number, { at: number; fire: () => void }>();
  let nextTimer = 1e9;
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    IntersectionObserver: g.IntersectionObserver,
    ResizeObserver: g.ResizeObserver,
  };
  const realClear = globalThis.clearTimeout;
  const resized: (() => void)[] = [];
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => {
    queue.delete(id);
  };
  g.setTimeout = (cb: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = nextTimer++;
    const fire = () => {
      const t = timers.get(id);
      if (!t) return;
      timers.delete(id);
      cb(...args);
    };
    timers.set(id, { at: clock + ms, fire });
    return id;
  };
  g.clearTimeout = (id: unknown) => {
    const t = typeof id === "number" ? timers.get(id) : undefined;
    if (!t) return realClear(id as ReturnType<typeof setTimeout>);
    timers.delete(id as number);
  };
  g.IntersectionObserver = class {
    private watcher: { cb: (entries: Entries) => void; targets: Set<Element> };
    constructor(cb: (entries: Entries) => void) {
      this.watcher = { cb, targets: new Set() };
      watchers.add(this.watcher);
    }
    observe(el: Element) {
      this.watcher.targets.add(el);
    }
    unobserve(el: Element) {
      this.watcher.targets.delete(el);
    }
    disconnect() {
      this.watcher.targets.clear();
      watchers.delete(this.watcher);
    }
  };
  g.ResizeObserver = class {
    constructor(cb: () => void) {
      resized.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const now = spyOn(performance, "now").mockImplementation(() => clock);
  let still = reduced;
  const heard = new Set<() => void>();
  const fakeMedia = (query: string) =>
    ({
      get matches() {
        return still && query.includes("reduce");
      },
      addEventListener: (_: string, cb: () => void) => heard.add(cb),
      removeEventListener: (_: string, cb: () => void) => heard.delete(cb),
    }) as unknown as MediaQueryList;
  // In the test DOM the global `matchMedia` and the window's are different functions, so both are replaced.
  const media = spyOn(window, "matchMedia").mockImplementation(fakeMedia);
  const globalMedia = spyOn(globalThis as unknown as Window, "matchMedia").mockImplementation(fakeMedia);
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  document.body.append(host);
  host.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, ...size }) as DOMRect;
  Object.defineProperty(canvas, "offsetParent", { get: () => host });
  let draws = 0;
  let last: ImageData | null = null;
  canvas.getContext = (() => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (image: ImageData) => {
      draws++;
      last = image;
    },
  })) as unknown as typeof canvas.getContext;
  return {
    canvas,
    host,
    /** Frames drawn on the canvas so far. */
    draws: () => draws,
    /** The last frame drawn: one RGBA pixel (`pixelOf`) per sky pixel, row by row. */
    image: () => (last ? { pixels: new Uint32Array(last.data.buffer.slice(0)), w: last.width, h: last.height } : null),
    /** The canvas's parent takes a new size (CSS pixels). */
    resize(w: number, h: number) {
      size = { width: w, height: h };
      for (const cb of resized) cb();
    },
    /** Animation frames asked for and not run yet. */
    pending: () => queue.size,
    /** Timers set and neither run nor cleared yet. */
    timers: () => timers.size,
    /** Runs `ms` of a screen of `hz` (60 by default), with the timers that fall due in it. */
    frames(ms: number) {
      for (const end = clock + ms; clock < end; ) {
        clock += 1000 / hz;
        for (;;) {
          const due = [...timers.values()].filter((t) => t.at <= clock).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          due.fire();
        }
        const frame = queue;
        queue = new Map();
        for (const cb of frame.values()) cb(clock);
      }
    },
    /**
     * Intersection observer calls: each observed element gets these answers, oldest first (a browser gives several
     * when they pile up). Every observer that watches something hears them.
     */
    onScreen(...on: boolean[]) {
      for (const w of [...watchers]) {
        const entries = [...w.targets].flatMap((target) => on.map((isIntersecting) => ({ isIntersecting, target })));
        if (entries.length) w.cb(entries);
      }
    },
    /** The same, for one element only. */
    onScreenFor(target: Element, ...on: boolean[]) {
      for (const w of [...watchers])
        if (w.targets.has(target)) w.cb(on.map((isIntersecting) => ({ isIntersecting, target })));
    },
    /** The person turns reduced motion on or off while the page is open: the query's listeners hear it. */
    motion(on: boolean) {
      still = on;
      for (const cb of heard) cb();
    },
    /** How many listen to the reduced-motion query now. */
    listening: () => heard.size,
    close() {
      host.remove();
      lastClock = clock;
      timers.clear();
      now.mockRestore();
      globalMedia.mockRestore();
      media.mockRestore();
      Object.assign(g, saved);
    },
  };
}
