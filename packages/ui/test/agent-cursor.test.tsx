import { afterEach, describe, expect, jest, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { act, cleanup, render } from "@testing-library/react";
import { createRef, type Ref, useRef } from "react";
import { AGENT_GRADIENTS, contrastOf, cursorTones } from "../src/agent/engine.js";
import { pictureBox } from "../src/components/AgentCursor";
import {
  AgentCursor,
  type AgentCursorHandle,
  CURSOR,
  fitBox,
  glideControl,
  glideMs,
  glidePath,
  tagSide,
} from "../src/index";
import { step, tick } from "../testing";

afterEach(() => cleanup());

const DESK = { width: 1280, height: 900 };

/** The person asked for reduced motion (`prefers-reduced-motion: reduce`) until the returned call. */
function reducedMotion() {
  const real = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = real;
  };
}

/** An element as the browser lays it out: its inner size and where it stands in its offset parent. */
function laidOut(el: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
  for (const [key, value] of Object.entries({
    clientWidth: box.width,
    clientHeight: box.height,
    clientLeft: 0,
    clientTop: 0,
    offsetLeft: box.left,
    offsetTop: box.top,
  })) {
    Object.defineProperty(el, key, { configurable: true, get: () => value });
  }
}

describe("where the pointer goes", () => {
  test("the picture drawn whole and centred in its box, as noVNC scales a screen", () => {
    expect(fitBox({ width: 1280, height: 900 }, DESK)).toEqual({ left: 0, top: 0, width: 1280, height: 900 });
    // A wide box: bands at the sides.
    expect(fitBox({ width: 1000, height: 450 }, DESK)).toEqual({ left: 180, top: 0, width: 640, height: 450 });
    // A tall one: bands above and below.
    expect(fitBox({ width: 640, height: 900 }, DESK)).toEqual({ left: 0, top: 225, width: 640, height: 450 });
    expect(fitBox({ width: 0, height: 900 }, DESK)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    const el = document.createElement("div");
    laidOut(el, { left: 10, top: 20, width: 1000, height: 450 });
    expect(pictureBox(el, DESK)).toEqual({ left: 190, top: 20, width: 640, height: 450 });
  });

  test("a glide: from its place to the next on a gentle curve, quick when short and never slow", () => {
    const a = { x: 100, y: 100 };
    const b = { x: 900, y: 100 };
    const path = glidePath(a, b);
    expect(path).toHaveLength(CURSOR.pathPoints);
    expect(path[0]).toEqual(a);
    expect(path.at(-1)).toEqual(b);
    // Bent to one side of the straight line, by a share of the way, at its middle.
    expect(glideControl(a, b)).toEqual({ x: 500, y: 100 + 800 * CURSOR.bend });
    const middle = path[Math.floor(path.length / 2)] as { y: number };
    expect(middle.y).toBeGreaterThan(100 + 800 * CURSOR.bend * 0.4);
    expect(glideMs(a, { x: 104, y: 100 })).toBe(CURSOR.glideMinMs);
    expect(glideMs(a, { x: 1279, y: 899 })).toBe(CURSOR.glideMaxMs);
    const mid = glideMs(a, { x: 300, y: 100 });
    expect(mid).toBeGreaterThan(CURSOR.glideMinMs);
    expect(mid).toBeLessThan(CURSOR.glideMaxMs);
  });

  test("the tag right and below the tip while it fits there, else on the side with more room", () => {
    const room = { width: 900, height: 630 };
    const tag = { width: 220, height: 22 };
    const gap = { right: 15, below: 19, left: 4, above: 4 };
    expect(tagSide({ x: 100, y: 100 }, tag, room, gap)).toEqual({ west: false, north: false });
    expect(tagSide({ x: 800, y: 100 }, tag, room, gap)).toEqual({ west: true, north: false });
    expect(tagSide({ x: 100, y: 610 }, tag, room, gap)).toEqual({ west: false, north: true });
    expect(tagSide({ x: 890, y: 625 }, tag, room, gap)).toEqual({ west: true, north: true });
    // A tag wider than either side stays on the side with more room.
    const wide = { width: 700, height: 40 };
    expect(tagSide({ x: 300, y: 100 }, wide, room, gap)).toEqual({ west: false, north: false });
    expect(tagSide({ x: 600, y: 100 }, wide, room, gap)).toEqual({ west: true, north: false });
  });

  test("its colors: the arrow the agent's own, its name's tag dark enough for white words (WCAG AA)", () => {
    for (const color of [...Object.keys(AGENT_GRADIENTS), "#ffd400", "#9be15d"]) {
      const { arrow, tag } = cursorTones(color);
      expect(contrastOf("#ffffff", tag)).toBeGreaterThanOrEqual(4.5);
      expect(arrow).toMatch(/^#[0-9a-f]{6}$/);
    }
    // The sky passes as it is.
    expect(cursorTones("sky")).toEqual({ arrow: "#0063d1", tag: "#0063d1" });
  });
});

describe("the agent's cursor", () => {
  function Screen({
    cursor,
    shown = true,
    box = { left: 10, top: 20, width: 640, height: 450 },
  }: {
    cursor: Ref<AgentCursorHandle>;
    shown?: boolean;
    box?: { left: number; top: number; width: number; height: number };
  }) {
    const over = useRef<HTMLDivElement>(null);
    return (
      <div className="stage">
        <div
          ref={(el) => {
            over.current = el;
            if (el) laidOut(el, box);
          }}
        />
        <AgentCursor ref={cursor} over={over} size={DESK} name="Ada" color="violet" shown={shown} />
      </div>
    );
  }
  const parts = (c: HTMLElement) => ({
    layer: c.querySelector<HTMLElement>(".ac-cursor"),
    track: c.querySelector<HTMLElement>(".ac-cursor__track"),
    tag: c.querySelector<HTMLElement>(".ac-cursor__tag"),
    what: () => c.querySelector<HTMLElement>(".ac-cursor__what"),
  });

  test("laid over the picture, never taking the pointer, and hidden until a step comes", () => {
    const cursor = createRef<AgentCursorHandle>();
    const { container } = render(<Screen cursor={cursor} />);
    const { layer } = parts(container);
    expect(layer?.style.left).toBe("10px");
    expect(layer?.style.top).toBe("20px");
    expect(layer?.style.width).toBe("640px");
    expect(layer?.style.height).toBe("450px");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.dataset.phase).toBe("gone");
  });

  test("a step lands where it says, a share of the picture, with the name and the step in words", async () => {
    // Reduced motion: each step lands at once, with no press.
    const restore = reducedMotion();
    try {
      const cursor = createRef<AgentCursorHandle>();
      const { container } = render(<Screen cursor={cursor} />);
      await act(async () => {
        cursor.current?.step({ x: 960, y: 225, presses: 1, words: "clicking Join the list" });
      });
      const { layer, track, tag, what } = parts(container);
      expect(layer?.dataset.phase).toBe("on");
      expect(track?.style.transform).toBe("translate(75%, 25%)");
      expect(tag?.textContent).toBe("Adaclicking Join the list");
      expect(what()?.textContent).toBe("clicking Join the list");
      await act(async () => {
        cursor.current?.step({ x: 100, y: 880, presses: 0, words: "" });
      });
      expect(track?.style.transform).toBe(`translate(${(100 / 1280) * 100}%, ${(880 / 900) * 100}%)`);
      // A move says nothing new: the step's words stay theirs for their moment.
      expect(what()?.textContent).toBe("clicking Join the list");
      expect(container.querySelector(".ac-cursor__ripple")).toBeNull();
    } finally {
      restore();
    }
  });

  test("it glides from where it stands along the curve, then presses with a ripple in its color", async () => {
    const cursor = createRef<AgentCursorHandle>();
    const { container } = render(<Screen cursor={cursor} />);
    await act(async () => {
      cursor.current?.step({ x: 128, y: 90, presses: 0, words: "" });
    });
    const { track, layer } = parts(container);
    // The first step has nowhere to come from: it shows where it lands.
    expect(track?.getAnimations()).toHaveLength(0);
    expect(track?.style.transform).toBe("translate(10%, 10%)");
    await act(async () => {
      cursor.current?.step({ x: 640, y: 450, presses: 2, words: "clicking Documents" });
    });
    const [glide] = track?.getAnimations() ?? [];
    expect(glide).toBeDefined();
    await act(async () => {
      glide?.finish();
      await new Promise((r) => setTimeout(r, CURSOR.pressGapMs + 50));
    });
    expect(track?.style.transform).toBe("translate(50%, 50%)");
    // Two presses where it landed, each with its ripple.
    const ripples = [...(layer?.querySelectorAll<HTMLElement>(".ac-cursor__ripple") ?? [])];
    expect(ripples.length).toBe(2);
    expect(ripples[0]?.style.left).toBe("50%");
    expect(ripples[0]?.style.top).toBe("50%");
  });

  test("typing with no place shows where it stands; before any place, nothing", async () => {
    const cursor = createRef<AgentCursorHandle>();
    const { container } = render(<Screen cursor={cursor} />);
    await act(async () => {
      cursor.current?.step({ presses: 0, words: "typing" });
    });
    expect(parts(container).layer?.dataset.phase).toBe("gone");
    expect(parts(container).what()).toBeNull();
    await act(async () => {
      cursor.current?.step({ x: 640, y: 450, presses: 0, words: "clicking" });
      cursor.current?.step({ presses: 0, words: "typing" });
    });
    expect(parts(container).track?.style.transform).toBe("translate(50%, 50%)");
    expect(parts(container).what()?.textContent).toBe("typing");
  });

  test("quiet, its words go, it rests fainter, then it goes", async () => {
    jest.useFakeTimers();
    const restore = reducedMotion();
    try {
      const cursor = createRef<AgentCursorHandle>();
      const { container } = render(<Screen cursor={cursor} />);
      await step(() => cursor.current?.step({ x: 640, y: 450, presses: 0, words: "scrolling" }));
      expect(parts(container).what()?.textContent).toBe("scrolling");
      await tick(CURSOR.wordsMs);
      expect(parts(container).what()).toBeNull();
      expect(parts(container).layer?.dataset.phase).toBe("on");
      await tick(CURSOR.restMs - CURSOR.wordsMs);
      expect(parts(container).layer?.dataset.phase).toBe("rest");
      await tick(CURSOR.goneMs - CURSOR.restMs);
      expect(parts(container).layer?.dataset.phase).toBe("gone");
    } finally {
      restore();
      // happy-dom runs its own 0 ms timeouts on a timer of its own: dropped while fake, later files' never fire.
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  });

  test("hidden (control, a cover), it goes at once and drops what comes", async () => {
    const cursor = createRef<AgentCursorHandle>();
    const { container, rerender } = render(<Screen cursor={cursor} />);
    await act(async () => {
      cursor.current?.step({ x: 640, y: 450, presses: 0, words: "clicking" });
    });
    expect(parts(container).layer?.dataset.phase).toBe("on");
    rerender(<Screen cursor={cursor} shown={false} />);
    expect(parts(container).layer?.dataset.phase).toBe("gone");
    await act(async () => {
      cursor.current?.step({ x: 0, y: 0, presses: 1, words: "clicking" });
    });
    expect(parts(container).layer?.dataset.phase).toBe("gone");
    expect(parts(container).track?.style.transform).toBe("translate(50%, 50%)");
  });

  test("a tag that fits neither side wraps to the wider one; on a small screen it says only who", async () => {
    // Laid out as a browser would: the picture's box, and the tag as wide as its words make it (130 without them).
    const proto = HTMLElement.prototype;
    const sizes: Record<string, (el: HTMLElement) => number | undefined> = {
      offsetWidth: (el) => (el.classList.contains("ac-cursor") ? Number.parseFloat(el.style.width) : undefined),
      offsetHeight: (el) => (el.classList.contains("ac-cursor") ? Number.parseFloat(el.style.height) : undefined),
      scrollWidth: (el) => (el.classList.contains("ac-cursor__tag") ? (el.hasAttribute("data-terse") ? 130 : 330) : 0),
      scrollHeight: (el) => (el.classList.contains("ac-cursor__tag") ? 22 : 0),
    };
    const was = Object.fromEntries(Object.keys(sizes).map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));
    for (const [key, size] of Object.entries(sizes)) {
      Object.defineProperty(proto, key, {
        configurable: true,
        get(this: HTMLElement) {
          return size(this) ?? was[key]?.get?.call(this) ?? 0;
        },
      });
    }
    const restore = reducedMotion();
    try {
      const cursor = createRef<AgentCursorHandle>();
      const step = { x: 640, y: 300, presses: 0, words: "clicking Send the refund request to the manager" };
      // A phone's screen, 358 wide: 175 left of the tip, 164 right of it.
      const small = render(<Screen cursor={cursor} box={{ left: 0, top: 0, width: 358, height: 252 }} />);
      await act(async () => cursor.current?.step(step));
      const tag = () => small.container.querySelector<HTMLElement>(".ac-cursor__tag");
      expect(tag()?.hasAttribute("data-west")).toBe(true);
      expect(tag()?.hasAttribute("data-terse")).toBe(true);
      expect(tag()?.style.maxWidth).toBe("");
      small.unmount();
      // A desktop's: 490 on each side, the whole tag right of the tip.
      const wide = render(<Screen cursor={cursor} box={{ left: 0, top: 0, width: 1000, height: 703 }} />);
      await act(async () => cursor.current?.step(step));
      const big = wide.container.querySelector<HTMLElement>(".ac-cursor__tag");
      expect(big?.hasAttribute("data-west")).toBe(false);
      expect(big?.hasAttribute("data-terse")).toBe(false);
    } finally {
      restore();
      for (const [key, d] of Object.entries(was)) {
        if (d) Object.defineProperty(proto, key, d);
        else Reflect.deleteProperty(proto, key);
      }
    }
  });

  test("with no picture to lay over, nothing shows and no step plays", async () => {
    const cursor = createRef<AgentCursorHandle>();
    const { container } = render(<Screen cursor={cursor} box={{ left: 0, top: 0, width: 0, height: 0 }} />);
    await act(async () => {
      cursor.current?.step({ x: 640, y: 450, presses: 1, words: "clicking" });
    });
    expect(parts(container).layer?.dataset.phase).toBe("gone");
  });
});
