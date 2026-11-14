import { expect, test } from "bun:test";
import type { MessageStructureObject } from "imapflow";
import { findTextPart } from "../src/imap-parse";

const attachment: MessageStructureObject = {
  type: "multipart/alternative",
  part: "1",
  disposition: "attachment",
  childNodes: [
    { type: "text/plain", part: "1.1" },
    { type: "text/html", part: "1.2" },
  ],
};

test.each(["text/plain", "text/html"])("IMAP snippets skip attached multipart trees before the %s body", (type) => {
  const body = { type, part: "2" };
  expect(findTextPart({ type: "multipart/mixed", childNodes: [attachment, body] })).toEqual(body);
});

test("a message containing only an attached multipart has no snippet body", () => {
  expect(findTextPart({ type: "multipart/mixed", childNodes: [attachment] })).toBeNull();
});

test("inline alternatives still supply the plain text body", () => {
  expect(findTextPart({ ...attachment, disposition: "inline" })?.part).toBe("1.1");
});
