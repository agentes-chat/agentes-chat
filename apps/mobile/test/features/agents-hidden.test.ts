import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next from "i18next";
import { freeSections, splitHidden, type TeamLine } from "../../src/features/agents/logic";

const line = (id: string): TeamLine =>
  ({
    agent: { id, name: id, role: "" },
    work: null,
    approval: null,
    waitingCount: 0,
    at: null,
    preview: null,
  }) as unknown as TeamLine;

const free = [line("a"), line("b"), line("c")];

describe("Esconder da lista", () => {
  test("nothing hidden leaves the list as it is", () => {
    const out = splitHidden(free, new Set());
    expect(out.shown).toBe(free);
    expect(out.hidden).toEqual([]);
  });

  test("a hidden agent leaves the lists and waits in Escondidos, in the lists' order", () => {
    const out = splitHidden(free, new Set(["c", "a"]));
    expect(out.shown.map((l) => l.agent.id)).toEqual(["b"]);
    expect(out.hidden.map((l) => l.agent.id)).toEqual(["a", "c"]);
    expect(freeSections(out.shown, [], []).flatMap((s) => s.lines.map((l) => l.agent.id))).toEqual(["b"]);
  });

  test("Mostrar brings it back to its place", () => {
    const hidden = new Set(["b"]);
    expect(splitHidden(free, hidden).shown.map((l) => l.agent.id)).toEqual(["a", "c"]);
    hidden.delete("b");
    const out = splitHidden(free, hidden);
    expect(out.shown.map((l) => l.agent.id)).toEqual(["a", "b", "c"]);
    expect(out.hidden).toEqual([]);
  });

  test("an id the lists don't hold changes nothing", () => {
    expect(splitHidden(free, new Set(["gone"])).shown.map((l) => l.agent.id)).toEqual(["a", "b", "c"]);
  });

  test("the words shared with the web exist", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "pt-BR", resources, interpolation: { escapeValue: false } });
    expect(i18n.t("shell.sidebarSetup.hiddenAgents")).toBe("Escondidos");
    expect(i18n.t("shell.sidebarSetup.showAgent")).toBe("Mostrar");
    expect(i18n.t("agentGroups.undo")).toBe("Desfazer");
  });
});
