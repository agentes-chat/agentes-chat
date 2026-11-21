/**
 * The model registry (ADR 0195): every model agentes.chat knows lives in `models.json`, one block each, with where
 * it runs and at what price, and `roles` says which family does what on each route. Everything else reads it: the
 * catalog (`catalog.ts`), the coding plans' model lists, Claude Code's aliases, ChatGPT's Fast mode and the CLIs'
 * fallback lists (`plans.ts`). Pure data and pure functions, like `plans.ts`: the runner and the apps import it too.
 */
import data from "./models.json";

/** USD per million tokens, as each provider publishes them (`catalog.ts` turns them into nano-USD per token). */
export interface RegistryPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A model on one route: the fields a route doesn't set come from the model. */
export interface RegistryRoute {
  /** The id this route sends, when it isn't the model's. */
  id?: string;
  label?: string;
  /** An API route's prices (`ModelInfo.prices`); a plan or a CLI has none. */
  prices?: RegistryPrices;
  intro?: { until: string; prices: RegistryPrices };
  longContext?: { aboveInputTokens: number; prices: RegistryPrices };
  offPeak?: { prices: RegistryPrices; peakHoursUtc: [number, number][] };
  contextWindow?: number;
  maxOutputTokens?: number;
  serverSideFallback?: true;
  reasoning?: true;
  leastThinking?: "off" | "minimal";
  efforts?: string[];
  structuredOutput?: false;
  /** A coding plan's: how its picker sells the model (`PlanModelTag`). */
  tag?: "cheap" | "fast" | "smart";
  /** A coding plan's: what the plan's account must allow first (`PlanModelNeed`). */
  needs?: "globalRegion" | "paidTraining" | "freeTraining";
  /** A coding plan's: it costs nothing there. */
  free?: true;
  /** `codex`: ChatGPT's Fast mode serves it. */
  fast?: true;
  /** `cli:antigravity`: the thinking levels its slugs end in (`gemini-4-argon-high`). */
  levels?: string[];
  note?: string;
}

export interface RegistryModel {
  label: string;
  /** An API provider's id (`PROVIDERS`), else the maker's name. */
  maker?: string;
  /** Its line ("claude-sonnet"): `roles` names families, and the newest of one takes its roles. */
  family?: string;
  /** The day it came out (UTC): within a family, the latest is the newest. */
  released?: string;
  contextWindow?: number;
  /** It reads text only. */
  images?: false;
  note?: string;
  /** Where it runs: an API provider's id, `commandcode`, `plan:<id>`, `codex` or `cli:<name>`. */
  on: Record<string, RegistryRoute>;
}

/** The roles on an API provider's route: Automatic's tiers and the catalog's picks. */
export const API_ROLES = ["large", "medium", "small", "recommended", "cheap", "router"] as const;
/** The roles on `claude-code` and on a coding plan: Claude Code's aliases (`fable` is Claude's own, no plan maps it). */
export const ALIAS_ROLES = ["fable", "opus", "sonnet", "haiku"] as const;
export type RegistryRole = (typeof API_ROLES)[number] | (typeof ALIAS_ROLES)[number];

export interface Registry {
  updatedAt: string;
  /** Where each route's data was read, and when. */
  sources: Record<string, string>;
  /** Per route, the family that holds each role. */
  roles: Record<string, Partial<Record<RegistryRole, string>>>;
  models: Record<string, RegistryModel>;
}

export const REGISTRY = data as unknown as Registry;

/** Routes whose roles are resolved on another route's models: Claude Code's aliases run Claude's API models. */
const RESOLVED_ON: Record<string, string> = { "claude-code": "anthropic" };

/** The route whose models hold a route's roles: itself, or the one `RESOLVED_ON` names. */
export const resolvedOn = (route: string) => RESOLVED_ON[route] ?? route;

/** The id a route sends for a model: its own `id` there, else the model's. */
export const sentId = (route: string, id: string, registry: Registry = REGISTRY) =>
  registry.models[id]?.on[route]?.id ?? id;

/** The models a route offers, in the file's order: the model's id, the model and its route. */
export function routeModels(route: string, registry: Registry = REGISTRY): [string, RegistryModel, RegistryRoute][] {
  return Object.entries(registry.models).flatMap(([id, m]) => {
    const r = m.on[route];
    return r ? [[id, m, r] as [string, RegistryModel, RegistryRoute]] : [];
  });
}

/**
 * Of a family's models on a route, the newest: the latest `released` (a model without one counts as the oldest, so
 * the registry test asks for one in every family a role names), the first in the file among equals.
 */
function newest(registry: Registry, route: string, family: string): string | null {
  let best: [string, string] | null = null;
  for (const [id, m] of routeModels(route, registry)) {
    if (m.family !== family) continue;
    const day = m.released ?? "";
    if (!best || day > best[1]) best = [id, day];
  }
  return best?.[0] ?? null;
}

/** Who holds each role on each route: the newest model of the family `roles` gives it (none when the route has none). */
export function resolveRoles(registry: Registry = REGISTRY): Map<string, Map<RegistryRole, string>> {
  const holders = new Map<string, Map<RegistryRole, string>>();
  for (const [route, roles] of Object.entries(registry.roles)) {
    const held = new Map<RegistryRole, string>();
    for (const [role, family] of Object.entries(roles) as [RegistryRole, string][]) {
      const id = newest(registry, resolvedOn(route), family);
      if (id) held.set(role, id);
    }
    holders.set(route, held);
  }
  return holders;
}

const holders = resolveRoles();

/** The model (its registry id) that holds `role` on `route`; null when the route gives the role to no family it has. */
export const roleModel = (route: string, role: RegistryRole): string | null => holders.get(route)?.get(role) ?? null;
