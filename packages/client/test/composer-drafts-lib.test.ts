import { expect, test } from "bun:test";
import {
  DRAFT_TTL_MS,
  type DraftFile,
  draftKeyOf,
  MAX_DRAFTS,
  readDraftBook,
  withDraft,
  withDraftFiles,
} from "../src/lib/composer-drafts";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");

test("a thread's composer has its own draft; a channel's (or DM's) is the channel's", () => {
  expect(draftKeyOf("c1")).toBe("channel:c1");
  expect(draftKeyOf("c1", null)).toBe("channel:c1");
  expect(draftKeyOf("c1", "t1")).toBe("thread:t1");
});

test("a typed text is kept and read back; a blank one removes the entry", () => {
  let book = withDraft({}, "channel:c1", "half a thought", NOW);
  book = withDraft(book, "thread:t1", "reply", NOW);
  const read = readDraftBook(JSON.stringify(book), NOW + 1000);
  expect(read["channel:c1"]).toEqual({ text: "half a thought", at: NOW });
  expect(read["thread:t1"]?.text).toBe("reply");
  expect(withDraft(read, "channel:c1", "   ", NOW)["channel:c1"]).toBeUndefined();
});

test("nothing, broken JSON or the wrong shape read as an empty book; bad and blank entries are skipped", () => {
  expect(readDraftBook(null, NOW)).toEqual({});
  expect(readDraftBook("{oops", NOW)).toEqual({});
  expect(readDraftBook("[1,2]", NOW)).toEqual({});
  const raw = JSON.stringify({
    a: { text: "ok", at: NOW },
    b: { text: 3, at: NOW },
    c: { text: "  ", at: NOW },
    d: "text",
  });
  expect(Object.keys(readDraftBook(raw, NOW))).toEqual(["a"]);
});

test("old drafts expire", () => {
  const raw = JSON.stringify({
    old: { text: "old", at: NOW - DRAFT_TTL_MS - 1 },
    recent: { text: "new", at: NOW - 1 },
  });
  expect(Object.keys(readDraftBook(raw, NOW))).toEqual(["recent"]);
});

test("the book keeps only the most recent drafts", () => {
  let book = {};
  for (let i = 0; i < MAX_DRAFTS + 5; i++) book = withDraft(book, `channel:${i}`, `text ${i}`, NOW + i);
  const keys = Object.keys(book);
  expect(keys).toHaveLength(MAX_DRAFTS);
  expect(keys).not.toContain("channel:0");
  expect(keys).toContain(`channel:${MAX_DRAFTS + 4}`);
});

const PRINT: DraftFile = { id: "f-1", version: 1, title: "print.png", name: "print.png", size: 4, type: "image/png" };

test("files waiting in a composer are kept with its text, each kept when the other changes", () => {
  let book = withDraftFiles({}, "channel:c1", [PRINT], NOW);
  // Files alone keep the entry, with a blank text.
  expect(readDraftBook(JSON.stringify(book), NOW)["channel:c1"]).toEqual({ text: "", files: [PRINT], at: NOW });
  book = withDraft(book, "channel:c1", "look", NOW + 1);
  expect(book["channel:c1"]).toEqual({ text: "look", files: [PRINT], at: NOW + 1 });
  book = withDraftFiles(book, "channel:c1", [], NOW + 2);
  expect(book["channel:c1"]).toEqual({ text: "look", at: NOW + 2 });
  // No text and no files: the entry goes.
  expect(withDraft(withDraftFiles(book, "channel:c1", [], NOW), "channel:c1", "", NOW)["channel:c1"]).toBeUndefined();
});

test("a stored file of the wrong shape is skipped; an entry left with nothing goes", () => {
  const raw = JSON.stringify({
    a: { text: "", files: [PRINT, { id: "f-2", name: "x" }], at: NOW },
    b: { text: "", files: [{ id: 3 }], at: NOW },
    c: { text: "", files: "print.png", at: NOW },
  });
  expect(readDraftBook(raw, NOW)).toEqual({ a: { text: "", files: [PRINT], at: NOW } });
});
