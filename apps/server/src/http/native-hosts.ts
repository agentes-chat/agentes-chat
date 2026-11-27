/**
 * The addresses of a server that runs on this computer (native mode, `ownHostsOnly`, ADR 0255 §5). It listens on
 * 127.0.0.1 only. The computer that runs it opens it at `http://127.0.0.1:<PORT>`, its loopback origin, and everyone
 * else at `PUBLIC_URL`, which becomes the tailnet's https address once reach is on. Each origin keeps its own sign-in.
 *
 * The loopback origin gets no privilege of its own: nothing here trusts the Host, the peer address (127.0.0.1 is also
 * where `tailscaled` proxies tailnet requests from) or any forwarded header. It only decides which origin a request is
 * answered as, the same way for anyone who can reach it.
 */

/** The loopback name this server answers as itself: `127.0.0.1:<PORT>`. */
export const loopbackHost = (port: number | string) => `127.0.0.1:${port}`;

/** The origin the computer that runs the server opens it at. */
export const loopbackOrigin = (port: number | string) => `http://${loopbackHost(port)}`;

/** The other loopback name a browser may type, sent on to `loopbackHost` so there is one cookie jar. */
const localhostHost = (port: number | string) => `localhost:${port}`;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/**
 * `EXTRA_TRUSTED_ORIGINS` with this server's loopback origin added, as native mode starts (ADR 0255 §5): the
 * window on this computer signs in and saves there while `PUBLIC_URL` is the tailnet's address. Computed on every
 * start, never written to `.env`, so it follows a port move. Only the exact origin: never `localhost`, no wildcard.
 * Unchanged when `PUBLIC_URL` already is that origin or the list already holds it.
 */
export function withLoopbackOrigin(extra: string | undefined, port: number | string, publicUrl: string) {
  const loopback = loopbackOrigin(port);
  if (originOf(publicUrl) === loopback) return extra;
  const entries = (extra ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.some((entry) => entry.replace(/\/+$/, "") === loopback)) return extra;
  return [...entries, loopback].join(",");
}

/**
 * The loopback origin this server trusts besides `PUBLIC_URL` (native mode, `withLoopbackOrigin`), or null: a server
 * whose `PUBLIC_URL` is that origin itself, or one that never added it (Docker, the Cloud).
 */
export function trustedLoopbackOrigin(config: {
  PORT: number;
  PUBLIC_URL: string;
  EXTRA_TRUSTED_ORIGINS?: readonly string[];
}): string | null {
  const loopback = loopbackOrigin(config.PORT);
  if (originOf(config.PUBLIC_URL) === loopback) return null;
  return config.EXTRA_TRUSTED_ORIGINS?.includes(loopback) ? loopback : null;
}

/**
 * Whether a request whose Host is `host` came to one of this server's loopback names while people use another address
 * (`PUBLIC_URL`). Social sign-in is refused there (its provider returns to `PUBLIC_URL`, so the session would land on
 * the other origin), and a connector's sign-in started there comes back there.
 */
export function atLoopbackBesidePublic(config: { PORT: number; PUBLIC_URL: string }, host: string | null | undefined) {
  if (!host) return false;
  const name = host.toLowerCase();
  if (name !== loopbackHost(config.PORT) && name !== localhostHost(config.PORT)) return false;
  return hostOf(config.PUBLIC_URL).toLowerCase() !== name;
}

/** Whether a Host header names a loopback address (any port): HSTS means nothing there and is never sent. */
export function isLoopbackHost(host: string | null | undefined) {
  if (!host) return false;
  const name = host
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  return name === "localhost" || name === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/**
 * The guard in front of a native server (ADR 0255 §5), null where the request goes on:
 * - a Host that isn't one of its names gets a 421 (a page that points a name of its own at 127.0.0.1, DNS rebinding);
 * - `127.0.0.1:<PORT>` and `PUBLIC_URL`'s host are served as themselves, never sent to the other;
 * - a page opened at `localhost:<PORT>` (an HTML GET) goes to `127.0.0.1:<PORT>`, the one loopback cookie jar; its
 *   other requests are answered there as they are.
 */
export function nativeHostGuard({ port, publicUrl }: { port: number; publicUrl: string }) {
  const loopback = loopbackHost(port);
  const localhost = localhostHost(port);
  const people = hostOf(publicUrl).toLowerCase();
  return (req: Request): Response | null => {
    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (host === loopback || (people && host === people)) return null;
    if (host !== localhost) {
      return new Response("This server answers only at its own address.\n", {
        status: 421,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (req.method !== "GET" || !req.headers.get("accept")?.includes("text/html")) return null;
    const { pathname, search } = new URL(req.url);
    return new Response(null, { status: 302, headers: { location: `${loopbackOrigin(port)}${pathname}${search}` } });
  };
}
