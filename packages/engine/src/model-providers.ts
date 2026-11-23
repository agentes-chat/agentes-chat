import { isKnownProvider, PROVIDER_IDS } from "@agenteschat/providers";

/** Plans on an agent's computer that no API provider of the catalog sells: their own ids in `MODEL_PROVIDERS`. */
export const PLAN_ONLY_AIS = ["cursor", "grok", "opencode"] as const;

/** In `MODEL_PROVIDERS`: workspaces may also add API keys of the providers left out (the listed ones always may). */
export const API_KEYS = "api_keys";

/** Every id `MODEL_PROVIDERS` takes: the API providers', the plans' of their own, then `api_keys`. */
export const MODEL_AI_IDS = [...PROVIDER_IDS, ...PLAN_ONLY_AIS, API_KEYS] as [string, ...string[]];

const isModelAi = (id: string) =>
  isKnownProvider(id) || (PLAN_ONLY_AIS as readonly string[]).includes(id) || id === API_KEYS;

/**
 * The AIs this server lets workspaces use (`MODEL_PROVIDERS`), or null for every one. One left out takes no new key
 * or plan sign-in, and one saved before stays listed (so it can be removed) but nothing thinks with it.
 */
let allowed: ReadonlySet<string> | null = null;

/** Set once at boot from `MODEL_PROVIDERS`; empty or absent: every AI. An unknown id fails the boot. */
export function setModelProviders(ids: readonly string[] | null | undefined) {
  if (!ids || ids.length === 0) {
    allowed = null;
    return;
  }
  const unknown = ids.filter((id) => !isModelAi(id));
  if (unknown.length > 0)
    throw new Error(`MODEL_PROVIDERS: unknown provider ${unknown.join(", ")} (known: ${MODEL_AI_IDS.join(", ")})`);
  allowed = new Set(ids);
}

/** Whether workspaces may use the provider, or the plan of its own, on this server (`setModelProviders`). */
export const providerAllowed = (provider: string) => allowed === null || allowed.has(provider);

/**
 * Whether an API provider's keys may be added and used (the workspace's or the server's): no list, the provider
 * listed, or `api_keys` listed, which opens the others' keys too (not their plans).
 */
export const keyAllowed = (provider: string) =>
  allowed === null || allowed.has(provider) || (allowed.has(API_KEYS) && isKnownProvider(provider));

/** The AIs workspaces may use, in `MODEL_AI_IDS` order; null when every one is. */
export const allowedProviders = (): string[] | null =>
  allowed === null ? null : MODEL_AI_IDS.filter((id) => allowed?.has(id));

/** A coding plan's key on Claude Code, by its maker's API id (`zai`'s GLM Coding Plan is Z.ai's). */
const CODING_PLAN_AI: Readonly<Record<string, string>> = {
  zai: "zai",
  kimi: "moonshot",
  minimax: "minimax",
  opencode: "opencode",
};

/**
 * The id `MODEL_PROVIDERS` names a computer plan by: Claude's, a coding plan's maker on Claude Code, ChatGPT's
 * (Codex), Gemini's (the Antigravity CLI), else the plan's own (Cursor, Grok, OpenCode). Null for the model brain.
 */
export function planAiOf(kind: string, provider?: string | null): string | null {
  switch (kind) {
    case "claude_code":
      return (provider && CODING_PLAN_AI[provider]) || "anthropic";
    case "codex":
      return "openai";
    case "antigravity":
      return "gemini";
    case "cursor":
    case "grok":
    case "opencode":
      return kind;
    default:
      return null;
  }
}
