import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render, screen } from "@testing-library/react";
import { Composer } from "../src/components/Composer";

afterEach(cleanup);

describe("the composer past one line", () => {
  test("a text the canvas says fits but the box wraps keeps one shape instead of flipping until React gives up", () => {
    // The box's own lines (two, 48px) and the canvas (8px a character, 40px for "hello" in a 600px row) disagree, as
    // Windows' text or a zoom can make them.
    const pen = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ font: "", measureText: (text: string) => ({ width: text.length * 8 }) }) as never,
    );
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 48 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
    try {
      render(
        <Composer
          value="hello"
          onChange={() => {}}
          onSend={() => {}}
          label="Mensagem para #geral"
          sendLabel="Enviar"
        />,
      );
      expect(screen.getByRole("textbox").closest(".ac-composer")?.hasAttribute("data-wide")).toBe(true);
    } finally {
      pen.mockRestore();
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    }
  });
});
