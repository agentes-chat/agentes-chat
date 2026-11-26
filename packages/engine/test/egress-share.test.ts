import { afterEach, expect, test } from "bun:test";
import { EGRESS_SHARE_PROTOCOL, type MachineRequest, STREAM_CLOSE } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { runMigration } from "@agenteschat/db/testing";
import {
  type ClaimedStream,
  createEgressRelay,
  issueManagedMachine,
  lendingComputers,
  listDevices,
  listMachines,
  MachineRequestError,
  updateComputerDevice,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine, RUNNER } from "./machine-fixtures";
import { fakeSocket, until } from "./stream-fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const pair = async (userId: string, name: string, protocol = EGRESS_SHARE_PROTOCOL) =>
  (await pairMachine(deps(), userId, f.org.id, { name, ...RUNNER, protocol })).machineId;
const row = async (id: string) =>
  (
    await f.db.select().from(schema.machines).where(eq(schema.machines.id, id))
  )[0] as typeof schema.machines.$inferSelect;
const hello = (streamId: string, egress?: { host: string; port: number }) => ({
  type: "stream.hello" as const,
  token: "agm_unused",
  streamId,
  ...(egress ? { egress } : {}),
});

test("who lends: people's own computers with the switch on and an app new enough, the newest pick first", async () => {
  f = await setup();
  const ana = await addMember(f.db, f.org.id, "member", "ana");
  const first = await pair(f.owner.id, "Office Mac");
  const second = await pair(ana.id, "Ana's laptop");
  const old = await pair(ana.id, "Old PC", EGRESS_SHARE_PROTOCOL - 1);
  const off = await pair(ana.id, "Studio PC");
  await f.db.update(schema.machines).set({ egressShare: false }).where(eq(schema.machines.id, off));
  await issueManagedMachine({ db: f.db }, f.org.id);

  // On by default for a computer paired now; the last paired comes first.
  expect((await lendingComputers(f.db, f.org.id)).map((m) => m.id)).toEqual([second, first]);
  // Turned on again by its owner, it is picked first.
  await updateComputerDevice(deps(), f.owner.id, f.org.id, first, { shareInternet: true });
  expect((await lendingComputers(f.db, f.org.id)).map((m) => m.id)).toEqual([first, second]);
  expect((await lendingComputers(f.db, f.org.id)).map((m) => m.id)).not.toContain(old);
});

test("only its owner lends a computer's internet; an admin may stop it; never the workspace's own computer", async () => {
  f = await setup();
  const sam = await addMember(f.db, f.org.id, "admin", "sam");
  const rui = await addMember(f.db, f.org.id, "member", "rui");
  const laptop = await pair(rui.id, "Rui's laptop");
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");

  expect(await updateComputerDevice(deps(), sam.id, f.org.id, laptop, { shareInternet: false })).toMatchObject({
    shareInternet: { on: false, inUse: false },
  });
  await expect(updateComputerDevice(deps(), sam.id, f.org.id, laptop, { shareInternet: true })).rejects.toMatchObject({
    code: "device.share_owner_only",
  });
  expect(await updateComputerDevice(deps(), rui.id, f.org.id, laptop, { shareInternet: true })).toMatchObject({
    shareInternet: { on: true, inUse: false },
  });
  await expect(
    updateComputerDevice(deps(), f.owner.id, f.org.id, managed.machineId, { shareInternet: true }),
  ).rejects.toMatchObject({ code: "machine.managed" });
});

test("a lent connection: the workspace's computer asks, the lending computer dials, the bytes pass both ways", async () => {
  f = await setup();
  const ana = await addMember(f.db, f.org.id, "member", "ana");
  const laptop = await pair(ana.id, "Ana's laptop");
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");
  const requests: { machineId: string; request: MachineRequest }[] = [];
  const device = fakeSocket();
  const held: { side: ClaimedStream | null } = { side: null };
  const relay = createEgressRelay({
    db: f.db,
    hub: {
      status: async (id) => ({ online: id === laptop }) as never,
      async call(machineId, request: MachineRequest) {
        requests.push({ machineId, request });
        if (request.op !== "egress.dial") throw new Error(`unexpected ${request.op}`);
        // The lending computer reached the site and dials its data socket for the stream.
        const taken = relay.claim(hello(request.streamId), laptop, device.socket);
        if (!taken) throw new Error("the lent side wasn't taken");
        held.side = taken;
        return { connected: true } as never;
      },
    },
  });

  const cloud = fakeSocket();
  const cloudSide = relay.claim(
    hello("a".repeat(43), { host: "gov.example", port: 443 }),
    managed.machineId,
    cloud.socket,
  );
  expect(cloudSide?.readyLater).toBe(true);
  await until(() => cloud.sent.length > 0, "stream.ready");
  expect(cloud.sent[0]).toBe(JSON.stringify({ type: "stream.ready" }));
  expect(requests).toMatchObject([
    { machineId: laptop, request: { op: "egress.dial", host: "gov.example", port: 443 } },
  ]);

  cloudSide?.data(new Uint8Array([1, 2, 3]));
  held.side?.data(new Uint8Array([4, 5]));
  expect(device.sent).toEqual([new Uint8Array([1, 2, 3])]);
  expect(cloud.sent.slice(1)).toEqual([new Uint8Array([4, 5])]);

  // Whose internet it uses shows on the computer and on the lending computer's own page.
  await until(async () => (await row(managed.machineId)).egressVia?.machineId === laptop, "egress_via");
  const computer = (await listMachines(f.db, f.owner.id, f.org.id)).find((m) => m.id === managed.machineId);
  expect(computer?.egressVia).toMatchObject({ machineId: laptop, name: "Ana's laptop", userName: "ana" });
  const lent = (await listDevices(f.db, f.org.id, ana.id)).devices.find((d) => d.id === laptop);
  expect(lent?.shareInternet).toEqual({ on: true, inUse: true });

  held.side?.closed();
  expect(cloud.closed).toMatchObject({ code: STREAM_CLOSE.normal });
  expect(device.closed).toMatchObject({ code: STREAM_CLOSE.normal });
});

test("nothing lent, a refused destination or a computer that isn't the workspace's: the socket closes with why", async () => {
  f = await setup();
  const laptop = await pair(f.owner.id, "Laptop");
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");
  let online = false;
  const relay = createEgressRelay({
    db: f.db,
    hub: {
      status: async () => ({ online }) as never,
      call: async () => {
        throw new MachineRequestError("not_allowed", "Only public addresses are reached");
      },
    },
  });
  const ask = async (machineId: string) => {
    const s = fakeSocket();
    relay.claim(hello("b".repeat(43), { host: "203.0.113.9", port: 443 }), machineId, s.socket);
    await until(() => s.closed !== null, "close");
    return s.closed?.code;
  };

  // Offline: the workspace's computer goes out its usual way.
  expect(await ask(managed.machineId)).toBe(STREAM_CLOSE.unreachable);
  online = true;
  expect(await ask(managed.machineId)).toBe(STREAM_CLOSE.refused);
  // A person's computer can't borrow another's connection.
  expect(await ask(laptop)).toBe(STREAM_CLOSE.forbidden);
  // A data socket naming no lent connection is left to the others.
  expect(relay.claim(hello("c".repeat(43)), laptop, fakeSocket().socket)).toBeNull();
});

test("a lending computer that is paused or doesn't answer is passed over: the next ask goes to another", async () => {
  f = await setup();
  const older = await pair(f.owner.id, "Desk");
  const newer = await pair(f.owner.id, "Laptop");
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");
  const asked: string[] = [];
  for (const code of ["timeout", "paused"] as const) {
    asked.length = 0;
    const relay = createEgressRelay({
      db: f.db,
      hub: {
        status: async () => ({ online: true }) as never,
        call: async (machineId) => {
          asked.push(machineId);
          throw new MachineRequestError(machineId === newer ? code : "not_allowed", "no");
        },
      },
    });
    for (const id of ["d", "e"]) {
      const s = fakeSocket();
      relay.claim(hello(id.repeat(43), { host: "203.0.113.9", port: 443 }), managed.machineId, s.socket);
      await until(() => s.closed !== null, "close");
    }
    expect(asked).toEqual([newer, older]);
  }
});

test("computers paired before lend too: each one's owner hears it once, a team's computer its admins; off ends it", async () => {
  f = await setup();
  const sam = await addMember(f.db, f.org.id, "admin", "sam");
  const rui = await addMember(f.db, f.org.id, "member", "rui");
  const laptop = await pair(rui.id, "Rui's laptop");
  const desk = await pair(rui.id, "Front desk PC");
  await f.db.update(schema.machines).set({ belongsToWorkspace: true }).where(eq(schema.machines.id, desk));
  const notices = async () =>
    (await f.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "device.internet_shared")))
      .map((n) => ({ to: n.userId, about: n.source.machineId, label: n.source.label, done: n.doneAt !== null }))
      .sort((a, b) => `${a.about}${a.to}`.localeCompare(`${b.about}${b.to}`));

  // No workspace computer to lend to: nobody hears.
  await runMigration(f.db, "egress_share_notice");
  expect(await notices()).toEqual([]);

  await issueManagedMachine({ db: f.db }, f.org.id);
  await runMigration(f.db, "egress_share_notice");
  const expected = [
    { to: rui.id, about: laptop, label: "Rui's laptop", done: false },
    ...[f.owner.id, sam.id].map((to) => ({ to, about: desk, label: "Front desk PC", done: false })),
  ].sort((a, b) => `${a.about}${a.to}`.localeCompare(`${b.about}${b.to}`));
  expect(await notices()).toEqual(expected);

  // Turn off, by its owner or an admin: the computer stops lending and its notice is done for everyone told.
  await updateComputerDevice(deps(), rui.id, f.org.id, laptop, { shareInternet: false });
  await updateComputerDevice(deps(), sam.id, f.org.id, desk, { shareInternet: false });
  expect((await notices()).every((n) => n.done)).toBe(true);
  expect(await lendingComputers(f.db, f.org.id)).toEqual([]);
});
