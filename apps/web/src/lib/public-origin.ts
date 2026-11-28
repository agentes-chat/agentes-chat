/**
 * The address people open, for every link this page hands out (ADR 0265 §5).
 *
 * The desktop app opens a server that runs on the same computer at its loopback origin (`http://127.0.0.1:<port>`),
 * while everyone else (a phone, the team) uses its `PUBLIC_URL`, the tailnet's address once reach is on. A link copied,
 * shared or shown from that window must name `PUBLIC_URL`: a loopback address opens nowhere else. `auth-config` says
 * what `PUBLIC_URL` is (`publicUrl`); main.tsx hands it here as soon as it answers.
 */

let known: string | null = null;

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
};

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** Whether an origin is a loopback address (this computer only). */
export const isLoopbackOrigin = (origin: string) => {
  try {
    return LOOPBACK_HOST.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/**
 * The origin links use, for a page at `page` on a server whose `PUBLIC_URL` is `publicUrl`: that address when the page
 * is at a loopback origin and people open the server elsewhere; else the page's own origin, as before (a development
 * server whose `PUBLIC_URL` is loopback too keeps its own).
 */
export function publicOriginFor(page: string, publicUrl: string | null | undefined): string {
  const people = originOf(publicUrl);
  return people && people !== page && isLoopbackOrigin(page) && !isLoopbackOrigin(people) ? people : page;
}

/** The origins that are this server's own for a page at `page`: its own, then `PUBLIC_URL`'s when that differs. */
export function ownOriginsFor(page: string, publicUrl: string | null | undefined): string[] {
  const people = originOf(publicUrl);
  return people && people !== page ? [page, people] : [page];
}

/** Remembers the server's `PUBLIC_URL` (`auth-config`'s `publicUrl`); null forgets it. */
export function rememberPublicUrl(publicUrl: string | null | undefined) {
  known = originOf(publicUrl);
}

const pageOrigin = () => (typeof window === "undefined" ? "" : window.location.origin);

/**
 * The origin for a link this page hands out: the server's `PUBLIC_URL` on its loopback origin, else this page's own.
 * Before `auth-config` answers, the page's own.
 */
export const publicOrigin = () => publicOriginFor(pageOrigin(), known);

/** The origins a link may name and still be this server's (to open it in the app): this page's and `PUBLIC_URL`'s. */
export const ownOrigins = () => ownOriginsFor(pageOrigin(), known);
