// A textarea and its mirror wrap the same text. The word joiners keep the space
// reserved for one pill together, and the outer breaks let it wrap as a unit.
const SPACE = "\u200B";
const PAD_UNIT = "\u2060\u2003";
const MIN_PAD = 3;
const MAX_PAD = 24;
const DEFAULT_PAD = 14;
const PREVIEW_MAX = 160;
const PREVIEW_SLICE = 1024;
const PILL_MAX_PX = 320;
const PILL_MIN_PX = 64;
const PILL_ROOM_SHARE = 0.44;
// Icon (14) + gap (5) + horizontal padding (8) + trailing gap (5) + breathing room.
const PILL_CHROME_PX = 38;
const TOKEN = /\u200B\u2003[\uFE00-\uFE0F]{3}(?:\u2060\u2003){1,24}\u200B/g;

export type ComposerQuotes = Readonly<Record<string, string>>;

/** Short one-line preview shown inside an inline quote pill. */
export function quotePreview(markdown: string): string {
  const first = markdown.search(/[^\s>]/);
  if (first < 0) return "";
  const lineStart = first > 0 ? markdown.lastIndexOf("\n", first - 1) + 1 : 0;
  const end = lineStart + PREVIEW_SLICE;
  const truncated = end < markdown.length;
  const raw = truncated ? markdown.slice(lineStart, end).replace(/[\uD800-\uDBFF]$/, "") : markdown.slice(lineStart);
  const text = raw
    .replace(/^> /gm, "")
    .replace(/(^|\n)([ \t]*)\\(?=`{3,}|~{3,})/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= PREVIEW_MAX) {
    return truncated && text && /\S/.test(markdown.slice(end)) ? `${text}…` : text;
  }
  const preview = text
    .slice(0, PREVIEW_MAX)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
  return `${preview}…`;
}

/**
 * Picks how many em-space pads to reserve inside the textarea for one inline quote pill: wide enough for ~30+
 * characters (up to ~320px or 44% of the field, whichever is smaller), snugger for short quotes, and narrow
 * enough on mobile/side panels that the marker never wraps across lines.
 */
export function inlineQuotePad(field: HTMLTextAreaElement | null | undefined, markdown: string): number {
  if (!field?.clientWidth || typeof document === "undefined") return DEFAULT_PAD;
  const s = getComputedStyle(field);
  const padLeft = Number.parseFloat(s.paddingLeft) || 0;
  const padRight = Number.parseFloat(s.paddingRight) || 0;
  const room = field.clientWidth - padLeft - padRight;
  if (room <= 0) return DEFAULT_PAD;
  const fontSize = Number.parseFloat(s.fontSize) || 14;
  const pen = document.createElement("canvas").getContext("2d");
  let em = fontSize;
  if (pen) {
    pen.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const measuredEm = pen.measureText("\u2003").width;
    if (measuredEm > 0) em = measuredEm;
  }
  const shareCap = Math.min(PILL_MAX_PX, Math.max(120, Math.floor(room * PILL_ROOM_SHARE)));
  const maxPx = Math.min(shareCap, Math.max(PILL_MIN_PX, room - 24));
  let targetPx = maxPx;
  const preview = quotePreview(markdown);
  if (pen && preview) {
    pen.font = `${s.fontStyle} ${s.fontWeight} 13px ${s.fontFamily}`;
    // 1.1x accounts for `font-size-adjust` on Source Sans 3, which Canvas 2D does not apply.
    const fitPx = Math.ceil(pen.measureText(preview).width * 1.1 + PILL_CHROME_PX);
    targetPx = Math.min(maxPx, Math.max(PILL_MIN_PX, fitPx));
  }
  const maxEms = Math.max(MIN_PAD + 1, Math.floor(maxPx / em));
  const desiredEms = targetPx < maxPx ? Math.ceil(targetPx / em) : maxEms;
  return Math.max(MIN_PAD, Math.min(MAX_PAD, Math.min(maxEms, desiredEms) - 1));
}

export function inlineQuoteToken(value: string, quotes: ComposerQuotes, pad = DEFAULT_PAD): string | undefined {
  const clamped = Math.max(MIN_PAD, Math.min(MAX_PAD, Math.round(pad)));
  const padding = PAD_UNIT.repeat(clamped);
  for (let id = 0; id < 0x1000; id++) {
    const selectors = String.fromCharCode(0xfe00 + (id >> 8), 0xfe00 + ((id >> 4) & 15), 0xfe00 + (id & 15));
    const token = `${SPACE}\u2003${selectors}${padding}${SPACE}`;
    if (!quotes[token] && !value.includes(token)) return token;
  }
}

export function inlineQuoteRanges(value: string, quotes: ComposerQuotes) {
  if (!Object.keys(quotes).length) return [];
  return [...value.matchAll(TOKEN)].flatMap(({ 0: token, index: start }) =>
    quotes[token] ? [{ token, start, end: start + token.length, markdown: quotes[token] }] : [],
  );
}

/** The plain text used by the clipboard and the outgoing message. */
export function expandInlineQuotes(value: string, quotes: ComposerQuotes): string {
  const parts: string[] = [];
  let end = 0;
  for (const quote of inlineQuoteRanges(value, quotes)) {
    const before = value.slice(end, quote.start);
    parts.push(before);
    if (before && !before.endsWith("\n")) parts.push("\n");
    parts.push(quote.markdown);
    end = quote.end;
    if (end < value.length && value[end] !== "\n") parts.push("\n");
  }
  return parts.length ? parts.join("") + value.slice(end) : value;
}

/** A range crossing part of a pill selects the whole pill. A caret inside it moves to the nearer end. */
export function inlineQuoteSelection(value: string, quotes: ComposerQuotes, start: number, end: number) {
  const ranges = inlineQuoteRanges(value, quotes);
  if (start === end) {
    const inside = ranges.find((quote) => quote.start < start && start < quote.end);
    if (inside) {
      const edge = start - inside.start < inside.end - start ? inside.start : inside.end;
      return { start: edge, end: edge };
    }
  }
  for (const quote of ranges) {
    if (quote.start < start && start < quote.end) start = quote.start;
    if (quote.start < end && end < quote.end) end = quote.end;
  }
  return { start, end };
}

/** Repair an edit from an input method that changed only part of a pill. */
export function protectInlineQuoteEdit(
  previous: string,
  next: string,
  quotes: ReturnType<typeof inlineQuoteRanges>,
): { value: string; caret: number } | undefined {
  if (!quotes.length || previous === next) return;
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let left = previous.length;
  let right = next.length;
  while (left > start && right > start && previous[left - 1] === next[right - 1]) {
    left--;
    right--;
  }
  // Adjacent markers share padding. A text diff may place its boundary inside
  // an untouched marker even when the browser removed another one in full.
  const tail = quotes.find((q) => q.start < left && left < q.end);
  if (tail && next.endsWith(previous.slice(tail.start))) {
    left = tail.start;
    right = next.length - (previous.length - left);
    start = Math.min(start, right, left);
  }
  const head = quotes.find((q) => q.start < start && start < q.end);
  if (head && next.startsWith(previous.slice(0, head.end))) {
    start = head.end;
    left = Math.max(left, start);
    right = Math.max(right, start);
  }
  const replacement = next.slice(start, right);
  if (start === left) {
    const quote = quotes.find((q) => q.start < start && start < q.end);
    if (!quote) return;
    return {
      value: previous.slice(0, quote.end) + replacement + previous.slice(quote.end),
      caret: quote.end + replacement.length,
    };
  }
  const from = quotes.find((q) => q.start < start && start < q.end)?.start ?? start;
  const to = quotes.find((q) => q.start < left && left < q.end)?.end ?? left;
  if (from !== start || to !== left) {
    return { value: previous.slice(0, from) + replacement + previous.slice(to), caret: from + replacement.length };
  }
}
