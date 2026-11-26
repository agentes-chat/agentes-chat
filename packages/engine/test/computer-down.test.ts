import { afterEach, describe, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  COMPUTER_DOWN_JOB,
  createMachineHub,
  DOWN_EMAIL_MS,
  DOWN_JOIN_MS,
  DOWN_NOTICE_MS,
  downGroup,
  issueManagedMachine,
  type MachineHub,
  noticeComputerBack,
  noticeComputerDown,
  outageStart,
  pollDeviceToken,
  setMachineMoving,
  setMachineStandby,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/** "Computer down" and "back" (ADR 0241): who hears it, when, and never for a computer away by plan. */

let f: Fixture;
let hub: MachineHub | null = null;
afterEach(async () => {
  await hub?.stop();
  hub = null;
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const MIN = 60_000;
const T0 = Date.parse("2026-11-23T22:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const close = (connectedAt: number, closedAt: number) => ({
  connectedAt: at(connectedAt),
  at: at(closedAt),
  code: 1006,
  reason: "",
});

describe("outageStart", () => {
  test("the last close, joined with the closes before it the computer came back from for under 30 minutes", () => {
    expect(outageStart([])).toBeNull();
    // Up for an hour before it went: an outage of its own.
    expect(outageStart([close(-60 * MIN, 0)])?.toISOString()).toBe(at(0));
    // Back 5 minutes, gone again: one outage since the first close.
    expect(outageStart([close(5 * MIN, 10 * MIN), close(-60 * MIN, 0)])?.toISOString()).toBe(at(0));
    // Back for 30 minutes or more: a new outage.
    expect(outageStart([close(5 * MIN, 5 * MIN + DOWN_JOIN_MS), close(-60 * MIN, 0)])?.toISOString()).toBe(
      at(5 * MIN + DOWN_JOIN_MS),
    );
    // A "back" told at minute 6: what came before it is over.
    expect(outageStart([close(5 * MIN, 10 * MIN), close(-60 * MIN, 0)], T0 + 6 * MIN)?.toISOString()).toBe(
      at(10 * MIN),
    );
    // No close since then: no outage.
    expect(outageStart([close(-60 * MIN, 0)], T0 + MIN)).toBeNull();
  });
});

/** The workspace's own computer, redeemed, that went away at T0 after an hour up. */
async function managedComputer() {
  const issued = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!issued) throw new Error("no org");
  const token = await pollDeviceToken({ db: f.db }, issued.enrollCode);
  if (!token.ok) throw new Error(`enroll failed: ${token.error}`);
  await wentAway(issued.machineId);
  return { machineId: issued.machineId, token: token.token };
}

async function wentAway(machineId: string, disconnects = [close(-60 * MIN, 0)]) {
  await f.db
    .update(schema.machines)
    .set({ online: false, lastSeenAt: new Date(T0), disconnects })
    .where(eq(schema.machines.id, machineId));
}

const deps = (ms: number, home: string | null = null) => ({
  db: f.db,
  pubsub: f.pubsub,
  now: () => new Date(T0 + ms),
  home,
});

const notices = (kind: string) =>
  f.db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.orgId, f.org.id), eq(schema.notifications.kind, kind)));

const emails = async () =>
  (await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send"))).map(
    (j) => (j.payload as { template: { kind: string; back?: boolean } }).template,
  );

describe("computer down", () => {
  test("after 10 minutes who configures the workspace hears it once; from 30 by email; members never", async () => {
    f = await setup();
    const member = await addMember(f.db, f.org.id, "member", "Bruno");
    const { machineId } = await managedComputer();

    await noticeComputerDown(deps(DOWN_NOTICE_MS - MIN), machineId, "down");
    expect(await notices("computer_down")).toHaveLength(0);

    await noticeComputerDown(deps(DOWN_NOTICE_MS), machineId, "down");
    await noticeComputerDown(deps(DOWN_NOTICE_MS + MIN), machineId, "down");
    const down = await notices("computer_down");
    expect(down.map((n) => n.userId)).toEqual([f.owner.id]);
    expect(down.map((n) => n.userId)).not.toContain(member.id);
    expect(down[0]).toMatchObject({
      groupKey: downGroup(machineId, new Date(T0)),
      source: { machineId },
      latest: { since: at(0), runs: 0, calls: 0 },
    });
    expect(await emails()).toEqual([]);

    // The email's check: a server that sends email mails it, and the row remembers it did.
    await noticeComputerDown(deps(DOWN_EMAIL_MS, "https://app.example.com"), machineId, "email");
    expect(await emails()).toEqual([expect.objectContaining({ kind: "computer_down", back: false })]);
    expect((await notices("computer_down"))[0]?.latest).toMatchObject({ emailed: true });
  });

  test("never for a computer in standby, one moving hosts, or a workspace on hold", async () => {
    f = await setup();
    const { machineId } = await managedComputer();

    await setMachineStandby({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, true);
    await noticeComputerDown(deps(DOWN_EMAIL_MS, "https://app.example.com"), machineId, "email");
    await setMachineStandby({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, false);
    // Taken out of standby it is waking: what this test's clock calls the past, so it is cleared here.
    await f.db.update(schema.machines).set({ wakeWantedAt: null }).where(eq(schema.machines.id, machineId));

    expect(await setMachineMoving({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, true)).toEqual({ moving: true });
    await noticeComputerDown(deps(DOWN_EMAIL_MS, "https://app.example.com"), machineId, "email");
    expect(await notices("computer_down")).toHaveLength(0);
    expect(await emails()).toEqual([]);

    // A move nobody ended hours ago no longer covers it.
    await f.db
      .update(schema.machines)
      .set({ movingAt: new Date(T0 - 3 * 3600_000) })
      .where(eq(schema.machines.id, machineId));
    await noticeComputerDown(deps(DOWN_NOTICE_MS), machineId, "down");
    expect(await notices("computer_down")).toHaveLength(1);
  });

  test("a computer someone brought counts only while work waits for it", async () => {
    f = await setup();
    const paired = await pairMachine({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, { name: "Laptop" });
    await wentAway(paired.machineId);

    await noticeComputerDown(deps(DOWN_NOTICE_MS), paired.machineId, "down");
    expect(await notices("computer_down")).toHaveLength(0);

    const [run] = await f.db
      .insert(schema.agentRuns)
      .values({
        orgId: f.org.id,
        agentId: f.agent.id,
        channelId: f.general.id,
        threadRootId: crypto.randomUUID(),
        triggerMessageId: crypto.randomUUID(),
        trigger: "mention",
        hop: 1,
        status: "waiting_input",
        waitingMachineId: paired.machineId,
      })
      .returning();
    expect(run).toBeDefined();
    await noticeComputerDown(deps(DOWN_NOTICE_MS), paired.machineId, "down");
    expect((await notices("computer_down")).map((n) => n.latest)).toEqual([expect.objectContaining({ runs: 1 })]);
  });
});

describe("computer back", () => {
  test("only after a down was told: to the same people, with how long and what waited; the down is done", async () => {
    f = await setup();
    const { machineId } = await managedComputer();
    const row = async () => {
      const [m] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, machineId));
      if (!m) throw new Error("no machine");
      return m;
    };

    // Back after 5 minutes: nobody was told it went, nobody hears it is back.
    await noticeComputerBack(deps(5 * MIN), await row());
    expect(await notices("computer_back")).toHaveLength(0);

    await noticeComputerDown(deps(DOWN_EMAIL_MS, "https://app.example.com"), machineId, "email");
    await noticeComputerBack(deps(42 * MIN, "https://app.example.com"), await row());
    await noticeComputerBack(deps(43 * MIN, "https://app.example.com"), await row());
    const back = await notices("computer_back");
    expect(back.map((n) => [n.userId, n.latest])).toEqual([[f.owner.id, expect.objectContaining({ since: at(0) })]]);
    expect((await notices("computer_down")).every((n) => n.doneAt !== null)).toBe(true);
    // Mailed it was down: mailed it is back.
    expect((await emails()).map((e) => e.back)).toEqual([false, true]);

    // It goes again 10 minutes after the back: a new outage, told again after its own 10 minutes.
    await wentAway(machineId, [close(43 * MIN, 53 * MIN), close(-60 * MIN, 0)]);
    await noticeComputerDown(deps(53 * MIN + DOWN_NOTICE_MS), machineId, "down");
    expect((await notices("computer_down")).map((n) => n.latest.since).sort()).toEqual([at(0), at(53 * MIN)]);
  });

  test("the hub queues the checks when a socket closes, and tells the back at the next hello", async () => {
    f = await setup();
    const { machineId, token } = await managedComputer();
    hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-a" });
    const hello = async () => {
      const conn = hub?.open({ send: () => {}, close: () => {} });
      if (!conn || !hub) throw new Error("no hub");
      await hub.message(
        conn,
        JSON.stringify({
          type: "hello",
          token,
          hostname: "vm-7f3a",
          os: "linux",
          arch: "x64",
          version: "1.0.0",
          protocol: MACHINE_PROTOCOL_VERSION,
          workspace: "/var/lib/agentes-runner/work",
          exec: true,
        }),
      );
      return conn;
    };
    const conn = await hello();
    await hub.close(conn);
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, COMPUTER_DOWN_JOB));
    expect(jobs.map((j) => j.payload).sort((a, b) => String(a.stage).localeCompare(String(b.stage)))).toEqual([
      { machineId, stage: "down" },
      { machineId, stage: "email" },
    ]);

    // Away long enough and told: its next hello says it is back.
    await wentAway(machineId, [close(-60 * MIN, -20 * MIN)]);
    await noticeComputerDown(deps(0), machineId, "down");
    expect(await notices("computer_down")).toHaveLength(1);
    await hello();
    expect(await notices("computer_back")).toHaveLength(1);
  });
});
