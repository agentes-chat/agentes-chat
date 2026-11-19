import { describe, expect, test } from "bun:test";
import { en, ptBR, STRINGS } from "../src/index";
import { LOCALES } from "../src/locale";
import { flatten } from "./check-locale";

/**
 * "Works on the computer of" (ADR 0202): the field's words exist in every language the repo ships (ADR 0122), say plainly
 * that on that computer the agent can do what the other one can, and never call the other agent a "lead" (the word
 * is a setor's person, ADR 0083). The phone reads these same strings.
 */
const at = (strings: Parameters<typeof flatten>[0]) => new Map(flatten(strings));

describe("the field's words", () => {
  test("English and Portuguese say what the product decided", () => {
    expect(at(en).get("worksOn.label")).toBe("Works on the computer of");
    expect(at(ptBR).get("worksOn.label")).toBe("Trabalha no computador de");
    for (const text of [at(en), at(ptBR)]) {
      expect(text.get("worksOn.tradeoff")?.length ?? 0).toBeGreaterThan(40);
    }
    expect(at(en).get("worksOn.tradeoff")?.toLowerCase()).toContain("sign-in");
    expect(at(en).get("worksOn.tradeoff")?.toLowerCase()).toContain("approval");
  });

  for (const { code } of LOCALES) {
    test(`${code} never calls the other agent a "lead"`, () => {
      for (const [k, v] of at(STRINGS[code]))
        if (k.startsWith("worksOn.")) expect(v.toLowerCase()).not.toMatch(/\blead(er)?\b/);
    });
  }
});

describe("the lock line and the empty state", () => {
  test("a linked agent whose lead is unknown reads a line with no name; the empty state is about the owner", () => {
    for (const { code } of LOCALES) {
      const text = at(STRINGS[code]);
      expect(text.get("worksOn.lockedUnknown")).toBeTruthy();
      expect(text.get("worksOn.lockedUnknown")).not.toContain("{{name}}");
    }
    expect(at(en).get("worksOn.noneEligible")).toBe("No other agent with the same owner has a computer to share.");
  });
});
