import { Icon, isApple } from "@agenteschat/ui";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { matchesNow, TOUCH } from "@/hooks/useMatchMedia";

export interface SelectionRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SelectionQuoteMatch {
  messageId: string;
  text: string;
  rect: SelectionRect;
}

const EXCLUDED_SELECTOR =
  "input, textarea, select, button, [contenteditable='true'], [contenteditable=''], [hidden], .ac-visually-hidden, .msg-quote, .code-card__top, .ac-msg__actions, .ac-msg__head, .ac-msg__bubble-head, .ac-msg__stamp, .ac-msg__reply, .ac-msg__foot, .ac-msg__own-foot";

const COPYABLE_CHROME_SELECTOR =
  ".ac-msg__head, .ac-msg__bubble-head, .ac-msg__reply, .ac-msg__foot, .ac-msg__own-foot";

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

/** Normalizes selected plain text while keeping intentional line breaks for multi-line Markdown blockquotes. */
function normalizeQuoteSelection(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n");
  let start = 0;
  let end = lines.length;
  while (lines[start] === "\n") start++;
  while (end > start && lines[end - 1] === "\n") end--;
  return lines.slice(start, end);
}

/** Alt+Q (⌥Q on a Mac, by the key's place: Option changes the letter). */
const quotesKey = (e: KeyboardEvent) => e.code === "KeyQ" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

/** Format every selected line, including quoted paragraph breaks. Mentions stay as written: the server ignores `>` lines. */
export function formatMarkdownQuote(raw: string): string {
  const text = normalizeQuoteSelection(raw);
  if (!text.trim()) return "";
  return text
    .split("\n")
    .map((line) => `> ${line.replace(/^(\s*)(`{3,}|~{3,})/, "$1\\$2")}`)
    .join("\n");
}

/**
 * Inserts `inserted` at `[start, end]` in `el`, preferring `document.execCommand("insertText")` so browsers push the
 * edit onto the textarea's native Ctrl/Cmd+Z undo stack, with a `setRangeText` fallback for test DOMs.
 */
export function insertIntoTextarea(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
  inserted: string,
  onChange: (next: string) => void,
): { value: string; caret: number } {
  const before = el.value;
  const expected = before.slice(0, start) + inserted + before.slice(end);
  const caret = start + inserted.length;
  el.focus();
  el.setSelectionRange(start, end);
  let applied = false;
  if (typeof document.execCommand === "function") {
    try {
      applied = document.execCommand("insertText", false, inserted) && el.value === expected;
    } catch {
      applied = false;
    }
  }
  if (!applied) {
    if (el.value !== before) el.value = before;
    if (typeof el.setRangeText === "function") {
      el.setRangeText(inserted, start, end, "end");
    }
    onChange(expected);
  } else {
    onChange(el.value);
  }
  el.setSelectionRange(caret, caret);
  return { value: expected, caret };
}

/** Finds the tightest range covering all selectable non-whitespace `Text` nodes inside `textContainer`. */
function selectableTextBounds(textContainer: HTMLElement): Range | null {
  const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_TEXT);
  let firstText: Text | null = null;
  let lastText: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (!text.data.trim()) continue;
    const parent = text.parentElement;
    if (parent?.closest(EXCLUDED_SELECTOR)) continue;
    if (!firstText) firstText = text;
    lastText = text;
  }
  if (!firstText || !lastText) return null;
  const bounds = document.createRange();
  bounds.setStart(firstText, 0);
  bounds.setEnd(lastText, lastText.data.length);
  return bounds;
}

/**
 * Clips `range` to the selectable `Text` nodes inside `textContainer` (excluding bubble head, reply quote, and
 * timestamp). Returns `overflowed: true` whenever `range` started before the first selectable text node or ended
 * past the last selectable text node (e.g. triple-click, drag past the bubble edge or timestamp).
 */
function clipRangeToMessageText(
  range: Range,
  textContainer: HTMLElement,
): { clipped: Range; overflowed: boolean } | null {
  const bounds = selectableTextBounds(textContainer);
  if (!bounds) return null;

  try {
    // Disjoint: range ends at/before bounds start, or starts at/after bounds end.
    if (range.compareBoundaryPoints(Range.START_TO_END, bounds) <= 0) return null;
    if (range.compareBoundaryPoints(Range.END_TO_START, bounds) >= 0) return null;
  } catch {
    return null;
  }

  const clipped = range.cloneRange();
  let overflowed = false;
  if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clipped.setStart(bounds.startContainer, bounds.startOffset);
    overflowed = true;
  }
  if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clipped.setEnd(bounds.endContainer, bounds.endOffset);
    overflowed = true;
  }
  if (clipped.collapsed) return null;
  return { clipped, overflowed };
}

/**
 * Extracts plain text from `range`, removing any nested excluded chrome (such as `.code-card__top` language headers
 * and Copy/Raw buttons) while preserving line breaks across block elements and `.code-line` spans.
 */
function extractSelectableText(range: Range): string {
  const frag = range.cloneContents();
  for (const el of Array.from(frag.querySelectorAll(EXCLUDED_SELECTOR))) el.remove();
  let out = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node as Text).data;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === "BR") {
        out += "\n";
        return;
      }
      const separator = el.tagName === "P" ? "\n\n" : BLOCK_TAGS.has(el.tagName) ? "\n" : "";
      const separate = () => {
        if (!separator || !out || out.endsWith(separator)) return;
        out += out.endsWith("\n") ? "\n" : separator;
      };
      separate();
      for (const child of Array.from(el.childNodes)) visit(child);
      separate();
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(frag);
  return out;
}

/** True when `range` covers at least one character of a visible non-timestamp chrome element (author, reply, footer). */
function rangeTouchesCopyableChrome(range: Range, row: HTMLElement): boolean {
  for (const el of Array.from(row.querySelectorAll<HTMLElement>(COPYABLE_CHROME_SELECTOR))) {
    if (el.matches(".ac-msg__bubble-head") && el.closest('[data-names="false"]')) continue;
    if (el.closest("[hidden], .ac-visually-hidden")) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      if (!text.data.trim()) continue;
      if (text.parentElement?.closest("[hidden], .ac-visually-hidden, .ac-msg__stamp")) continue;
      try {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(text);
        if (
          range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
          range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
        ) {
          return true;
        }
      } catch {
        // Ignore nodes from another document.
      }
    }
  }
  return false;
}

/** True when the user dragged from bottom/right to top/left so anchor comes after focus in document order. */
function isSelectionBackwards(sel: Selection): boolean {
  if (!sel.anchorNode || !sel.focusNode) return false;
  if (sel.anchorNode === sel.focusNode) return sel.anchorOffset > sel.focusOffset;
  try {
    const anchor = document.createRange();
    anchor.setStart(sel.anchorNode, sel.anchorOffset);
    anchor.collapse(true);
    const focus = document.createRange();
    focus.setStart(sel.focusNode, sel.focusOffset);
    focus.collapse(true);
    return anchor.compareBoundaryPoints(Range.START_TO_START, focus) > 0;
  } catch {
    return Boolean(sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_PRECEDING);
  }
}

interface SelectionQuoteDetail {
  match: SelectionQuoteMatch;
  tightRange: Range;
  overflowed: boolean;
  touchesCopyableChrome: boolean;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    if (typeof range.intersectsNode === "function") return range.intersectsNode(node);
  } catch {
    // Fall back to boundary comparison when intersectsNode is unavailable.
  }
  try {
    const nodeRange = document.createRange();
    nodeRange.selectNode(node);
    return (
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
    );
  } catch {
    return false;
  }
}

/**
 * Extracts a quotable plain-text selection covering selectable text from **exactly one** message (`.ac-msg__text`
 * under `[data-message-id]`) within `container`. Works regardless of whether the range boundaries land on the bubble
 * head, bubble margin, timestamp (`.ac-msg__stamp`), footer, or the next message's `offset 0` / non-selectable chrome,
 * while ignoring selections that span selectable text across two or more messages.
 */
function selectionQuoteDetail(container: HTMLElement | null, selection: Selection | null): SelectionQuoteDetail | null {
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const commonEl = elementOf(range.commonAncestorContainer);
  if (!commonEl) return null;
  if (!container.contains(commonEl) && !commonEl.contains(container)) return null;
  // Selection entirely inside an excluded control (input, textarea, quote preview, header, timestamp).
  if (commonEl.closest(EXCLUDED_SELECTOR)) return null;

  const singleRow = commonEl.closest<HTMLElement>("[data-message-id]");
  const candidates: HTMLElement[] =
    singleRow && container.contains(singleRow)
      ? [singleRow]
      : Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).filter((row) =>
          rangeIntersectsNode(range, row),
        );

  let found: {
    messageId: string;
    row: HTMLElement;
    text: string;
    clipped: Range;
    overflowed: boolean;
    fallbackEl: HTMLElement;
  } | null = null;

  for (const row of candidates) {
    const messageId = row.dataset.messageId;
    if (!messageId) continue;
    const textBlocks = Array.from(row.querySelectorAll<HTMLElement>(".ac-msg__text"));
    const parts: string[] = [];
    let firstClipped: Range | null = null;
    let lastClipped: Range | null = null;
    let overflowed = false;
    let fallbackEl: HTMLElement | null = null;
    for (const block of textBlocks) {
      const hit = clipRangeToMessageText(range, block);
      if (!hit) continue;
      const piece = normalizeQuoteSelection(extractSelectableText(hit.clipped));
      if (!piece.trim()) continue;
      parts.push(piece);
      if (!firstClipped) {
        firstClipped = hit.clipped;
        fallbackEl = block;
      }
      lastClipped = hit.clipped;
      if (hit.overflowed) overflowed = true;
    }
    if (parts.length === 0 || !firstClipped || !lastClipped || !fallbackEl) continue;
    // More than one message has selectable text inside the range: genuine cross-message selection.
    if (found) return null;
    const combined = firstClipped.cloneRange();
    if (lastClipped !== firstClipped) {
      combined.setEnd(lastClipped.endContainer, lastClipped.endOffset);
    }
    found = {
      messageId,
      row,
      text: parts.join("\n\n"),
      clipped: combined,
      overflowed,
      fallbackEl,
    };
  }

  if (!found) return null;

  const sameBounds =
    found.clipped.startContainer === range.startContainer &&
    found.clipped.startOffset === range.startOffset &&
    found.clipped.endContainer === range.endContainer &&
    found.clipped.endOffset === range.endOffset;
  const rectSource = sameBounds ? range : found.clipped;
  let rect = rectSource.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    rect = rectSource.getClientRects()[0] ?? range.getBoundingClientRect();
  }
  if (rect.width === 0 && rect.height === 0) {
    rect = found.fallbackEl.getBoundingClientRect();
  }

  return {
    match: {
      messageId: found.messageId,
      text: found.text,
      rect: {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    },
    tightRange: found.clipped,
    overflowed: found.overflowed,
    touchesCopyableChrome: found.overflowed && rangeTouchesCopyableChrome(range, found.row),
  };
}

/** Public helper returning the quotable single-message selection inside `container`, or `null`. */
export function selectionQuoteIn(
  container: HTMLElement | null,
  selection: Selection | null,
): SelectionQuoteMatch | null {
  return selectionQuoteDetail(container, selection)?.match ?? null;
}

export interface FloatingBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const PILL_WIDTH = 92;
const PILL_HEIGHT = 34;
const VIEWPORT_PAD = 8;
const SELECTION_GAP = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Computes fixed viewport coordinates above the selection, flipping below or clamping inside visible bounds. */
export function floatingPosition(
  rect: SelectionRect,
  viewport: { width: number; height: number },
  pill = { width: PILL_WIDTH, height: PILL_HEIGHT },
  bounds?: FloatingBounds,
  anchor?: { x: number; y: number } | null,
): { top: number; left: number } {
  const minLeft = bounds ? Math.max(VIEWPORT_PAD, bounds.left) : VIEWPORT_PAD;
  const maxRight = bounds ? Math.min(viewport.width - VIEWPORT_PAD, bounds.right) : viewport.width - VIEWPORT_PAD;
  const maxLeft = Math.max(minLeft, maxRight - pill.width);
  const minTop = bounds ? Math.max(VIEWPORT_PAD, bounds.top) : VIEWPORT_PAD;
  const maxBottom = bounds ? Math.min(viewport.height - VIEWPORT_PAD, bounds.bottom) : viewport.height - VIEWPORT_PAD;
  const maxTop = Math.max(minTop, maxBottom - pill.height);

  const centerX = rect.left + rect.width / 2;
  const left = clamp(centerX - pill.width / 2, minLeft, maxLeft);
  const above = rect.top - pill.height - SELECTION_GAP;
  const below = rect.bottom + SELECTION_GAP;
  let top: number;
  if (above >= minTop && above <= maxTop) {
    top = above;
  } else if (below >= minTop && below <= maxTop) {
    top = below;
  } else if (anchor && anchor.y >= minTop && anchor.y <= maxBottom) {
    top = clamp(anchor.y - pill.height - SELECTION_GAP, minTop, maxTop);
  } else {
    top = clamp(Math.max(rect.top, minTop), minTop, maxTop);
  }
  return { top, left };
}

/**
 * Floating "Quote" ("Citar") pill shown near text selected inside a conversation's messages.
 * Scoped to one scroller container so channels and side thread panels stay independent.
 */
export function SelectionQuote({
  container,
  enabled,
  canQuote,
  onQuote,
}: {
  container: RefObject<HTMLElement | null>;
  enabled: boolean;
  canQuote: (messageId: string) => boolean;
  onQuote: (messageId: string, text: string) => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<(SelectionQuoteMatch & { anchor?: { x: number; y: number } | null }) | null>(
    null,
  );
  const pillRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const clamping = useRef(false);
  const pointerAnchor = useRef<{ x: number; y: number } | null>(null);
  const canQuoteRef = useRef(canQuote);
  canQuoteRef.current = canQuote;
  const onQuoteRef = useRef(onQuote);
  onQuoteRef.current = onQuote;

  const evaluate = useCallback(
    (clampMode: "none" | "overflow" | "triple" = "none"): boolean => {
      if (!enabled) {
        setActive(null);
        return false;
      }
      const sel = window.getSelection();
      const detail = selectionQuoteDetail(container.current, sel);
      if (!detail || !canQuoteRef.current(detail.match.messageId)) {
        setActive(null);
        return false;
      }
      // Tighten live selection only on triple-click (`detail >= 3`) or when overflow is solely onto `.ac-msg__stamp`
      // or bubble margin/visually-hidden chrome — never when the user deliberately included visible author, reply
      // preview, or footer text to copy. Preserve bottom-to-top selection direction when clamping.
      const shouldClamp =
        detail.overflowed && (clampMode === "triple" || (clampMode === "overflow" && !detail.touchesCopyableChrome));
      if (shouldClamp && sel) {
        clamping.current = true;
        try {
          const backwards = isSelectionBackwards(sel);
          if (backwards && typeof sel.setBaseAndExtent === "function") {
            sel.setBaseAndExtent(
              detail.tightRange.endContainer,
              detail.tightRange.endOffset,
              detail.tightRange.startContainer,
              detail.tightRange.startOffset,
            );
          } else {
            sel.removeAllRanges();
            sel.addRange(detail.tightRange);
          }
        } catch {
          // Keep the match even if the browser refuses modifying the live range.
        } finally {
          clamping.current = false;
        }
      }
      setActive({ ...detail.match, anchor: pointerAnchor.current });
      return true;
    },
    [container, enabled],
  );

  useEffect(() => {
    if (!enabled) setActive(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let touchTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (touchTimer !== null) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const notePointer = (e: { clientX: number; clientY: number }) => {
      if (e.clientX > 0 || e.clientY > 0) {
        pointerAnchor.current = { x: e.clientX, y: e.clientY };
      }
    };

    const recheckAfterPointer = (triple = false) => {
      dragging.current = false;
      clearTimers();
      const mode = triple ? "triple" : "overflow";
      if (!evaluate(mode)) {
        // Double- and triple-click selections can commit right after mouseup/dblclick in some browsers.
        settleTimer = setTimeout(() => evaluate(mode), 0);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (pillRef.current && target && pillRef.current.contains(target)) return;
      clearTimers();
      pointerAnchor.current = null;
      if (e.pointerType !== "touch" && e.button === 0) {
        dragging.current = Boolean(container.current && target && container.current.contains(target));
      }
      setActive(null);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = e.target as Node | null;
      if (pillRef.current && target && pillRef.current.contains(target)) return;
      notePointer(e);
      recheckAfterPointer(false);
    };

    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (pillRef.current && target && pillRef.current.contains(target)) return;
      notePointer(e);
      recheckAfterPointer(e.detail >= 3);
    };

    const onDblClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (pillRef.current && target && pillRef.current.contains(target)) return;
      notePointer(e);
      recheckAfterPointer(false);
    };

    const onTripleClick = (e: MouseEvent) => {
      if (e.detail < 3) return;
      const target = e.target as Node | null;
      if (pillRef.current && target && pillRef.current.contains(target)) return;
      notePointer(e);
      recheckAfterPointer(true);
    };

    const resetDrag = () => {
      dragging.current = false;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if (e.shiftKey || e.key === "Shift" || e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
        pointerAnchor.current = null;
        evaluate("none");
      }
    };

    const onSelectionChange = () => {
      if (clamping.current) return;
      clearTimers();
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setActive(null);
        return;
      }
      // On touch devices, wait briefly for the OS selection handles to settle without fighting long-press menus.
      if (matchesNow(TOUCH)) {
        pointerAnchor.current = null;
        touchTimer = setTimeout(() => evaluate("none"), 150);
        return;
      }
      if (!dragging.current) evaluate("none");
    };

    const onScroll = () => setActive(null);
    const scroller = container.current;

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", resetDrag, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("click", onTripleClick, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("blur", resetDrag);
    window.addEventListener("resize", onScroll);
    return () => {
      clearTimers();
      dragging.current = false;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", resetDrag, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("click", onTripleClick, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", resetDrag);
      window.removeEventListener("resize", onScroll);
    };
  }, [container, enabled, evaluate]);

  const quote = useCallback((picked: { messageId: string; text: string }) => {
    setActive(null);
    window.getSelection()?.removeAllRanges();
    onQuoteRef.current(picked.messageId, picked.text);
  }, []);

  // Escape closes the floating pill before reaching the composer or side panel; Alt+Q (⌥Q) quotes, the keyboard's way
  // to the pill, which sits outside the Tab order.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        setActive(null);
      } else if (quotesKey(e)) {
        e.preventDefault();
        quote(active);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, quote]);

  if (!active) return null;

  const viewport = {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  };
  const containerRect = container.current?.getBoundingClientRect();
  const bounds =
    containerRect && containerRect.width > 0 && containerRect.height > 0
      ? {
          left: Math.max(VIEWPORT_PAD, containerRect.left + VIEWPORT_PAD),
          right: Math.min(viewport.width - VIEWPORT_PAD, containerRect.right - VIEWPORT_PAD),
          top: Math.max(VIEWPORT_PAD, containerRect.top + VIEWPORT_PAD),
          bottom: Math.min(viewport.height - VIEWPORT_PAD, containerRect.bottom - VIEWPORT_PAD),
        }
      : undefined;
  const pos = floatingPosition(active.rect, viewport, undefined, bounds, active.anchor);

  const label = t("channel.quote");

  return createPortal(
    <div
      ref={pillRef}
      className="selection-quote"
      role="toolbar"
      aria-label={label}
      data-esc-layer=""
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
    >
      <button
        type="button"
        className="selection-quote__btn"
        onMouseDown={(e) => e.preventDefault()}
        aria-keyshortcuts="Alt+Q"
        title={`${label} (${isApple() ? "⌥Q" : "Alt+Q"})`}
        onClick={() => quote(active)}
      >
        <Icon name="quote" size={14} />
        <span>{label}</span>
      </button>
    </div>,
    document.body,
  );
}
