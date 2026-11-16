import { baseOf, requestJson } from "./http";
import {
  type DecisionAnswer,
  type DecisionCall,
  DecisionError,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionUsage,
} from "./types";

/**
 * OpenAI's Decisions API (ADR 0188): POST /v1/decisions with gpt-6-luna. Its own field names: predicate instead of
 * noul, choices and levels as arrays, and an answers array keyed by name. Text, pictures and JSON go in the input;
 * files, audio and video are not taken here.
 * https://developers.openai.com/api/docs/guides/decisions
 */

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const textOf = (q: DecisionQuestion) =>
  typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);

/** One question in OpenAI's words, with Jev's true/false criteria folded into a predicate's instructions. */
function questionOf(id: string, q: DecisionQuestion): Record<string, unknown> {
  if (q.type === "box") throw new DecisionError("box questions need Jev", "unchecked");
  if (q.type === "choice")
    return {
      type: "choice",
      name: id,
      instructions: textOf(q),
      choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })),
    };
  if (q.type === "score")
    return {
      type: "score",
      name: id,
      instructions: textOf(q),
      levels: q.criteria.map((description, level) => ({ label: String(level), description })),
    };
  const criteria = q.criteria ? `\nYes: ${q.criteria.true}\nNo: ${q.criteria.false}` : "";
  return { type: "predicate", name: id, instructions: `${textOf(q)}${criteria}` };
}

/** The pictures a call carries as data URLs. Audio, video and documents are refused by this API. */
function contentOf(call: DecisionCall) {
  const content: Record<string, unknown>[] = [
    { type: "input_text", text: typeof call.state === "string" ? call.state : JSON.stringify(call.state) },
  ];
  for (const asset of Object.values(call.assets ?? {})) {
    if (!asset.mediaType.startsWith("image/"))
      throw new DecisionError("OpenAI's decisions read text and pictures only", "unchecked");
    content.push({ type: "input_image", image_url: `data:${asset.mediaType};base64,${asset.data}` });
  }
  return content;
}

interface Answer {
  type?: unknown;
  name?: unknown;
  probability?: unknown;
  choice?: unknown;
  probabilities?: unknown;
  score?: unknown;
  confidence?: unknown;
}

/** An answer array cast to the engine's shapes: predicate to noul, probabilities by value. */
function answersOf(questions: DecisionCall["questions"], raw: unknown): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const a = (item ?? {}) as Answer;
    if (typeof a.name !== "string" || !(a.name in questions)) continue;
    const q = questions[a.name];
    // Only what the provider actually answered: a missing answer must fall through to Jev, not read as a confident no.
    const confidence = typeof a.confidence === "number" ? { confidence: clamp(a.confidence) } : {};
    if (a.type === "predicate" && typeof a.probability === "number") {
      out[a.name] = { noul: clamp(a.probability) };
    } else if (a.type === "choice" && typeof a.choice === "string") {
      const probabilities: Record<string, number> = {};
      for (const p of Array.isArray(a.probabilities) ? a.probabilities : []) {
        const row = (p ?? {}) as { value?: unknown; probability?: unknown };
        if (typeof row.value === "string" && typeof row.probability === "number")
          probabilities[row.value] = clamp(row.probability);
      }
      out[a.name] = { choice: a.choice, probabilities, ...confidence };
    } else if (a.type === "score" && typeof a.score === "number" && Number.isFinite(a.score)) {
      const probabilities: Record<string, number> = {};
      for (const p of Array.isArray(a.probabilities) ? a.probabilities : []) {
        const row = (p ?? {}) as { value?: unknown; probability?: unknown };
        if ((typeof row.value === "number" || typeof row.value === "string") && typeof row.probability === "number")
          probabilities[String(row.value)] = clamp(row.probability);
      }
      const levels = q?.type === "score" ? q.criteria.length : 2;
      out[a.name] = { score: Math.min(levels - 1, Math.max(0, a.score)), probabilities, ...confidence };
    }
  }
  return out;
}

export interface OpenAIOptions {
  baseURL?: string;
  apiKey: string;
  timeoutMs?: number;
  http?: typeof fetch;
}

/** One POST /v1/decisions with gpt-6-luna: its typed answers, normalized. */
export async function openAIDecision(options: OpenAIOptions, call: DecisionCall): Promise<DecisionResult> {
  const base = baseOf(options.baseURL, "https://api.openai.com");
  const reply = await requestJson(
    "openai",
    `${base}/v1/decisions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model: call.model,
        input: [{ role: "user", content: contentOf(call) }],
        questions: Object.entries(call.questions).map(([id, q]) => questionOf(id, q)),
      }),
    },
    options.timeoutMs ?? 3000,
    options.apiKey,
    options.http,
  );
  const json = (reply.body ?? {}) as {
    model?: unknown;
    answers?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  if (!Array.isArray(json.answers))
    throw new DecisionError("the decision model answered without answers", "down", reply.status);
  const input = json.usage?.input_tokens ?? json.usage?.prompt_tokens;
  const usage: DecisionUsage = {
    inputTokens: typeof input === "number" ? input : 0,
    // OpenAI bills no output tokens for a decision.
    outputTokens: 0,
  };
  return {
    model: typeof json.model === "string" ? json.model : call.model,
    answers: answersOf(call.questions, json.answers),
    usage,
  };
}
