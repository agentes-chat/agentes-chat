import { describe, expect, test } from "bun:test";
import { claudeCodeAliasModel, defaultModels, MODEL_CATALOG, PROVIDER_IDS } from "../src/catalog";
import { PLAN_IDS } from "../src/plans";
import {
  ALIAS_ROLES,
  API_ROLES,
  REGISTRY,
  type Registry,
  type RegistryModel,
  resolvedOn,
  resolveRoles,
  routeModels,
  sentId,
} from "../src/registry";

const ROUTES = new Set<string>([
  ...PROVIDER_IDS,
  ...PLAN_IDS.map((p) => `plan:${p}`),
  "codex",
  "cli:grok",
  "cli:antigravity",
  "cli:opencode-free",
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

describe("the model registry (models.json)", () => {
  test("every model has a name and somewhere to run, on routes that exist", () => {
    const problems = Object.entries(REGISTRY.models).flatMap(([id, m]) => [
      ...(m.label.trim() ? [] : [`${id}: no label`]),
      ...(Object.keys(m.on).length ? [] : [`${id}: runs nowhere`]),
      ...Object.keys(m.on).flatMap((route) => (ROUTES.has(route) ? [] : [`${id}: unknown route ${route}`])),
      ...(m.released === undefined || DAY.test(m.released) ? [] : [`${id}: released ${m.released}`]),
    ]);
    expect(problems).toEqual([]);
  });

  test("an API route always has prices, in USD per million tokens; a plan or a CLI never does", () => {
    const problems = Object.entries(REGISTRY.models).flatMap(([id, m]) =>
      Object.entries(m.on).flatMap(([route, r]) => {
        const api = (PROVIDER_IDS as readonly string[]).includes(route);
        // Above $1,000 per million tokens is a price typed per token, or in nano-USD.
        const odd = Object.values(r.prices ?? {}).some((v) => !(v >= 0 && v < 1000));
        return (r.prices !== undefined) === api && !odd ? [] : [`${id} on ${route}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  test("every role is one its route takes, and goes to a family that has a model there", () => {
    const held = resolveRoles();
    const problems = Object.entries(REGISTRY.roles).flatMap(([route, roles]) => {
      // Claude Code and the plans take its aliases; an API provider takes Automatic's tiers and the catalog's picks.
      const takes: readonly string[] = route === "claude-code" || route.startsWith("plan:") ? ALIAS_ROLES : API_ROLES;
      const known = route === "claude-code" || ROUTES.has(route);
      return [
        ...(known ? [] : [`roles for unknown route ${route}`]),
        ...Object.entries(roles).flatMap(([role, family]) => [
          ...(takes.includes(role) ? [] : [`${role} on ${route}: not a role there`]),
          ...(held.get(route)?.has(role as never) ? [] : [`${role} on ${route}: no ${family} model there`]),
        ]),
      ];
    });
    expect(problems).toEqual([]);
  });

  test("each family a role names has a release day on every model, never two on the same day on a route", () => {
    // A model without a day counts as the oldest, so a newer one added without it would never take the roles; a
    // tie would leave the file's order to decide.
    const problems = Object.entries(REGISTRY.roles).flatMap(([route, roles]) =>
      [...new Set(Object.values(roles))].flatMap((family) => {
        const members = routeModels(resolvedOn(route)).filter(([, m]) => m.family === family);
        const days = members.map(([, m]) => m.released);
        return [
          ...members.flatMap(([id, m]) => (m.released ? [] : [`${id} (${family}): no release day`])),
          ...(new Set(days).size === days.length ? [] : [`${family} on ${route}: two models released the same day`]),
        ];
      }),
    );
    expect(problems).toEqual([]);
  });

  test("on Claude Code and each plan, every alias runs a model of its own", () => {
    const held = resolveRoles();
    for (const route of [...PLAN_IDS.map((p) => `plan:${p}`), "claude-code"]) {
      const models = ALIAS_ROLES.flatMap((a) => held.get(route)?.get(a) ?? []);
      expect(models.filter((id, i) => models.indexOf(id) !== i)).toEqual([]);
    }
  });

  test("two models never send the same id on one route", () => {
    for (const route of ROUTES) {
      const sent = routeModels(route).map(([id, , r]) => r.id ?? id);
      expect(sent.filter((id, i) => sent.indexOf(id) !== i)).toEqual([]);
    }
  });

  test("the catalog is every API route's model, Claude's with its suggested model and its three sizes", () => {
    const rows = PROVIDER_IDS.flatMap((p) => routeModels(p));
    expect(Object.keys(MODEL_CATALOG)).toHaveLength(rows.length);
    expect(MODEL_CATALOG["claude-sonnet-5-5"]).toMatchObject({ recommended: true, tier: "medium" });
    expect(MODEL_CATALOG["claude-opus-5-5"]?.tier).toBe("large");
    expect(MODEL_CATALOG["claude-haiku-5-5"]).toMatchObject({ tier: "small", cheap: true, router: true });
    // Claude Code's aliases and the server's defaults name catalog ids, which price their calls.
    for (const alias of ALIAS_ROLES) expect(MODEL_CATALOG[claudeCodeAliasModel(alias) ?? ""]).toBeDefined();
    for (const id of Object.values(defaultModels())) expect(MODEL_CATALOG[id]).toBeDefined();
    // Prices turn into nano-USD per token: $0.006 per million tokens is 6.
    expect(MODEL_CATALOG["deepseek-flash"]?.prices.cacheRead).toBe(6);
  });
});

describe("roles follow each family's newest model", () => {
  const sonnet = (released: string, price: number): RegistryModel => ({
    label: `Sonnet ${released}`,
    family: "claude-sonnet",
    released,
    on: { anthropic: { prices: { input: price, output: price, cacheRead: price, cacheWrite: price } } },
  });
  const registry = (models: Record<string, RegistryModel>): Registry => ({
    updatedAt: "2026-11-17",
    sources: {},
    roles: {
      anthropic: { medium: "claude-sonnet", recommended: "claude-sonnet" },
      "claude-code": { sonnet: "claude-sonnet" },
      "plan:zai": { sonnet: "claude-sonnet" },
    },
    models,
  });

  test("a newer model of the family takes its roles with no other change, wherever it is in the file", () => {
    const held = resolveRoles(
      registry({ "sonnet-new": sonnet("2026-12-01", 2), "sonnet-old": sonnet("2026-09-28", 2) }),
    );
    expect(held.get("anthropic")?.get("medium")).toBe("sonnet-new");
    expect(held.get("anthropic")?.get("recommended")).toBe("sonnet-new");
    // Claude Code's alias runs Claude's API models.
    expect(held.get("claude-code")?.get("sonnet")).toBe("sonnet-new");
    const reversed = resolveRoles(
      registry({ "sonnet-old": sonnet("2026-09-28", 2), "sonnet-new": sonnet("2026-12-01", 2) }),
    );
    expect(reversed.get("anthropic")?.get("medium")).toBe("sonnet-new");
  });

  test("a route without the family's models gives the role to no one", () => {
    const held = resolveRoles(registry({ "sonnet-old": sonnet("2026-09-28", 2) }));
    expect(held.get("plan:zai")?.get("sonnet")).toBeUndefined();
  });

  test("a role names the model; what a route sends for it is its own id there", () => {
    const dated = sonnet("2026-12-01", 2);
    const models = {
      "sonnet-new": { ...dated, on: { anthropic: { ...dated.on.anthropic, id: "sonnet-new-20261201" } } },
    };
    const r = registry(models);
    expect(resolveRoles(r).get("claude-code")?.get("sonnet")).toBe("sonnet-new");
    expect(sentId("anthropic", "sonnet-new", r)).toBe("sonnet-new-20261201");
    expect(sentId("plan:zai", "sonnet-new", r)).toBe("sonnet-new");
  });
});
