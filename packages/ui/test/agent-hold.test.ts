import { afterEach, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";
import { canvasPage } from "../testing/frames";

setupDom();

import { addLiveAgent } from "../src/agent/live";
import { addLiveSticker } from "../src/agent/sticker-live";
import { addLiveBrain } from "../src/brain/live";
import { addLiveComputer } from "../src/computer/live";
import { holdSkies } from "../src/sky/engine";

let close = () => {};
afterEach(() => {
  holdSkies(false);
  close();
});

/** A canvas that draws nothing: these tests read the loops, not the pixels. */
const blank = () => {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => null) as unknown as typeof canvas.getContext;
  return canvas;
};

test("the living agents and stickers hold still with the skies (the Linux app), and move again when freed", () => {
  const page = canvasPage({ width: 40, height: 40 });
  close = page.close;
  holdSkies();
  const stopAgent = addLiveAgent({
    canvas: blank(),
    box: document.createElement("div"),
    look: () => ({ state: "thinking", seed: 1 }),
  });
  const stopSticker = addLiveSticker({
    canvas: blank(),
    spec: () => ({ look: {} as never, mood: "happy" as never, size: 32, seed: 0 }),
  });
  // Held: each is drawn once, and no frame is asked for.
  expect(page.pending()).toBe(0);
  holdSkies(false);
  expect(page.pending()).toBeGreaterThan(0);
  page.frames(100);
  expect(page.pending()).toBeGreaterThan(0);
  // Held again while moving: the loops stop on their next frame.
  holdSkies();
  page.frames(100);
  expect(page.pending()).toBe(0);
  stopAgent();
  stopSticker();
});

test("the engine and computer portraits hold still with the skies, and move again when freed", () => {
  const page = canvasPage({ width: 40, height: 40 });
  const timers = spyOn(globalThis, "setTimeout");
  const cleared = spyOn(globalThis, "clearTimeout");
  close = () => {
    timers.mockRestore();
    cleared.mockRestore();
    page.close();
  };
  holdSkies();
  const before = timers.mock.calls.length;
  const stopBrain = addLiveBrain({
    canvas: blank(),
    look: () => ({ kind: "claude" as never, state: "idle" as never }),
  });
  const stopComputer = addLiveComputer({
    canvas: blank(),
    look: () => ({ kind: "mac" as never, state: "idle" as never }),
  });
  // Held: drawn once, no next frame scheduled.
  expect(timers.mock.calls.length).toBe(before);
  holdSkies(false);
  expect(timers.mock.calls.length).toBe(before + 2);
  stopBrain();
  stopComputer();
  // The last portrait gone: its pending frame is cancelled, not left to fire later.
  expect(cleared.mock.calls.map(([id]) => id)).toEqual(timers.mock.results.slice(before).map((r) => r.value));
});
