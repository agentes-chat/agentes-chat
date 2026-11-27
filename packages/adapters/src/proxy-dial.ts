import { isIP, type Socket, connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

/**
 * A proxy a person chose for agents (ADR 0262): HTTP or HTTPS (CONNECT) or SOCKS5, with an optional user and password.
 * Shared by the server (its test) and the runner (every connection of its agents while one is set).
 */
export interface ProxyAddress {
  scheme: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const DEFAULT_PORT: Record<ProxyAddress["scheme"], number> = { http: 80, https: 443, socks5: 1080 };

/**
 * A proxy address as a person types it (`socks5://user:pass@host:1080`, `http://host:3128`, `socks5h://…`), or null.
 * No path, query or fragment: a proxy has none.
 */
export function parseProxyUrl(raw: string): ProxyAddress | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "").replace(/^socks5h$/, "socks5");
  if (scheme !== "http" && scheme !== "https" && scheme !== "socks5") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || (url.pathname && url.pathname !== "/") || url.search || url.hash) return null;
  const port = url.port ? Number(url.port) : DEFAULT_PORT[scheme];
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (username.length > 255 || password.length > 255) return null;
  return { scheme, host, port, ...(username ? { username, password } : {}) };
}

/** The address back as text, user and password included (for the sealed copy and the runner). */
export function proxyUrlOf(p: ProxyAddress): string {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@` : "";
  const host = isIP(p.host) === 6 ? `[${p.host}]` : p.host;
  return `${p.scheme}://${auth}${host}:${p.port}`;
}

/** What people see of it: never the user or password. */
export const proxyLabel = (p: Pick<ProxyAddress, "scheme" | "host" | "port">) =>
  `${p.scheme}://${isIP(p.host) === 6 ? `[${p.host}]` : p.host}:${p.port}`;

/** Why a proxy didn't carry a connection: it couldn't be reached, refused our user and password, or the destination. */
export class ProxyDialError extends Error {
  constructor(
    readonly reason: "unreachable" | "auth" | "refused",
    message: string,
  ) {
    super(message);
  }
}

/** Reads from `socket` until `done` says how many bytes it took (null: more needed); the rest is put back. */
function readUntil(socket: Socket, done: (buf: Buffer) => number | null, limit = 8192): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const finish = (error?: Error, used?: number) => {
      socket.off("data", onData);
      socket.off("error", onEnd);
      socket.off("close", onEnd);
      if (error) return reject(error);
      const rest = buf.subarray(used);
      if (rest.length > 0) socket.unshift(rest);
      resolve(buf.subarray(0, used));
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const used = done(buf);
      if (used !== null) return finish(undefined, used);
      if (buf.length > limit) finish(new ProxyDialError("refused", "The proxy answered too much"));
    };
    const onEnd = () => finish(new ProxyDialError("unreachable", "The proxy closed the connection"));
    socket.on("data", onData);
    socket.once("error", onEnd);
    socket.once("close", onEnd);
  });
}

/**
 * A SOCKS5 request's address: IPv4 as one, anything else by name (the proxy resolves it; an IPv6 literal it reads too).
 *
 * ponytail: no IPv6 address type; add one if a proxy refuses literals as names.
 */
function socksAddress(host: string): Buffer {
  if (isIP(host) === 4) return Buffer.from([1, ...host.split(".").map(Number)]);
  const name = Buffer.from(host, "latin1");
  return Buffer.concat([Buffer.from([3, name.length]), name]);
}

const SOCKS_REPLY_LENGTH = (buf: Buffer) => {
  if (buf.length < 5) return null;
  const n = buf[3] === 1 ? 4 : buf[3] === 4 ? 16 : buf[3] === 3 ? 1 + (buf[4] as number) : 0;
  return buf.length >= 4 + n + 2 ? 4 + n + 2 : null;
};

/**
 * One TCP connection to `host:port` through the proxy, ready for the destination's bytes. Rejects with a
 * `ProxyDialError` (unreachable proxy, refused sign-in, destination refused) within `timeoutMs`.
 */
export async function dialViaProxy(
  proxy: ProxyAddress,
  host: string,
  port: number,
  o: { timeoutMs?: number; connect?: (host: string, port: number) => Socket } = {},
): Promise<Socket> {
  const timeoutMs = o.timeoutMs ?? 10_000;
  const raw = (o.connect ?? ((h, p) => tcpConnect({ host: h, port: p })))(proxy.host, proxy.port);
  const socket: Socket =
    proxy.scheme === "https" ? tlsConnect({ socket: raw, servername: isIP(proxy.host) ? undefined : proxy.host }) : raw;
  const timer = setTimeout(
    () => socket.destroy(new ProxyDialError("unreachable", "The proxy didn't answer in time")),
    timeoutMs,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once(proxy.scheme === "https" ? "secureConnect" : "connect", () => resolve());
      socket.once("error", (e) =>
        reject(e instanceof ProxyDialError ? e : new ProxyDialError("unreachable", "The proxy couldn't be reached")),
      );
    });
    const target = isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
    if (proxy.scheme !== "socks5") {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}\r\n`
        : "";
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
      const head = await readUntil(socket, (b) => {
        const end = b.indexOf("\r\n\r\n");
        return end < 0 ? null : end + 4;
      });
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.toString("latin1"))?.[1] ?? 0);
      if (status === 407) throw new ProxyDialError("auth", "The proxy refused the user or password");
      if (status !== 200) throw new ProxyDialError("refused", `The proxy answered ${status || "something else"}`);
      return socket;
    }
    socket.write(Buffer.from(proxy.username ? [5, 2, 0, 2] : [5, 1, 0]));
    const [, method] = await readUntil(socket, (b) => (b.length >= 2 ? 2 : null));
    if (method === 2) {
      const user = Buffer.from(proxy.username ?? "");
      const pass = Buffer.from(proxy.password ?? "");
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const [, ok] = await readUntil(socket, (b) => (b.length >= 2 ? 2 : null));
      if (ok !== 0) throw new ProxyDialError("auth", "The proxy refused the user or password");
    } else if (method !== 0) {
      throw new ProxyDialError("auth", "The proxy asks for a sign-in it wasn't given");
    }
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(host), portBytes]));
    const reply = await readUntil(socket, SOCKS_REPLY_LENGTH);
    if (reply[1] !== 0) throw new ProxyDialError("refused", `The proxy didn't reach ${target}`);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error instanceof ProxyDialError ? error : new ProxyDialError("unreachable", "The proxy couldn't be reached");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where agents come out through the proxy: one request through it to a public echo of the caller's address and
 * country (Cloudflare's trace, which every network reaches). Rejects with a `ProxyDialError`.
 */
export async function proxyExit(
  proxy: ProxyAddress,
  o: { timeoutMs?: number; connect?: (host: string, port: number) => Socket } = {},
): Promise<{ ip: string; country: string | null }> {
  const host = "www.cloudflare.com";
  const tunnel = await dialViaProxy(proxy, host, 443, o);
  const tls = tlsConnect({ socket: tunnel, servername: host });
  try {
    await new Promise<void>((resolve, reject) => {
      tls.once("secureConnect", () => resolve());
      tls.once("error", () => reject(new ProxyDialError("refused", "The proxy's connection broke")));
    });
    tls.write(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: agentes.chat\r\n\r\n`);
    const body = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timer = setTimeout(
        () => reject(new ProxyDialError("unreachable", "No answer through the proxy")),
        o.timeoutMs ?? 10_000,
      );
      tls.on("data", (c: Buffer) => {
        text += c.toString("utf8");
        if (text.length > 16_384) tls.destroy();
      });
      tls.once("close", () => {
        clearTimeout(timer);
        resolve(text);
      });
      tls.once("error", () => undefined);
    });
    const ip = /^ip=(.+)$/m.exec(body)?.[1]?.trim();
    if (!ip || !isIP(ip)) throw new ProxyDialError("refused", "The answer through the proxy had no address");
    const loc = /^loc=([A-Z]{2})$/m.exec(body)?.[1];
    return { ip, country: loc && loc !== "XX" ? loc : null };
  } finally {
    tls.destroy();
  }
}
