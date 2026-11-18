/**
 * Cloudflare Access as a gate in front of a server (ADR 0195 §10), the phone's side: how Access says it wants its
 * sign-in, and the session the sign-in leaves. Pure.
 *
 * Access turns away every request without a session, WebSocket upgrades included: a redirect to the team's sign-in
 * page (`https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<server's host>`), which React Native's `fetch`
 * follows, so the answer that comes back is that page; or, to some clients, a 401 naming itself in `WWW-Authenticate`.
 * The person signs in on that page in a web view; the session is the `CF_Authorization` cookie Access sets on the
 * server's host as the sign-in ends, a JWT, which the app then sends as a cookie with every request to that server.
 */

/** The cookie Access keeps the person's session in, on the server's host. */
export const GATE_SESSION_COOKIE = "CF_Authorization";

/** Every Access team's own pages are under this domain. */
const TEAM_DOMAIN = ".cloudflareaccess.com";
const LOGIN_PATH = "/cdn-cgi/access/login/";
/** Access's own paths on the server's host (the end of a sign-in lands on `/cdn-cgi/access/authorized`). */
const OWN_PATHS = "/cdn-cgi/";

const urlOf = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** A team's own host (`<team>.cloudflareaccess.com`, one label, https on its default port), or null. */
export function teamHost(value: string): string | null {
  const url = urlOf(value);
  if (url?.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(TEAM_DOMAIN)) return null;
  return /^[a-z0-9-]+$/.test(host.slice(0, -TEAM_DOMAIN.length)) ? host : null;
}

/** Whether `value` is a team's sign-in page for `server` (an https origin). */
export function signsInTo(value: string, server: string): boolean {
  const site = urlOf(server);
  const url = urlOf(value);
  if (!site || !url || site.protocol !== "https:" || teamHost(value) === null) return false;
  if (!url.pathname.startsWith(LOGIN_PATH)) return false;
  return url.pathname.slice(LOGIN_PATH.length).split("/")[0]?.toLowerCase() === site.hostname.toLowerCase();
}

/**
 * Whether an answer to a request to `server` is Access turning it away: the sign-in page a redirect led to (`url` is
 * where the request ended), a redirect to it not followed, or Access named in `WWW-Authenticate`.
 */
export function gateWantsSignIn(
  answer: { status: number; url: string; headers: { get(name: string): string | null } },
  server: string,
): boolean {
  if (answer.headers.get("www-authenticate")?.trimStart().startsWith("Cloudflare-Access")) return true;
  if (answer.url && signsInTo(answer.url, server)) return true;
  const location = answer.status >= 300 && answer.status < 400 ? answer.headers.get("location") : null;
  return location !== null && signsInTo(location, server);
}

/**
 * Whether the sign-in's web view is back on the server's own pages (not Access's, which are under `/cdn-cgi/` there):
 * the sign-in is over and the session cookie is set.
 */
export function backOnServer(value: string, server: string): boolean {
  const site = urlOf(server);
  const url = urlOf(value);
  return Boolean(site && url && url.origin === site.origin && !url.pathname.startsWith(OWN_PATHS));
}

/** The pages the sign-in's web view may show: the server's own and its team's. Anything else opens outside the app. */
export function stayInSignIn(value: string, server: string): boolean {
  const site = urlOf(server);
  const url = urlOf(value);
  if (!site || !url) return false;
  if (url.protocol === "about:" || url.protocol === "data:" || url.protocol === "blob:") return true;
  return url.origin === site.origin || teamHost(value) !== null;
}

/** A session's claims (a JWT's payload), read, not verified (Access verifies it); null when it isn't one. */
function claimsOf(jwt: string): Record<string, unknown> | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")));
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The team host a session was issued by: its `iss`, `https://<team>.cloudflareaccess.com`; null otherwise. */
export function teamOfSession(jwt: string): string | null {
  const iss = claimsOf(jwt)?.iss;
  return typeof iss === "string" ? teamHost(iss) : null;
}

/**
 * When a session (a JWT) ends, in milliseconds since the epoch, from its `exp`: read, not verified (Access verifies
 * it); null when it has none or isn't one.
 */
export function sessionExpiry(jwt: string): number | null {
  const exp = claimsOf(jwt)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

/** A session cookie's pair to add to a request's `Cookie` header, or "" without one. */
export const gateCookiePair = (token: string | null | undefined): string =>
  token ? `${GATE_SESSION_COOKIE}=${token}` : "";

/** Two `Cookie` header values as one (either may be empty). */
export const joinCookies = (a: string, b: string): string => [a, b].filter(Boolean).join("; ");
