import { baseOf, requestJson } from "./http";
import {
  type DecisionAnswer,
  type DecisionAsset,
  type DecisionCall,
  DecisionError,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionUsage,
} from "./types";

/**
 * Gemini's Decisions API (ADR 0188): POST /v1beta/decisions with gemini-decision-1. Shared input is multimodal (text,
 * pictures, audio, video and PDF), questions are a map by id and answers come back in a map. Its noul criteria name
 * the two sides true_description and false_description. No box/spatial grounding.
 * https://ai.google.dev/api/decisions
 */

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const textOf = (q: DecisionQuestion) =>
  typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);

function questionOf(q: DecisionQuestion): Record<string, unknown> {
  if (q.type === "box") throw new DecisionError("box questions need Jev", "unchecked");
  if (q.type === "choice") return { type: "choice", instructions: textOf(q), criteria: q.criteria };
  if (q.type === "score") return { type: "score", instructions: textOf(q), criteria: q.criteria };
  return {
    type: "noul",
    instructions: textOf(q),
    ...(q.criteria ? { criteria: { true_description: q.criteria.true, false_description: q.criteria.false } } : {}),
  };
}

/** The shared input: the state as JSON text, then each asset in the block its media type takes. */
function inputOf(call: DecisionCall): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    { type: "text", text: typeof call.state === "string" ? call.state : JSON.stringify(call.state) },
  ];
  for (const asset of Object.values(call.assets ?? {})) blocks.push(assetBlock(asset));
  return blocks;
}

function assetBlock(asset: DecisionAsset): Record<string, unknown> {
  const type = asset.mediaType.startsWith("image/")
    ? "image"
    : asset.mediaType.startsWith("audio/")
      ? "audio"
      : asset.mediaType.startsWith("video/")
        ? "video"
        : "document";
  return { type, data: asset.data, mime_type: asset.mediaType };
}

/** A probabilities map, strings only, clamped. */
function probabilitiesOf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([key, value]) => [key, clamp(value)]),
  );
}

function answersOf(questions: DecisionCall["questions"], raw: unknown): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, q] of Object.entries(questions)) {
    const a = ((raw as Record<string, unknown>)[id] ?? {}) as {
      noul?: unknown;
      choice?: unknown;
      probabilities?: unknown;
      score?: unknown;
      confidence?: unknown;
    };
    const confidence = typeof a.confidence === "number" ? { confidence: clamp(a.confidence) } : {};
    // Only what the provider answered: a missing answer must fall through to Jev, not read as a confident no.
    if (q.type === "noul" && typeof a.noul === "number") {
      out[id] = { noul: clamp(a.noul), ...confidence };
    } else if (q.type === "score" && typeof a.score === "number" && Number.isFinite(a.score)) {
      out[id] = {
        score: Math.min(q.criteria.length - 1, Math.max(0, a.score)),
        probabilities: probabilitiesOf(a.probabilities),
        ...confidence,
      };
    } else if (q.type === "choice" && typeof a.choice === "string") {
      out[id] = { choice: a.choice, probabilities: probabilitiesOf(a.probabilities), ...confidence };
    }
  }
  return out;
}

export interface GeminiOptions {
  baseURL?: string;
  apiKey: string;
  timeoutMs?: number;
  http?: typeof fetch;
}

/** One POST /v1beta/decisions with gemini-decision-1: its typed answers, normalized. */
export async function geminiDecision(options: GeminiOptions, call: DecisionCall): Promise<DecisionResult> {
  const base = baseOf(options.baseURL, "https://generativelanguage.googleapis.com");
  const reply = await requestJson(
    "gemini",
    `${base}/v1beta/decisions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify({
        model: call.model,
        input: inputOf(call),
        questions: Object.fromEntries(Object.entries(call.questions).map(([id, q]) => [id, questionOf(q)])),
      }),
    },
    options.timeoutMs ?? 3000,
    options.apiKey,
    options.http,
  );
  const json = (reply.body ?? {}) as {
    model?: unknown;
    answers?: unknown;
    usage?: { total_input_tokens?: unknown; input_tokens?: unknown; total_output_tokens?: unknown };
  };
  if (!json.answers || typeof json.answers !== "object")
    throw new DecisionError("the decision model answered without answers", "down", reply.status);
  const input = json.usage?.total_input_tokens ?? json.usage?.input_tokens;
  const usage: DecisionUsage = {
    inputTokens: typeof input === "number" ? input : 0,
    // Gemini bills no output tokens for a decision.
    outputTokens: 0,
  };
  return {
    model: typeof json.model === "string" ? json.model : call.model,
    answers: answersOf(call.questions, json.answers),
    usage,
  };
}
