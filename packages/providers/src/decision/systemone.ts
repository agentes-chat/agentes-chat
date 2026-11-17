import { baseOf, requestJson } from "./http";
import {
  type DecisionAnswer,
  type DecisionAsset,
  type DecisionBox,
  type DecisionCall,
  DecisionError,
  type DecisionResult,
  type DecisionRuntime,
  type DecisionUsage,
} from "./types";

/**
 * The System One wire (ADR 0195): the one Jev answers, and the one decision models on Ollama, llama.cpp and LM Studio
 * serve locally. A call sends the state, the questions by id and, when the questions look at pictures, the assets.
 * llama.cpp takes the pictures as data URLs under images, the others as Jev's assets map.
 */

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function boxOf(v: unknown): DecisionBox {
  const b = (v ?? {}) as Partial<Record<keyof DecisionBox, unknown>>;
  const top = clamp(b.top);
  const left = clamp(b.left);
  return { top, left, bottom: Math.max(top, clamp(b.bottom)), right: Math.max(left, clamp(b.right)) };
}

/** The pictures a call carries, in the shape the runtime takes: images for llama.cpp, assets for the others. */
function withAssets(
  body: Record<string, unknown>,
  assets: Record<string, DecisionAsset> | undefined,
  runtime: DecisionRuntime,
) {
  if (!assets || Object.keys(assets).length === 0) return body;
  if (runtime === "llamacpp")
    return {
      ...body,
      images: Object.values(assets).map((a) => `data:${a.mediaType};base64,${a.data}`),
    };
  return {
    ...body,
    assets: Object.fromEntries(
      Object.entries(assets).map(([key, a]) => [
        key,
        { data_base64: a.data, format: a.mediaType === "image/png" ? "png" : "jpg" },
      ]),
    ),
  };
}

/** A probabilities map, clamped, strings only. */
function probabilitiesOf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([key, value]) => [key, clamp(value)]),
  );
}

/** An answer as the engine reads it: probabilities by option, the level clamped to its criteria. */
function answersOf(
  questions: DecisionCall["questions"],
  raw: Record<string, unknown> | undefined,
): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = (raw?.[id] ?? {}) as {
      noul?: unknown;
      choice?: unknown;
      probabilities?: unknown;
      score?: unknown;
      confidence?: unknown;
      box?: unknown;
    };
    const confidence = typeof a.confidence === "number" ? { confidence: clamp(a.confidence) } : {};
    // Only what the provider answered: a missing answer must fall through to Jev, not read as a confident no.
    if (q.type === "noul" && typeof a.noul === "number") {
      out[id] = { noul: clamp(a.noul), ...confidence };
    } else if (q.type === "box" && a.box && typeof a.box === "object") {
      out[id] = { box: boxOf(a.box), ...confidence };
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

export interface SystemOneOptions {
  baseURL?: string;
  apiKey?: string;
  runtime?: DecisionRuntime;
  timeoutMs?: number;
  http?: typeof fetch;
}

/** One POST /v1/systemone to a local decision runtime (or a Jev-compatible one): its answers, normalized. */
export async function systemOneCall(options: SystemOneOptions, call: DecisionCall): Promise<DecisionResult> {
  const base = baseOf(options.baseURL, "http://127.0.0.1:11434");
  const runtime = options.runtime ?? "custom";
  const body = withAssets({ model: call.model, state: call.state, questions: call.questions }, call.assets, runtime);
  const reply = await requestJson(
    "local",
    `${base}/v1/systemone`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
    options.timeoutMs ?? 5000,
    options.apiKey,
    options.http,
  );
  const json = (reply.body ?? {}) as {
    model?: unknown;
    answers?: Record<string, unknown>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  if (reply.status === 501 || reply.status === 400) {
    throw new DecisionError("this model does not answer typed decisions", "unchecked", reply.status);
  }
  if (!json.answers || typeof json.answers !== "object") {
    throw new DecisionError("the decision model answered without answers", "down", reply.status);
  }
  const usage: DecisionUsage = {
    inputTokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : 0,
    outputTokens: typeof json.usage?.output_tokens === "number" ? json.usage.output_tokens : 0,
  };
  return {
    model: typeof json.model === "string" ? json.model : call.model,
    answers: answersOf(call.questions, json.answers),
    usage,
  };
}
