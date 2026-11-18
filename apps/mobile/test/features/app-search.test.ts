import { describe, expect, test } from "bun:test";
import type { OrgSummary } from "@agenteschat/client";
import { findAgents } from "../../src/features/agents/logic";
import { destinations, findDestinations } from "../../src/features/search/destinations";
import { translator } from "./fixtures";

/** A membership holding exactly these permission keys. */
const member = (permissions: string[]) => ({ permissions }) as unknown as OrgSummary;
const admin = member([
  "read",
  "configure",
  "invite_people",
  "manage_roles",
  "manage_agents",
  "create_agents",
  "view_audit",
]);
const wiki = [{ slug: "processos/onboarding", title: "Onboarding de clientes", folder: "Processos", tags: ["vendas"] }];

describe("Agentes' search", () => {
  const agents = [
    { name: "Ána", handle: "ana", role: "Atendimento" },
    { name: "Bruno", handle: "dev-bruno", role: "Engenharia de dados" },
  ];
  test("by name, @ and role, ignoring case and accents; no words keeps everyone", () => {
    expect(findAgents(agents, "ANA").map((a) => a.handle)).toEqual(["ana"]);
    expect(findAgents(agents, "dev-").map((a) => a.handle)).toEqual(["dev-bruno"]);
    expect(findAgents(agents, " @ana").map((a) => a.handle)).toEqual(["ana"]);
    expect(findAgents(agents, "engenharia").map((a) => a.handle)).toEqual(["dev-bruno"]);
    expect(findAgents(agents, "  ")).toEqual(agents);
    expect(findAgents(agents, "ninguém")).toEqual([]);
  });
});

describe("Busca's places", () => {
  test("screens, settings sections and wiki pages, found by name in the person's language", async () => {
    const t = await translator("pt-BR");
    const all = destinations(t, admin, wiki);
    const keys = (q: string) => findDestinations(q, all, 50).map((d) => d.key);
    expect(keys("rotinas")).toContain("g:routines");
    expect(keys("painéis")).toContain("g:dashboards");
    expect(keys("paineis")).toContain("g:dashboards");
    expect(keys("aprovações")).toContain("g:approvals");
    expect(keys("onboarding")).toEqual(["w:processos/onboarding"]);
    expect(all.find((d) => d.key === "w:processos/onboarding")?.href).toBe("/wiki/processos%2Fonboarding");
    expect(keys("auditoria")).toContain("s:audit");
  });

  test("by what they hold too, a name's match first, and every word must be there", async () => {
    const t = await translator("pt-BR");
    const all = destinations(t, admin, wiki);
    const found = findDestinations("cota", all, 50).map((d) => d.key);
    expect(found).toEqual(["s:usage"]);
    expect(findDestinations("vendas", all).map((d) => d.key)).toEqual(["w:processos/onboarding"]);
    // "uso" names IA e uso and is in other sections' words: the name comes first.
    expect(findDestinations("uso", all, 50)[0]?.key).toBe("s:usage");
    expect(findDestinations("ia uso", all, 50).map((d) => d.key)).toContain("s:usage");
    expect(findDestinations("rotinas zzz", all)).toEqual([]);
    expect(findDestinations("", all)).toEqual([]);
  });

  test("only the settings this membership opens; English ids find them in any language", async () => {
    const t = await translator("en");
    const plain = destinations(t, member(["read"]));
    const sections = plain.filter((d) => d.key.startsWith("s:")).map((d) => d.key);
    expect(sections).not.toContain("s:audit");
    expect(sections).not.toContain("s:roles");
    expect(sections).toContain("s:usage");
    expect(findDestinations("audit", plain)).toEqual([]);
    expect(findDestinations("quota", plain).map((d) => d.key)).toEqual(["s:usage"]);
    expect(findDestinations("drive", plain).map((d) => d.href)).toEqual(["/drive"]);
    expect(findDestinations("agents", plain).find((d) => d.key === "g:agents")?.tab).toBe(true);
  });

  test("at most a few, so the conversations stay in sight", async () => {
    const t = await translator("en");
    expect(findDestinations("e", destinations(t, admin, wiki)).length).toBeLessThanOrEqual(6);
  });
});
