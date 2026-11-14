import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { glideMs, glidePoint } from "../src/components/browser/AgentCursor";

describe("the agent's cursor on its way to a point", () => {
  test("it leaves from where it was and lands exactly on the point, on any shape of picture", () => {
    const from = { x: 0.2, y: 0.8 };
    const to = { x: 0.7, y: 0.3 };
    for (const ratio of [0.625, 1, 1.6]) {
      expect(glidePoint(from, to, 0, ratio)).toEqual(from);
      const end = glidePoint(from, to, 1, ratio);
      expect(end.x).toBeCloseTo(to.x, 9);
      expect(end.y).toBeCloseTo(to.y, 9);
    }
  });

  test("the way there bends off the straight line, and a gesture on the point it is on stays put", () => {
    const half = glidePoint({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 0.5, 1);
    expect(half.x).toBeCloseTo(0.5, 9);
    expect(half.y).not.toBeCloseTo(0.5, 3);
    const same = { x: 0.4, y: 0.4 };
    expect(glidePoint(same, same, 0.5, 0.625)).toEqual(same);
  });

  test("a short hop takes about 0.3 s, the whole picture no more than 0.64 s", () => {
    expect(glideMs(0)).toBe(280);
    expect(glideMs(0.1)).toBeCloseTo(342, 0);
    expect(glideMs(2)).toBe(640);
  });
});
