import { randomBytes } from "node:crypto";
import { EGRESS_SHARE, EGRESS_SHARE_PROTOCOL, STREAM_CLOSE, type StreamHello } from "@agenteschat/adapters";
import { and, type Database, desc, eq, gte, isNull, schema, sql } from "@agenteschat/db";
import { type MachineCaller, MachineRequestError } from "./machine-hub";
import { borrowsInternet, getMachineById, serverLending } from "./machines";
import type { ClaimedStream, StreamSocket } from "./streams";

const { machines } = schema;

/** A borrower's `machines.egress_via` and a lender's `egress_lent_at` are written at most this often. */
const VIA_WRITE_MS = 60_000;
/**
 * A lent computer that said it carries enough now, is paused, or didn't answer in time (asleep, its socket not yet
 * seen gone) is passed over this long: the next ask goes to another, or out the usual way at once.
 */
const FULL_MS = 60_000;
const PASS_OVER = new Set(["no_slot", "paused", "timeout"]);
/** Bytes queued toward one side before the connection ends as too slow. */
const BUFFERED_MAX = 16 * 1024 * 1024;
/** How long the server waits for the lent computer to reach the site and dial its data socket. */
const DIAL_MS = EGRESS_SHARE.connectMs + 5_000;
/** Who may lend in a workspace, read again at most this often. */
const CANDIDATES_MS = 5_000;

/**
 * The computers of a workspace that lend it their internet now (ADR 0237): people's own (`connected`), with the
 * switch on, new enough to, newest pick first (turned on or picked last, else paired last).
 */
export async function lendingComputers(db: Database, orgId: string) {
  return db
    .select({ id: machines.id, name: machines.name, pairedByUserId: machines.pairedByUserId })
    .from(machines)
    .where(
      and(
        eq(machines.orgId, orgId),
        eq(machines.kind, "connected"),
        eq(machines.egressShare, true),
        gte(machines.protocol, EGRESS_SHARE_PROTOCOL),
        isNull(machines.deletedAt),
      ),
    )
    .orderBy(desc(sql`coalesce(${machines.egressShareAt}, ${machines.createdAt})`));
}

const closeCodeFor = (error: unknown) => {
  if (!(error instanceof MachineRequestError)) return STREAM_CLOSE.unreachable;
  if (error.code === "not_allowed" || error.code === "bad_request") return STREAM_CLOSE.refused;
  if (error.code === "not_found") return STREAM_CLOSE.notFound;
  return STREAM_CLOSE.unreachable;
};

const quietly = (fn: () => void) => {
  try {
    fn();
  } catch {
    // A socket that broke is cleaned up by its close.
  }
};

interface Leg {
  socket: StreamSocket;
  peer: Leg | null;
  closed: boolean;
}

/**
 * Lent connections on this server (ADR 0237). A borrowing computer's data socket names a destination in its hello
 * (`claim` with `egress`), or the server itself asks for one for an organization's agents (`connect`): the server
 * picks the computer that lends, asks it to dial (`egress.dial`), and pairs the data socket it opens with the first,
 * bytes passed as they come. Nothing lent now, or a refusal, closes the first socket with a code read as "go out your
 * usual way" (`unreachable`, `forbidden`: this computer doesn't borrow) or "not carried" (`refused`, `notFound`).
 * Both sockets must reach this server process.
 */
export function createEgressRelay(deps: {
  db: Database;
  hub: Pick<MachineCaller, "call" | "status">;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  /** The lent computer's data socket we wait for, by its stream id: the workspace computer's side waiting for it. */
  const pending = new Map<string, { deviceId: string; leg: Leg }>();
  const full = new Map<string, number>();
  const candidates = new Map<string, { at: number; rows: Promise<Awaited<ReturnType<typeof lendingComputers>>> }>();
  const viaWritten = new Map<string, { deviceId: string; at: number }>();
  const lentWritten = new Map<string, number>();

  const end = (leg: Leg, code: number = STREAM_CLOSE.normal, reason = "") => {
    if (leg.closed) return;
    leg.closed = true;
    quietly(() => leg.socket.close(code, reason));
    if (leg.peer) end(leg.peer);
  };

  const pass = (from: Leg, data: string | Uint8Array) => {
    const to = from.peer;
    if (!to || to.closed || typeof data === "string") return;
    if (to.socket.buffered() > BUFFERED_MAX) return end(from, STREAM_CLOSE.tooSlow, "too slow");
    quietly(() => to.socket.send(data));
  };

  const claimed = (leg: Leg): ClaimedStream => ({
    data: (data) => pass(leg, data),
    closed: () => end(leg),
  });

  const lenders = (orgId: string) => {
    const hit = candidates.get(orgId);
    if (hit && now() - hit.at < CANDIDATES_MS) return hit.rows;
    const rows = lendingComputers(deps.db, orgId);
    candidates.set(orgId, { at: now(), rows });
    rows.catch(() => candidates.delete(orgId));
    return rows;
  };

  /** The lending computer for `orgId` now, never `borrowerId` itself. */
  async function pick(orgId: string, borrowerId: string | null) {
    for (const row of await lenders(orgId)) {
      if (row.id === borrowerId || (full.get(row.id) ?? 0) > now()) continue;
      if ((await deps.hub.status(row.id).catch(() => null))?.online) return row;
    }
    return null;
  }

  /** Who carried the last connection, on the borrower's row (the server itself has none), and when, on the lender's. */
  async function noteVia(borrowerId: string | null, deviceId: string) {
    const at = new Date(now());
    const last = borrowerId ? viaWritten.get(borrowerId) : undefined;
    if (borrowerId && !(last && last.deviceId === deviceId && now() - last.at < VIA_WRITE_MS)) {
      viaWritten.set(borrowerId, { deviceId, at: now() });
      await deps.db
        .update(machines)
        .set({ egressVia: { machineId: deviceId, at: at.toISOString() } })
        .where(eq(machines.id, borrowerId));
    }
    if (now() - (lentWritten.get(deviceId) ?? Number.NEGATIVE_INFINITY) < VIA_WRITE_MS) return;
    lentWritten.set(deviceId, now());
    await deps.db.update(machines).set({ egressLentAt: at }).where(eq(machines.id, deviceId));
  }

  async function open(
    leg: Leg,
    borrower: { orgId: string; machineId: string | null },
    target: { host: string; port: number },
  ) {
    const device = await pick(borrower.orgId, borrower.machineId);
    if (leg.closed) return;
    if (!device) return end(leg, STREAM_CLOSE.unreachable, "no computer lends its internet now");
    const streamId = randomBytes(32).toString("base64url");
    pending.set(streamId, { deviceId: device.id, leg });
    try {
      await deps.hub.call(device.id, { op: "egress.dial", streamId, ...target }, { timeoutMs: DIAL_MS });
    } catch (error) {
      if (error instanceof MachineRequestError && PASS_OVER.has(error.code)) full.set(device.id, now() + FULL_MS);
      end(leg, closeCodeFor(error), "the lent connection didn't open");
      return;
    } finally {
      pending.delete(streamId);
    }
    // Answered once its data socket was ready: no pair by now means none is coming.
    if (!leg.peer) return end(leg, STREAM_CLOSE.unreachable, "the lent connection didn't open");
    await noteVia(borrower.machineId, device.id).catch((error) =>
      deps.log?.warn("egress via write failed", { machineId: borrower.machineId, error: String(error) }),
    );
  }

  /** A borrowing computer's request: only one that borrows (`borrowsInternet`) gets a lent connection. */
  async function openFor(leg: Leg, machineId: string, target: { host: string; port: number }) {
    const machine = await getMachineById(deps.db, machineId);
    if (!machine || machine.deletedAt || !borrowsInternet(machine)) {
      return end(leg, STREAM_CLOSE.forbidden, "this computer doesn't borrow a lent connection");
    }
    await open(leg, { orgId: machine.orgId, machineId: machine.id }, target);
  }

  return {
    /**
     * `StreamBrokerDeps.claim`: a workspace computer's request (`hello.egress`), answered `stream.ready` once paired
     * (`readyLater`), or the lent computer's data socket for one of them. Null: neither.
     */
    claim(hello: StreamHello, machineId: string, socket: StreamSocket): ClaimedStream | null {
      if (hello.egress) {
        const leg: Leg = { socket, peer: null, closed: false };
        void openFor(leg, machineId, hello.egress).catch((error) => {
          deps.log?.warn("egress relay failed", { machineId, error: String(error) });
          end(leg, STREAM_CLOSE.internal, "internal");
        });
        return { ...claimed(leg), readyLater: true };
      }
      const wait = pending.get(hello.streamId);
      if (!wait || wait.deviceId !== machineId || wait.leg.closed) return null;
      pending.delete(hello.streamId);
      const leg: Leg = { socket, peer: wait.leg, closed: false };
      wait.leg.peer = leg;
      quietly(() => wait.leg.socket.send(JSON.stringify({ type: "stream.ready" })));
      return claimed(leg);
    },
    /**
     * The server's own connection to `target` for an organization's agents (`egress-fetch.ts`), over `socket`: its
     * first text frame is `stream.ready` once a lent connection carries it, or it closes as a data socket would.
     */
    connect(orgId: string, target: { host: string; port: number }, socket: StreamSocket): ClaimedStream {
      const leg: Leg = { socket, peer: null, closed: false };
      if (!serverLending()) end(leg, STREAM_CLOSE.forbidden, "this server lends no connection to itself");
      else
        void open(leg, { orgId, machineId: null }, target).catch((error) => {
          deps.log?.warn("egress relay failed", { orgId, error: String(error) });
          end(leg, STREAM_CLOSE.internal, "internal");
        });
      return claimed(leg);
    },
    /** Whether a computer lends `orgId` its internet now. */
    lending: async (orgId: string) => (await pick(orgId, null)) !== null,
  };
}

export type EgressRelay = ReturnType<typeof createEgressRelay>;
