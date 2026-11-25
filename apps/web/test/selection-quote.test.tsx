import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { Message } from "@agenteschat/client";
import { MAX_MESSAGE_LENGTH } from "@agenteschat/client/lib/message-length";
import { mentionsEveryone } from "@agenteschat/i18n/everyone";
import { expandInlineQuotes, inlineQuoteToken } from "@agenteschat/ui";
import { parseMarkdown } from "@agenteschat/ui/markdown";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { floatingPosition, formatMarkdownQuote, insertIntoTextarea } from "../src/components/SelectionQuote";
import { ADA_ID, createFakeApi, ENG_ID, NOW, ORG_ID, seedDm, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

const click = (el: Element) => act(async () => fireEvent.click(el));

function mockRect(range: Range, rect = { left: 120, top: 200, bottom: 220, width: 80, height: 20 }) {
  range.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect;
}

/** Selects a substring inside `root` and dispatches mouseup + selectionchange so the floating quote pill opens. */
async function selectTextIn(
  root: Element,
  needle: string,
  trigger: "drag" | "dblclick" = "drag",
  rect = { left: 120, top: 200, bottom: 220, width: 80, height: 20 },
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let acc = "";
  const nodes: { node: Text; from: number; to: number }[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    const from = acc.length;
    acc += text.data;
    nodes.push({ node: text, from, to: acc.length });
  }
  const idx = acc.indexOf(needle);
  if (idx < 0) throw new Error(`"${needle}" not found in "${acc}"`);
  const endIdx = idx + needle.length;
  for (const entry of nodes) {
    if (!startNode && idx >= entry.from && idx < entry.to) {
      startNode = entry.node;
      startOffset = idx - entry.from;
    }
    if (endIdx > entry.from && endIdx <= entry.to) {
      endNode = entry.node;
      endOffset = endIdx - entry.from;
      break;
    }
  }
  if (!startNode || !endNode) throw new Error(`Could not build range for "${needle}"`);
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  mockRect(range, rect);
  const sel = window.getSelection();
  await act(async () => {
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (trigger === "dblclick") {
      fireEvent.pointerDown(root, { pointerType: "mouse", button: 0 });
      document.dispatchEvent(new Event("selectionchange"));
      fireEvent.mouseUp(root);
      fireEvent.doubleClick(root);
    } else {
      fireEvent.mouseUp(root);
      document.dispatchEvent(new Event("selectionchange"));
    }
  });
  await settle(2);
}

describe("inline quote formatting and insertion helpers", () => {
  test("formats every selected line, escapes each code fence and preserves long text and paragraph breaks", () => {
    const long = "😀".repeat(500);
    expect(formatMarkdownQuote(`primeira linha\r\n\r\n${long}\n`)).toBe(`> primeira linha\n> \n> ${long}`);
    expect(formatMarkdownQuote("```ts\nconst x = 1\n```\n  ~~~")).toBe("> \\```ts\n> const x = 1\n> \\```\n>   \\~~~");
    expect(formatMarkdownQuote("oi @dev\n@todos")).toBe("> oi @dev\n> @todos");
  });

  test("keeps quoted mentions as written; quoted lines mention nobody", () => {
    for (const input of ["@todos", "@everyone", "oi @todos", "https://x.com/@dev", "user@example.com"]) {
      const quoted = formatMarkdownQuote(input);
      expect(quoted).toBe(`> ${input}`);
      expect(mentionsEveryone(quoted)).toBe(false);
    }
    expect(mentionsEveryone(`${formatMarkdownQuote("@todos")}\n@todos`)).toBe(true);
  });

  test("expands inline markers at their positions without empty gap lines", () => {
    const a = inlineQuoteToken("", {}) ?? "";
    const b = inlineQuoteToken(a, { [a]: "> A\n> B" }) ?? "";
    expect(a).not.toBe(b);
    expect(expandInlineQuotes(`antes ${a}${b}depois`, { [a]: "> A\n> B", [b]: "> C" })).toBe(
      "antes \n> A\n> B\n> C\ndepois",
    );
    expect(expandInlineQuotes(`antes\n${a}\ndepois`, { [a]: "> A" })).toBe("antes\n> A\ndepois");
    expect(expandInlineQuotes(a, {})).toBe(a);

    // Sent Markdown without blank lines parses into distinct alternating quote and paragraph blocks.
    expect(parseMarkdown("> Fable\nConcordo com esse ponto.\n> Outro trecho\nTambém acho.", { breaks: true })).toEqual([
      { type: "quote", text: "Fable", lines: ["Fable"] },
      { type: "paragraph", text: "Concordo com esse ponto." },
      { type: "quote", text: "Outro trecho", lines: ["Outro trecho"] },
      { type: "paragraph", text: "Também acho." },
    ]);
  });

  test("floatingPosition clamps inside visible list bounds when a tall selection starts above the viewport", () => {
    const viewport = { width: 1200, height: 760 };
    const bounds = { left: 260, top: 64, right: 1180, bottom: 640 };

    // Top scrolled above window, bottom still fits inside visible scroller -> flips neatly below selection.
    const bottomVisible = floatingPosition(
      { left: 320, top: -220, bottom: 520, width: 420, height: 740 },
      viewport,
      undefined,
      bounds,
    );
    expect(bottomVisible.top).toBe(528);

    // Taller than visible scroller (both top above and bottom below) -> stays near pointer release inside bounds.
    const tallerPointer = floatingPosition(
      { left: 320, top: -220, bottom: 820, width: 420, height: 1040 },
      viewport,
      undefined,
      bounds,
      { x: 500, y: 410 },
    );
    expect(tallerPointer.top).toBe(368);
    expect(tallerPointer.top).toBeGreaterThanOrEqual(bounds.top);
    expect(tallerPointer.top + 34).toBeLessThanOrEqual(bounds.bottom);

    // Taller than visible scroller without pointer anchor (keyboard) or scrolled completely above -> clamps to bounds.top, never negative.
    const scrolledAbove = floatingPosition(
      { left: 320, top: -300, bottom: -40, width: 420, height: 260 },
      viewport,
      undefined,
      bounds,
    );
    expect(scrolledAbove.top).toBe(bounds.top);
    expect(scrolledAbove.top).toBeGreaterThan(0);
  });

  test("insertIntoTextarea prefers document.execCommand('insertText') for native undo history and falls back to setRangeText", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello world";
    document.body.appendChild(textarea);
    const seen: string[] = [];

    // 1. Native execCommand path (preserves browser Ctrl/Cmd+Z undo stack).
    const origExec = document.execCommand;
    const calls: unknown[][] = [];
    document.execCommand = ((cmd: string, ui?: boolean, val?: string) => {
      calls.push([cmd, ui, val]);
      if (cmd === "insertText" && typeof val === "string") {
        const s = textarea.selectionStart ?? 0;
        const e = textarea.selectionEnd ?? 0;
        textarea.value = textarea.value.slice(0, s) + val + textarea.value.slice(e);
        return true;
      }
      return false;
    }) as typeof document.execCommand;
    try {
      const res = insertIntoTextarea(textarea, 6, 6, "\n\n> A\n\n", (v) => seen.push(v));
      expect(calls).toEqual([["insertText", false, "\n\n> A\n\n"]]);
      expect(res.value).toBe("hello \n\n> A\n\nworld");
      expect(textarea.value).toBe("hello \n\n> A\n\nworld");
      expect(textarea.selectionStart).toBe(res.caret);
      expect(seen.at(-1)).toBe("hello \n\n> A\n\nworld");

      // 2. Fallback path when execCommand returns false.
      document.execCommand = (() => false) as typeof document.execCommand;
      const res2 = insertIntoTextarea(textarea, textarea.value.length, textarea.value.length, "\n\n> B\n\n", (v) =>
        seen.push(v),
      );
      expect(res2.value).toBe("hello \n\n> A\n\nworld\n\n> B\n\n");
      expect(textarea.value).toBe("hello \n\n> A\n\nworld\n\n> B\n\n");

      // 3. Fallback path restores original value if a buggy execCommand partially mutated el.value before failing.
      document.execCommand = (() => {
        textarea.value += "GARBAGE";
        return true;
      }) as typeof document.execCommand;
      const before3 = textarea.value;
      const res3 = insertIntoTextarea(textarea, before3.length, before3.length, "\n\n> C\n\n", (v) => seen.push(v));
      expect(res3.value).toBe(`${before3}\n\n> C\n\n`);
      expect(textarea.value).toBe(`${before3}\n\n> C\n\n`);
      expect(textarea.value).not.toContain("GARBAGE");
    } finally {
      document.execCommand = origExec;
      textarea.remove();
    }
  });
});

function quotePreviews(box: HTMLTextAreaElement) {
  return [...(box.closest(".ac-composer__text")?.querySelectorAll(".ac-composer__quote-pill--inline") ?? [])].map(
    (pill) => pill.textContent,
  );
}

describe("text-selection inline quote pill", () => {
  test("accumulates multiple quotes in order (A -> text -> B -> text -> C) in channel composer without replyTo", async () => {
    const state = seedState();
    state.messages.push(
      {
        id: "m-a",
        channelId: ENG_ID,
        threadId: null,
        author: { type: "agent", id: ADA_ID },
        body: "Primeiro ponto sobre Claude Fable 5.2 rodando agora.",
        mentionedAgentIds: [],
        agentRunId: null,
        meta: {},
        createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
      } as Message,
      {
        id: "m-b",
        channelId: ENG_ID,
        threadId: null,
        author: { type: "person", id: "u-joao" },
        body: "Segundo ponto com **trecho formatado** e `comando`.",
        mentionedAgentIds: [],
        agentRunId: null,
        meta: {},
        createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
      } as Message,
    );
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);

    const rowA = document.querySelector('[data-message-id="m-a"]') as HTMLElement;
    const rowB = document.querySelector('[data-message-id="m-b"]') as HTMLElement;
    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;

    // Quote A via double-click on a word: renders compact pill backdrop with no blank line.
    await selectTextIn(rowA.querySelector(".ac-msg__text") as HTMLElement, "Claude", "dblclick");
    const pillA = screen().getByRole("toolbar", { name: "Citar" });
    await click(within(pillA).getByRole("button", { name: "Citar" }));
    await settle(2);
    expect(document.activeElement).toBe(box);
    expect(quotePreviews(box)).toEqual(["Claude"]);
    expect(box.value).not.toContain("\n");
    const textWrap = box.closest(".ac-composer__text") as HTMLElement;
    expect(textWrap.dataset.quotePills).toBe("true");
    expect(textWrap.querySelectorAll(".ac-composer__quote-pill")).toHaveLength(1);
    expect(textWrap.querySelector(".ac-composer__quote-pill--inline svg")).toBeTruthy();

    // IME composition temporarily hands rendering back to native textarea, then restores pills on compositionend.
    await act(async () => fireEvent.compositionStart(box));
    expect(textWrap.dataset.quotePills).toBeUndefined();
    await act(async () => fireEvent.compositionEnd(box));
    expect(textWrap.dataset.quotePills).toBe("true");

    // User writes after A.
    await act(async () => {
      fireEvent.change(box, { target: { value: `${box.value}Concordo com o primeiro ponto.` } });
      box.setSelectionRange(box.value.length, box.value.length);
      fireEvent.select(box);
    });

    // Quote B from formatted Markdown message.
    await selectTextIn(rowB.querySelector(".ac-msg__text") as HTMLElement, "trecho formatado e comando");
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);
    expect(quotePreviews(box)).toEqual(["Claude", "trecho formatado e comando"]);
    expect(box.value).not.toContain("\n");

    // User writes after B, then quotes C.
    await act(async () => {
      fireEvent.change(box, { target: { value: `${box.value}Sobre o segundo ponto também.` } });
      box.setSelectionRange(box.value.length, box.value.length);
      fireEvent.select(box);
    });
    await selectTextIn(rowA.querySelector(".ac-msg__text") as HTMLElement, "rodando agora.");
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);

    const expectedBody =
      "> Claude\nConcordo com o primeiro ponto.\n> trecho formatado e comando\nSobre o segundo ponto também.\n> rodando agora.\n";
    expect(quotePreviews(box)).toEqual(["Claude", "trecho formatado e comando", "rodando agora."]);
    expect(textWrap.querySelectorAll(".ac-composer__quote-pill")).toHaveLength(3);
    expect(document.querySelector(".composer-quote")).toBeNull();

    // Sending posts the Markdown blockquotes as body with no replyTo.
    await click(screen().getByRole("button", { name: "Enviar" }));
    await settle(8);
    const post = state.calls.find((c) => c.method === "chat.post")?.args[2] as Record<string, unknown>;
    expect(post.body).toBe(expectedBody.trim());
    expect(post.replyTo).toBeUndefined();
  });

  test("keeps a long multi-paragraph quote on reload and copy, and blocks an oversized send with the existing notice", async () => {
    localStorage.clear();
    const state = seedState();
    const long = "Trecho inteiro com emoji 😀. ".repeat(36).trimEnd();
    state.messages.push({
      id: "m-long-quote",
      channelId: ENG_ID,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: `Começo.\n\n${long}\n\nÚltimo parágrafo.`,
      mentionedAgentIds: [],
      agentRunId: null,
      meta: {},
      createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
    } as Message);
    const url = `/org/${ORG_ID}/c/${ENG_ID}`;
    await renderApp(url, { api: createFakeApi(state) });
    await settle(8);
    const content = document.querySelector('[data-message-id="m-long-quote"] .ac-msg__text') as HTMLElement;
    await selectTextIn(content, `Começo.${long}Último parágrafo.`);
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);
    const expected = `> Começo.\n> \n> ${long}\n> \n> Último parágrafo.`;

    cleanup();
    await renderApp(url, { api: createFakeApi(state), reload: true });
    await settle(8);
    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;
    expect(quotePreviews(box)[0]).toStartWith("Começo.");
    expect(quotePreviews(box)[0]).not.toContain("Último parágrafo.");
    const draft = box.value;
    const clipboard = {
      setData: (_kind: string, text: string) => {
        copied = text;
      },
    };
    let copied = "";
    box.setSelectionRange(0, box.value.length);
    fireEvent.copy(box, { clipboardData: clipboard });
    expect(copied).toBe(expected);
    await act(async () => fireEvent.change(box, { target: { value: draft + "x".repeat(MAX_MESSAGE_LENGTH) } }));
    expect(screen().getByRole("button", { name: "Enviar como arquivo" })).toBeTruthy();
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(state.calls.some((c) => c.method === "chat.post")).toBe(false);

    await act(async () => {
      fireEvent.change(box, { target: { value: draft } });
      box.setSelectionRange(0, draft.length);
      fireEvent.cut(box, { clipboardData: clipboard });
    });
    expect(box.value).toBe("");
    expect(copied).toBe(expected);
    // Native undo restores the marker, with its data still in the draft.
    await act(async () => fireEvent.change(box, { target: { value: `${draft}Minha resposta.` } }));
    await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
    await settle(8);
    expect(state.calls.find((c) => c.method === "chat.post")?.args[2]).toMatchObject({
      body: `${expected}\nMinha resposta.`,
    });
    localStorage.clear();
  });

  test("triple-click / full-bubble overflow (agent and own bubbles, bubble-head to stamp or next row) opens Citar and clamps live selection", async () => {
    const state = seedState();
    const dmId = seedDm(state, { type: "agent", id: ADA_ID });
    state.messages.push(
      {
        id: "m-triple-1",
        channelId: dmId,
        threadId: null,
        author: { type: "agent", id: ADA_ID },
        body: "Estou rodando no modelo principal.\nSegunda linha completa da resposta.",
        mentionedAgentIds: [],
        agentRunId: null,
        meta: {},
        createdAt: new Date(NOW.getTime() - 40_000).toISOString(),
      } as Message,
      {
        id: "m-triple-own",
        channelId: dmId,
        threadId: null,
        author: { type: "person", id: state.me?.user.id ?? "u-walter" },
        body: "Minha própria mensagem em balão para testar seleção inteira.",
        mentionedAgentIds: [],
        agentRunId: null,
        meta: {},
        createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
      } as Message,
      {
        id: "m-triple-2",
        channelId: dmId,
        threadId: null,
        author: { type: "agent", id: ADA_ID },
        body: "Mensagem seguinte na conversa.",
        mentionedAgentIds: [],
        agentRunId: null,
        meta: {},
        createdAt: new Date(NOW.getTime() - 20_000).toISOString(),
      } as Message,
    );
    await renderApp(`/org/${ORG_ID}/dm/agent/${ADA_ID}`, { api: createFakeApi(state) });
    await settle(8);

    const row1 = document.querySelector('[data-message-id="m-triple-1"]') as HTMLElement;
    const rowOwn = document.querySelector('[data-message-id="m-triple-own"]') as HTMLElement;
    const row2 = document.querySelector('[data-message-id="m-triple-2"]') as HTMLElement;
    expect(row1.dataset.look).toBe("bubbles");
    expect(row1.querySelector(".ac-msg__stamp")).toBeTruthy();
    expect(row1.classList.contains("ac-msg--own")).toBe(false);
    expect(rowOwn.classList.contains("ac-msg--own")).toBe(true);
    expect(rowOwn.querySelector(".ac-msg__stamp")).toBeTruthy();
    const text1 = row1.querySelector(".ac-msg__text") as HTMLElement;
    const textOwn = rowOwn.querySelector(".ac-msg__text") as HTMLElement;
    const sel = window.getSelection();

    // 1. Agent bubble: drag/triple-click starting at (.ac-msg__text, 0) (before bubble-head) and ending after .ac-msg__text (past stamp).
    const fullBubbleRange = document.createRange();
    fullBubbleRange.setStart(text1, 0);
    fullBubbleRange.setEnd(text1, text1.childNodes.length);
    mockRect(fullBubbleRange, { left: 100, top: 180, bottom: 224, width: 320, height: 44 });
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(fullBubbleRange);
      fireEvent.mouseUp(text1);
    });
    await settle(2);
    // Live selection is tightened strictly onto Text nodes (never spilling past <p> or onto .ac-msg__stamp).
    const clamped1 = sel?.getRangeAt(0);
    expect(clamped1?.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(clamped1?.endContainer.nodeType).toBe(Node.TEXT_NODE);
    const pill1 = screen().getByRole("toolbar", { name: "Citar" });
    await click(within(pill1).getByRole("button", { name: "Citar" }));
    await settle(2);
    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;
    expect(quotePreviews(box)).toEqual(["Estou rodando no modelo principal. Segunda linha completa da resposta."]);

    // 2. Own bubble (`ac-msg--own`): selection from <p> text past .ac-msg__text into .ac-msg__body also opens Citar & clamps.
    const ownTextNode = document.createTreeWalker(textOwn, NodeFilter.SHOW_TEXT).nextNode() as Text;
    expect(ownTextNode).toBeTruthy();
    const ownOverflow = document.createRange();
    ownOverflow.setStart(ownTextNode, 0);
    ownOverflow.setEnd(rowOwn, rowOwn.childNodes.length);
    mockRect(ownOverflow, { left: 120, top: 240, bottom: 264, width: 280, height: 24 });
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(ownOverflow);
      fireEvent.mouseUp(rowOwn);
    });
    await settle(2);
    expect(sel?.getRangeAt(0).endContainer.nodeType).toBe(Node.TEXT_NODE);
    const pillOwn = screen().getByRole("toolbar", { name: "Citar" });
    await click(within(pillOwn).getByRole("button", { name: "Citar" }));
    await settle(2);
    expect(quotePreviews(box)).toContain("Minha própria mensagem em balão para testar seleção inteira.");

    // 3. Overflow ending at the immediately following message's offset 0 (or its non-selectable head) still opens Citar for row1 only.
    const walker1 = document.createTreeWalker(text1, NodeFilter.SHOW_TEXT);
    let firstTextNode: Text | null = null;
    for (let n = walker1.nextNode(); n; n = walker1.nextNode()) {
      if (!(n as Text).parentElement?.closest(".ac-msg__bubble-head, .ac-msg__stamp") && (n as Text).data.trim()) {
        firstTextNode = n as Text;
        break;
      }
    }
    expect(firstTextNode).toBeTruthy();
    const tripleToNext = document.createRange();
    tripleToNext.setStart(firstTextNode as Node, 0);
    tripleToNext.setEnd(rowOwn, 0);
    mockRect(tripleToNext, { left: 100, top: 180, bottom: 224, width: 320, height: 44 });
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(tripleToNext);
      fireEvent.mouseUp(text1);
    });
    await settle(2);
    expect(screen().getByRole("toolbar", { name: "Citar" })).toBeTruthy();

    // 4. Genuine cross-message selection (selecting actual text inside row1 and row2) must NOT open Citar.
    const text2 = row2.querySelector(".ac-msg__text") as HTMLElement;
    const walker2 = document.createTreeWalker(text2, NodeFilter.SHOW_TEXT);
    let secondTextNode: Text | null = null;
    for (let n = walker2.nextNode(); n; n = walker2.nextNode()) {
      if (!(n as Text).parentElement?.closest(".ac-msg__bubble-head, .ac-msg__stamp") && (n as Text).data.trim()) {
        secondTextNode = n as Text;
        break;
      }
    }
    expect(secondTextNode).toBeTruthy();
    const crossRange = document.createRange();
    crossRange.setStart(firstTextNode as Node, 0);
    crossRange.setEnd(secondTextNode as Node, 8);
    mockRect(crossRange);
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(crossRange);
      fireEvent.mouseUp(text2);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await settle(2);
    expect(screen().queryByRole("toolbar", { name: "Citar" })).toBeNull();
  });

  test("inserts at cursor in mid-draft and appends at end when composer was never focused; works in DM and thread", async () => {
    const state = seedState();
    const dmId = seedDm(state, { type: "agent", id: ADA_ID });
    state.messages.push({
      id: "m-dm-1",
      channelId: dmId,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: "Veja o **trecho formatado** e `comando` antes de subir.",
      mentionedAgentIds: [],
      agentRunId: null,
      meta: {},
      createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
    } as Message);
    await renderApp(`/org/${ORG_ID}/dm/agent/${ADA_ID}`, { api: createFakeApi(state) });
    await settle(8);

    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;
    // Simulate a pre-existing unfocused draft (caret was never placed by the user in this session).
    await act(async () => {
      fireEvent.change(box, { target: { value: "Rascunho existente" } });
      box.blur();
    });
    // Force selectionStart = 0 as browsers do on untouched restored textareas.
    box.setSelectionRange(0, 0);

    const dmRow = document.querySelector('[data-message-id="m-dm-1"]') as HTMLElement;
    await selectTextIn(dmRow.querySelector(".ac-msg__text") as HTMLElement, "trecho formatado");
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);
    expect(box.value.startsWith("Rascunho existente")).toBe(true);
    expect(quotePreviews(box)).toEqual(["trecho formatado"]);

    // Now place cursor in the middle of the draft and quote again: inserts at that exact caret.
    await act(async () => {
      box.focus();
      fireEvent.change(box, { target: { value: "Inicio fim" } });
      box.setSelectionRange(7, 7);
      fireEvent.select(box);
    });
    await selectTextIn(dmRow.querySelector(".ac-msg__text") as HTMLElement, "comando");
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);
    expect(box.value.startsWith("Inicio ")).toBe(true);
    expect(box.value.endsWith("fim")).toBe(true);
    expect(box.value).not.toContain("\n");
    expect(quotePreviews(box)).toEqual(["comando"]);
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    await settle(8);
    expect(state.calls.find((c) => c.method === "chat.post")?.args[2]).toMatchObject({
      body: "Inicio \n> comando\nfim",
    });
  });

  test("works inside a thread side panel without disturbing full-message Responder", async () => {
    const state = seedState();
    state.messages.push({
      id: "t-quote",
      channelId: ENG_ID,
      threadId: "m-1",
      author: { type: "person", id: "u-joao" },
      body: "Vamos revisar a etapa de deploy primeiro.",
      mentionedAgentIds: [],
      agentRunId: null,
      meta: {},
      createdAt: new Date(NOW.getTime() - 20_000).toISOString(),
    } as Message);
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}?thread=m-1`, { api: createFakeApi(state) });
    await settle(10);

    const panel = screen().getByRole("complementary", { name: "Thread" });
    const row = panel.querySelector('[data-message-id="t-quote"]') as HTMLElement;
    await selectTextIn(row.querySelector(".ac-msg__text") as HTMLElement, "etapa de deploy");

    const pill = screen().getByRole("toolbar", { name: "Citar" });
    await click(within(pill).getByRole("button", { name: "Citar" }));
    await settle(2);

    const box = within(panel).getByRole("combobox", { name: "Responder na thread" }) as HTMLTextAreaElement;
    expect(quotePreviews(box)).toEqual(["etapa de deploy"]);
    await act(async () => fireEvent.change(box, { target: { value: `${box.value}Concordo` } }));
    await click(within(panel).getByRole("button", { name: "Enviar" }));
    await settle(8);

    expect(state.calls.find((c) => c.method === "chat.post")?.args[2]).toMatchObject({
      body: "> etapa de deploy\nConcordo",
      threadId: "m-1",
    });
  });

  test("does not open outside messages, closes on Escape/outside click, and recovers after pointercancel", async () => {
    const state = seedState();
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);

    const header = document.querySelector(".channel__header") as HTMLElement;
    await selectTextIn(header, header.textContent?.trim().slice(0, 4) || "eng");
    expect(screen().queryByRole("toolbar", { name: "Citar" })).toBeNull();

    const row = document.querySelector('[data-message-id="m-1"]') as HTMLElement;
    const textEl = row.querySelector(".ac-msg__text") as HTMLElement;
    const sample = textEl.textContent?.trim().slice(0, 6) ?? "";
    expect(sample.length).toBeGreaterThan(0);

    await selectTextIn(textEl, sample);
    expect(screen().getByRole("toolbar", { name: "Citar" })).toBeTruthy();

    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    await settle(2);
    expect(screen().queryByRole("toolbar", { name: "Citar" })).toBeNull();

    await selectTextIn(textEl, sample);
    expect(screen().getByRole("toolbar", { name: "Citar" })).toBeTruthy();
    await act(async () => fireEvent.pointerDown(header));
    await settle(2);
    expect(screen().queryByRole("toolbar", { name: "Citar" })).toBeNull();

    // Pointercancel resets dragging state so subsequent selectionchange still opens Citar.
    await act(async () => fireEvent.pointerDown(textEl, { pointerType: "mouse", button: 0 }));
    await act(async () => fireEvent.pointerCancel(document));
    await settle(1);
    await selectTextIn(textEl, sample);
    expect(screen().getByRole("toolbar", { name: "Citar" })).toBeTruthy();

    // Alt+Q (⌥Q, by the key's place) quotes from the keyboard, the pill being outside the Tab order.
    await act(async () => fireEvent.keyDown(window, { key: "œ", code: "KeyQ", altKey: true }));
    await settle(2);
    expect(screen().queryByRole("toolbar", { name: "Citar" })).toBeNull();
    const box = screen().getByRole("combobox", { name: /Mensagem para/ }) as HTMLTextAreaElement;
    expect(quotePreviews(box)).toHaveLength(1);
  });

  test("excludes code-card chrome (.code-card__top, buttons, hidden Copiado), preserves author-inclusive copy and backwards direction, and guards quote pills", async () => {
    const state = seedState();
    state.messages.push({
      id: "m-code",
      channelId: ENG_ID,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: 'Veja o bloco:\n```json\n{"a":1,"b":2}\n```\nFim do bloco.',
      mentionedAgentIds: [],
      agentRunId: null,
      meta: {},
      createdAt: new Date(NOW.getTime() - 10_000).toISOString(),
    } as Message);
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);

    const row = document.querySelector('[data-message-id="m-code"]') as HTMLElement;
    const textEl = row.querySelector(".ac-msg__text") as HTMLElement;
    expect(textEl.querySelector(".code-card__top")).toBeTruthy();
    expect(textEl.querySelector(".code-card__copied")).toBeTruthy();

    // 1. Selecting across a code block strips `.code-card__top` ("JSON", "Original", hidden "Copiado") from the quote.
    const sel = window.getSelection();
    const acrossCode = document.createRange();
    acrossCode.selectNodeContents(textEl);
    mockRect(acrossCode, { left: 100, top: 180, bottom: 260, width: 320, height: 80 });
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(acrossCode);
      fireEvent.mouseUp(textEl);
    });
    await settle(2);
    await click(within(screen().getByRole("toolbar", { name: "Citar" })).getByRole("button", { name: "Citar" }));
    await settle(2);
    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;
    expect(quotePreviews(box)).toEqual(['Veja o bloco: { "a": 1, "b": 2 } Fim do bloco.']);

    // 2. Deliberately selecting visible author header (.ac-msg__head) + message text keeps the live selection unclamped
    //    for Ctrl+C, while still showing Citar (which quotes only the message body).
    const authorText = document
      .createTreeWalker(row.querySelector(".ac-msg__head") as HTMLElement, NodeFilter.SHOW_TEXT)
      .nextNode() as Text;
    const bodyText = document
      .createTreeWalker(textEl.querySelector("p") as HTMLElement, NodeFilter.SHOW_TEXT)
      .nextNode() as Text;
    expect(authorText).toBeTruthy();
    expect(bodyText).toBeTruthy();
    const authorToBody = document.createRange();
    authorToBody.setStart(authorText, 0);
    authorToBody.setEnd(bodyText, bodyText.data.length);
    mockRect(authorToBody, { left: 100, top: 150, bottom: 200, width: 220, height: 50 });
    await act(async () => {
      sel?.removeAllRanges();
      sel?.addRange(authorToBody);
      fireEvent.mouseUp(row, { detail: 1 });
    });
    await settle(2);
    expect(sel?.getRangeAt(0).startContainer).toBe(authorText);
    expect(screen().getByRole("toolbar", { name: "Citar" })).toBeTruthy();

    // Triple-click (`detail: 3`) DOES clamp even when the browser selection included the header.
    await act(async () => {
      fireEvent.mouseUp(row, { detail: 3 });
      fireEvent.click(row, { detail: 3 });
    });
    await settle(2);
    expect(sel?.getRangeAt(0).startContainer).toBe(bodyText);

    // 3. Backwards (bottom-to-top) overflow selection clamps without flipping anchor/focus direction.
    if (sel && typeof sel.setBaseAndExtent === "function") {
      const firstBodyText = bodyText;
      await act(async () => {
        sel.setBaseAndExtent(textEl, textEl.childNodes.length, firstBodyText, 0);
        mockRect(sel.getRangeAt(0), { left: 100, top: 180, bottom: 260, width: 320, height: 80 });
        fireEvent.mouseUp(textEl, { detail: 1 });
      });
      await settle(2);
      expect(sel.anchorNode === firstBodyText).toBe(false);
      expect(sel.focusNode === firstBodyText).toBe(true);
      expect(sel.focusOffset).toBe(0);
    }

    // 4. Composer quote pill guards: `>oi` (no space) does NOT render a pill, leading spaces stay outside the pill,
    //    and `onSelect`/`onKeyUp` sync backdrop `scrollTop`.
    const textWrap = box.closest(".ac-composer__text") as HTMLElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: ">oi sem espaco" } });
    });
    expect(textWrap.dataset.quotePills).toBeUndefined();
    expect(textWrap.querySelector(".ac-composer__quote-pill")).toBeNull();

    await act(async () => {
      fireEvent.change(box, { target: { value: "  > citado com recuo\nlinha normal" } });
    });
    expect(textWrap.dataset.quotePills).toBe("true");
    const pill = textWrap.querySelector(".ac-composer__quote-pill") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.querySelector(".ac-composer__quote-glyph")?.textContent).toBe("> ");
    expect(pill.textContent).toBe("> citado com recuo");
    expect(pill.parentElement?.firstChild?.textContent).toBe("  ");

    const backdrop = textWrap.querySelector(".ac-composer__backdrop") as HTMLElement;
    box.scrollTop = 48;
    await act(async () => {
      fireEvent.keyUp(box, { key: "ArrowDown" });
    });
    expect(backdrop.scrollTop).toBe(48);
  });
});
