import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render } from "@testing-library/react";
import { Composer, type ComposerProps } from "../src";

afterEach(cleanup);

function Box(props: Partial<ComposerProps> & { value: string }) {
  return <Composer onChange={() => {}} onSend={() => {}} label="Mensagem para #eng" sendLabel="Enviar" {...props} />;
}

/** Geometry of a wrapped one-line draft in a browser: tall enough to wrap, but narrow to the canvas's estimate. */
function wideGeometry() {
  const patch = (on: object, key: string, get: () => number) => {
    const was = Object.getOwnPropertyDescriptor(on, key);
    Object.defineProperty(on, key, { configurable: true, get });
    return () => {
      if (was) Object.defineProperty(on, key, was);
      else Reflect.deleteProperty(on, key);
    };
  };
  const restores = [
    patch(HTMLElement.prototype, "clientWidth", function (this: HTMLElement) {
      return this.classList.contains("ac-composer__row") ? 600 : 300;
    }),
    patch(HTMLElement.prototype, "offsetWidth", function (this: HTMLElement) {
      return this.classList.contains("ac-composer__tools") ? 50 : 300;
    }),
    patch(HTMLTextAreaElement.prototype, "offsetHeight", () => 48),
  ];
  const pen = { font: "10px sans-serif", measureText: () => ({ width: 10 }) };
  const canvas = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => pen as never);
  const computed = spyOn(globalThis, "getComputedStyle").mockImplementation(
    () =>
      ({
        font: "",
        fontStyle: "normal",
        fontWeight: "400",
        fontSize: "14px",
        fontFamily: "Arial",
        minHeight: "28px",
        paddingLeft: "8px",
        paddingRight: "8px",
      }) as never,
  );
  return {
    pen,
    restore() {
      computed.mockRestore();
      canvas.mockRestore();
      for (const restore of restores.reverse()) restore();
    },
  };
}

describe("the composer switching its tools under a wrapped text", () => {
  test("the text seen wrapping stays wide even when the canvas estimate disagrees", () => {
    const geometry = wideGeometry();
    try {
      render(<Box value={"a\t".repeat(18)} />);
      expect(document.querySelector(".ac-composer")?.hasAttribute("data-wide")).toBe(true);
    } finally {
      geometry.restore();
    }
  });

  test("the canvas measures in the field's font, never its 10px default when the font shorthand is empty", () => {
    const geometry = wideGeometry();
    try {
      const view = render(<Box value={"a\t".repeat(18)} />);
      view.rerender(<Box value={`${"a\t".repeat(17)}b`} />);
      expect(geometry.pen.font).toBe("normal 400 14px Arial");
      expect(document.querySelector(".ac-composer")?.hasAttribute("data-wide")).toBe(true);
    } finally {
      geometry.restore();
    }
  });
});
