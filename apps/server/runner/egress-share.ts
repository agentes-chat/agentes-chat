import { lookup } from "node:dns/promises";
import { isIP, type Socket, connect as tcpConnect } from "node:net";
import {
  EGRESS_SHARE,
  isEgressTarget,
  isStreamId,
  type MachineReplies,
  type MachineRequest,
  STREAM_CLOSE,
} from "@agenteschat/adapters/machine-protocol";
import { onOwnNetwork, publicAddress } from "./egress";
import { RunnerError } from "./errors";
import { readJson, writeJson } from "./json-file";
import type { DataSocket } from "./streams";

/** What this computer lent today (UTC), in `<runner home>/egress-share.json`, so a restart doesn't reset the cap. */
export const EGRESS_SHARE_FILE = "egress-share.json";
/** Reading from the destination pauses while the data socket holds more than this. */
const HIGH_WATER = 1024 * 1024;
const RESUME_POLL_MS = 25;

type Usage = { day: string; bytes: number };
type Limits = { dailyBytes: number; open: number; connectMs: number };

const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * ADR 0237, on a person's computer: `egress.dial` opens one web connection for the workspace's own computer and
 * carries it on a data socket. Only a public address is reached (the person's own network never is), only on
 * `EGRESS_SHARE.ports`, at most `open` at once and `dailyBytes` a day.
 */
export class EgressShare {
  private open = 0;
  private usage: Usage;
  private readonly limits: Limits;

  constructor(
    private readonly o: {
      /** Where today's count is kept; none: only in memory. */
      file?: string;
      resolve?: (host: string) => Promise<string[]>;
      connect?: (host: string, port: number) => Socket;
      /** This computer's interfaces (default `os.networkInterfaces()`). */
      interfaces?: () => Parameters<typeof onOwnNetwork>[1];
      now?: () => Date;
      limits?: Partial<Limits>;
    } = {},
  ) {
    this.limits = { ...EGRESS_SHARE, ...o.limits };
    const saved = o.file ? readJson<Usage>(o.file) : null;
    this.usage =
      saved && typeof saved.day === "string" && typeof saved.bytes === "number" ? saved : { day: "", bytes: 0 };
  }

  /** Bytes lent today. */
  get today() {
    this.roll();
    return this.usage.bytes;
  }

  private roll() {
    const day = today(this.o.now?.() ?? new Date());
    if (this.usage.day !== day) this.usage = { day, bytes: 0 };
  }

  private save() {
    if (!this.o.file) return;
    try {
      writeJson(this.o.file, this.usage);
    } catch {
      // The count goes on in memory; the cap still holds until a restart.
    }
  }

  private async addresses(host: string): Promise<string[]> {
    if (isIP(host)) return [host];
    try {
      const resolve = this.o.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
      return await resolve(host);
    } catch {
      throw new RunnerError("not_found", `${host} has no address`);
    }
  }

  async dial(
    req: Extract<MachineRequest, { op: "egress.dial" }>,
    dialData: (streamId: string) => Promise<DataSocket>,
  ): Promise<MachineReplies["egress.dial"]> {
    const { streamId } = req;
    if (!isStreamId(streamId) || !isEgressTarget({ host: req.host, port: req.port })) {
      throw new RunnerError("bad_request", "egress.dial takes a stream, a host and a web port");
    }
    this.roll();
    if (this.usage.bytes >= this.limits.dailyBytes) {
      throw new RunnerError("no_slot", "This computer lent all the internet it lends today");
    }
    if (this.open >= this.limits.open) throw new RunnerError("no_slot", "This computer carries enough connections now");
    const found = await this.addresses(req.host);
    // A name that points anywhere private (this network, this computer) is refused whole: never the person's own.
    if (found.length === 0) throw new RunnerError("not_found", `${req.host} has no address`);
    const interfaces = this.o.interfaces?.();
    if (!found.every((ip) => publicAddress(ip) && !onOwnNetwork(ip, interfaces))) {
      throw new RunnerError("not_allowed", "Only public addresses outside this computer's own network are reached");
    }
    this.open++;
    let tcp: Socket | null = null;
    let data: DataSocket | null = null;
    try {
      tcp = await this.reach(found[0] as string, req.port);
      data = await dialData(streamId);
    } catch (error) {
      this.open--;
      tcp?.destroy();
      throw error instanceof RunnerError ? error : new RunnerError("not_found", `Couldn't reach ${req.host}`);
    }
    this.pipe(tcp, data);
    return { connected: true };
  }

  private reach(address: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = (this.o.connect ?? ((h, p) => tcpConnect({ host: h, port: p })))(address, port);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new RunnerError("not_found", "The site didn't answer in time"));
      }, this.limits.connectMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        reject(new RunnerError("not_found", "The site refused the connection"));
      });
    });
  }

  private pipe(tcp: Socket, data: DataSocket) {
    const end = pipeSocket(tcp, data, {
      count: (n) => {
        this.roll();
        this.usage.bytes += n;
        if (this.usage.bytes >= this.limits.dailyBytes) end();
      },
      ended: () => {
        this.open--;
        this.save();
      },
    });
  }
}

/**
 * Carries a TCP socket's bytes on a data socket and back until either side ends (then both do, `ended` once).
 * Reading from the TCP socket pauses while the data socket is more than `HIGH_WATER` behind. Returns the way to end it.
 */
export function pipeSocket(
  tcp: Socket,
  data: DataSocket,
  o: { count?: (bytes: number) => void; ended?: () => void } = {},
): () => void {
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    tcp.destroy();
    data.close(STREAM_CLOSE.normal, "");
    o.ended?.();
  };
  tcp.on("data", (chunk: Buffer) => {
    o.count?.(chunk.byteLength);
    if (done) return;
    data.send(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    if (data.bufferedAmount <= HIGH_WATER) return;
    tcp.pause();
    const wait = setInterval(() => {
      if (done || data.bufferedAmount <= HIGH_WATER / 2) {
        clearInterval(wait);
        if (!done) tcp.resume();
      }
    }, RESUME_POLL_MS);
  });
  tcp.on("error", end);
  tcp.on("close", end);
  data.listen({
    bytes: (chunk) => {
      o.count?.(chunk.byteLength);
      if (!done) tcp.write(chunk);
    },
    closed: end,
  });
  tcp.resume();
  return end;
}
