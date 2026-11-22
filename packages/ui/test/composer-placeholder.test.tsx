import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Composer, mentionQuery } from "../src/components/Composer";
import { inlineQuotePad, inlineQuoteRanges, inlineQuoteToken, quotePreview } from "../src/composer-quotes";

afterEach(cleanup);

const box = () => (
  <Composer
    value=""
    onChange={() => {}}
    onSend={() => {}}
    label="Mensagem para #geral"
    placeholder="Mensagem para #geral · use @ para chamar um agente"
    sendLabel="Enviar"
  />
);

/** A box `width` px wide, its text 8px a character. */
function sized(width: number) {
  const pen = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ font: "", measureText: (text: string) => ({ width: text.length * 8 }) }) as never,
  );
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  return () => {
    pen.mockRestore();
    if (was) Object.defineProperty(HTMLElement.prototype, "clientWidth", was);
  };
}

describe("the composer's placeholder", () => {
  test("whole when it fits on one line; in a narrow box (a phone, a task's panel), without the tip after its ·", () => {
    // 50 characters: 400px of text.
    const wide = sized(600);
    render(box());
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
      "Mensagem para #geral · use @ para chamar um agente",
    );
    cleanup();
    wide();
    const narrow = sized(300);
    render(box());
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Mensagem para #geral");
    narrow();
  });

  test("quote pill backdrop disables cleanly when Composer is disabled", () => {
    const { container, rerender } = render(
      <Composer value="> citado\ntexto" onChange={() => {}} onSend={() => {}} label="Mensagem" sendLabel="Enviar" />,
    );
    expect(container.querySelector(".ac-composer__text")?.getAttribute("data-quote-pills")).toBe("true");
    expect(container.querySelector(".ac-composer__backdrop")).toBeTruthy();

    rerender(
      <Composer
        value="> citado\ntexto"
        onChange={() => {}}
        onSend={() => {}}
        label="Mensagem"
        sendLabel="Enviar"
        disabled
      />,
    );
    expect(container.querySelector(".ac-composer__text")?.getAttribute("data-quote-pills")).toBeNull();
    expect(container.querySelector(".ac-composer__backdrop")).toBeNull();
  });
});

test("quote pills stay whole through extending selections, word deletion, and partial native input", () => {
  const a = inlineQuoteToken("", {}) ?? "";
  const b = inlineQuoteToken(a, { [a]: "> First" }) ?? "";
  const quotes = { [a]: "> First", [b]: "> Second" };
  function WithQuotes() {
    const [value, set] = useState(a + b);
    return (
      <Composer
        value={value}
        inlineQuotes={quotes}
        onChange={set}
        onSend={() => {}}
        label="Quote test"
        sendLabel="Send"
      />
    );
  }
  render(<WithQuotes />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  field.setSelectionRange(0, 0);
  fireEvent.keyDown(field, { key: "ArrowRight", shiftKey: true });
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, a.length]);
  fireEvent.keyDown(field, { key: "ArrowLeft", shiftKey: true });
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0]);
  fireEvent.keyDown(field, { key: "ArrowRight", ctrlKey: true });
  expect([field.selectionStart, field.selectionEnd]).toEqual([a.length, a.length]);
  fireEvent.keyDown(field, { key: "Backspace", altKey: true });
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, a.length]);

  // The native edit removes only the selected pill, even if neighboring markers share characters.
  fireEvent.change(field, { target: { value: b } });
  expect(field.value).toBe(b);
  expect(document.querySelector(".ac-composer__quote-pill--inline")?.textContent).toBe("Second");
  // A keyboard without a keydown event deletes just one character. No invisible fragment stays.
  fireEvent.change(field, { target: { value: b.slice(0, -1) } });
  expect(field.value).toBe("");
  expect(document.querySelector(".ac-composer__quote-pill--inline")).toBeNull();
});

test("inline quote pills size to field width, open @mentions right after a pill, and ignore line formats on pill lines", () => {
  const longMd = `> ${"A busca devolveu resultados completos sobre o assunto. ".repeat(400)}`;
  expect(quotePreview(longMd).length).toBeLessThanOrEqual(161);
  expect(quotePreview(longMd).endsWith("…")).toBe(true);
  expect(quotePreview("> \\```ts\n> @\u200Bdev")).toBe("```ts @dev");

  const desktop = sized(700);
  const ta = document.createElement("textarea");
  const longPadDesktop = inlineQuotePad(ta, longMd);
  const shortPadDesktop = inlineQuotePad(ta, "> Claude");
  desktop();
  expect(longPadDesktop).toBeGreaterThanOrEqual(16);
  expect(shortPadDesktop).toBeLessThan(longPadDesktop);

  const mobile = sized(220);
  const longPadMobile = inlineQuotePad(ta, longMd);
  mobile();
  expect(longPadMobile).toBeLessThan(longPadDesktop);

  const pill = inlineQuoteToken("", {}, longPadDesktop) ?? "";
  expect(inlineQuoteRanges(pill, { [pill]: longMd })).toHaveLength(1);
  // Mention autocomplete works immediately after a pill token (trailing \u200B).
  expect(mentionQuery(`${pill}@ada`, pill.length + 4)).toEqual({ start: pill.length, query: "ada" });

  // Line-prefix shortcuts (quote/list) on a line with a pill do nothing even with a collapsed caret; bold after it works.
  const quotes = { [pill]: "> Quoted" };
  function WithFormat() {
    const [value, set] = useState(`${pill}hello`);
    return (
      <Composer
        value={value}
        inlineQuotes={quotes}
        onChange={set}
        onSend={() => {}}
        label="Format test"
        sendLabel="Send"
        mentions={{
          listLabel: "People",
          search: (q) => ("ada".startsWith(q.toLowerCase()) ? [{ key: "ada", insert: "ada", label: "Ada" }] : []),
        }}
        format={{
          toolbar: "Format",
          bold: "Bold",
          italic: "Italic",
          strike: "Strike",
          code: "Code",
          codeBlock: "Code block",
          link: "Link",
          linkText: "text",
          bulletList: "Bullets",
          numberedList: "Numbers",
          quote: "Quote",
        }}
      />
    );
  }
  render(<WithFormat />);
  const field = screen.getByRole("combobox") as HTMLTextAreaElement;
  field.setSelectionRange(field.value.length, field.value.length);
  fireEvent.keyDown(field, { key: "9", code: "Digit9", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(field, { key: "8", code: "Digit8", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(field, { key: "7", code: "Digit7", ctrlKey: true, shiftKey: true });
  expect(field.value).toBe(`${pill}hello`);

  field.setSelectionRange(pill.length, field.value.length);
  fireEvent.keyDown(field, { key: "b", ctrlKey: true });
  expect(field.value).toBe(`${pill}**hello**`);

  // Typing @ada directly after the pill (no space) opens the mention autocomplete list.
  const withMention = `${pill}@ada`;
  fireEvent.change(field, {
    target: { value: withMention, selectionStart: withMention.length, selectionEnd: withMention.length },
  });
  expect(screen.getByRole("option", { name: "Ada" })).toBeTruthy();
});
