/**
 * A gate in front of the server (ADR 0195): an identity-aware proxy that answers no request without its own
 * credentials, WebSocket upgrades included. The runner shows each server's gate what it takes, and only that server's.
 *
 * Credentials belong to one server's origin: a request anywhere else carries none of them, and a redirect away from
 * that origin is followed without them (fetch would forward a header it doesn't know to the next host). A gate's
 * refusal comes back as it was answered and is told to whoever listens (`onSignInWanted`: the desktop app asks the
 * person to sign in again). Each kind of gate is a file of its own; Cloudflare Access is `gate-cloudflare.ts`.
 */
import {
  CLOUDFLARE_ACCESS,
  type CloudflareAccessCredentials,
  cloudflareAccessHeaders,
  cloudflareAccessWantsSignIn,
} from "./gate-cloudflare";

/** What the runner shows one server's gate. */
export type GateCredentials = CloudflareAccessCredentials;
export type GateKind = GateCredentials["kind"];

interface Kind {
  headers(credentials: GateCredentials): Record<string, string>;
  /** Whether an answer is this gate turning the request away. */
  wantsSignIn(status: number, headers: Headers, url: string): boolean;
}

const KINDS: Record<GateKind, Kind> = {
  [CLOUDFLARE_ACCESS]: { headers: cloudflareAccessHeaders, wantsSignIn: cloudflareAccessWantsSignIn },
};

export const isGateKind = (kind: unknown): kind is GateKind => typeof kind === "string" && Object.hasOwn(KINDS, kind);

/** Redirects followed by hand, as fetch's own limit would. */
const MAX_REDIRECTS = 20;
/** Headers that name the person or the computer: never sent past the origin they were set for. */
const PRIVATE_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/**
 * Per origin, two layers: what this computer keeps for that server (`config.json`'s `gate`, a service token) and the
 * person's session the desktop app sends (memory only). Both are shown; the gate takes whichever it accepts.
 */
interface Held {
  kind: GateKind;
  stored?: Record<string, string>;
  session?: Record<string, string>;
}
const byOrigin = new Map<string, Held>();
const listeners = new Set<(server: string, kind: GateKind) => void>();

/** `scheme://host[:port]` of an http(s) or ws(s) address, sockets as their http twin; null for anything else. */
export function originOf(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const scheme = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  if (scheme !== "https:" && scheme !== "http:") return null;
  return `${scheme}//${url.host}`;
}

function hold(server: string, layer: "stored" | "session", credentials: GateCredentials | null): void {
  const origin = originOf(server);
  if (!origin) return;
  const prev = byOrigin.get(origin);
  const headers = credentials ? KINDS[credentials.kind].headers(credentials) : {};
  if (credentials && Object.keys(headers).length > 0) {
    // Another kind of gate replaces whatever the other kind held.
    const kept = prev?.kind === credentials.kind ? prev : {};
    byOrigin.set(origin, { ...kept, kind: credentials.kind, [layer]: headers });
    return;
  }
  if (!prev) return;
  const next: Held = { ...prev };
  delete next[layer];
  if (next.stored || next.session) byOrigin.set(origin, next);
  else byOrigin.delete(origin);
}

/** The person's session for `server`'s gate (from the desktop app, memory only); null forgets it. */
export function setGate(server: string, credentials: GateCredentials | null): void {
  hold(server, "session", credentials);
}

/** What this computer keeps for `server`'s gate (`config.json`'s `gate`: a service token); null forgets it. */
export function setStoredGate(server: string, credentials: GateCredentials | null): void {
  hold(server, "stored", credentials);
}

/** Whether the runner has something to show `server`'s gate. */
export const hasGate = (server: string): boolean => {
  const origin = originOf(server);
  return !!origin && byOrigin.has(origin);
};

/** The headers for a request to `address`: none unless it is on the origin the credentials belong to. */
export function gateHeaders(address: string): Record<string, string> {
  const origin = originOf(address);
  const held = origin ? byOrigin.get(origin) : undefined;
  return held ? { ...held.stored, ...held.session } : {};
}

/** The kind of gate that turned this answer away, if one did. */
export function gateRefusal(status: number, headers: Headers, url: string): GateKind | null {
  for (const [kind, k] of Object.entries(KINDS) as [GateKind, Kind][]) {
    if (k.wantsSignIn(status, headers, url)) return kind;
  }
  return null;
}

/** Called with the server's origin and its gate's kind whenever a gate turned a request away. */
export function onSignInWanted(listener: (server: string, kind: GateKind) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function signInWanted(origin: string, kind: GateKind): void {
  for (const listener of listeners) {
    try {
      listener(origin, kind);
    } catch {
      // A listener's failure is its own.
    }
  }
}

type Fetch = typeof fetch;

/**
 * `fetchFn` with each server's gate: a request to a server the runner has credentials for carries them, its
 * redirects are followed by hand so they never reach another origin, and the gate's refusal comes back as it is,
 * told to `onSignInWanted`. Requests to anywhere else go to `fetchFn` untouched.
 */
export function withGates(fetchFn: Fetch): Fetch {
  const wrapped = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const first = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const origin = originOf(first.url);
    if (!origin || !byOrigin.has(origin)) return fetchFn(input, init);
    const follow = (init?.redirect ?? (input instanceof Request ? input.redirect : "follow")) === "follow";
    let request = first;
    for (let hop = 0; ; hop++) {
      const headers = new Headers(request.headers);
      for (const [name, value] of Object.entries(gateHeaders(request.url))) headers.set(name, value);
      const response = await fetchFn(new Request(request, { headers, redirect: "manual" }));
      const refusedBy = gateRefusal(response.status, response.headers, request.url);
      if (refusedBy) {
        signInWanted(origin, refusedBy);
        return response;
      }
      const location = response.headers.get("location");
      if (!follow || response.status < 300 || response.status >= 400 || !location) return response;
      if (hop >= MAX_REDIRECTS) throw new TypeError("Too many redirects");
      const next = new URL(location, request.url).toString();
      const keepsBody = response.status === 307 || response.status === 308;
      // A body already sent can't be sent again: such a redirect comes back as it is.
      if (keepsBody && request.body) return response;
      const method = keepsBody || request.method === "HEAD" ? request.method : "GET";
      const nextHeaders = new Headers(request.headers);
      if (method === "GET") nextHeaders.delete("content-type");
      if (originOf(next) !== origin) {
        for (const name of PRIVATE_HEADERS) nextHeaders.delete(name);
        return fetchFn(next, { method, headers: nextHeaders, signal: request.signal });
      }
      request = new Request(next, { method, headers: nextHeaders, signal: request.signal, redirect: "manual" });
    }
  };
  return Object.assign(wrapped, { preconnect: fetchFn.preconnect }) as Fetch;
}

/**
 * A WebSocket to `url`, with its server's gate credentials (Bun takes headers for the upgrade request; without any,
 * the plain constructor, which every runtime has).
 */
export function openWebSocket(url: string): WebSocket {
  const headers = gateHeaders(url);
  if (Object.keys(headers).length === 0) return new WebSocket(url);
  return new WebSocket(url, { headers } as unknown as string[]);
}

/**
 * Whether a gate stands between the runner and `server` and turned it away: asked after a socket closed before it
 * opened (a refused WebSocket upgrade shows nothing else), so the app learns why the computer can't connect.
 */
export async function checkSignIn(server: string, fetchFn: Fetch = fetch): Promise<boolean> {
  const origin = originOf(server);
  if (!origin) return false;
  try {
    const response = await fetchFn(`${origin}/api/health`, {
      redirect: "manual",
      headers: gateHeaders(origin),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    const refusedBy = gateRefusal(response.status, response.headers, origin);
    if (refusedBy) signInWanted(origin, refusedBy);
    return refusedBy !== null;
  } catch {
    return false;
  }
}

/** Tests: forget every server's credentials and listeners. */
export function resetGates(): void {
  byOrigin.clear();
  listeners.clear();
}
