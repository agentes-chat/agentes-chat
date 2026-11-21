import { expect, test } from "bun:test";
import { parseAddressList } from "../src/composio-mail";

test("escaped quotes in a display name do not split or swallow recipients", () => {
  expect(parseAddressList(String.raw`"Doe \"Jane, JD\"" <jane@example.com>, bob@example.com`)).toEqual([
    { name: 'Doe "Jane, JD"', address: "jane@example.com" },
    { address: "bob@example.com" },
  ]);
});

test("quoted pairs decode once and a following address remains separate", () => {
  expect(parseAddressList(String.raw`"C:\\Work, Team" <team@example.com>; next@example.com`)).toEqual([
    { name: String.raw`C:\Work, Team`, address: "team@example.com" },
    { address: "next@example.com" },
  ]);
  expect(parseAddressList('"Last, First" <first@example.com>, next@example.com')).toEqual([
    { name: "Last, First", address: "first@example.com" },
    { address: "next@example.com" },
  ]);
});
