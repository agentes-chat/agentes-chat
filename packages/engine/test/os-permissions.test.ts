import { afterEach, expect, test } from "bun:test";
import { orgTopic, type PermissionNeed } from "@agenteschat/adapters";
import { and, eq, schema, sql } from "@agenteschat/db";
import { createAgentRuns, createMachineSandboxProvider, insertMessage, listDevices, type MachineHub } from "../src";
import { type Fixture, setup } from "./fixtures";
import { fakeRunner, pairMachine, RUNNER } from "./machine-fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.machineHub?.stop();
  await f?.close();
});

const need = (permission: PermissionNeed["permission"], trigger: string): PermissionNeed => ({
  permission,
  trigger,
  agentId: f.agent.id,
  since: "2026-11-26T18:00:00.000Z",
});

test("the permissions a computer waits on come with its hello and each change, and show on its device", async () => {
  f = await setup({ machines: true });
  const paired = await pairMachine(f, f.owner.id, f.org.id, { name: "MacBook", ...RUNNER, os: "darwin" });
  const runner = fakeRunner(f.machineHub as MachineHub);
  await runner.hello(paired.token, { permissions: [need("disk", "ls ~/Desktop")] });
  await Bun.sleep(5);
  const computer = async () =>
    (await listDevices(f.db, f.org.id, f.owner.id)).devices.find((d) => d.id === paired.machineId);
  expect((await computer())?.permissions).toEqual([need("disk", "ls ~/Desktop")]);

  const events: Record<string, unknown>[] = [];
  f.pubsub.subscribe(orgTopic(f.org.id), (e) => events.push((e as { event?: Record<string, unknown> }).event ?? {}));
  await runner.frame({
    type: "permissions.changed",
    permissions: [need("screen", "screencapture -x screen.png"), { permission: "bogus", trigger: "x", since: "now" }],
  });
  await Bun.sleep(5);
  expect((await computer())?.permissions).toEqual([need("screen", "screencapture -x screen.png")]);
  expect(events).toContainEqual({ type: "machine.updated", machineId: paired.machineId, permissions: true });
  // The rest of what it reported stays.
  const [row] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
  expect(row?.executors?.permissions).toHaveLength(1);

  // Offline, nothing there asks: its last list isn't shown.
  await f.db.update(schema.machines).set({ online: false }).where(eq(schema.machines.id, paired.machineId));
  expect((await computer())?.permissions).toEqual([]);
  await f.db.update(schema.machines).set({ online: true }).where(eq(schema.machines.id, paired.machineId));
  expect((await computer())?.permissions).toHaveLength(1);

  // Allowed there: the wait ends.
  await runner.frame({ type: "permissions.changed", permissions: [] });
  await Bun.sleep(5);
  expect((await computer())?.permissions).toEqual([]);
});

test("a command that failed for want of a permission tells the agent it waits on the person, on which computer", async () => {
  f = await setup({ machines: true });
  const paired = await pairMachine(f, f.owner.id, f.org.id, { name: "MacBook", ...RUNNER, os: "darwin" });
  const runner = fakeRunner(f.machineHub as MachineHub, {
    exec: (req) =>
      req.command.startsWith("ls")
        ? { exitCode: 1, stdout: "", stderr: "ls: Desktop: Operation not permitted\n", permission: "disk" }
        : { exitCode: 0, stdout: "ok", stderr: "" },
  });
  await runner.hello(paired.token);
  const provider = createMachineSandboxProvider(f.machineHub as MachineHub, { id: f.agent.id, handle: "dev" });
  const refused = await provider.exec(paired.machineId, { command: "ls ~/Desktop", timeoutSeconds: 30 });
  expect(refused.stderr).toBe(
    "ls: Desktop: Operation not permitted\nWaiting for the person to allow Full Disk Access on MacBook: the agentes.chat app there is asking them now. Don't ask them in chat and don't run it again: you'll be told here once it is allowed, then run the same command again. Say in one line what it is waiting on. Don't look for a way around it.",
  );
  const fine = await provider.exec(paired.machineId, { command: "echo ok", timeoutSeconds: 30 });
  expect(fine.stderr).toBe("");
});

test("allowed there, the agent whose command waited hears it in that run's conversation and goes on", async () => {
  f = await setup({ machines: true });
  const paired = await pairMachine(f, f.owner.id, f.org.id, { name: "MacBook", ...RUNNER, os: "darwin" });
  const ask = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "take a screenshot of the app",
  });
  const [run] = await f.db.transaction((tx) => createAgentRuns(tx, ask, [f.agent.id], "mention"));
  if (!run) throw new Error("no run");
  await f.db
    .update(schema.agentRuns)
    .set({ status: "done", finishedAt: new Date(), createdAt: new Date("2026-11-26T17:59:00.000Z") })
    .where(eq(schema.agentRuns.id, run.id));
  const runner = fakeRunner(f.machineHub as MachineHub);
  await runner.hello(paired.token, { permissions: [need("screen", "screencapture -x screen.png")] });
  await Bun.sleep(5);
  const notices = () =>
    f.db
      .select({ meta: schema.messages.meta })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, f.general.id),
          sql`${schema.messages.meta}->'notice'->>'kind' = 'wait_result'`,
        ),
      );

  // Gone without the person allowing it (an older runner, a restart): nobody is woken.
  await runner.frame({ type: "permissions.changed", permissions: [need("screen", "screencapture -x screen.png")] });
  await Bun.sleep(5);
  expect(await notices()).toEqual([]);

  await runner.frame({ type: "permissions.changed", permissions: [], allowed: ["screen"] });
  await Bun.sleep(20);
  const told = await notices();
  expect(told).toHaveLength(1);
  expect((told[0]?.meta as { notice?: { text?: string } } | undefined)?.notice?.text).toBe(
    "Screen Recording is allowed on MacBook now: run the command that waited on it again and go on.",
  );
});
