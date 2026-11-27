import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import {
  areaAgentInput,
  areasFor,
  CUSTOM_LOOK,
  FIRST_AREAS,
  isFirstArea,
  MAILBOX_APP,
  nextAreas,
  openAreaRoutine,
  PERSONAL_AREAS,
  TEAM_AREAS,
  workspaceNameOf,
} from "../src/lib/first-areas";
import { RIGHT_HAND_DEFAULT } from "../src/lib/right-hand";

/*
 * The onboarding's first agent by the work it does (ADR 0256, addendum of 2026-11-27): a team's areas and a personal
 * workspace's, each one agent with its name, look and apps; the agent the work step makes; the routine of work that
 * starts with no app; and the workspace's name, read from the work e-mail (ADR 0162, the name step folded in).
 */

const translator = (lng: string): TFunction => {
  const instance = i18next.createInstance();
  void instance.init({ lng, fallbackLng: "en", resources, initAsync: false });
  return instance.t;
};
const pt = translator("pt-BR");

describe("the areas (FIRST_AREAS)", () => {
  test("a team's six and a personal workspace's six, each list in its own order", () => {
    expect(areasFor(false)).toEqual(TEAM_AREAS);
    expect(areasFor(true)).toEqual(PERSONAL_AREAS);
    expect(TEAM_AREAS).toEqual(["support", "sales", "finance", "marketing", "day", "tech"]);
    expect(PERSONAL_AREAS).toEqual(["life", "freelance", "study", "travel", "home", "health"]);
  });

  test("each one its own agent: a name of its own on its list, apps to work in, never the right hand's headset", () => {
    for (const list of [TEAM_AREAS, PERSONAL_AREAS]) {
      const names = list.map((a) => FIRST_AREAS[a].name);
      expect(new Set(names).size).toBe(names.length);
    }
    for (const [id, def] of Object.entries(FIRST_AREAS)) {
      expect({ id, same: def.id as string }).toEqual({ id, same: id });
      expect({ id, apps: def.apps.length > 0 }).toEqual({ id, apps: true });
      expect({ id, accessory: def.look.accessory }).not.toEqual({
        id,
        accessory: RIGHT_HAND_DEFAULT.appearance.accessory,
      });
    }
    expect(CUSTOM_LOOK.accessory).not.toBe(RIGHT_HAND_DEFAULT.appearance.accessory);
  });

  test("only marketing starts with no app: the internet is enough, on its own routine", () => {
    expect(
      Object.values(FIRST_AREAS)
        .filter((d) => d.open)
        .map((d) => d.id),
    ).toEqual(["marketing"]);
  });

  test("an area is a known key, never anything else ('custom' is Other's, not an area)", () => {
    expect(isFirstArea("support")).toBe(true);
    expect(isFirstArea("health")).toBe(true);
    expect(isFirstArea("custom")).toBe(false);
    expect(isFirstArea("toString")).toBe(false);
    expect(isFirstArea(null)).toBe(false);
  });

  test("the places the next agents take around the first one: four other areas of its list", () => {
    expect(nextAreas(false, "marketing")).toEqual(["sales", "finance", "tech", "support"]);
    expect(nextAreas(false, "support")).toEqual(["sales", "finance", "marketing", "tech"]);
    // "My day", or an agent with no area, takes none of them.
    expect(nextAreas(false, "day")).toEqual(["sales", "finance", "marketing", "tech"]);
    expect(nextAreas(false, null)).toEqual(["sales", "finance", "marketing", "tech"]);
    expect(nextAreas(true, "life")).toEqual(["freelance", "study", "travel", "home"]);
    expect(nextAreas(true, "study")).toEqual(["freelance", "travel", "home", "health"]);
  });
});

describe("the agent the work step makes (areaAgentInput)", () => {
  test("the area's agent in the person's language, its apps without the mailbox (connected through mail)", () => {
    const input = areaAgentInput(pt, "support", "Acme");
    expect(input).toEqual({
      area: "support",
      name: "Iara",
      role: "Atendimento",
      instructions: pt("onboarding.areas.list.support.instructions"),
      appearance: FIRST_AREAS.support.look,
      task: "Leia os e-mails dos últimos 7 dias, diga quantos pedem resposta e deixe um rascunho pronto para os de hoje.",
      apps: ["zendesk", "intercom"],
    });
    expect(input.apps).not.toContain(MAILBOX_APP);
  });

  test("the workspace's name in what it does", () => {
    const input = areaAgentInput(pt, "marketing", "Acme");
    expect(input.name).toBe("Gabi");
    expect(input.instructions).toContain("o que falam da Acme na internet");
    expect(input.task).toContain("o que falaram da Acme na internet");
  });
});

describe("work that starts with no app (openAreaRoutine)", () => {
  const pick = { agentId: "a-gabi", timezone: "America/Sao_Paulo", today: "2026-11-27" };

  test("its template's routine in the person's DM, on the area's weekdays and hour, from today in its zone", () => {
    const routine = openAreaRoutine(pt, "marketing", pick);
    expect(routine).toMatchObject({
      name: pt("routines.presets.mentions.name"),
      agentId: "a-gabi",
      prompt: pt("routines.presets.mentions.prompt"),
      target: { type: "dm" },
      report: "when_new",
      trigger: {
        type: "schedule",
        rule: {
          freq: "daily",
          interval: 1,
          times: ["09:00"],
          timezone: "America/Sao_Paulo",
          start: "2026-11-27",
          until: null,
          count: null,
          byWeekday: ["MO", "TU", "WE", "TH", "FR"],
        },
      },
    });
  });

  test("an area whose routine an app brings has none of its own", () => {
    for (const area of ["support", "finance", "tech", "life", "health"] as const)
      expect(openAreaRoutine(pt, area, pick)).toBeNull();
  });
});

describe("the workspace's name from the work e-mail (workspaceNameOf)", () => {
  test("a company's domain: its own label, capitalized, past a country's second level", () => {
    expect(workspaceNameOf("ana@acme.com.br", "Ana Souza")).toBe("Acme");
    expect(workspaceNameOf("ana@acme.com", "Ana Souza")).toBe("Acme");
    expect(workspaceNameOf("ana@mail.acme.com.br", "Ana Souza")).toBe("Acme");
    expect(workspaceNameOf("ana@acme.co.uk", "Ana Souza")).toBe("Acme");
    expect(workspaceNameOf("Ana@ACME.COM.BR", "Ana Souza")).toBe("Acme");
    // Words joined by a dash are words.
    expect(workspaceNameOf("caio@acme-saude.com.br", "Caio")).toBe("Acme Saude");
  });

  test("a webmail address names a person, not a company: the person's first name", () => {
    expect(workspaceNameOf("ana.souza@gmail.com", "Ana Souza")).toBe("Ana");
    expect(workspaceNameOf("ana@outlook.com.br", "Ana Souza")).toBe("Ana");
    expect(workspaceNameOf("leo@uol.com.br", "Léo Martins")).toBe("Léo");
    expect(workspaceNameOf("nina@icloud.com", "  Nina  ")).toBe("Nina");
  });

  test("an address with no domain to read: the first name, else nothing", () => {
    expect(workspaceNameOf("ana@localhost", "Ana Souza")).toBe("Ana");
    expect(workspaceNameOf("", "Ana Souza")).toBe("Ana");
    expect(workspaceNameOf("ana@gmail.com", "")).toBe("");
  });
});
