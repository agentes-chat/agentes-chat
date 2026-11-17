/**
 * The typed-question wire a decision model answers (ADR 0195). The shapes are the ones the judge and the router
 * already speak (noul, choice, score, box); each provider adapter translates them to its own API and back, so the
 * engine never learns a provider's field names.
 */

/** A provider that can answer typed questions for the installation. Jev itself stays in its own key and routes. */
export type DecisionProviderId = "openai" | "gemini" | "local";

/** What a provider's decision endpoint is. */
export type DecisionWire = "openai" | "gemini" | "systemone";

/** A yes/no, a fixed choice, an ordered level, or a box in an image. */
export type DecisionQuestion =
  | { type: "noul"; instructions: string | Record<string, unknown>; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string | Record<string, unknown>; criteria: Record<string, string> }
  | { type: "score"; instructions: string | Record<string, unknown>; criteria: string[] }
  | { type: "box"; instructions: string | Record<string, unknown> };

/** A region of an image: fractions of its width and height, from the top left. */
export interface DecisionBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** One normalized answer. Missing fields mean the provider said nothing about that question. */
export interface DecisionAnswer {
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
  box?: DecisionBox;
}

/** A picture, a recording, a video or a document the questions look at. Base64, no data: prefix. */
export interface DecisionAsset {
  mediaType: string;
  data: string;
}

/** What a model can take, detected from its provider or its runtime. */
export type DecisionModality = "text" | "image" | "audio" | "video" | "file";

export interface DecisionCapabilities {
  inputs: DecisionModality[];
}

/** Where a decision model is called: a provider, a base address override and a key (local servers may take none). */
export interface DecisionEndpoint {
  provider: DecisionProviderId;
  /** OpenAI and Gemini accept a host override; local is the runtime's own address. */
  baseURL?: string;
  apiKey?: string;
  /** The local runtime, when known: it picks how images are sent and whether it can pull models. */
  runtime?: DecisionRuntime;
  timeoutMs?: number;
}

/** The local runtime behind a decision endpoint. */
export type DecisionRuntime = "ollama" | "llamacpp" | "lmstudio" | "custom";

/** One request: shared state, questions by id, and assets the placeholders in the state refer to. */
export interface DecisionCall {
  model: string;
  state: Record<string, unknown> | string;
  questions: Record<string, DecisionQuestion>;
  assets?: Record<string, DecisionAsset>;
}

/** What a call used, priced by the caller's table (0 when it is local). */
export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  costNanoUsd?: number;
}

export interface DecisionResult {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: DecisionUsage;
}

/** How a call ended, for the key's state and the skip windows. */
export type DecisionState = "ok" | "invalid" | "no_credit" | "rate_limited" | "down" | "unreachable" | "unchecked";

/** A refused or failed decision call. The engine maps it to the key state and to the app's error words. */
export class DecisionError extends Error {
  constructor(
    message: string,
    readonly state: DecisionState,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

/** A provider as the settings screen offers it. */
export interface DecisionProviderInfo {
  label: string;
  wire: DecisionWire;
  /** The host its API is called at, unless the owner overrides it. */
  baseURL: string;
  /** Whether a key is required. */
  key: boolean;
  /** Where its keys are made and where credit is added, for the screen's links. */
  site?: string;
  credit?: string;
}

/**
 * A decision model the installation can pick. Cloud models are listed with their key; local models carry the runtime
 * that serves them, an approximate download size and the RAM they need with headroom, so the screen can recommend one
 * from the host's size (ADR 0195).
 */
export interface DecisionModelInfo {
  provider: DecisionProviderId;
  id: string;
  label: string;
  inputs: DecisionModality[];
  /** The local runtime that serves it, and so the one it is downloaded to. Absent: a cloud model. */
  runtime?: DecisionRuntime;
  /** Approximate download and memory figures, in GB. */
  sizeGb?: number;
  /** What the model needs in RAM (or VRAM) with the rest of the server's work beside it. */
  needsGb?: number;
  /** Only worth it with a GPU. */
  gpu?: boolean;
  /** A license note the screen shows (openjev is non-commercial). */
  license?: string;
  /** The page a person reads before choosing it. */
  site?: string;
}
