import { expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, render } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { useOverflows } from "@/hooks/useOverflows";

test("only measures a skipped message once layout includes it", async () => {
  const native = globalThis.ResizeObserver;
  let notify: () => void = () => {};
  let disconnected = false;
  let visible = false;
  let height = 200;
  let reads = 0;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof ResizeObserver;

  function Message() {
    const words = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const element = words.current;
      if (!element) return;
      element.checkVisibility = () => visible;
      Object.defineProperty(element, "scrollHeight", {
        get: () => {
          reads++;
          return height;
        },
      });
    }, []);
    const cut = useOverflows(words, true, 100);
    return <div ref={words}>{cut ? "cut" : "whole"}</div>;
  }

  const result = render(<Message />);
  try {
    expect(reads).toBe(0);
    await act(notify);
    expect(reads).toBe(0);
    expect(result.container.textContent).toBe("whole");

    visible = true;
    await act(notify);
    expect(result.container.textContent).toBe("cut");

    height = 40;
    await act(notify);
    expect(result.container.textContent).toBe("whole");
  } finally {
    result.unmount();
    globalThis.ResizeObserver = native;
  }
  expect(disconnected).toBe(true);
});
