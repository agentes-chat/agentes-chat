import { expect, test } from "bun:test";
import { FESTIVE_PARTICLES } from "@agenteschat/client/lib/festive";
import { festiveTones } from "../src/sky/math";
import { particleRects } from "../src/sky/particles";

test("festive particles stay near their box, on its grid, and move with time", () => {
  const [w, h, cell] = [390, 300, 3];
  for (const kind of FESTIVE_PARTICLES) {
    let moved = false;
    for (let t = 0; t < 20; t += 0.37) {
      const rects = [...particleRects(kind, t, w, h, cell, 0), ...particleRects(kind, t, w, h, cell, 1)];
      expect(rects.length % 4).toBe(0);
      for (let i = 0; i < rects.length; i += 4) {
        const [x, y] = [rects[i] as number, rects[i + 1] as number];
        expect(Math.abs(x / cell - Math.round(x / cell))).toBeLessThan(1e-9);
        expect(Math.abs(y / cell - Math.round(y / cell))).toBeLessThan(1e-9);
        expect(x).toBeGreaterThan(-12 * cell);
        expect(x).toBeLessThan(w + 12 * cell);
        expect(y).toBeGreaterThan(-12 * cell);
        expect(y).toBeLessThan(h + 12 * cell);
      }
      if (JSON.stringify(rects) !== JSON.stringify(particleRects(kind, 0, w, h, cell, 0))) moved = true;
    }
    expect({ kind, moved }).toEqual({ kind, moved: true });
  }
});

test("a mood shifts a sky's tones but keeps the surface it rises from", () => {
  const tones = ["#ffffff", "#a6cfff", "#78b4ff"];
  expect(festiveTones(tones, null)).toEqual(tones);
  const shifted = festiveTones(tones, { tint: "#ff0000", tintAmount: 0.2 });
  expect(shifted[0]).toBe("#ffffff");
  expect(shifted[1]).not.toBe("#a6cfff");
});
