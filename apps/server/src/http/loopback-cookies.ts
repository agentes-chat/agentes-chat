/**
 * The sign-in cookies of a native server's loopback origin (ADR 0256 §5).
 *
 * Better Auth names its cookies from `PUBLIC_URL` once for every host: `__Secure-better-auth.<x>` with `Secure` when
 * it is https (the tailnet's address once reach is on), `better-auth.<x>` otherwise. On `http://127.0.0.1:<PORT>` that
 * breaks twice: a `Secure` cookie isn't kept or sent over http by every webview, and the name changes when reach turns
 * on or off, so the window on this computer would be signed out each time. Cookies of 127.0.0.1 are also shared by
 * every port, so another server there would overwrite them.
 *
 * So on Host `127.0.0.1:<PORT>` alone:
 * - a request's `agentes-<PORT>.<x>` cookies are handed to the app under the names Better Auth expects, and its own
 *   names (another server's on 127.0.0.1) are dropped;
 * - a response's `Set-Cookie` named `(__Secure-)better-auth.<x>` is renamed `agentes-<PORT>.<x>`, and `Secure` leaves
 *   every `Set-Cookie`.
 * Better Auth signs only a cookie's value, and the multi-session cookies keep their `_multi-<token>` suffix, so a
 * renamed cookie stays valid. The tailnet's host (`tailscale serve` keeps the Host) keeps the names and flags as is.
 */

const BETTER_AUTH = /^(?:__Secure-)?better-auth\.(.+)$/;

/** The prefix of this server's loopback cookie names. */
export const loopbackCookiePrefix = (port: number | string) => `agentes-${port}.`;

/** One `Cookie` header's pairs, in order, as written (a value may hold `=`). */
function cookiePairs(header: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    pairs.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
  }
  return pairs;
}

/** `Set-Cookie` with its name renamed when it is one of Better Auth's, and without `Secure`. */
function rewriteSetCookie(line: string, prefix: string): string {
  const at = line.indexOf("=");
  const name = at > 0 ? line.slice(0, at).trim() : "";
  const own = BETTER_AUTH.exec(name);
  const renamed = own ? `${prefix}${own[1]}${line.slice(at)}` : line;
  return renamed
    .split(";")
    .filter((attribute, i) => i === 0 || attribute.trim().toLowerCase() !== "secure")
    .join(";");
}

export interface LoopbackCookies {
  /** Whether this request came to the loopback host, where the cookies are renamed. */
  applies(req: Request): boolean;
  /** Renames the request's cookies in place (its headers stay the same object, so a WebSocket upgrade still works). */
  request(req: Request): void;
  /** The response with its `Set-Cookie` renamed and without `Secure`; the same response when it sets none. */
  response(res: Response): Response;
}

export function loopbackCookies({ port, publicUrl }: { port: number; publicUrl: string }): LoopbackCookies {
  const host = `127.0.0.1:${port}`;
  const prefix = loopbackCookiePrefix(port);
  const appPrefix = publicUrl.startsWith("https:") ? "__Secure-better-auth." : "better-auth.";
  return {
    applies: (req) => (req.headers.get("host") ?? "").toLowerCase() === host,
    request(req) {
      const header = req.headers.get("cookie");
      if (!header) return;
      const kept: string[] = [];
      for (const [name, value] of cookiePairs(header)) {
        // Better Auth's own names on 127.0.0.1 are another server's (or this one's from before): never read here.
        if (BETTER_AUTH.test(name)) continue;
        kept.push(name.startsWith(prefix) ? `${appPrefix}${name.slice(prefix.length)}=${value}` : `${name}=${value}`);
      }
      if (kept.length) req.headers.set("cookie", kept.join("; "));
      else req.headers.delete("cookie");
    },
    response(res) {
      const lines = res.headers.getSetCookie();
      if (lines.length === 0) return res;
      const headers = new Headers(res.headers);
      headers.delete("set-cookie");
      for (const line of lines) headers.append("set-cookie", rewriteSetCookie(line, prefix));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
  };
}

/**
 * `fetch` behind the loopback cookies: the request renamed before `next`, the response after. Other hosts pass
 * through untouched. `next` answering nothing (a WebSocket upgraded) stays nothing.
 */
export function withLoopbackCookies<Args extends unknown[]>(
  cookies: LoopbackCookies,
  next: (req: Request, ...args: Args) => Response | undefined | Promise<Response | undefined>,
) {
  return async (req: Request, ...args: Args): Promise<Response | undefined> => {
    if (!cookies.applies(req)) return next(req, ...args);
    cookies.request(req);
    const res = await next(req, ...args);
    return res ? cookies.response(res) : res;
  };
}
