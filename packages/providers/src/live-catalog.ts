import {
  MODEL_CATALOG,
  type ModelInfo,
  type ProviderId,
  REQUEST_EFFORTS,
  type RequestEffort,
  setLiveCatalogModels,
  xaiLiveEffortsOf,
} from "./catalog";
import { learnFastModels } from "./plans";

/**
 * Live public model catalog (`https://models.dev/api.json`, ADR 0198): keeps new frontier models, context limits,
 * pricing, fast modes, and supported reasoning efforts up to date automatically at run time while preserving static
 * `MODEL_CATALOG` as an offline fallback. Disabled by default so unit tests stay deterministic; `enableLiveCatalog`
 * turns it on at server startup.
 */
export const MODELS_DEV_URL = "https://models.dev/api.json";

const LIVE_CATALOG_TTL_MS = 60 * 60_000;
const LIVE_CATALOG_RETRY_MS = 5 * 60_000;
const LIVE_CATALOG_TIMEOUT_MS = 10_000;
const LIVE_CATALOG_MAX_BYTES = 16 * 1024 * 1024;
const MAX_NEW_PER_PROVIDER = 12;

const PROVIDER_MAP: Readonly<Record<string, ProviderId>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  deepseek: "deepseek",
  moonshotai: "moonshot",
  zai: "zai",
  minimax: "minimax",
};

interface RawCostTier {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tier?: { type?: string; size?: number };
}

interface RawReasoningOption {
  type?: string;
  values?: unknown[];
}

interface RawModelEntry {
  id?: string;
  name?: string;
  status?: string | null;
  tool_call?: boolean;
  reasoning?: boolean;
  reasoning_options?: RawReasoningOption[] | null;
  release_date?: string;
  modalities?: { input?: unknown[]; output?: unknown[] };
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: RawCostTier[];
  } | null;
  experimental?: { modes?: Record<string, unknown> } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRequestEffort = (v: string): v is RequestEffort => (REQUEST_EFFORTS as readonly string[]).includes(v);
const nanoPerToken = (usdPerMillion: unknown, fallback = 0) =>
  typeof usdPerMillion === "number" && Number.isFinite(usdPerMillion) && usdPerMillion >= 0
    ? Math.round(usdPerMillion * 1000)
    : fallback;

const DATE_SNAPSHOT_ID = /-20\d{6}$|-\d{8}$|-latest$/;

function extractEfforts(raw: RawModelEntry): RequestEffort[] | undefined {
  if (raw.reasoning === false) return [];
  const opts = Array.isArray(raw.reasoning_options) ? raw.reasoning_options : [];
  let hasToggle = false;
  let values: RequestEffort[] | undefined;
  for (const opt of opts) {
    if (!opt || typeof opt !== "object") continue;
    if (opt.type === "toggle") hasToggle = true;
    if (opt.type === "effort" && Array.isArray(opt.values)) {
      values = opt.values.filter((v): v is string => typeof v === "string").filter(isRequestEffort);
    }
  }
  if (!values || values.length === 0) return undefined;
  const out = [...values];
  if (hasToggle && !out.includes("none")) out.unshift("none");
  return out;
}

function isTextChatToolModel(id: string, raw: RawModelEntry): boolean {
  if (raw.tool_call !== true) return false;
  const out = Array.isArray(raw.modalities?.output) ? raw.modalities.output : [];
  if (out.length !== 1 || out[0] !== "text") return false;
  if (!raw.cost || typeof raw.cost.input !== "number" || typeof raw.cost.output !== "number") return false;
  if (/(embedding|whisper|tts|realtime|transcribe|search|research|image|audio|video)/i.test(id)) return false;
  return true;
}

export interface ParsedLiveCatalog {
  active: [string, ModelInfo][];
  known: Map<string, ModelInfo>;
  xaiEfforts: Map<string, RequestEffort[]>;
  fastModels: string[];
}

/** Parses `models.dev/api.json` into active frontier picker rows, full known lookup, xAI efforts, and Fast models. */
export function parseModelsDevCatalog(data: unknown): ParsedLiveCatalog {
  const active: [string, ModelInfo][] = [];
  const known = new Map<string, ModelInfo>();
  const xaiEfforts = new Map<string, RequestEffort[]>();
  const fastModels: string[] = [];

  if (!isRecord(data)) return { active, known, xaiEfforts, fastModels };

  // Extract xAI (`grok-*`) reasoning efforts even though xAI uses Grok Build CLI rather than API key catalog.
  const xaiRaw = isRecord(data.xai) && isRecord(data.xai.models) ? data.xai.models : null;
  if (xaiRaw) {
    for (const [id, entry] of Object.entries(xaiRaw)) {
      if (!isRecord(entry)) continue;
      const efforts = extractEfforts(entry as RawModelEntry);
      if (efforts && efforts.length > 0) xaiEfforts.set(id, efforts);
    }
  }

  for (const [sourceKey, providerId] of Object.entries(PROVIDER_MAP)) {
    const providerRaw = data[sourceKey];
    if (!isRecord(providerRaw) || !isRecord(providerRaw.models)) continue;
    const rows = Object.entries(providerRaw.models)
      .filter((entry): entry is [string, RawModelEntry] => isRecord(entry[1]))
      .sort((a, b) => (b[1].release_date ?? "").localeCompare(a[1].release_date ?? ""));

    let addedForProvider = 0;
    for (const [rawId, m] of rows) {
      const id = m.id?.trim() || rawId.trim();
      if (!id) continue;
      const rawOut = m.cost?.output;
      const rawIn = m.cost?.input;
      if (!m.cost || typeof rawIn !== "number" || typeof rawOut !== "number") continue;

      const input = nanoPerToken(rawIn);
      const output = nanoPerToken(rawOut);
      const cacheRead = nanoPerToken(m.cost.cache_read, 0);
      const rawCacheWrite = m.cost.cache_write;
      const cacheWrite =
        typeof rawCacheWrite === "number" && Number.isFinite(rawCacheWrite) && rawCacheWrite > 0
          ? nanoPerToken(rawCacheWrite)
          : input;

      const contextTier = Array.isArray(m.cost.tiers)
        ? m.cost.tiers.find(
            (t) =>
              t?.tier?.type === "context" &&
              typeof t.tier.size === "number" &&
              typeof t.input === "number" &&
              typeof t.output === "number",
          )
        : undefined;

      const efforts = extractEfforts(m);
      const modes = m.experimental?.modes;
      const hasFast = isRecord(modes) && "fast" in modes && Boolean(modes.fast);
      if (hasFast && providerId === "openai") fastModels.push(id);

      const info: ModelInfo = {
        provider: providerId,
        label: (typeof m.name === "string" && m.name.trim()) || id,
        prices: { input, output, cacheRead, cacheWrite },
        ...(contextTier?.tier?.size
          ? {
              longContext: {
                aboveInputTokens: contextTier.tier.size,
                prices: {
                  input: nanoPerToken(contextTier.input, input),
                  output: nanoPerToken(contextTier.output, output),
                  cacheRead: nanoPerToken(contextTier.cache_read, cacheRead),
                  cacheWrite: nanoPerToken(contextTier.cache_write, cacheWrite),
                },
              },
            }
          : {}),
        serverSideFallback: providerId === "anthropic" ? (MODEL_CATALOG[id]?.serverSideFallback ?? true) : false,
        ...(typeof m.reasoning === "boolean" ? { reasoning: m.reasoning } : {}),
        ...(typeof m.limit?.context === "number" && m.limit.context > 0 ? { contextWindow: m.limit.context } : {}),
        ...(typeof m.limit?.output === "number" && m.limit.output > 0 ? { maxOutputTokens: m.limit.output } : {}),
        ...(efforts !== undefined ? { efforts } : {}),
        ...(typeof m.release_date === "string" && m.release_date ? { releaseDate: m.release_date } : {}),
        ...(hasFast ? { fast: true } : {}),
      };

      known.set(id, info);

      if (m.status === "deprecated") continue;
      if (!isTextChatToolModel(id, m)) continue;
      // Skip dated snapshots unless they are explicitly part of the curated catalog.
      if (DATE_SNAPSHOT_ID.test(id) && !Object.hasOwn(MODEL_CATALOG, id)) continue;
      if (!Object.hasOwn(MODEL_CATALOG, id)) {
        if (addedForProvider >= MAX_NEW_PER_PROVIDER) continue;
        addedForProvider++;
      }
      active.push([id, info]);
    }
  }

  return { active, known, xaiEfforts, fastModels };
}

let http: typeof fetch | null = null;
let loadedAt = 0;
let triedAt = 0;
let inflight: Promise<void> | null = null;
let loaded = false;

/** Turns live catalog reads on at server startup; omitted in tests so runs stay offline. */
export function enableLiveCatalog(fetchFn: typeof fetch = fetch) {
  http = fetchFn;
}

/** Whether live catalog entries from `models.dev/api.json` are currently loaded. */
export const liveCatalogLoaded = () => loaded;

/** Clears cached state (tests). */
export function resetLiveCatalog(keepHttp = false) {
  if (!keepHttp) http = null;
  loadedAt = 0;
  triedAt = 0;
  inflight = null;
  loaded = false;
  setLiveCatalogModels(null);
}

/**
 * Ensures the live catalog is populated when enabled: waits only on first load, or when an unknown `model` is
 * requested after `LIVE_CATALOG_RETRY_MS`. Refreshes in background past `LIVE_CATALOG_TTL_MS`.
 */
export async function ensureLiveCatalog(model?: string): Promise<void> {
  if (!http) return;
  const now = Date.now();
  const hasModel = !model || loaded;
  if (loaded && hasModel) {
    if (now - loadedAt >= LIVE_CATALOG_TTL_MS && !inflight) void refresh();
    return;
  }
  if (inflight) return inflight;
  if (triedAt && now - triedAt < LIVE_CATALOG_RETRY_MS) return;
  return refresh();
}

async function refresh(): Promise<void> {
  if (!http) return;
  const run = (async () => {
    triedAt = Date.now();
    try {
      const res = await http(MODELS_DEV_URL, {
        headers: {
          "User-Agent": "agentes-chat/1.0",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(LIVE_CATALOG_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > LIVE_CATALOG_MAX_BYTES) return;
      const text = await res.text();
      if (text.length > LIVE_CATALOG_MAX_BYTES) return;
      const parsed = parseModelsDevCatalog(JSON.parse(text));
      if (parsed.active.length === 0) return;
      setLiveCatalogModels(parsed.active, parsed.known, parsed.xaiEfforts);
      if (parsed.fastModels.length > 0) learnFastModels(parsed.fastModels);
      loadedAt = Date.now();
      loaded = true;
    } catch {
      // Keep static fallback / previous cached catalog cleanly on transient network or parse failures.
    } finally {
      inflight = null;
    }
  })();
  inflight = run;
  return run;
}

export { xaiLiveEffortsOf };
