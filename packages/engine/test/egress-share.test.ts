import { afterEach, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import {
  EGRESS_ANY_PORT_PROTOCOL,
  EGRESS_PROXY_PROTOCOL,
  EGRESS_SHARE_PROTOCOL,
  type MachineRequest,
  STREAM_CLOSE,
} from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { runMigration } from "@agenteschat/db/testing";
import {
  type ClaimedStream,
  createEgressFetch,
  createEgressRelay,
  issueManagedMachine,
  lendingComputers,
  listDevices,
  listMachines,
  type MachineHub,
  MachineRequestError,
  noticeLendingComputers,
  setServerLending,
  updateComputerDevice,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { fakeRunner, pairMachine, RUNNER } from "./machine-fixtures";
import { fakeSocket, until } from "./stream-fixtures";

let f: Fixture;
afterEach(async () => {
  setServerLending(false);
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

test("SSH and other ports go only to a lender whose app carries them; while only older ones lend, it isn't carried", async () => {
  f = await setup();
  const desk = await pair(f.owner.id, "Desk", EGRESS_ANY_PORT_PROTOCOL);
  const laptop = await pair(f.owner.id, "Laptop", EGRESS_ANY_PORT_PROTOCOL - 1);
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");
  let online = [desk, laptop];
  const asked: string[] = [];
  const relay = createEgressRelay({
    db: f.db,
    hub: {
      status: async (id) => ({ online: online.includes(id) }) as never,
      call: async (machineId) => {
        asked.push(machineId);
        throw new MachineRequestError("not_found", "no");
      },
    },
  });
  const ask = async (port: number) => {
    const s = fakeSocket();
    relay.claim(hello("f".repeat(43), { host: "git.example", port }), managed.machineId, s.socket);
    await until(() => s.closed !== null, "close");
    return s.closed?.code;
  };

  // The laptop, paired last, carries the web; SSH goes to the desk, whose app carries any port.
  await ask(443);
  await ask(22);
  expect(asked).toEqual([laptop, desk]);
  // Only the older one online: SSH is "not carried", so the web keeps asking, never "none lends".
  online = [laptop];
  expect(await ask(22)).toBe(STREAM_CLOSE.refused);
  expect(asked).toEqual([laptop, desk]);
  online = [];
  expect(await ask(22)).toBe(STREAM_CLOSE.unreachable);
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

test("the flag of the computer's way out: only once it was seen on the route its agents take now", async () => {
  f = await setup();
  const ana = await addMember(f.db, f.org.id, "member", "ana");
  const laptop = await pair(ana.id, "Ana's laptop");
  const desk = await pair(ana.id, "Ana's desk");
  const managed = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!managed) throw new Error("no managed computer");
  let clock = Date.parse("2026-11-20T10:00:00.000Z");
  let lender = laptop;
  const relay = createEgressRelay({
    db: f.db,
    now: () => clock,
    hub: {
      status: async (id) => ({ online: id === lender }) as never,
      async call(_machineId, request: MachineRequest) {
        if (request.op !== "egress.dial") throw new Error(`unexpected ${request.op}`);
        relay.claim(hello(request.streamId), lender, fakeSocket().socket);
        return { connected: true } as never;
      },
    },
  });
  const lend = async () => {
    const cloud = fakeSocket();
    relay.claim(
      hello(`s${clock}`.padEnd(43, "x"), { host: "gov.example", port: 443 }),
      managed.machineId,
      cloud.socket,
    );
    await until(async () => (await row(managed.machineId)).egressVia?.at === new Date(clock).toISOString(), "via");
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const started = clock;
  await lend();
  // A minute on, the same computer still lending: it began when it first did. Another one starts again.
  clock += 70_000;
  await lend();
  expect((await row(managed.machineId)).egressVia).toEqual({ machineId: laptop, at: iso(clock), since: iso(started) });
  clock += 70_000;
  lender = desk;
  await lend();
  expect((await row(managed.machineId)).egressVia?.since).toBe(iso(clock));

  const at = (value: { egress: unknown; online?: boolean }) =>
    f.db
      .update(schema.machines)
      .set({ online: true, lastSeenAt: new Date(clock), ...value } as never)
      .where(eq(schema.machines.id, managed.machineId));
  const seen = async () =>
    (await listMachines(f.db, f.owner.id, f.org.id, new Date(clock))).find((m) => m.id === managed.machineId)?.egress;
  // Seen before the desk began carrying its connections (the Cloud's own exit): the address, no flag.
  await at({ egress: { ip: "203.0.113.7", country: "ES", at: iso(clock - 5_000) } });
  expect(await seen()).toEqual({ ip: "203.0.113.7", at: iso(clock - 5_000) });
  // Seen through the desk: its country.
  await at({ egress: { ip: "198.51.100.4", country: "BR", at: iso(clock + 1_000) } });
  expect(await seen()).toEqual({ ip: "198.51.100.4", country: "BR", at: iso(clock + 1_000) });

  // No lent route shown any more, yet a computer online to lend: the next connections go through it, no flag yet.
  clock += 10 * 60_000;
  await f.db
    .update(schema.machines)
    .set({ online: true, lastSeenAt: new Date(clock) })
    .where(eq(schema.machines.id, laptop));
  await at({ egress: { ip: "203.0.113.7", country: "ES", at: iso(clock - 1_000) } });
  expect(await seen()).toEqual({ ip: "203.0.113.7", at: iso(clock - 1_000) });
  // Nobody to lend: the usual way out, with its flag.
  await f.db.update(schema.machines).set({ online: false }).where(eq(schema.machines.id, laptop));
  expect(await seen()).toEqual({ ip: "203.0.113.7", country: "ES", at: iso(clock - 1_000) });
});

describe("on a self-hosted server (ADR 0237): people's computers lend to this server's computer and its reads", () => {
  /** A relay whose lending computer `laptop` answers every dial by opening its side on a fake socket. */
  const lendingRelay = (laptop: string, now?: () => number) => {
    const device = fakeSocket();
    const held: { side: ClaimedStream | null; dials: number } = { side: null, dials: 0 };
    const relay = createEgressRelay({
      db: f.db,
      ...(now ? { now } : {}),
      hub: {
        status: async (id) => ({ online: id === laptop }) as never,
        async call(_machineId, request: MachineRequest) {
          if (request.op !== "egress.dial") throw new Error(`unexpected ${request.op}`);
          held.dials++;
          held.side = relay.claim(hello(request.streamId), laptop, device.socket);
          return { connected: true } as never;
        },
      },
    });
    return { relay, device, held };
  };
  const ask = async (relay: ReturnType<typeof createEgressRelay>, machineId: string) => {
    const s = fakeSocket();
    relay.claim(hello("h".repeat(43), { host: "shop.example", port: 443 }), machineId, s.socket);
    await until(() => s.sent.length > 0 || s.closed !== null, "ready or close");
    return s;
  };

  test("this server's own computer borrows: paired with the lending computer, shown on both pages", async () => {
    f = await setup();
    const ana = await addMember(f.db, f.org.id, "member", "ana");
    const laptop = await pair(ana.id, "Ana's laptop");
    const host = await pair(f.owner.id, "VPS");
    await f.db.update(schema.machines).set({ kind: "host" }).where(eq(schema.machines.id, host));
    const { relay } = lendingRelay(laptop);

    // Where a provisioner makes the computers (the Cloud), only its managed computer borrows.
    expect((await ask(relay, host)).closed?.code).toBe(STREAM_CLOSE.forbidden);
    expect((await listDevices(f.db, f.org.id, ana.id)).lendsInternet).toBe(false);
    expect((await listDevices(f.db, f.org.id, ana.id)).devices.find((d) => d.id === laptop)?.shareInternet).toBeNull();

    setServerLending(true);
    expect((await ask(relay, host)).sent[0]).toBe(JSON.stringify({ type: "stream.ready" }));
    await until(async () => (await row(laptop)).egressLentAt !== null, "egress_lent_at");
    expect((await row(host)).egressVia?.machineId).toBe(laptop);
    const computer = (await listMachines(f.db, f.owner.id, f.org.id)).find((m) => m.id === host);
    expect(computer?.egressVia).toMatchObject({ machineId: laptop, name: "Ana's laptop", userName: "ana" });
    const list = await listDevices(f.db, f.org.id, ana.id);
    expect(list.lendsInternet).toBe(true);
    expect(list.devices.find((d) => d.id === laptop)?.shareInternet).toEqual({ on: true, inUse: true });
  });

  test("a computer marked the workspace's borrows with its switch off; on, it lends and is refused as a borrower", async () => {
    f = await setup();
    setServerLending(true);
    const laptop = await pair(f.owner.id, "Laptop");
    const vps = await pair(f.owner.id, "Build VPS");
    const { relay, held } = lendingRelay(laptop);
    await f.db.update(schema.machines).set({ belongsToWorkspace: true }).where(eq(schema.machines.id, vps));

    // Its switch on: it lends, so it never borrows (nor goes out through itself).
    expect((await ask(relay, vps)).closed?.code).toBe(STREAM_CLOSE.forbidden);
    expect((await ask(relay, laptop)).closed?.code).toBe(STREAM_CLOSE.forbidden);
    expect(held.dials).toBe(0);

    await f.db.update(schema.machines).set({ egressShare: false }).where(eq(schema.machines.id, vps));
    expect((await ask(relay, vps)).sent[0]).toBe(JSON.stringify({ type: "stream.ready" }));
    expect(held.dials).toBe(1);
    // A person's own computer that doesn't lend doesn't borrow either.
    await f.db.update(schema.machines).set({ belongsToWorkspace: false }).where(eq(schema.machines.id, vps));
    expect((await ask(relay, vps)).closed?.code).toBe(STREAM_CLOSE.forbidden);
  });

  test('the lending computer\'s "in use" is written at most once a minute, whoever borrowed', async () => {
    f = await setup();
    setServerLending(true);
    const laptop = await pair(f.owner.id, "Laptop");
    const host = await pair(f.owner.id, "VPS");
    await f.db.update(schema.machines).set({ kind: "host" }).where(eq(schema.machines.id, host));
    let clock = 1_000_000;
    const { relay } = lendingRelay(laptop, () => clock);
    await ask(relay, host);
    await until(async () => (await row(laptop)).egressLentAt !== null, "egress_lent_at");
    await f.db.update(schema.machines).set({ egressLentAt: null }).where(eq(schema.machines.id, laptop));
    clock += 30_000;
    await ask(relay, host);
    await Bun.sleep(30);
    expect((await row(laptop)).egressLentAt).toBeNull();
    clock += 31_000;
    await ask(relay, host);
    await until(async () => (await row(laptop)).egressLentAt !== null, "egress_lent_at again");
  });

  test("the server's own reads: a CONNECT with this process's key goes out through the lending computer", async () => {
    f = await setup();
    const laptop = await pair(f.owner.id, "Laptop");
    // Lending off (the Cloud): none.
    expect(await createEgressFetch(lendingRelay(laptop).relay).lentFetch(f.org.id)).toBeNull();
    setServerLending(true);
    await f.db.update(schema.machines).set({ egressShare: false }).where(eq(schema.machines.id, laptop));
    // Nothing lends now: none, and the caller goes its usual way.
    expect(await createEgressFetch(lendingRelay(laptop).relay).lentFetch(f.org.id)).toBeNull();
    await f.db.update(schema.machines).set({ egressShare: true }).where(eq(schema.machines.id, laptop));
    const { relay, device, held } = lendingRelay(laptop);
    const open = await createEgressFetch(relay).lentFetch(f.org.id);
    if (!open) throw new Error("no lent fetch");

    // Bun's fetch tunnels through the proxy: the lending computer's side gets the TLS handshake.
    const real = globalThis.fetch;
    let proxy = "";
    globalThis.fetch = ((url: string, init?: RequestInit & { proxy?: string }) => {
      proxy = init?.proxy ?? "";
      return real(url, init);
    }) as typeof fetch;
    const page = open("https://shop.example/", { signal: AbortSignal.timeout(3_000) }).catch(() => null);
    globalThis.fetch = real;
    await until(() => device.sent.length > 0, "bytes at the lending computer");
    expect((device.sent[0] as Uint8Array)[0]).toBe(0x16);
    expect(held.dials).toBe(1);
    held.side?.closed();
    expect(await page).toBeNull();

    // Without this process's key the proxy answers 407; a destination off the web ports, 403.
    const url = new URL(proxy);
    const raw = (head: string) =>
      new Promise<string>((resolve) => {
        const s = connect(Number(url.port), "127.0.0.1", () => s.write(head));
        let got = "";
        s.on("data", (d) => {
          got += d.toString();
        });
        s.on("close", () => resolve(got));
      });
    const basic = (user: string, key: string) => Buffer.from(`${user}:${key}`).toString("base64");
    expect(
      await raw(`CONNECT shop.example:443 HTTP/1.1\r\nProxy-Authorization: Basic ${basic(f.org.id, "nope")}\r\n\r\n`),
    ).toStartWith("HTTP/1.1 407");
    expect(
      await raw(
        `CONNECT shop.example:22 HTTP/1.1\r\nProxy-Authorization: Basic ${basic(f.org.id, url.password)}\r\n\r\n`,
      ),
    ).toStartWith("HTTP/1.1 403");
  });

  test("its role changing tells an online computer at once: marked the workspace's with its switch off, it borrows", async () => {
    f = await setup({ machines: true });
    setServerLending(true);
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, { name: "Build VPS", ...RUNNER });
    const runner = fakeRunner(f.machineHub as MachineHub);
    await runner.hello(paired.token);
    // A computer that lends gets no proxy at connect.
    expect(runner.sent.find((frame) => frame.type === "welcome")).not.toHaveProperty("egressProxy");
    const asked = () =>
      runner.sent.flatMap((frame) => (frame.type === "request" && frame.op === "egress.proxy" ? [frame.on] : []));
    await updateComputerDevice({ ...deps(), hub: f.machineHub as MachineHub }, f.owner.id, f.org.id, paired.machineId, {
      belongsToWorkspace: true,
    });
    expect(asked()).toEqual([]);
    await updateComputerDevice({ ...deps(), hub: f.machineHub as MachineHub }, f.owner.id, f.org.id, paired.machineId, {
      shareInternet: false,
    });
    await until(() => asked().length > 0, "egress.proxy");
    expect(asked()).toEqual([true]);

    // Connecting again, it is told in its welcome; an app older than the proxy never is.
    const again = fakeRunner(f.machineHub as MachineHub);
    await again.hello(paired.token);
    expect(again.sent.find((frame) => frame.type === "welcome")).toMatchObject({ egressProxy: true });
    const old = fakeRunner(f.machineHub as MachineHub);
    await old.hello(paired.token, { protocol: EGRESS_PROXY_PROTOCOL - 1 });
    expect(old.sent.find((frame) => frame.type === "welcome")).not.toHaveProperty("egressProxy");
  });

  test("the owners of computers that lend hear it once, where the server starts lending", async () => {
    f = await setup();
    const rui = await addMember(f.db, f.org.id, "member", "rui");
    const laptop = await pair(rui.id, "Rui's laptop");
    await pair(rui.id, "Old PC").then((id) =>
      f.db.update(schema.machines).set({ egressShare: false }).where(eq(schema.machines.id, id)),
    );
    expect(await noticeLendingComputers(f.db)).toBe(1);
    const [notice] = await f.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "device.internet_shared"));
    expect(notice).toMatchObject({ userId: rui.id, source: { machineId: laptop, label: "Rui's laptop" } });
    // Run again (another start): nobody hears twice.
    expect(await noticeLendingComputers(f.db)).toBe(0);
  });
});
