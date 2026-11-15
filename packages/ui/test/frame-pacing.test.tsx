import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";
import { canvasPage } from "../testing/frames";

setupDom();

import { SKY_TONES, startSky } from "../src";
import type { LiveAgent } from "../src/agent/live";
import type { LiveSticker } from "../src/agent/sticker-live";

// Each loop keeps the intersection observer of its first avatar or sticker for the whole run, which another test file
// may have made already (without this page's): these get a copy of the loops of their own.
const own = (path: string) => import(`${path}?frame-pacing`);
const { addLiveAgent, playAgentReaction, setGaze } = (await own(
  "../src/agent/live.ts",
)) as typeof import("../src/agent/live");
const { addLiveSticker } = (await own("../src/agent/sticker-live.ts")) as typeof import("../src/agent/sticker-live");

/**
 * The loops ask the browser for a frame only when one is due (a timer waits out the gap): on a 240 Hz screen, asking
 * at every refresh keeps the compositor awake for a handful of drawn frames. These count the frame callbacks that
 * actually run in a second of such a screen.
 */
const HZ = 240;

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()?.();
});

function screen() {
  const page = canvasPage({ width: 40, height: 40, hz: HZ });
  const g = globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number };
  const asked = g.requestAnimationFrame;
  let ran = 0;
  g.requestAnimationFrame = (cb) =>
    asked((t) => {
      ran++;
      cb(t);
    });
  return Object.assign(page, {
    /** Frame callbacks run since the last call, over `ms` of the screen. */
    callbacks(ms: number) {
      const before = ran;
      page.frames(ms);
      return ran - before;
    },
  });
}

function agent(state: "idle" | "thinking", add = addLiveAgent, key?: string) {
  const box = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => null) as unknown as typeof canvas.getContext;
  box.append(canvas);
  document.body.append(box);
  const live: LiveAgent = { canvas, box, look: () => ({ state, seed: 1, reactionKey: key }) };
  const stop = add(live);
  closers.push(() => {
    stop();
    box.remove();
  });
  return { box, stop };
}

function sticker(add = addLiveSticker) {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => null) as unknown as typeof canvas.getContext;
  document.body.append(canvas);
  const live = {
    canvas,
    spec: () => ({ look: {}, mood: "idle", size: 32, seed: 0 }),
  } as unknown as LiveSticker;
  const stop = add(live);
  closers.push(() => {
    stop();
    canvas.remove();
  });
  return { canvas, stop };
}

describe("frame pacing on a 240 Hz screen", () => {
  test("a sky in motion runs about 30 frame callbacks a second, and none and no timer once off screen", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const page = screen();
    const stop = startSky(page.canvas, () => ({ palette: SKY_TONES, base: () => 0.5 }));
    closers.push(() => {
      stop();
      page.frames(100);
      page.close();
    });
    const n = page.callbacks(1000);
    expect(n).toBeGreaterThanOrEqual(27);
    expect(n).toBeLessThanOrEqual(33);
    page.onScreen(false);
    page.frames(100);
    expect(page.callbacks(1000)).toBe(0);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    page.onScreen(true);
    expect(page.callbacks(500)).toBeGreaterThan(10);
  });

  test("an avatar at work runs about 25 frame callbacks a second, one at rest about 12", () => {
    const page = screen();
    closers.push(() => page.close());
    const working = agent("thinking");
    page.onScreen(true);
    const busy = page.callbacks(1000);
    expect(busy).toBeGreaterThanOrEqual(22);
    expect(busy).toBeLessThanOrEqual(27);
    working.stop();
    page.frames(200);
    expect(page.timers()).toBe(0);

    agent("idle");
    page.onScreen(true);
    const rest = page.callbacks(1000);
    expect(rest).toBeGreaterThanOrEqual(10);
    expect(rest).toBeLessThanOrEqual(14);
  });

  test("with no avatar in view the loop stops (no callback, none pending) and comes back with one on screen", () => {
    const page = screen();
    closers.push(() => page.close());
    const { box } = agent("thinking");
    expect(page.callbacks(1000)).toBe(0);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    page.onScreen(true);
    expect(page.callbacks(1000)).toBeGreaterThan(20);
    page.onScreenFor(box, false);
    page.frames(200);
    expect(page.callbacks(1000)).toBe(0);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    page.onScreenFor(box, true);
    expect(page.callbacks(1000)).toBeGreaterThan(20);
  });

  test("a sticker in view runs about 25 frame callbacks a second; with none in view the loop stops and comes back", () => {
    const page = screen();
    closers.push(() => page.close());
    const { canvas } = sticker();
    expect(page.callbacks(1000)).toBe(0);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    page.onScreen(true);
    const n = page.callbacks(1000);
    expect(n).toBeGreaterThanOrEqual(22);
    expect(n).toBeLessThanOrEqual(27);
    page.onScreenFor(canvas, false);
    page.frames(200);
    expect(page.callbacks(1000)).toBe(0);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    page.onScreenFor(canvas, true);
    expect(page.callbacks(1000)).toBeGreaterThan(20);
  });

  // The reduced-motion query is read once per module and keeps the page it was made on: these load modules of their
  // own after the page opens, so the page's `motion` reaches them.
  test("an avatar's loop stops when reduced motion turns on and runs again when it turns off", async () => {
    const page = screen();
    closers.push(() => page.close());
    const { addLiveAgent: add } = (await own("../src/agent/live.ts?motion")) as typeof import("../src/agent/live");
    agent("thinking", add);
    page.onScreen(true);
    expect(page.callbacks(500)).toBeGreaterThan(8);
    page.motion(true);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    expect(page.callbacks(500)).toBe(0);
    page.motion(false);
    expect(page.callbacks(500)).toBeGreaterThan(8);
  });

  test("a sticker's loop stops when reduced motion turns on and runs again when it turns off", async () => {
    const page = screen();
    closers.push(() => page.close());
    const { addLiveSticker: add } = (await own(
      "../src/agent/sticker-live.ts?motion",
    )) as typeof import("../src/agent/sticker-live");
    sticker(add);
    page.onScreen(true);
    expect(page.callbacks(500)).toBeGreaterThan(8);
    page.motion(true);
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(0);
    expect(page.callbacks(500)).toBe(0);
    page.motion(false);
    expect(page.callbacks(500)).toBeGreaterThan(8);
  });
});

describe("an avatar's loop looks again at its pace when something makes it busy", () => {
  // Right after a frame an idle avatar's next one is 80 ms away: a loop that looks again waits 40 ms instead.
  function afterFrame(page: ReturnType<typeof screen>) {
    for (let i = 0; i < 200 && page.callbacks(1000 / HZ) === 0; i++);
  }

  test("a first gaze point brings the next frame forward, with one timer and no direct frame request", () => {
    const page = screen();
    closers.push(() => page.close());
    const zone = document.createElement("div");
    zone.dataset.gaze = "";
    document.body.append(zone);
    closers.push(() => zone.remove());
    const { box } = agent("idle");
    zone.append(box);
    page.onScreen(true);
    afterFrame(page);
    setGaze({ x: 10, y: 10 });
    closers.push(() => setGaze(null));
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(1);
    expect(page.callbacks(60)).toBeGreaterThanOrEqual(1);
  });

  test("a reaction brings the next frame forward, with one timer and no direct frame request", () => {
    const page = screen();
    closers.push(() => page.close());
    agent("idle", addLiveAgent, "reaction-pacing");
    page.onScreen(true);
    afterFrame(page);
    playAgentReaction("reaction-pacing", "up");
    expect(page.pending()).toBe(0);
    expect(page.timers()).toBe(1);
    expect(page.callbacks(60)).toBeGreaterThanOrEqual(1);
  });
});
