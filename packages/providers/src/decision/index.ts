import { geminiDecision } from "./gemini";
import { cleanBaseURL } from "./http";
import { openAIDecision } from "./openai";
import { systemOneCall } from "./systemone";
import {
  type DecisionAsset,
  type DecisionCall,
  type DecisionCapabilities,
  DecisionError,
  type DecisionModality,
  type DecisionModelInfo,
  type DecisionProviderId,
  type DecisionProviderInfo,
  type DecisionResult,
  type DecisionRuntime,
  type DecisionState,
  type DecisionWire,
} from "./types";

export * from "./gemini";
export * from "./http";
export * from "./openai";
export * from "./systemone";
export * from "./types";

/**
 * The decision models an installation may pick (ADR 0195). Jev itself is not here: its key and its two ways of paying
 * for it stay in the Jev card and in jev-key.ts, untouched. The models below are the ones this slot can add.
 */
export const DECISION_MODELS: readonly DecisionModelInfo[] = [
  {
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    inputs: ["text", "image"],
    site: "https://developers.openai.com/api/docs/guides/decisions",
  },
  {
    provider: "gemini",
    id: "gemini-decision-1",
    label: "Gemini Decision 1",
    inputs: ["text", "image", "audio", "video", "file"],
    site: "https://ai.google.dev/api/decisions",
  },
  // Laya is the only local decision model this build offers: 421M parameters, about 0.45 GB, light enough for an
  // old CPU and a small RAM. A llama.cpp server serves it, and the compose decision service downloads it on first
  // start (ADR 0195).
  {
    provider: "local",
    id: "laya",
    label: "Laya",
    inputs: ["text"],
    runtime: "llamacpp",
    sizeGb: 0.45,
    needsGb: 2,
    site: "https://huggingface.co/ggml-org/Laya-GGUF",
  },
];

/** What each provider speaks and where its calls go. */
export const DECISION_PROVIDERS: Record<DecisionProviderId, DecisionProviderInfo> = {
  openai: {
    label: "OpenAI",
    wire: "openai",
    baseURL: "https://api.openai.com",
    key: true,
    site: "https://platform.openai.com/api-keys",
    credit: "https://platform.openai.com/settings/organization/billing/overview",
  },
  gemini: {
    label: "Gemini",
    wire: "gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    key: true,
    site: "https://aistudio.google.com/api-keys",
    credit: "https://aistudio.google.com/",
  },
  local: {
    label: "Local",
    wire: "systemone",
    // The compose decision service (llama.cpp with Laya); an owner-run runtime points here too.
    baseURL: "http://127.0.0.1:8080",
    key: false,
  },
};

export const DECISION_PROVIDER_IDS = Object.keys(DECISION_PROVIDERS) as DecisionProviderId[];
export const isDecisionProvider = (id: string): id is DecisionProviderId => Object.hasOwn(DECISION_PROVIDERS, id);

/** The provider's API style, for the engine's adapter choice. */
export const decisionWireOf = (provider: DecisionProviderId): DecisionWire => DECISION_PROVIDERS[provider].wire;

/**
 * Input prices in nano-USD per token (USD per million x 1000), from each provider's own page (2026-11-16):
 * OpenAI's Decisions API and Gemini's Decisions API both charge US$ 0.10 per million input tokens and nothing for
 * output; a local runtime costs nothing. Jev's own price stays in router-jev.ts.
 */
export const DECISION_NANO_USD_PER_INPUT_TOKEN: Record<DecisionProviderId, number> = {
  openai: 100,
  gemini: 100,
  local: 0,
};

export const decisionCostNanoUsd = (provider: DecisionProviderId, inputTokens: number) =>
  Math.round(inputTokens * DECISION_NANO_USD_PER_INPUT_TOKEN[provider]);

/** The modalities a model takes: the table's, else the provider's own (OpenAI reads pictures, Gemini reads all). */
export function capabilitiesOf(provider: DecisionProviderId, model: string): DecisionCapabilities {
  const known = DECISION_MODELS.find((m) => m.provider === provider && m.id === model);
  if (known) return { inputs: [...known.inputs] };
  if (provider === "openai") return { inputs: ["text", "image"] };
  if (provider === "gemini") return { inputs: ["text", "image", "audio", "video", "file"] };
  return { inputs: ["text"] };
}

/** The model's label, or its id when this build doesn't know it. */
export const decisionModelLabel = (provider: DecisionProviderId, model: string) =>
  DECISION_MODELS.find((m) => m.provider === provider && m.id === model)?.label ?? model;

/** One decision call, dispatched to the provider's adapter. */
export async function decide(
  options: {
    provider: DecisionProviderId;
    baseURL?: string;
    apiKey?: string;
    runtime?: DecisionRuntime;
    timeoutMs?: number;
  },
  call: DecisionCall,
  http?: typeof fetch,
): Promise<DecisionResult> {
  const provider = options.provider;
  if (provider === "local")
    return systemOneCall(
      {
        baseURL: options.baseURL,
        apiKey: options.apiKey,
        runtime: options.runtime,
        timeoutMs: options.timeoutMs ?? 5000,
        http,
      },
      call,
    );
  if (!options.apiKey) throw new DecisionError(`${DECISION_PROVIDERS[provider].label} needs a key`, "invalid");
  if (provider === "openai")
    return openAIDecision(
      { baseURL: options.baseURL, apiKey: options.apiKey, timeoutMs: options.timeoutMs ?? 3000, http },
      call,
    );
  return geminiDecision(
    { baseURL: options.baseURL, apiKey: options.apiKey, timeoutMs: options.timeoutMs ?? 3000, http },
    call,
  );
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const MODEL_ID = /^[\w.:/@+-]{1,200}$/;

/** The ids a runtime lists: OpenAI-style data, Ollama's own models, and the media and decision marks around them. */
export function parseRuntimeModels(body: unknown): { id: string; inputs?: DecisionModality[] }[] {
  const root = obj(body);
  const rows = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : [];
  const seen = new Set<string>();
  const out: { id: string; inputs?: DecisionModality[] }[] = [];
  for (const row of rows) {
    const r = obj(row) ?? {};
    const id = [r.id, r.model, r.name].find((v): v is string => typeof v === "string");
    if (!id || !MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const architecture = obj(r.architecture);
    const modalities = Array.isArray(architecture?.input_modalities)
      ? (architecture.input_modalities as unknown[]).filter((m): m is DecisionModality =>
          ["text", "image", "audio", "video", "file"].includes(String(m)),
        )
      : undefined;
    out.push({ id, ...(modalities?.length ? { inputs: modalities } : {}) });
    if (out.length >= 500) break;
  }
  return out;
}

/**
 * The models a provider offers. OpenAI and Gemini serve one decision model each today, so their list is the table's;
 * a local runtime is asked what it has (OpenAI-style data or Ollama's tags), with the models this build knows that it
 * could pull shown beside them.
 */
export async function listDecisionModels(options: {
  provider: DecisionProviderId;
  baseURL?: string;
  apiKey?: string;
  runtime?: DecisionRuntime;
  http?: typeof fetch;
}): Promise<{ models: (DecisionModelInfo & { installed?: boolean })[]; error?: string }> {
  const http = options.http ?? fetch;
  if (options.provider !== "local") return { models: DECISION_MODELS.filter((m) => m.provider === options.provider) };

  const base = cleanBaseURL(options.baseURL ?? DECISION_PROVIDERS.local.baseURL);
  const known = DECISION_MODELS.filter((m) => m.provider === "local");
  if (!base) return { models: [...known], error: "The runtime address is not a valid http(s) URL." };
  const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};
  const read = async (path: string): Promise<unknown> => {
    const res = await http(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  };
  let listed: { id: string; inputs?: DecisionModality[] }[] = [];
  try {
    listed = parseRuntimeModels(await read("/v1/models"));
    if (listed.length === 0) listed = parseRuntimeModels(await read("/api/tags"));
  } catch {
    return {
      models: [...known],
      error: "Could not reach the local runtime. Check DECISION_MODEL_URL and that it is running.",
    };
  }
  // This build serves one local model (Laya). Whatever else a runtime lists is left out, so the screen never offers a
  // model whose size or behavior nobody checked.
  const installed = new Set(listed.map((m) => m.id));
  return { models: known.map((m) => ({ ...m, installed: installed.has(m.id) })) };
}

/**
 * Which runtime answers at an address: Ollama (it has /api/version), llama.cpp (its model rows carry architecture),
 * LM Studio (its native /api/v1/models), else a server speaking one of the wires.
 */
export async function detectRuntime(options: {
  baseURL?: string;
  apiKey?: string;
  http?: typeof fetch;
}): Promise<{ runtime: DecisionRuntime; version?: string; baseURL: string } | null> {
  const http = options.http ?? fetch;
  const base = cleanBaseURL(options.baseURL ?? DECISION_PROVIDERS.local.baseURL);
  if (!base) return null;
  const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};
  const get = async (path: string) => {
    try {
      const res = await http(`${base}${path}`, { headers, signal: AbortSignal.timeout(2500) });
      return res.ok ? await res.json().catch(() => null) : null;
    } catch {
      return null;
    }
  };
  const version = obj(await get("/api/version"));
  if (typeof version?.version === "string") return { runtime: "ollama", version: version.version, baseURL: base };
  const native = obj(await get("/api/v1/models"));
  if (Array.isArray(native?.models)) return { runtime: "lmstudio", baseURL: base };
  const listed = await get("/v1/models");
  const rows = obj(listed)?.data;
  if (
    Array.isArray(rows) &&
    rows.some((row) => {
      const architecture = obj(obj(row)?.architecture);
      return Array.isArray(architecture?.output_modalities) || Array.isArray(architecture?.input_modalities);
    })
  )
    return { runtime: "llamacpp", baseURL: base };
  if (Array.isArray(rows) || Array.isArray(obj(listed)?.models)) return { runtime: "custom", baseURL: base };
  return null;
}

/**
 * Whether a model answers typed decisions, and what it reads: one tiny noul. Only a real call can tell a key's
 * account from a refusal, and only the runtime can tell a decision model from a chat one (llama.cpp answers 501).
 */
export async function checkDecisionModel(
  options: {
    provider: DecisionProviderId;
    model: string;
    baseURL?: string;
    apiKey?: string;
    runtime?: DecisionRuntime;
    http?: typeof fetch;
  },
  timeoutMs = 5000,
): Promise<{ state: DecisionState; capabilities: DecisionCapabilities; error?: string }> {
  const http = options.http ?? fetch;
  const capabilities = capabilitiesOf(options.provider, options.model);
  try {
    await decide(
      {
        provider: options.provider,
        baseURL: options.baseURL,
        apiKey: options.apiKey,
        runtime: options.runtime,
        timeoutMs,
      },
      {
        model: options.model,
        state: { text: "ok" },
        questions: {
          ok: { type: "noul", instructions: "Is the state the word ok?" },
        },
      },
      http,
    );
    return { state: "ok", capabilities };
  } catch (error) {
    if (error instanceof DecisionError) {
      return { state: error.state, capabilities, error: error.message };
    }
    return { state: "unchecked", capabilities, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The server's own size, as the local recommendation reads it. */
export interface DecisionHost {
  cpus: number;
  memoryGb: number;
  /** What the process may use, when a container caps it. */
  memoryLimitGb?: number;
  diskFreeGb: number;
  diskGb: number;
  gpu?: { name: string; vramGb: number } | null;
}

export interface DecisionCandidate extends DecisionModelInfo {
  fits: boolean;
  /** One line the screen shows under the model: why it fits, or what it needs. */
  why: string;
}

const GIB = 2 ** 30;

/**
 * The largest local model that fits the host with room for the rest of the server, by title, or the smallest when none
 * does. The recommendation only: any model in the list can still be chosen (ADR 0195).
 */
export function recommendLocalModel(
  host: DecisionHost,
  runtime: DecisionRuntime,
): { recommended: DecisionCandidate | null; candidates: DecisionCandidate[] } {
  const usable = Math.max(0, Math.min(host.memoryGb, host.memoryLimitGb ?? host.memoryGb) - 2);
  const vram = host.gpu?.vramGb ?? 0;
  const room = Math.max(usable, vram);
  const free = Math.max(0, host.diskFreeGb - 1);
  const candidates = DECISION_MODELS.filter(
    (m) => m.provider === "local" && (!m.runtime || m.runtime === runtime || runtime === "custom"),
  ).map((m) => {
    const needs = m.needsGb ?? (m.sizeGb ?? 0) + 2;
    const fits = needs <= room && (m.sizeGb ?? 0) <= free;
    const why = fits
      ? `needs about ${needs} GB, and this server has ${Math.floor(room)} GB for it`
      : `needs about ${needs} GB, more than this server has free for it`;
    return { ...m, fits, why };
  });
  const fits = candidates.filter((c) => c.fits);
  const recommended =
    [...fits].sort((a, b) => (b.needsGb ?? 0) - (a.needsGb ?? 0))[0] ??
    [...candidates].sort((a, b) => (a.needsGb ?? 0) - (b.needsGb ?? 0))[0] ??
    null;
  return { recommended, candidates };
}

/** A host figure as GB, from bytes, one decimal. */
export const gbOf = (bytes: number) => Math.round((bytes / GIB) * 10) / 10;

export type { DecisionAsset, DecisionModality };
