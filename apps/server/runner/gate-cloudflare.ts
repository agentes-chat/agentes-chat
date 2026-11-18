/**
 * Cloudflare Access as a gate in front of the server (ADR 0195, `gate.ts`): what it takes from a program and how it
 * says it wants its sign-in.
 *
 * Access takes either the person's own session, `cf-access-token: <JWT>` (the `CF_Authorization` cookie the desktop
 * app's window got when the person signed in there), or a service token, `CF-Access-Client-Id` and
 * `CF-Access-Client-Secret`, for a computer nobody signs in on. Without either it redirects every request, WebSocket
 * upgrades included, to the team's sign-in page, and names itself in `WWW-Authenticate`.
 */

export const CLOUDFLARE_ACCESS = "cloudflare-access";

export interface CloudflareAccessCredentials {
  kind: typeof CLOUDFLARE_ACCESS;
  /** The person's Access session (`CF_Authorization`), a JWT. */
  token?: string;
  /** A service token's id and secret. */
  clientId?: string;
  clientSecret?: string;
}

/** Every Access team's own pages are under this domain. */
const TEAM_DOMAIN = ".cloudflareaccess.com";
const LOGIN_PATH = "/cdn-cgi/access/login/";

/** The headers Access reads; empty when the credentials hold nothing usable (half a service token). */
export function cloudflareAccessHeaders(c: CloudflareAccessCredentials): Record<string, string> {
  const headers: Record<string, string> = {};
  if (c.clientId && c.clientSecret) {
    headers["CF-Access-Client-Id"] = c.clientId;
    headers["CF-Access-Client-Secret"] = c.clientSecret;
  }
  if (c.token) headers["cf-access-token"] = c.token;
  return headers;
}

/** A team's sign-in page (`https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…`). */
function isTeamSignIn(location: string | null, base: string): boolean {
  if (!location) return false;
  try {
    const url = new URL(location, base);
    const team = url.hostname.endsWith(TEAM_DOMAIN) ? url.hostname.slice(0, -TEAM_DOMAIN.length) : "";
    return url.protocol === "https:" && /^[a-z0-9-]+$/.test(team) && url.pathname.startsWith(LOGIN_PATH);
  } catch {
    return false;
  }
}

/** Whether an answer is Access turning the request away: a redirect to its sign-in, or its `WWW-Authenticate`. */
export function cloudflareAccessWantsSignIn(status: number, headers: Headers, url: string): boolean {
  if (headers.get("www-authenticate")?.trimStart().startsWith("Cloudflare-Access")) return true;
  return status >= 300 && status < 400 && isTeamSignIn(headers.get("location"), url);
}
