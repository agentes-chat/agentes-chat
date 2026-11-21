import { type ALIAS_ROLES, type RegistryPrices, type RegistryRole, roleModel, routeModels, sentId } from "./registry";
import type { ModelUsage } from "./types";

/**
 * Prices in nano-USD per token (1e-9 USD), i.e. USD per million tokens × 1000,
 * so every cost is an exact integer. They come from the model registry
 * (`models.json`, ADR 0195), in USD per million tokens with where and when each
 * was read. Change them there: usage records store the computed cost, so
 * history is never repriced.
 */
export interface TokenPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderInfo {
  label: string;
  /** The API it speaks, which picks its adapter (`createModelProviders`). */
  protocol: "anthropic" | "openai" | "gemini" | "openrouter" | "commandcode" | "custom";
  /** Replaces the SDK's default host. */
  baseURL?: string;
  /**
   * Another company's Anthropic-compatible endpoint, sent only what it takes
   * (`createAnthropicProvider`). `toolChoiceAny`: it honors `tool_choice: any`
   * with thinking off, so structured output can force its tool.
   */
  compat?: { toolChoiceAny: boolean };
}

/**
 * Model providers agentes.chat can talk to. Adding one is an entry here, its
 * models on its route in the model registry (`models.json`, ADR 0195), and an
 * adapter for its protocol; the database stores the provider id as text, so no
 * migration is needed.
 */
export const PROVIDERS = {
  anthropic: { label: "Claude", protocol: "anthropic" },
  openai: { label: "OpenAI", protocol: "openai" },
  gemini: { label: "Gemini", protocol: "gemini" },
  deepseek: {
    label: "DeepSeek",
    protocol: "anthropic",
    baseURL: "https://api.deepseek.com/anthropic",
    compat: { toolChoiceAny: true },
  },
  moonshot: {
    label: "Kimi",
    protocol: "anthropic",
    baseURL: "https://api.moonshot.ai/anthropic",
    compat: { toolChoiceAny: true },
  },
  // Z.ai documents only `tool_choice: auto`. MiniMax documents `any` too, untried here, so its tool isn't forced yet.
  zai: {
    label: "Z.ai",
    protocol: "anthropic",
    baseURL: "https://api.z.ai/api/anthropic",
    compat: { toolChoiceAny: false },
  },
  minimax: {
    label: "MiniMax",
    protocol: "anthropic",
    baseURL: "https://api.minimax.io/anthropic",
    compat: { toolChoiceAny: false },
  },
  // Its models come from its public list at run time (`openrouter.ts`), never from this catalog.
  openrouter: { label: "OpenRouter", protocol: "openrouter" },
  // Claude over Anthropic Messages, the rest over Chat Completions (`commandcode.ts`).
  commandcode: { label: "Command Code", protocol: "commandcode" },
  // A workspace's own endpoint (ADR 0146): its address, API style and models live on its credential (`custom.ts`).
  custom: { label: "Other provider", protocol: "custom" },
} as const satisfies Record<string, ProviderInfo>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]];

export const isKnownProvider = (id: string): id is ProviderId => Object.hasOwn(PROVIDERS, id);

export interface ModelInfo {
  provider: ProviderId;
  label: string;
  prices: TokenPrices;
  /** Lower prices the provider charges until a day (UTC, exclusive): `prices` apply from then on. */
  intro?: { until: string; prices: TokenPrices };
  /**
   * Lower prices outside the provider's peak hours (UTC, `[from, to)`, Monday to Friday; weekends are off-peak all
   * day): `prices` are the peak ones.
   */
  offPeak?: { prices: TokenPrices; peakHoursUtc: readonly (readonly [number, number])[] };
  /** Prices for the whole request when its prompt exceeds `aboveInputTokens`. */
  longContext?: { aboveInputTokens: number; prices: TokenPrices };
  /** Ask the API to retry a refused request on a fallback model (Anthropic `fallbacks: "default"`). */
  serverSideFallback: boolean;
  /** Takes a reasoning `effort` (OpenAI reasoning models). */
  reasoning?: boolean;
  /** The provider's small, cheap model (summaries, reflection). */
  cheap?: boolean;
  /**
   * The provider's pick for routing and the judge (`routerModelOf`): its fastest model with the least thinking,
   * at about US$ 0.0006 a call or less. Not always its `cheap` one: one that always thinks is slower for the same cost.
   */
  router?: boolean;
  /**
   * The least thinking the model allows, which `effort: "none"` asks for: `off` turns it off, `minimal` keeps
   * a little (it can't be turned off). Absent: `none` goes as `low`.
   */
  leastThinking?: "off" | "minimal";
  /** Suggested for new agents of that provider. */
  recommended?: boolean;
  /** Its size in the provider's line, for "Automático": each run picks a tier, mapped back to a model. */
  tier?: ModelTier;
  /** Context window in tokens (prompt + output); absent = `DEFAULT_CONTEXT_WINDOW`. */
  contextWindow?: number;
  /** The most output tokens one call may ask for; the gateway caps each call at it. */
  maxOutputTokens?: number;
  /** The reasoning efforts it takes, highest first: a request's effort goes as the nearest. Absent: any. */
  efforts?: readonly string[];
  /** It can't follow an `outputSchema`: never a pick for routing, the judge or summaries. */
  structuredOutput?: false;
  /**
   * `false`: the pickers offer it only to a workspace with its provider's key (OpenRouter's long list, Command Code's).
   * `true`: a long list's good pick, shown first, greyed without a key. Absent: a catalog model.
   */
  pick?: boolean;
  /** No prices known (a workspace's own endpoint, ADR 0146): its calls cost 0 and count tokens only. */
  unpriced?: true;
  /** A workspace endpoint's name (ADR 0146), which the pickers group its models under. */
  endpoint?: string;
}

/** The sizes "Automático" chooses between: a fast cheap model, the everyday one, the strongest. */
export type ModelTier = "small" | "medium" | "large";
export const MODEL_TIERS: readonly ModelTier[] = ["small", "medium", "large"];

/**
 * An agent's model setting that is no model: each run picks the tier and the
 * effort (`packages/engine/src/auto-model.ts`). Never sent to a provider.
 */
export const AUTO_MODEL = "auto";
export const isAutoModel = (model: string | null | undefined) => model === AUTO_MODEL;

/** Context window assumed for a model without one in the catalog: the smallest current one, so runs stay inside it. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

const toNano = (usdPerMillion: number) => Math.round(usdPerMillion * 1000);

const nanoPrices = (p: RegistryPrices): TokenPrices => ({
  input: toNano(p.input),
  output: toNano(p.output),
  cacheRead: toNano(p.cacheRead),
  cacheWrite: toNano(p.cacheWrite),
});

/** A model's id in the catalog on a provider: Command Code's carry its prefix (`commandcode.ts`). */
const catalogId = (provider: ProviderId, id: string) => (provider === "commandcode" ? `commandcode:${id}` : id);

/**
 * The API providers' models in the registry (`models.json`, ADR 0195), in `PROVIDERS`' order and then the file's,
 * with the roles the registry gives each one there. Command Code's are its long list (`pick: false`). A row without
 * prices is left out (we never make a call we can't price; the registry test fails on it), never a load error: the
 * apps and the runner import this file too.
 */
function catalogFromRegistry(): Record<string, ModelInfo> {
  const catalog: Record<string, ModelInfo> = {};
  for (const provider of PROVIDER_IDS) {
    const holds = (role: RegistryRole, id: string) => roleModel(provider, role) === id;
    for (const [id, model, r] of routeModels(provider)) {
      if (!r.prices) continue;
      const tier = MODEL_TIERS.find((t) => holds(t, id));
      const contextWindow = r.contextWindow ?? model.contextWindow;
      const long = r.longContext;
      catalog[catalogId(provider, r.id ?? id)] = {
        provider,
        label: r.label ?? model.label,
        prices: nanoPrices(r.prices),
        ...(r.intro ? { intro: { until: r.intro.until, prices: nanoPrices(r.intro.prices) } } : {}),
        ...(r.offPeak
          ? { offPeak: { prices: nanoPrices(r.offPeak.prices), peakHoursUtc: r.offPeak.peakHoursUtc } }
          : {}),
        ...(long ? { longContext: { aboveInputTokens: long.aboveInputTokens, prices: nanoPrices(long.prices) } } : {}),
        ...(contextWindow ? { contextWindow } : {}),
        ...(r.maxOutputTokens ? { maxOutputTokens: r.maxOutputTokens } : {}),
        serverSideFallback: r.serverSideFallback === true,
        ...(r.reasoning ? { reasoning: true } : {}),
        ...(r.efforts ? { efforts: r.efforts } : {}),
        ...(r.leastThinking ? { leastThinking: r.leastThinking } : {}),
        ...(r.structuredOutput === false ? { structuredOutput: false as const } : {}),
        ...(holds("cheap", id) ? { cheap: true } : {}),
        ...(holds("router", id) ? { router: true } : {}),
        ...(holds("recommended", id) ? { recommended: true } : {}),
        ...(tier ? { tier } : {}),
        ...(provider === "commandcode" ? { pick: false } : {}),
      };
    }
  }
  return catalog;
}

/** Every API provider's model, by the id calls send (`commandcode:` ones by Command Code's): read from the registry. */
export const MODEL_CATALOG: Record<string, ModelInfo> = catalogFromRegistry();

/** Models a provider lists at run time (OpenRouter's, `openrouter.ts`), beside the fixed catalog. */
let listed = new Map<string, ModelInfo>();

/** Replaces the models listed at run time. A catalog id is never shadowed. */
export function setListedModels(models: Record<string, ModelInfo>) {
  listed = new Map(Object.entries(models).filter(([id]) => !Object.hasOwn(MODEL_CATALOG, id)));
}

/**
 * A workspace's own endpoint's models (ADR 0146), by organization, under ids `custom:<credentialId>:<model>`: the
 * credential in the id keeps two workspaces' models (and the catalog's ids) apart. Never in `listedModels`.
 */
let custom = new Map<string, Map<string, ModelInfo>>();
/**
 * Every endpoint model this process has loaded, kept after it is removed or its key revoked: a call already running
 * still settles its cost by it. Only `modelInfo` reads it; who may call a model is `customModelOf`.
 */
const lastKnown = new Map<string, ModelInfo>();
const CUSTOM_ID = /^custom:([0-9a-f-]{36}):(.+)$/;

export const customModelId = (credentialId: string, model: string) => `custom:${credentialId}:${model}`;

/** The credential and the endpoint's own model id of a `custom:` id; null for any other id. */
export function parseCustomModel(id: string): { credentialId: string; model: string } | null {
  const m = CUSTOM_ID.exec(id);
  return m?.[1] && m[2] ? { credentialId: m[1], model: m[2] } : null;
}

export const isCustomModel = (id: string) => CUSTOM_ID.test(id);

/** Agents work by tool calls: a model that made one first, then an untested one, then one that only talked, then failed. */
const CHECK_RANK = { ok: 0, unchecked: 1, no_tools: 2, failed: 3 } as const;

/**
 * The one endpoint model an agent runs when nothing names one (Automático on an endpoint key, or a key just connected),
 * as its `custom:` id: the best last test (`CHECK_RANK`), the admin's order among equals. Null when it offers none.
 */
export function endpointModelId(
  credentialId: string,
  models: readonly { id: string; check?: "ok" | "no_tools" | "failed" | null }[],
): string | null {
  let best: (typeof models)[number] | undefined;
  for (const m of models) {
    if (!best || CHECK_RANK[m.check ?? "unchecked"] < CHECK_RANK[best.check ?? "unchecked"]) best = m;
  }
  return best ? customModelId(credentialId, best.id) : null;
}

/** Replaces an organization's endpoint models (full ids); an empty record forgets them. */
export function setCustomModels(orgId: string, models: Record<string, ModelInfo>) {
  custom = new Map(custom);
  for (const [id, info] of Object.entries(models)) lastKnown.set(id, info);
  if (Object.keys(models).length === 0) custom.delete(orgId);
  else custom.set(orgId, new Map(Object.entries(models)));
}

/** An organization's endpoint models, in the order they were set. */
export const customModelsOf = (orgId: string): [string, ModelInfo][] => [...(custom.get(orgId) ?? [])];

/** One endpoint model of this organization; undefined for another workspace's. */
export const customModelOf = (orgId: string, id: string) => custom.get(orgId)?.get(id);

/**
 * A model of the catalog, of a list read at run time or of an endpoint loaded in this process (also one removed
 * since, for the cost of a call still running); undefined for any other id.
 */
export function modelInfo(model: string): ModelInfo | undefined {
  if (Object.hasOwn(MODEL_CATALOG, model)) return MODEL_CATALOG[model];
  return isCustomModel(model) ? lastKnown.get(model) : listed.get(model);
}

/** Every model: the catalog's, then the listed ones in their list's order. */
export const listedModels = (): [string, ModelInfo][] => [...Object.entries(MODEL_CATALOG), ...listed];

/**
 * The model a provider's system tasks use (summaries, reflection): its cheap
 * one, else its recommended one (a line with no small model, like Kimi's).
 */
export function cheapModelOf(provider: string): string | null {
  const own = listedModels().filter(([, m]) => m.provider === provider);
  return (own.find(([, m]) => m.cheap) ?? own.find(([, m]) => m.recommended))?.[0] ?? null;
}

/** The provider's model for routing and the judge, never a large one: null for a line with none (Kimi). */
export function routerModelOf(provider: string): string | null {
  return listedModels().find(([, m]) => m.provider === provider && m.router)?.[0] ?? null;
}

/**
 * Of one provider's models, the one for a tier: that tier, else the nearest
 * smaller one (a line without a large model answers with its medium one), else
 * the nearest larger. The apps label Automático's defaults with it too.
 */
export function nearestTier<T>(
  models: readonly T[],
  tier: ModelTier,
  tierOf: (model: T) => ModelTier | undefined,
): T | undefined {
  const at = MODEL_TIERS.indexOf(tier);
  for (const t of [...MODEL_TIERS.slice(0, at + 1).reverse(), ...MODEL_TIERS.slice(at + 1)]) {
    const hit = models.find((m) => tierOf(m) === t);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** A provider's model for a tier (`nearestTier`); null when the provider has no tiered model. */
export function modelForTier(provider: string, tier: ModelTier): string | null {
  const own = listedModels().filter(([, m]) => m.provider === provider);
  return nearestTier(own, tier, ([, m]) => m.tier)?.[0] ?? null;
}

/** The model's context window in tokens (`DEFAULT_CONTEXT_WINDOW` when the catalog doesn't say). */
export const contextWindowOf = (model: string) => modelInfo(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

export const isKnownModel = (model: string) => modelInfo(model) !== undefined;

/** The catalog id of a model a CLI named (`claude-opus-5-5[1m]`, a dated `…-20261001`); null when it has no price. */
export function catalogModelOf(model: string | null | undefined): string | null {
  const base = model?.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  return base && isKnownModel(base) ? base : null;
}

/** A model's prices, or a throw: we never make a call we can't price. */
function infoOf(model: string): ModelInfo {
  const info = modelInfo(model);
  if (!info) throw new Error(`unknown model ${model}`);
  return info;
}

/** What a 1-hour cache write costs, in times the input price (Anthropic's extended TTL; only Claude is asked for one). */
export const LONG_CACHE_WRITE = 2;

const tokensCost = (p: TokenPrices, u: ModelUsage) =>
  u.inputTokens * p.input +
  u.outputTokens * p.output +
  u.cacheReadTokens * p.cacheRead +
  u.cacheWriteTokens * p.cacheWrite +
  (u.cacheWriteLongTokens ?? 0) * (LONG_CACHE_WRITE * p.input - p.cacheWrite);

/**
 * What a call made at `at` pays per token: the introductory prices before their day, the off-peak ones outside
 * the peak hours. Budget reservations
 * (`maxCostNanoUsd`, `outputTokensWithin`) keep the list prices on purpose, so they err high while a lower price
 * lasts; give them `at` too if that ever stops agents early.
 */
export const pricesAt = (info: ModelInfo, at = new Date()) => {
  if (info.intro && at.getTime() < Date.parse(info.intro.until)) return info.intro.prices;
  return info.offPeak && !atPeak(info.offPeak.peakHoursUtc, at) ? info.offPeak.prices : info.prices;
};

const atPeak = (hours: readonly (readonly [number, number])[], at: Date) => {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day !== 0 && day !== 6 && hours.some(([from, to]) => hour >= from && hour < to);
};

/**
 * Cost in nano-USD of one call made at `at`. Throws for models outside the catalog (we never make a call we
 * can't price).
 */
export function costNanoUsd(model: string, usage: ModelUsage, at = new Date()): number {
  const info = infoOf(model);
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return tokensCost(
    info.longContext && prompt > info.longContext.aboveInputTokens ? info.longContext.prices : pricesAt(info, at),
    usage,
  );
}

/**
 * Many calls' tokens added up, at the base prices: a sum's prompt says nothing about any one call's, so it
 * never crosses a long-context threshold. Throws for models outside the catalog.
 */
export function summedCostNanoUsd(model: string, usage: ModelUsage): number {
  return tokensCost(infoOf(model).prices, usage);
}

/**
 * Upper bound of a call's cost, for budget reservations: every prompt token at
 * the most expensive input rate (a cache write, a 1-hour one with `longCache`), every allowed output token
 * at the output rate, long-context prices when the prompt may cross the threshold.
 */
export function maxCostNanoUsd(
  model: string,
  promptTokens: number,
  maxOutputTokens: number,
  longCache = false,
): number {
  const info = infoOf(model);
  const p =
    info.longContext && promptTokens > info.longContext.aboveInputTokens ? info.longContext.prices : info.prices;
  const write = longCache ? Math.max(p.cacheWrite, LONG_CACHE_WRITE * p.input) : p.cacheWrite;
  return promptTokens * Math.max(p.input, write) + maxOutputTokens * p.output;
}

/** Output tokens that fit in `nanoUsd` after paying for the prompt (worst case), or 0. */
export function outputTokensWithin(model: string, promptTokens: number, nanoUsd: number, longCache = false): number {
  const info = infoOf(model);
  const p =
    info.longContext && promptTokens > info.longContext.aboveInputTokens ? info.longContext.prices : info.prices;
  const write = longCache ? Math.max(p.cacheWrite, LONG_CACHE_WRITE * p.input) : p.cacheWrite;
  const left = nanoUsd - promptTokens * Math.max(p.input, write);
  return left <= 0 ? 0 : Math.floor(left / p.output);
}

export const nanoUsdToUsd = (nano: number) => nano / 1e9;
export const usdToNanoUsd = (usd: number) => Math.round(usd * 1e9);

/**
 * The Claude model behind Claude Code's alias (`opus` → the newest Opus in the registry), by the id Claude's route
 * sends (its catalog id), for its price and name.
 */
export function claudeCodeAliasModel(alias: (typeof ALIAS_ROLES)[number]): string | null {
  const id = roleModel("claude-code", alias);
  return id ? sentId("anthropic", id) : null;
}

function required(model: string | null, what: string): string {
  if (!model) throw new Error(`models.json names no ${what}`);
  return model;
}

/**
 * What the server runs where its environment names no model (`ROUTER_MODEL`, `SUMMARY_MODEL`, `OPENAI_CHEAP_MODEL`):
 * the registry's picks. Only the server asks, so it refuses to start when the registry names none; the apps never do.
 */
export function defaultModels() {
  return {
    claudeRouter: required(routerModelOf("anthropic"), "routing model for Claude"),
    claudeCheap: required(cheapModelOf("anthropic"), "cheap Claude model"),
    openaiCheap: required(cheapModelOf("openai"), "cheap OpenAI model"),
  };
}
