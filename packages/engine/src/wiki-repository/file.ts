import { createHash } from "node:crypto";

/**
 * A wiki page as a Markdown file in a repository, and back (pure): the file's name and folder are the page's title and
 * folder, its frontmatter `tags` are the page's tags, and the rest of the frontmatter is kept as written.
 */

/** A note: a Markdown file. */
export const NOTE_FILE = /\.(md|markdown)$/i;

/** Hidden folders and files (`.git`, `.github`, `.obsidian`) and installed packages: never read. */
export const LEFT_OUT_PATH = /(^|\/)(\.[^/]*|node_modules)(\/|$)/;

/** The id git gives a file's content: what a repository's tree lists for it. */
export function gitBlobSha(content: string | Uint8Array) {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

export interface NoteFile {
  /** The file up to its text: the frontmatter block and the blank lines after it; empty when it has none. */
  head: string;
  body: string;
  tags: string[];
  aliases: string[];
}

const unquote = (value: string) =>
  value
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2")
    .trim();

/** `[a, b]`, `a, b` or one value, as a frontmatter key's inline value. */
const inlineList = (value: string) =>
  value
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .split(",")
    .map(unquote)
    .filter(Boolean);

/** Where the frontmatter is: the lines between the two `---`, and where the text starts. */
function frontmatter(text: string) {
  const open = /^﻿?---[ \t]*\r?\n/.exec(text);
  if (!open) return null;
  const close = /(^|\r?\n)---[ \t]*(\r?\n|$)/.exec(text.slice(open[0].length));
  if (!close) return null;
  const innerEnd = open[0].length + close.index;
  let bodyStart = innerEnd + close[0].length;
  while (text[bodyStart] === "\n" || text[bodyStart] === "\r") bodyStart++;
  return { open: open[0], inner: text.slice(open[0].length, innerEnd), bodyStart };
}

/** A top-level key's lines in a frontmatter block: its own line and the indented or `- ` lines under it. */
function keyBlock(lines: string[], key: string) {
  const start = lines.findIndex((l) => new RegExp(`^${key}[ \\t]*:`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^([ \t]+\S|[ \t]*-[ \t])/.test(lines[end] ?? "")) end++;
  return { start, end };
}

function listOf(inner: string, key: string) {
  const lines = inner.split(/\r?\n/);
  const block = keyBlock(lines, key);
  if (!block) return [];
  const first = (lines[block.start] ?? "").replace(/^[^:]*:/, "");
  const items = lines
    .slice(block.start + 1, block.end)
    .map((l) => /^[ \t]*-[ \t]+(.*)$/.exec(l)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(unquote)
    .filter(Boolean);
  return [...inlineList(first), ...items];
}

/** A file's text as a page's: its frontmatter kept apart, with the tags and aliases it names. */
export function parseNoteFile(text: string): NoteFile {
  const fm = frontmatter(text);
  if (!fm) return { head: "", body: text, tags: [], aliases: [] };
  return {
    head: text.slice(0, fm.bodyStart),
    body: text.slice(fm.bodyStart),
    tags: listOf(fm.inner, "tags").map((t) => t.replace(/^#/, "")),
    aliases: listOf(fm.inner, "aliases"),
  };
}

/** The most tags a page keeps (`WIKI_LIMITS.tags`): a note with more keeps them all there. */
const PAGE_TAGS = 20;

/**
 * Tags as the wiki keeps them (`cleanTags`: lowercased, at most 20), to tell whether a page's differ from its file's:
 * a note's 21st tag, or its capitals, never read as a change made here that rewrites the note's tags.
 */
export const tagKey = (tags: readonly string[]) =>
  [...new Set(tags.map((t) => t.trim().replace(/^#/, "").toLowerCase().slice(0, 40)).filter(Boolean))]
    .slice(0, PAGE_TAGS)
    .sort()
    .join("\n");

/** `head` with its `tags` replaced by `tags` (the block removed when there are none, the frontmatter when it empties). */
function headWithTags(head: string, tags: readonly string[]) {
  const fm = frontmatter(head);
  const eol = head.includes("\r\n") ? "\r\n" : "\n";
  const block = tags.length ? ["tags:", ...tags.map((t) => `  - ${t}`)] : [];
  if (!fm) return block.length ? `---\n${block.join("\n")}\n---\n\n` : "";
  const lines = fm.inner ? fm.inner.split(/\r?\n/) : [];
  const at = keyBlock(lines, "tags");
  const next = at ? [...lines.slice(0, at.start), ...block, ...lines.slice(at.end)] : [...lines, ...block];
  if (next.every((l) => !l.trim())) return "";
  const after = head.slice(fm.open.length + fm.inner.length);
  return `${fm.open}${next.join(eol)}${/^\r?\n/.test(after) ? "" : eol}${after}`;
}

/**
 * A page as its file's text: the frontmatter as it was written when the tags are the same, else with the page's tags;
 * the text ends with a line break, as files do.
 */
export function noteFileText(page: { body: string; tags: readonly string[] }, head: string) {
  const same = tagKey(parseNoteFile(head).tags) === tagKey(page.tags);
  const top = same ? head : headWithTags(head, page.tags);
  const body = page.body && !page.body.endsWith("\n") ? `${page.body}\n` : page.body;
  return { head: top, text: `${top}${body}` };
}

/** Names Windows keeps for devices: a file can't be called that, whatever its extension. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * A page's title as a file name: what no file system refuses, without the dots and spaces Windows drops at the end
 * nor a name Windows keeps for a device (a vault is cloned everywhere), and never a name the listing leaves out (a
 * hidden one, `node_modules`): a note written there would read as removed.
 */
export function noteFileName(title: string) {
  const name = [...title.replace(/[\\/:*?"<>|]/g, "-")]
    .filter((c) => (c.codePointAt(0) ?? 0) >= 32)
    .slice(0, 120)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  if (!name) return "page";
  return DEVICE_NAME.test(name) || name.toLowerCase() === "node_modules" ? `${name}-` : name;
}

/** Where a page's file goes, relative to the repository's folder: its folder, then its title. */
export function notePath(page: { title: string; folder: string }) {
  const folder = page.folder
    .split("/")
    .filter((part) => part.trim())
    .map((part) => noteFileName(part))
    .join("/");
  return `${folder ? `${folder}/` : ""}${noteFileName(page.title)}.md`;
}

/**
 * A path as two disks compare it: some don't tell the letters' case apart, and a Mac may write an accent as two
 * characters where another disk writes one.
 */
export const pathKey = (path: string) => path.normalize("NFC").toLowerCase();

/** A file's path as a page's title and folder; the title without what a page's title can't hold (`[ ] | # ^`). */
export function pageOfPath(path: string) {
  const parts = path.normalize("NFC").split("/");
  const file = parts.pop() ?? path;
  const title = file
    .replace(NOTE_FILE, "")
    .replace(/[[\]|#^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return { title, folder: parts.join("/") };
}
