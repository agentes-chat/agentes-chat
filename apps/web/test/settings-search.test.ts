import { describe, expect, test } from "bun:test";
import { searchSettings, shownText } from "../src/pages/settings-search";

const strings: Record<string, unknown> = {
  vault: { title: "Cofre", item: { password: "Senha de {{name}}" } },
  "settings.timezone": "Fuso horário",
  "settings.timezoneHelp": "O <b>fuso</b> dos lembretes",
};
const resource = (key: string) => strings[key];
const sections = [
  { id: "general" as const, name: "Workspace" },
  { id: "vault" as const, name: "Cofre" },
];

describe("settings search", () => {
  test("finds what was typed, as typed, upper and lower case aside", () => {
    expect(searchSettings("FUSO", sections, resource)).toEqual([
      { section: "general", text: "Fuso horário" },
      { section: "general", text: "O fuso dos lembretes" },
    ]);
  });
  test("no fuzzy match: a letter off finds nothing", () => {
    expect(searchSettings("fsuo", sections, resource)).toEqual([]);
  });
  test("the section's own name comes first, placeholders out", () => {
    expect(searchSettings("cofre", sections, resource)[0]).toEqual({ section: "vault", text: "Cofre" });
    expect(searchSettings("senha", sections, resource)).toEqual([{ section: "vault", text: "Senha de …" }]);
  });
  test("nothing typed, nothing found", () => {
    expect(searchSettings("   ", sections, resource)).toEqual([]);
    expect(shownText("  a  <b>b</b> ")).toBe("a b");
  });
  test("indexes English fallback text for each untranslated key in a translated section", () => {
    const fallbackResource = (key: string) =>
      key === "vault" ? { title: "Vault", item: { password: "Password", hint: "Choose a secret" } } : undefined;
    expect(searchSettings("Choose a secret", sections, resource, { fallbackResource })).toEqual([
      { section: "vault", text: "Choose a secret" },
    ]);
    expect(searchSettings("Password", sections, resource, { fallbackResource })).toEqual([]);
  });
});
