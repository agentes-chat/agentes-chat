import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import type { MemberPresence, OrgRole } from "../src/api/types";
import { isAgentOff, memberGroups } from "../src/lib/member-groups";
import { agentOffLine } from "../src/lib/presence";

const role = (id: string, position: number, hoist = true): OrgRole => ({
  id,
  kind: "custom",
  name: id,
  icon: "shield",
  color: "indigo",
  position,
  permissions: [],
  mentionable: false,
  hoist,
  people: 0,
  editable: false,
  givable: false,
});
const everyone: OrgRole = { ...role("everyone", 99), kind: "everyone" };
const person = (userId: string, roleIds: string[] = [], owner = false) => ({
  userId,
  name: userId,
  role: owner ? ("owner" as const) : ("member" as const),
  roleIds,
});

const presence: Record<string, MemberPresence> = {
  heitor: "online",
  walter: "busy",
  caio: "online",
  bia: "away",
  lara: "offline",
  davi: "hidden",
  ivo: "offline",
};

const group = (opts: Partial<Parameters<typeof memberGroups>[0]> = {}) =>
  memberGroups({
    people: [
      person("lara", ["admin"]),
      person("caio", ["comercial", "admin"]),
      person("bia"),
      person("heitor", ["admin"], true),
      person("davi"),
      person("walter", ["admin"]),
      person("ivo", [], true),
    ],
    agents: [
      { id: "rui", name: "Rui" },
      { id: "theo", name: "Theo" },
      { id: "ada", name: "Ada" },
    ],
    roles: [role("comercial", 2), role("admin", 0), role("quiet", 1, false), everyone],
    presenceOf: (id) => presence[id],
    busy: (id) => id === "theo",
    ...opts,
  });

const ids = (g: ReturnType<typeof group>[number]) =>
  g.rows.map((r) => (r.kind === "person" ? r.person.userId : r.agent.id));

describe("memberGroups", () => {
  test("owner first, hoisted roles top first, agents, online, offline", () => {
    const groups = group();
    expect(groups.map((g) => g.key)).toEqual(["owner", "role:admin", "agents", "online", "offline"]);
    expect(groups.map(ids)).toEqual([
      ["heitor"],
      ["caio", "walter"],
      ["theo", "ada", "rui"],
      ["bia"],
      ["davi", "ivo", "lara"],
    ]);
    expect(groups[1]?.role?.id).toBe("admin");
  });

  test("the highest hoisted role wins and a person shows once", () => {
    const groups = group({ roles: [role("comercial", 0), role("admin", 1)] });
    expect(groups.map((g) => [g.key, ids(g)])).toContainEqual(["role:comercial", ["caio"]]);
    expect(groups.map((g) => [g.key, ids(g)])).toContainEqual(["role:admin", ["walter"]]);
    expect(groups.flatMap(ids).filter((id) => id === "caio")).toHaveLength(1);
  });

  test("offline people only under Offline, a hidden one too, an offline owner as well", () => {
    const offline = group().find((g) => g.key === "offline");
    expect(offline && ids(offline)).toEqual(["davi", "ivo", "lara"]);
  });

  test("a role that isn't hoisted and the base role never get a group; empty groups are left out", () => {
    const groups = group({ agents: [], roles: [role("quiet", 0, false), { ...everyone, hoist: true }] });
    expect(groups.map((g) => g.key)).toEqual(["owner", "online", "offline"]);
    expect(ids(groups[1] as (typeof groups)[number])).toEqual(["bia", "caio", "walter"]);
  });

  test("an agent that is off sits under Offline with the people there, by name, and leaves Agentes", () => {
    const groups = group({ agentOff: (id) => id === "rui" || id === "ada" });
    const of = (key: string) => groups.find((g) => g.key === key);
    expect(groups.map((g) => g.key)).toEqual(["owner", "role:admin", "agents", "online", "offline"]);
    expect(ids(of("agents") as (typeof groups)[number])).toEqual(["theo"]);
    expect(ids(of("offline") as (typeof groups)[number])).toEqual(["ada", "davi", "ivo", "lara", "rui"]);
  });

  test("off: out of office, paused or with no AI; away or at work isn't", () => {
    expect(isAgentOff("out")).toBe(true);
    expect(isAgentOff("offline")).toBe(true);
    expect(isAgentOff("away", { kind: "out_of_budget" })).toBe(true);
    expect(isAgentOff("away", null)).toBe(false);
    expect(isAgentOff("busy", { kind: "coding" })).toBe(false);
  });
});

test("an agent that is off says why under its name: its own line, short, else paused or with no AI", () => {
  const i18n = i18next.createInstance();
  void i18n.init({ lng: "pt-BR", fallbackLng: "en", resources, initAsync: false });
  const t = i18n.t.bind(i18n) as TFunction;
  const line = {
    by: "auto" as const,
    text: null,
    kind: "out_of_plan" as const,
    subject: null,
    emoji: null,
    until: null,
  };
  expect(agentOffLine(t, { presence: "out", line, noAi: false })).toBe("Sem limite");
  expect(agentOffLine(t, { presence: "offline", line: null, noAi: false })).toBe("Pausado");
  expect(agentOffLine(t, { presence: "offline", line: null, noAi: true })).toBe("Sem IA conectada");
  expect(agentOffLine(t, { presence: "out", line: null, noAi: false })).toBe(
    "Sem limite agora · responde quando renovar",
  );
});
