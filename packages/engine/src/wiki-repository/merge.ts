import { diffLines } from "../wiki";

/**
 * Two edits of one text joined, as git merges a file (ADR 0214): what the wiki and the repository each changed since
 * the text both last held comes in, as long as the two changed different lines. Lines next to each other count as the
 * same place, as they do for git: a merge never guesses which of two touching changes reads right.
 */

/** Where a text differs from the one before: lines `[start, end)` of the one before, and what stands there now. */
interface Change {
  start: number;
  end: number;
  lines: string[];
  side: "ours" | "theirs";
}

function changesFrom(base: string, next: string, side: Change["side"]): Change[] {
  const out: Change[] = [];
  let at = 0;
  let open: Change | null = null;
  for (const line of diffLines(base, next)) {
    if (line.type === "same") {
      open = null;
      at++;
      continue;
    }
    if (!open) {
      open = { start: at, end: at, lines: [], side };
      out.push(open);
    }
    if (line.type === "del") {
      at++;
      open.end = at;
    } else open.lines.push(line.text);
  }
  return out;
}

/**
 * `ours` and `theirs`, both edits of `base`, as one text; null when they changed the same lines or lines that touch.
 * Line endings are compared as `\n`; the result takes `theirs`'s (the repository's file) when it has `\r\n`.
 */
export function mergeText(base: string, ours: string, theirs: string): string | null {
  const crlf = theirs.includes("\r\n");
  const [b, o, t] = [base, ours, theirs].map((s) => s.replace(/\r\n/g, "\n")) as [string, string, string];
  const out = (text: string) => (crlf ? text.replace(/\n/g, "\r\n") : text);
  if (o === t || o === b) return out(t);
  if (t === b) return out(o);
  const lines = b.split("\n");
  const changes = [...changesFrom(b, o, "ours"), ...changesFrom(b, t, "theirs")].sort(
    (x, y) => x.start - y.start || x.end - y.end,
  );
  const merged: string[] = [];
  let copied = 0;
  for (let k = 0; k < changes.length; ) {
    const first = changes[k] as Change;
    const group = [first];
    let end = first.end;
    // Changes that overlap or touch are one place.
    for (k++; k < changes.length && (changes[k] as Change).start <= end; k++) {
      const next = changes[k] as Change;
      group.push(next);
      end = Math.max(end, next.end);
    }
    const start = first.start;
    const sideText = (side: Change["side"]) => {
      const text: string[] = [];
      let at = start;
      for (const c of group) {
        if (c.side !== side) continue;
        text.push(...lines.slice(at, c.start), ...c.lines);
        at = c.end;
      }
      return [...text, ...lines.slice(at, end)];
    };
    const sides = new Set(group.map((c) => c.side));
    let chosen: string[];
    if (sides.size === 1) chosen = sideText(first.side);
    else {
      const a = sideText("ours");
      const z = sideText("theirs");
      // The same change made on both sides is no conflict.
      if (a.length !== z.length || a.some((line, i) => line !== z[i])) return null;
      chosen = a;
    }
    merged.push(...lines.slice(copied, start), ...chosen);
    copied = end;
  }
  merged.push(...lines.slice(copied));
  return out(merged.join("\n"));
}

const tagKey = (tag: string) => tag.trim().replace(/^#/, "").toLowerCase();

/**
 * Tags edited on both sides: a tag either side added comes in, one either side took off goes, the rest stays. The
 * repository's spelling first.
 */
export function mergeTags(base: readonly string[], ours: readonly string[], theirs: readonly string[]): string[] {
  const before = new Set(base.map(tagKey));
  const here = new Set(ours.map(tagKey));
  const there = new Set(theirs.map(tagKey));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...theirs, ...ours]) {
    const key = tagKey(tag);
    if (!key || seen.has(key)) continue;
    if (before.has(key) && !(here.has(key) && there.has(key))) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
