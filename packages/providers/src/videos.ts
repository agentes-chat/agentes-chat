import type { ImageReference } from "./images";
import { ProviderError } from "./types";

/**
 * Video generation (ADR 0219): one catalog of video models, apart from the chat and image models, so they never show
 * up in model pickers, the router or Automático. Pure data and arithmetic; only the Model Gateway calls a provider's
 * `generateVideo`.
 */

/** Landscape or portrait: the two shapes every model here makes. */
export type VideoAspect = "16:9" | "9:16";
export const VIDEO_ASPECTS: readonly VideoAspect[] = ["16:9", "9:16"];

/** The longest prompt a request takes, in characters. */
export const MAX_VIDEO_PROMPT_CHARS = 4000;
/** How long a video is when nobody says. */
export const DEFAULT_VIDEO_SECONDS = 8;

export type VideoProviderId = "gemini" | "openrouter";

/**
 * How a model is billed, in nano-USD (1e-9 USD) per second of 720p video with sound, as its maker lists it:
 * - `second`: a fixed price per second;
 * - `reported`: the provider says what each call cost (OpenRouter's `usage.cost`); `typical` prices a call that says
 *   nothing, `worst` reserves the budget.
 */
export type VideoPrice = { per: "second"; nanoUsd: number } | { per: "reported"; typical: number; worst: number };

export interface VideoModelInfo {
  provider: VideoProviderId;
  label: string;
  /** The id sent to the provider's API. */
  apiModel: string;
  minSeconds: number;
  maxSeconds: number;
  /** It takes a picture to start from (image to video). */
  startImage: boolean;
  price: VideoPrice;
  /** The day its price was read on the maker's page. */
  pricedAt: string;
}

const usd = (value: number) => Math.round(value * 1e9);

/**
 * Video models by id, the default first: a workspace's default is the first one it has a key for. Prices per second
 * of 720p video with sound, read on 2026-11-23: Gemini Omni Flash on Google's model page (5,792 output tokens a
 * second at $12 per million), OpenRouter's from its `GET /api/v1/videos/models` (`worst` is the model's dearest
 * listed rate, so a reroute can't spend past the reservation).
 */
export const VIDEO_CATALOG: Record<string, VideoModelInfo> = {
  "gemini-omni-1.2-flash": {
    provider: "gemini",
    label: "Gemini Omni Flash",
    apiModel: "gemini-omni-1.2-flash",
    minSeconds: 3,
    maxSeconds: 15,
    startImage: true,
    price: { per: "second", nanoUsd: usd(0.069504) },
    pricedAt: "2026-11-23",
  },
  "openrouter:google/gemini-omni-1.2-flash": {
    provider: "openrouter",
    label: "Gemini Omni Flash (OpenRouter)",
    apiModel: "google/gemini-omni-1.2-flash",
    minSeconds: 3,
    maxSeconds: 15,
    startImage: true,
    price: { per: "reported", typical: usd(0.069504), worst: usd(0.104256) },
    pricedAt: "2026-11-23",
  },
  "openrouter:x-ai/grok-imagine-video": {
    provider: "openrouter",
    label: "Grok Imagine Video (OpenRouter)",
    apiModel: "x-ai/grok-imagine-video",
    minSeconds: 1,
    maxSeconds: 15,
    startImage: true,
    price: { per: "reported", typical: usd(0.07), worst: usd(0.08) },
    pricedAt: "2026-11-23",
  },
};

/** The catalog's ids, in the order a workspace's default is picked. */
export const VIDEO_MODEL_IDS = Object.keys(VIDEO_CATALOG);

export const videoModelInfo = (model: string): VideoModelInfo | undefined =>
  Object.hasOwn(VIDEO_CATALOG, model) ? VIDEO_CATALOG[model] : undefined;

/** Whole seconds within what the model makes; the default when none is asked. */
export function videoSeconds(info: Pick<VideoModelInfo, "minSeconds" | "maxSeconds">, asked?: number): number {
  const wanted = Number.isFinite(asked) ? Math.round(asked as number) : DEFAULT_VIDEO_SECONDS;
  return Math.min(info.maxSeconds, Math.max(info.minSeconds, wanted));
}

export interface VideoRequest {
  /** An id of `VIDEO_CATALOG` (the gateway sends the provider's own). */
  model: string;
  prompt: string;
  seconds: number;
  aspect: VideoAspect;
  /** A picture the video starts from. */
  startImage?: ImageReference;
  signal?: AbortSignal;
}

export interface MadeVideo {
  mediaType: string;
  bytes: Uint8Array;
}

export interface VideoResult {
  video: MadeVideo;
  model?: string;
  /** What the provider says the call cost; absent: priced from the catalog. */
  costNanoUsd?: number;
}

export interface VideoCallOptions {
  apiKey: string;
}

/** The most a request may cost, reserved against the budget before the call. */
export function maxVideoCostNanoUsd(model: string, seconds: number): number {
  const info = videoModelInfo(model);
  if (!info) throw new Error(`Video model ${model} is not in the catalog`);
  return seconds * (info.price.per === "second" ? info.price.nanoUsd : info.price.worst);
}

/** What a request cost, settled after the call: the provider's reported cost, else the catalog's price. */
export function videoCostNanoUsd(model: string, seconds: number, reported?: number): number {
  const info = videoModelInfo(model);
  if (!info) throw new Error(`Video model ${model} is not in the catalog`);
  if (info.price.per === "reported" && typeof reported === "number" && Number.isFinite(reported))
    return Math.max(0, Math.round(reported));
  return seconds * (info.price.per === "second" ? info.price.nanoUsd : info.price.typical);
}

/** A video's type from its first bytes (MP4/QuickTime's `ftyp` box, WebM), or null. */
export function videoTypeOf(bytes: Uint8Array): string | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp")
    return String.fromCharCode(...bytes.subarray(8, 10)) === "qt" ? "video/quicktime" : "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  return null;
}

/** The largest video a provider's answer may carry. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Bytes of a provider's video, its type read from the bytes (never trusted from the answer). */
export function checkedVideo(bytes: Uint8Array): MadeVideo {
  if (bytes.byteLength > MAX_VIDEO_BYTES) throw new ProviderError("the provider's video is too large", false);
  const mediaType = videoTypeOf(bytes);
  if (!mediaType) throw new ProviderError("could not read the provider's video", true);
  return { mediaType, bytes };
}

/** A provider refusing a prompt (its safety rules) says this: the agent says it was refused, not that it failed. */
export const VIDEO_BLOCKED_WORDS = "the provider refused to make this video";

export const videoBlockedError = (said?: string) =>
  new ProviderError(
    `${VIDEO_BLOCKED_WORDS}${said ? `: ${said}` : ""}`,
    false,
    400,
    undefined,
    said ? said.replace(/\s+/g, " ").trim().slice(0, 300) : undefined,
  );

/** Whether a failure is the provider refusing the prompt (`videoBlockedError`), also once the gateway masked it. */
export const isVideoBlocked = (error: unknown) =>
  error instanceof ProviderError && error.message.startsWith(VIDEO_BLOCKED_WORDS);
