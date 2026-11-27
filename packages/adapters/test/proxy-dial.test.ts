import { afterEach, expect, test } from "bun:test";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dialViaProxy, ProxyDialError, parseProxyUrl, proxyLabel, proxyUrlOf } from "../src/proxy-dial";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const listen = (server: Server) =>
  new Promise<number>((done) => {
    servers.push(server);
    server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port));
  });

/** A site that answers "hi " plus what it got. */
const echo = () => listen(createServer((s) => s.on("data", (d) => s.write(Buffer.concat([Buffer.from("hi "), d])))));

/** Pipes a proxy's client to `port` on this computer, whatever host it named; `seen` gets the targets. */
const tunnel = (client: Socket, port: number, rest: Buffer) => {
  const up = connect(port, "127.0.0.1");
  if (rest.length) up.write(rest);
  up.pipe(client);
  client.pipe(up);
};

/** An HTTP CONNECT proxy that asks for `user:pass` and sends everything to `to`. */
const httpProxy = (to: number, seen: string[]) =>
  listen(
    createServer((client) => {
      let buf = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        client.off("data", onData);
        const head = buf.subarray(0, end).toString();
        seen.push(head.split(" ")[1] ?? "");
        if (!head.includes(`Proxy-Authorization: Basic ${Buffer.from("ana:s3cr:t").toString("base64")}`)) {
          client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
          return;
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnel(client, to, buf.subarray(end + 4));
      };
      client.on("data", onData);
    }),
  );

/** A SOCKS5 proxy with user and password `ana`/`pw`. */
const socksProxy = (to: number, seen: string[]) =>
  listen(
    createServer((client) => {
      let stage = 0;
      let buf = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (stage === 0 && buf.length >= 2 + (buf[1] as number)) {
          client.write(Buffer.from([5, 2]));
          buf = buf.subarray(2 + (buf[1] as number));
          stage = 1;
        }
        if (stage === 1 && buf.length >= 2) {
          const ul = buf[1] as number;
          if (buf.length < 3 + ul) return;
          const pl = buf[2 + ul] as number;
          if (buf.length < 3 + ul + pl) return;
          const user = buf.subarray(2, 2 + ul).toString();
          const pass = buf.subarray(3 + ul, 3 + ul + pl).toString();
          buf = buf.subarray(3 + ul + pl);
          if (user !== "ana" || pass !== "pw") return client.end(Buffer.from([1, 1]));
          client.write(Buffer.from([1, 0]));
          stage = 2;
        }
        if (stage === 2 && buf.length >= 5 && buf[3] === 3) {
          const n = buf[4] as number;
          if (buf.length < 7 + n) return;
          seen.push(`${buf.subarray(5, 5 + n).toString()}:${buf.readUInt16BE(5 + n)}`);
          client.off("data", onData);
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          tunnel(client, to, buf.subarray(7 + n));
        }
      };
      client.on("data", onData);
    }),
  );

const talk = (s: Socket, text: string) =>
  new Promise<string>((done) => {
    s.once("data", (d) => done(d.toString()));
    s.write(text);
  });

test("proxy addresses: the schemes we speak, a default port, the password kept apart from what people see", () => {
  expect(parseProxyUrl("socks5://ana:p%40ss@proxy.example.com:1080")).toEqual({
    scheme: "socks5",
    host: "proxy.example.com",
    port: 1080,
    username: "ana",
    password: "p@ss",
  });
  expect(parseProxyUrl("socks5h://proxy.example.com")).toMatchObject({ scheme: "socks5", port: 1080 });
  expect(parseProxyUrl("http://proxy.example.com:3128")).toEqual({
    scheme: "http",
    host: "proxy.example.com",
    port: 3128,
  });
  for (const bad of ["ftp://x.example.com", "http://x.example.com/path", "not a url", "socks4://x.example.com"]) {
    expect(parseProxyUrl(bad)).toBeNull();
  }
  const p = parseProxyUrl("https://ana:p%40ss@proxy.example.com:8443");
  if (!p) throw new Error("no proxy");
  expect(parseProxyUrl(proxyUrlOf(p))).toEqual(p);
  expect(proxyLabel(p)).toBe("https://proxy.example.com:8443");
});

test("through an HTTP CONNECT proxy and a SOCKS5 one, signed in; a wrong password is said as such", async () => {
  const site = await echo();
  const seen: string[] = [];
  const http = await httpProxy(site, seen);
  const viaHttp = await dialViaProxy(
    { scheme: "http", host: "127.0.0.1", port: http, username: "ana", password: "s3cr:t" },
    "site.example.com",
    443,
  );
  expect(await talk(viaHttp, "there")).toBe("hi there");
  viaHttp.destroy();
  expect(seen).toEqual(["site.example.com:443"]);

  const socks = await socksProxy(site, seen);
  const viaSocks = await dialViaProxy(
    { scheme: "socks5", host: "127.0.0.1", port: socks, username: "ana", password: "pw" },
    "other.example.com",
    80,
  );
  expect(await talk(viaSocks, "you")).toBe("hi you");
  viaSocks.destroy();
  expect(seen).toEqual(["site.example.com:443", "other.example.com:80"]);

  for (const proxy of [
    { scheme: "http" as const, host: "127.0.0.1", port: http, username: "ana", password: "no" },
    { scheme: "socks5" as const, host: "127.0.0.1", port: socks, username: "ana", password: "no" },
  ]) {
    const refused = await dialViaProxy(proxy, "site.example.com", 443).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ProxyDialError);
    expect((refused as ProxyDialError).reason).toBe("auth");
  }
  // Nothing listens there: unreachable, not a hang.
  const closed = await listen(createServer());
  servers.pop()?.close();
  const gone = await dialViaProxy({ scheme: "socks5", host: "127.0.0.1", port: closed }, "x.example.com", 443, {
    timeoutMs: 2_000,
  }).catch((e: unknown) => e);
  expect((gone as ProxyDialError).reason).toBe("unreachable");
});
