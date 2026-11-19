import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render } from "@testing-library/react";
import { EMPTY_SCENES, EmptyState, ToolScene } from "../src";

/** A recording 2D context: every filled cell as "x,y,w,h,color". */
function recorder() {
  const cells: string[] = [];
  let fill = "";
  const own: Record<string, unknown> = {
    fillRect(x: number, y: number, w: number, h: number) {
      cells.push(`${x},${y},${w},${h},${fill}`);
    },
  };
  // Any other drawing call (the agent sticker's paths, gradients) is accepted and ignored.
  const ctx = new Proxy(own, {
    get: (target, key: string) => target[key] ?? (() => ({ addColorStop() {} })),
    set: (_, key, value) => {
      if (key === "fillStyle") fill = String(value);
      return true;
    },
  });
  return { cells, ctx };
}

let rec = recorder();
beforeEach(() => {
  rec = recorder();
  spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => rec.ctx) as never);
});
afterEach(() => cleanup());

describe("ToolScene", () => {
  test("every scene paints its own picture on a 16 by 16 grid, in whole cells", () => {
    const seen = new Set<string>();
    for (const scene of EMPTY_SCENES) {
      rec = recorder();
      const { container, unmount } = render(<ToolScene scene={scene} size={128} />);
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;
      expect(canvas.dataset.scene).toBe(scene);
      expect(canvas.style.width).toBe("128px");
      expect(canvas.width % 16).toBe(0);
      expect(rec.cells.length).toBeGreaterThan(40);
      for (const cell of rec.cells) {
        const [x, y, w, h] = cell.split(",").map(Number) as [number, number, number, number];
        expect(w).toBe(h);
        expect(x % w).toBe(0);
        expect(y % w).toBe(0);
        expect(x + w).toBeLessThanOrEqual(canvas.width);
        expect(y + h).toBeLessThanOrEqual(canvas.height);
      }
      seen.add([...new Set(rec.cells)].sort().join("|"));
      unmount();
    }
    expect(seen.size).toBe(EMPTY_SCENES.length);
  });
});

describe("tasks scene", () => {
  test("is part of the closed set", () => {
    expect(EMPTY_SCENES).toContain("tasks");
  });
});

describe("EmptyState scene", () => {
  test("the default keeps today's waving agent", () => {
    const plain = render(<EmptyState size="page" agent title="Aqui" />);
    const named = render(<EmptyState size="page" agent scene="default" title="Aqui" />);
    for (const { container } of [plain, named]) {
      const sticker = container.querySelector<HTMLElement>(".ac-empty__agent .ac-sticker");
      expect(sticker?.dataset.mood).toBe("wave");
      expect(sticker?.style.width).toBe("128px");
      expect(container.querySelector("[data-scene]")).toBeNull();
    }
    expect(named.container.innerHTML).toBe(plain.container.innerHTML);
  });

  test("a scene takes the agent's frame, size and glow, in a page and in a panel", () => {
    for (const scene of EMPTY_SCENES) {
      const page = render(<EmptyState size="page" agent scene={scene} title="Aqui" />);
      const art = page.container.querySelector<HTMLElement>(".ac-empty__agent [data-scene]");
      expect(art?.dataset.scene).toBe(scene);
      expect(art?.style.width).toBe("128px");
      expect(page.container.querySelector(".ac-empty__agent .ac-sky-glow")).not.toBeNull();
      expect(page.container.querySelector("[data-mood]")).toBeNull();
      const panel = render(<EmptyState size="panel" agent scene={scene} title="Aqui" />);
      expect(panel.container.querySelector<HTMLElement>("[data-scene]")?.style.width).toBe("96px");
    }
  });

  test("an inline list never grows a picture", () => {
    const { container } = render(<EmptyState size="inline" agent scene="files" title="Nada" />);
    expect(container.querySelector("[data-scene]")).toBeNull();
  });
});
