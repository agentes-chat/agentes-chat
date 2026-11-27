import { checkServer, originOf, type ServerCheck } from "@agenteschat/client/lib/server";
import { requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";
import { GATE_SESSION_COOKIE, gateCookiePair, gateWantsSignIn, sessionExpiry, teamOfSession } from "./gate-cloudflare";
import { perServer } from "./server";
import { readValueSync, writeValue } from "./storage";

/**
 * A gate in front of a server (ADR 0195 §10): Cloudflare Access, which turns away every request without the person's
 * session. Per server: each one's session is its own, kept in SecureStore, and goes only to that server (in the
 * `Cookie` header `readCookie` builds, `auth.ts`). Whether a server wants its gate's sign-in now is known from its
 * answers (`watchGate`); the sign-in itself is `GateSignIn` (features/gate), in a web view.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** What Better Auth's `fetch` is called with, besides a string. */
type AnyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const addressOf = (input: string | URL | Request) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** The web views' cookie store (modules/web-cookies): where the sign-in leaves its session. */
interface WebCookiesNative {
  get(url: string): Promise<Record<string, string>>;
  remove(url: string, name: string): Promise<void>;
}
const webCookies = requireOptionalNativeModule<WebCookiesNative>("WebCookies");

const SESSION = "gate-session";
const sessions = new Map<string, string | null>();

/** The person's gate session for `server` while it lasts, or null. */
export function gateSession(server: string): string | null {
  if (!sessions.has(server)) sessions.set(server, readValueSync(perServer(SESSION, server)));
  const token = sessions.get(server) ?? null;
  if (!token) return null;
  const ends = sessionExpiry(token);
  return ends === null || ends > Date.now() ? token : null;
}

/** The `Cookie` pair that shows `server`'s gate the person's session, or "". */
export const gateCookie = (server: string): string => gateCookiePair(gateSession(server));

/** Whether `url` is on `server`'s origin: a gate session goes nowhere else. */
const onServer = (url: string, server: string) => {
  const origin = originOf(server);
  return origin !== null && originOf(url) === origin;
};

// ── Which servers want their gate's sign-in now ─────────────────────────────────

let wanted: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function setWanted(next: ReadonlySet<string>) {
  wanted = next;
  for (const listener of listeners) listener();
}

/** `server`'s gate turned a request away: its sign-in shows. */
export function markGateWanted(server: string) {
  if (!wanted.has(server)) setWanted(new Set([...wanted, server]));
}

function clearGateWanted(server: string) {
  if (!wanted.has(server)) return;
  const next = new Set(wanted);
  next.delete(server);
  setWanted(next);
}

/** Whether `server`'s gate wants its sign-in now (the root layout shows `GateSignIn` over everything). */
export function useGateWanted(server: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => wanted.has(server),
  );
}

/**
 * `fetch` for requests to `server` that notices its gate turning one away (the answer is still returned, for the
 * caller to fail on as it would): every request of the app's API client and of Better Auth's goes through it.
 */
export function watchGate(server: string, fetchFn: AnyFetch = fetch): AnyFetch {
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (onServer(addressOf(input), server) && gateWantsSignIn(res, server)) markGateWanted(server);
    return res;
  };
}

/** What the app's API client calls with every answer from `server`: its gate turning one away shows its sign-in. */
export const noticeGate =
  (server: string) =>
  (res: Response): void => {
    if (gateWantsSignIn(res, server)) markGateWanted(server);
  };

/**
 * Whether `server` is behind a gate that wants its sign-in, asked once (for an address the person typed, before the
 * app moves there, and when the server stops answering): false when it answers, or doesn't at all.
 */
export async function gateWants(server: string, fetchFn: Fetch = fetch): Promise<boolean> {
  if (!server.startsWith("https://")) return false;
  const cookie = gateCookie(server);
  try {
    const res = await fetchFn(`${server}/api/instance`, {
      headers: { accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      credentials: "omit",
    });
    return gateWantsSignIn(res, server);
  } catch {
    return false;
  }
}

/** `checkServer`'s fetch for `server`: with its gate session, so a server behind one is checked as itself. */
export const gatedFetch =
  (server: string, fetchFn: Fetch = fetch): Fetch =>
  (input, init = {}) => {
    const cookie = onServer(input, server) ? gateCookie(server) : "";
    if (!cookie) return fetchFn(input, init);
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    return fetchFn(input, { ...init, headers, credentials: "omit" });
  };

/**
 * `checkServer` for a server that may be behind a gate: checked with its gate session, and when that fails, whether
 * the gate is what turned it away (`gated`: its sign-in now shows, `markGateWanted`).
 */
export async function checkServerOrGate(server: string): Promise<{ check: ServerCheck; gated: boolean }> {
  const check = await checkServer(server, gatedFetch(server));
  if (check.ok || !(await gateWants(server))) return { check, gated: false };
  markGateWanted(server);
  return { check, gated: true };
}

// ── The sign-in's session ───────────────────────────────────────────────────────

/**
 * The sign-in in the web view is over: its session, the cookie Access set on the server's host, is kept for `server`
 * and its sign-in no longer shows. False when the web view's store has none (the gate let it through without one).
 */
export async function takeGateSession(server: string): Promise<boolean> {
  const cookies = await webCookies?.get(server).catch(() => null);
  const token = cookies?.[GATE_SESSION_COOKIE] ?? null;
  if (token) {
    sessions.set(server, token);
    await writeValue(perServer(SESSION, server), token);
  }
  clearGateWanted(server);
  return Boolean(token);
}

/**
 * Forgets `server`'s gate session, the app's copy and the web views', with the web views' cookies of the Access team
 * that issued it (its `iss`): with those left, the next request through the team's pages gets a new session without
 * asking anyone (Android's networking follows those redirects with the web views' cookies). The next request asks for
 * the sign-in again (signing out of the server's last account), as the desktop app's sign-out does. Access's own
 * sign-out is left alone: it would end the person's session in every one of the team's apps, and in the browser.
 */
export async function forgetGateSession(server: string): Promise<void> {
  const kept = readValueSync(perServer(SESSION, server));
  const seen = await webCookies?.get(server).catch(() => null);
  const token = kept ?? seen?.[GATE_SESSION_COOKIE] ?? null;
  sessions.set(server, null);
  await writeValue(perServer(SESSION, server), null);
  await webCookies?.remove(server, GATE_SESSION_COOKIE).catch(() => {});
  const team = token ? teamOfSession(token) : null;
  if (!team || !webCookies) return;
  const teamPages = `https://${team}/`;
  const theirs = await webCookies.get(teamPages).catch(() => null);
  for (const name of Object.keys(theirs ?? {})) await webCookies.remove(teamPages, name).catch(() => {});
}
