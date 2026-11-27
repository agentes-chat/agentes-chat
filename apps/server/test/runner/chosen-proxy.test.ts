import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProxyAddress } from "@agenteschat/adapters/proxy-dial";
import { startEgressProxy, startEgressRelay } from "../../runner/egress-relay";

// ADR 0262: a proxy the workspace chose comes before lending and the usual way, and never falls back to them.

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const listen = (server: Server, at?: string) =>
  new Promise<number>((done) => {
    cleanup.push(() => server.close());
    const ready = () => done(at ? 0 : (server.address() as { port: number }).port);
    if (at) server.listen(at, ready);
    else server.listen(0, "127.0.0.1", ready);
  });

/** A CONNECT proxy that sends every tunnel to a site answering "hi " plus what it got; `seen`: the targets. */
async function chosenProxy(seen: string[]) {
  const site = await listen(
    createServer((s) => {
      s.on("data", (d: Buffer) => s.write(Buffer.concat([Buffer.from("hi "), d])));
    }),
  );
  return listen(
    createServer((client) => {
      client.once("data", (d) => {
        seen.push(d.toString().split(" ")[1] ?? "");
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const up = connect(site, "127.0.0.1");
        up.pipe(client);
        client.pipe(up);
      });
    }),
  );
}

/** One HTTP CONNECT through the loopback proxy: its status line, then what "there" got back. */
function through(port: number, target: string) {
  return new Promise<{ status: string; echo: string }>((done) => {
    const s: Socket = connect(port, "127.0.0.1");
    let status = "";
    s.on("data", (d) => {
      const text = d.toString();
      if (!status) {
        status = text.split("\r\n")[0] ?? "";
        if (!status.includes(" 200 ")) return done({ status, echo: "" });
        s.write("there");
        return;
      }
      done({ status, echo: text });
      s.destroy();
    });
    s.on("close", () => done({ status, echo: "" }));
    s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  });
}

const home = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chosen-proxy-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("a computer's loopback proxy goes through the chosen proxy, before a lent internet, and never another way when it fails", async () => {
  const seen: string[] = [];
  const port = await chosenProxy(seen);
  let chosen: ProxyAddress | null = { scheme: "http", host: "127.0.0.1", port };
  let lent = 0;
  let direct = 0;
  const loopback = await startEgressProxy({
    home: home(),
    dial: async () => {
      lent++;
      throw { closeCode: 4000 };
    },
    lent: () => true,
    upstream: () => chosen,
    connect: (host, p) => {
      direct++;
      return connect(p, host);
    },
  });
  cleanup.push(() => loopback.close());
  expect(await through(loopback.port, "site.example.com:443")).toEqual({
    status: "HTTP/1.1 200 Connection Established",
    echo: "hi there",
  });
  expect(seen).toEqual(["site.example.com:443"]);
  expect({ lent, direct }).toEqual({ lent: 0, direct: 0 });

  // The proxy is down: the connection fails here, neither lent nor direct.
  const closed = await listen(createServer());
  cleanup.pop()?.();
  chosen = { scheme: "http", host: "127.0.0.1", port: closed };
  expect((await through(loopback.port, "site.example.com:443")).status).toBe("HTTP/1.1 502 Bad Gateway");
  expect({ lent, direct }).toEqual({ lent: 0, direct: 0 });
});

test("the managed computer's guard socket answers SOCKS reply 5 when the chosen proxy fails, so the guard sends it nowhere else", async () => {
  const dir = home();
  const socket = path.join(dir, "egress-relay.sock");
  const closed = await listen(createServer());
  cleanup.pop()?.();
  let lent = 0;
  const relay = startEgressRelay({
    path: socket,
    dial: async () => {
      lent++;
      throw { closeCode: 4000 };
    },
    upstream: () => ({ scheme: "socks5", host: "127.0.0.1", port: closed }),
  });
  cleanup.push(() => relay.close());
  await Bun.sleep(20);
  const reply = await new Promise<number>((done) => {
    const s = connect(socket);
    let stage = 0;
    s.on("data", (d) => {
      if (stage++ === 0) s.write(Buffer.from([5, 1, 0, 1, 1, 1, 1, 1, 1, 187]));
      else {
        done(d[1] as number);
        s.destroy();
      }
    });
    s.write(Buffer.from([5, 1, 0]));
  });
  expect(reply).toBe(5);
  expect(lent).toBe(0);
});
