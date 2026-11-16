import { DecisionError, type DecisionProviderId, type DecisionState } from "./types";

/** A response whose body isn't needed after a failure: release it. */
const discard = (res: Response) => void res.body?.cancel().catch(() => {});

/** The provider's own words on one line, the key taken out, for a screen and a log. */
export const saidOf = (body: unknown, apiKey?: string) => {
  const raw = JSON.stringify(body ?? "");
  const text = raw
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/[{}[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
};

/** What a provider's status and words say about the key or the service, or null for the request's own fault. */
export function decisionStateOf(status: number, body: unknown): DecisionState | null {
  if (status >= 200 && status < 300) return "ok";
  const words = JSON.stringify(body ?? "").toLowerCase();
  if (/credit|balance|billing|payment|funds|quota/.test(words)) return "no_credit";
  if (status === 401 || status === 403) return "invalid";
  if (status === 402) return "no_credit";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "down";
  return null;
}

export interface JsonReply {
  status: number;
  body: unknown;
  retryAfterMs?: number;
  /** Our own deadline passed: the service was slow, not down. */
  late: boolean;
}

/**
 * One JSON request with a deadline and the key kept out of the error's words. A provider's failure is thrown as a
 * DecisionError; a request the provider refused on its own (400, 404, 422) is returned so the caller can explain it.
 */
export async function requestJson(
  provider: DecisionProviderId,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  apiKey?: string,
  http: typeof fetch = fetch,
): Promise<JsonReply> {
  let res: Response;
  try {
    res = await http(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const late = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new DecisionError(
      late ? "the decision model did not answer in time" : "could not reach the decision model",
      late ? "unchecked" : "unreachable",
      0,
    );
  }
  const body: unknown = await res.json().catch(() => null);
  const seconds = Number(res.headers.get("retry-after"));
  const retryAfterMs = seconds > 0 ? seconds * 1000 : undefined;
  const state = decisionStateOf(res.status, body);
  if (state && state !== "ok") {
    discard(res);
    throw new DecisionError(
      saidOf(body, apiKey) || `${provider} answered ${res.status}`,
      state,
      res.status,
      retryAfterMs,
    );
  }
  return { status: res.status, body, retryAfterMs, late: false };
}

/** A provider's key must be printable ASCII: a pasted curly quote or zero-width space fails before the request leaves. */
export const KEY_SHAPE = /^[\x21-\x7E]+$/;

/** A base URL as stored: http(s), no userinfo, query or hash, and no trailing slash. */
export function cleanBaseURL(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** The base a provider's calls go to: the owner's override, else the provider's own host. */
export const baseOf = (baseURL: string | undefined, fallback: string) =>
  (baseURL ? cleanBaseURL(baseURL) : fallback) ?? fallback;
