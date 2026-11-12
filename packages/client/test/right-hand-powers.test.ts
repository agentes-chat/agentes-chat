import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RIGHT_HAND_POWERS } from "../src/lib/right-hand";

test("every power the page lists stands on a grant the server gives the right hand", () => {
  const source = readFileSync(new URL("../../engine/src/right-hand.ts", import.meta.url), "utf8");
  const list = /RIGHT_HAND_GRANTS: readonly string\[\] = \[([\s\S]*?)\.\.\.\[([\s\S]*?)\]\.map/.exec(source);
  const given = new Set(list?.[1]?.match(/"[a-z]+:[a-z]+"/g)?.map((s) => s.slice(1, -1)));
  expect(given.size).toBeGreaterThan(0);
  for (const power of RIGHT_HAND_POWERS) for (const grant of power.grants) expect(given.has(grant)).toBe(true);
  expect(source).toContain("export const rightHandReaches");
});
