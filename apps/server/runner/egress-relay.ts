import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { chmodSync, rmSync } from "node:fs";
import { createServer, isIPv6, type Socket } from "node:net";
import { isEgressTarget, STREAM_CLOSE } from "@agenteschat/adapters/machine-protocol";
import { pipeSocket } from "./egress-share";
import type { DataSocket } from "./streams";

/**
 * ADR 0237, on the workspace's own computer: `<runner home>/egress-relay.sock`, a SOCKS5 socket (no authentication,
 * CONNECT only, mode 600: root's network guard alone opens it). Each connection asks the server for a computer a
 * person lent, and goes out through it.
 */
export const EGRESS_RELAY_SOCKET = "egress-relay.sock";

/** SOCKS5 replies (RFC 1928 §6) the guard tells apart: carried, nothing lent now, not carried here, destination failed. */
export const SOCKS_REPLY = {
  ok: 0,
  notAllowed: 2,
  networkUnreachable: 3,
  hostUnreachable: 4,
  notSupported: 7,
} as const;

/** The SOCKS reply for a data socket the server closed before `stream.ready`. */
export function replyFor(closeCode: number | undefined): number {
  if (closeCode === STREAM_CLOSE.refused || closeCode === STREAM_CLOSE.forbidden) return SOCKS_REPLY.notAllowed;
  if (closeCode === STREAM_CLOSE.notFound) return SOCKS_REPLY.hostUnreachable;
  return SOCKS_REPLY.networkUnreachable;
}

const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);

/** A CONNECT request's target, its length in `buf`, or null while more bytes are needed; `false`: not one we take. */
export function parseConnect(buf: Buffer): { host: string; port: number; length: number } | null | false {
  if (buf.length < 4) return null;
  if (buf[0] !== 5 || buf[1] !== 1 || buf[2] !== 0) return false;
  const atyp = buf[3];
  let host: string;
  let at: number;
  if (atyp === 1) {
    if (buf.length < 10) return null;
    host = [...buf.subarray(4, 8)].join(".");
    at = 8;
  } else if (atyp === 3) {
    if (buf.length < 5) return null;
    const n = buf[4] as number;
    if (buf.length < 5 + n + 2) return null;
    host = buf.subarray(5, 5 + n).toString("latin1");
    at = 5 + n;
  } else if (atyp === 4) {
    if (buf.length < 22) return null;
    const words: string[] = [];
    for (let i = 4; i < 20; i += 2) words.push(buf.readUInt16BE(i).toString(16));
    host = words.join(":");
    if (!isIPv6(host)) return false;
    at = 20;
  } else return false;
  return { host, port: buf.readUInt16BE(at), length: at + 2 };
}

/**
 * Serves the socket at `path` until `close`. `dial` opens the data socket that asks for `target` (`stream.hello`
 * with `egress`); a rejection carrying the server's `closeCode` becomes its SOCKS reply.
 */
export function startEgressRelay(o: {
  path: string;
  dial: (streamId: string, target: { host: string; port: number }) => Promise<DataSocket>;
}): { close(): void } {
  rmSync(o.path, { force: true });
  const server = createServer((client) => serve(client, o.dial));
  server.listen(o.path, () => {
    try {
      chmodSync(o.path, 0o600);
    } catch {
      server.close();
    }
  });
  // Bun types `Server` without its EventEmitter side: a failed listen must not throw out of the runner.
  (server as unknown as EventEmitter).on("error", () => undefined);
  return {
    close() {
      server.close();
      rmSync(o.path, { force: true });
    },
  };
}

function serve(
  client: Socket,
  dial: (streamId: string, target: { host: string; port: number }) => Promise<DataSocket>,
) {
  let buf = Buffer.alloc(0);
  let stage: "greeting" | "request" | "dialing" = "greeting";
  client.on("error", () => undefined);
  const timer = setTimeout(() => client.destroy(), 30_000);
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 600) return client.destroy();
    if (stage === "greeting") {
      if (buf.length < 2) return;
      if (buf[0] !== 5) return client.destroy();
      const n = buf[1] as number;
      if (buf.length < 2 + n) return;
      if (!buf.subarray(2, 2 + n).includes(0)) {
        client.end(Buffer.from([5, 0xff]));
        return;
      }
      client.write(Buffer.from([5, 0]));
      buf = buf.subarray(2 + n);
      stage = "request";
    }
    if (stage !== "request") return;
    const target = parseConnect(buf);
    if (target === null) return;
    if (target === false || !isEgressTarget(target)) {
      client.end(reply(target === false ? SOCKS_REPLY.notSupported : SOCKS_REPLY.notAllowed));
      return;
    }
    stage = "dialing";
    client.pause();
    client.off("data", onData);
    const early = buf.subarray(target.length);
    void dial(randomBytes(32).toString("base64url"), { host: target.host, port: target.port }).then(
      (data) => {
        clearTimeout(timer);
        if (client.destroyed) return data.close(STREAM_CLOSE.normal, "");
        client.write(reply(SOCKS_REPLY.ok));
        if (early.length > 0) data.send(new Uint8Array(early));
        pipeSocket(client, data);
      },
      (error: { closeCode?: number }) => {
        clearTimeout(timer);
        client.end(reply(replyFor(error?.closeCode)));
      },
    );
  };
  client.on("data", onData);
}
