import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { isEgressTarget, parseStreamHello, STREAM_CLOSE } from "@agenteschat/adapters/machine-protocol";
import { parseConnect, replyFor, SOCKS_REPLY, startEgressRelay } from "../../runner/egress-relay";
import { EgressShare } from "../../runner/egress-share";
import type { DataListener, DataSocket } from "../../runner/streams";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** A data socket in memory: what was sent on it, and a way to play the server's side. */
function fakeData() {
  const sent: Uint8Array[] = [];
  let listener: DataListener | null = null;
  let closed = false;
  const socket: DataSocket = {
    send: (data) => {
      if (typeof data !== "string") sent.push(data);
    },
    close: () => {
      if (closed) return;
      closed = true;
      listener?.closed();
    },
    bufferedAmount: 0,
    listen: (on) => {
      listener = on;
    },
  };
  return { socket, sent, peer: (bytes: Uint8Array) => listener?.bytes(bytes), isClosed: () => closed };
}

/** A TCP server on this computer that echoes what it hears, uppercased. */
async function echo(): Promise<{ port: number; server: Server }> {
  const server = createServer((s) => s.on("data", (d: Buffer) => s.write(d.toString().toUpperCase())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => server.close());
  return { port: (server.address() as { port: number }).port, server };
}

const until = async (done: () => boolean, what = "condition") => {
  for (let i = 0; i < 400; i++) {
    if (done()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const STREAM = "s".repeat(43);

test("what a lent connection carries: the web's ports, a plain host; a hello may ask for one", () => {
  expect(isEgressTarget({ host: "gov.example", port: 443 })).toBe(true);
  expect(isEgressTarget({ host: "203.0.113.4", port: 80 })).toBe(true);
  for (const bad of [
    { host: "gov.example", port: 22 },
    { host: "gov.example", port: 25 },
    { host: "a b", port: 443 },
    { host: "", port: 443 },
    { host: "x".repeat(254), port: 443 },
  ])
    expect(isEgressTarget(bad)).toBe(false);
  const hello = { type: "stream.hello", token: "agm_x", streamId: STREAM };
  expect(parseStreamHello(JSON.stringify({ ...hello, egress: { host: "gov.example", port: 443 } }))).toEqual({
    ...hello,
    type: "stream.hello",
    egress: { host: "gov.example", port: 443 },
  });
  expect(parseStreamHello(JSON.stringify({ ...hello, egress: { host: "gov.example", port: 25 } }))).toBeNull();
});

test("a lent connection reaches only public addresses, on the web's ports, and carries the bytes both ways", async () => {
  const { port } = await echo();
  const share = new EgressShare({
    resolve: async (host) => (host === "lan.example" ? ["192.168.1.1"] : ["203.0.113.7"]),
    // The site is this test's server: the address it was resolved to is the one checked.
    connect: (address) => {
      expect(address).toBe("203.0.113.7");
      return connect({ host: "127.0.0.1", port });
    },
  });
  const dial = (host: string, p = 443) =>
    share.dial({ op: "egress.dial", streamId: STREAM, host, port: p }, async () => data.socket);
  const data = fakeData();

  await expect(dial("lan.example")).rejects.toMatchObject({ code: "not_allowed" });
  await expect(dial("127.0.0.1")).rejects.toMatchObject({ code: "not_allowed" });
  await expect(dial("gov.example", 22)).rejects.toMatchObject({ code: "bad_request" });

  expect(await dial("gov.example")).toEqual({ connected: true });
  data.peer(new TextEncoder().encode("hello"));
  await until(() => data.sent.length > 0, "the echo");
  expect(new TextDecoder().decode(data.sent[0])).toBe("HELLO");
  expect(share.today).toBe(10);
  data.socket.close();
});

test("a lent connection never reaches this computer's own networks, though their addresses are global", async () => {
  const { port } = await echo();
  const share = new EgressShare({
    resolve: async (host) => ({ "router.example": ["2001:db8:1::1"], "office.example": ["198.51.100.1"] })[host] ?? [],
    connect: () => connect({ host: "127.0.0.1", port }),
    interfaces: () => ({
      en0: [
        {
          address: "2001:db8:1::5",
          cidr: "2001:db8:1::5/64",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "",
          internal: false,
          scopeid: 0,
        },
        {
          address: "198.51.100.20",
          cidr: "198.51.100.20/24",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "",
          internal: false,
        },
      ],
    }),
  });
  const data = fakeData();
  const dial = (host: string) =>
    share.dial({ op: "egress.dial", streamId: STREAM, host, port: 443 }, async () => data.socket);
  await expect(dial("router.example")).rejects.toMatchObject({ code: "not_allowed" });
  await expect(dial("office.example")).rejects.toMatchObject({ code: "not_allowed" });
  await expect(dial("2001:db8:1::5")).rejects.toMatchObject({ code: "not_allowed" });
  await expect(dial("::ffff:198.51.100.1")).rejects.toMatchObject({ code: "not_allowed" });
  expect(await dial("2001:db8:2::1")).toEqual({ connected: true });
  data.socket.close();
});

test("a day's cap: past it, new connections are refused and an open one ends; it is kept across restarts", async () => {
  const { port } = await echo();
  const dir = mkdtempSync(path.join(tmpdir(), "egress-share-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "egress-share.json");
  const opts = {
    file,
    resolve: async () => ["203.0.113.7"],
    connect: () => connect({ host: "127.0.0.1", port }),
    limits: { dailyBytes: 8 },
  };
  const share = new EgressShare(opts);
  const data = fakeData();
  await share.dial({ op: "egress.dial", streamId: STREAM, host: "gov.example", port: 443 }, async () => data.socket);
  data.peer(new TextEncoder().encode("12345"));
  await until(() => data.isClosed(), "the cap to end it");
  await expect(
    new EgressShare(opts).dial(
      { op: "egress.dial", streamId: STREAM, host: "gov.example", port: 443 },
      async () => fakeData().socket,
    ),
  ).rejects.toMatchObject({ code: "no_slot" });
});

test("the workspace's computer's socket: SOCKS5 CONNECT, mode 600, the server's refusal as its reply", async () => {
  expect(parseConnect(Buffer.from([5, 1, 0, 3, 11, ...Buffer.from("gov.example"), 1, 187]))).toEqual({
    host: "gov.example",
    port: 443,
    length: 18,
  });
  expect(parseConnect(Buffer.from([5, 1, 0, 1, 203, 0, 113, 9, 0, 80]))).toEqual({
    host: "203.0.113.9",
    port: 80,
    length: 10,
  });
  expect(parseConnect(Buffer.from([5, 2, 0, 1]))).toBe(false);
  expect(replyFor(STREAM_CLOSE.unreachable)).toBe(SOCKS_REPLY.networkUnreachable);
  expect(replyFor(STREAM_CLOSE.refused)).toBe(SOCKS_REPLY.notAllowed);
  expect(replyFor(STREAM_CLOSE.notFound)).toBe(SOCKS_REPLY.hostUnreachable);

  const dir = mkdtempSync(path.join(tmpdir(), "egress-relay-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const sock = path.join(dir, "egress-relay.sock");
  const data = fakeData();
  const asked: { host: string; port: number }[] = [];
  const relay = startEgressRelay({
    path: sock,
    dial: async (_id, target) => {
      asked.push(target);
      if (target.host === "nobody.example")
        throw Object.assign(new Error("none"), { closeCode: STREAM_CLOSE.unreachable });
      return data.socket;
    },
  });
  cleanup.push(() => relay.close());
  await until(() => {
    try {
      return (statSync(sock).mode & 0o777) === 0o600;
    } catch {
      return false;
    }
  }, "the socket");

  const ask = async (host: string, payload?: string) => {
    const client: Socket = connect(sock);
    const heard: Buffer[] = [];
    client.on("data", (d: Buffer) => heard.push(d));
    client.write(Buffer.from([5, 1, 0]));
    client.write(Buffer.from([5, 1, 0, 3, host.length, ...Buffer.from(host), 1, 187]));
    await until(() => Buffer.concat(heard).length >= 12, "the replies");
    if (payload) client.write(payload);
    return { client, heard };
  };
  const ok = await ask("gov.example", "GET /");
  expect([...Buffer.concat(ok.heard).subarray(0, 4)]).toEqual([5, 0, 5, SOCKS_REPLY.ok]);
  await until(() => data.sent.length > 0, "the request bytes");
  expect(new TextDecoder().decode(data.sent[0])).toBe("GET /");
  data.peer(new TextEncoder().encode("200 OK"));
  await until(() => Buffer.concat(ok.heard).toString().endsWith("200 OK"), "the answer");
  ok.client.destroy();

  const none = await ask("nobody.example");
  expect(Buffer.concat(none.heard)[3]).toBe(SOCKS_REPLY.networkUnreachable);
  none.client.destroy();
  expect(asked).toEqual([
    { host: "gov.example", port: 443 },
    { host: "nobody.example", port: 443 },
  ]);
});
