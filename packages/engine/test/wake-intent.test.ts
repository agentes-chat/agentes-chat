import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  createAgent,
  createChannel,
  INTENT_WINDOW_MS,
  issueManagedMachine,
  NEW_AGENT_DEFAULTS,
  noteWakeIntent,
  openDm,
  pollDeviceToken,
  resetWakeIntents,
  setMachineStandby,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * The computer woken on a guess (ADR 0161, the addendum on guesses): a conversation's signs add up, and at the threshold
 * its agents' computer in standby is asked back, once a window.
 */

let f: Fixture;
afterEach(async () => {
  resetWakeIntents();
  await f?.close();
});

async function asleep() {
  f = await setup();
  const issued = await issueManagedMachine({ db: f.db }, f.org.id);
  if (!issued) throw new Error("no org");
  const token = await pollDeviceToken({ db: f.db }, issued.enrollCode);
  if (!token.ok) throw new Error(token.error);
  const { machineId } = issued;
  await f.db.update(schema.agents).set({ machineId }).where(eq(schema.agents.id, f.agent.id));
  await setMachineStandby({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, true);
  const woken: [string, string][] = [];
  const deps = {
    db: f.db,
    machines: {
      status: async () => null,
      wake: async (id: string, why: string) => void woken.push([id, why]),
    },
  };
  const where = (channelId: string, extra: { threadId?: string; agentId?: string } = {}) => ({
    orgId: f.org.id,
    userId: f.owner.id,
    channelId,
    ...extra,
  });
  return { machineId, woken, deps, where };
}

describe("signs of a message to come", () => {
  test("opening the app or a channel never wakes it; a channel opened, then the composer focused, does", async () => {
    const { machineId, woken, deps, where } = await asleep();
    const t = Date.now();
    await noteWakeIntent(deps, "app", { orgId: f.org.id, userId: f.owner.id }, t);
    expect(await noteWakeIntent(deps, "open", where(f.general.id), t + 1)).toEqual([]);
    expect(woken).toEqual([]);
    expect(await noteWakeIntent(deps, "focus", where(f.general.id), t + 2)).toEqual([machineId]);
    expect(woken).toEqual([[machineId, "intent"]]);
    // Once a window per conversation, however many signs follow.
    await noteWakeIntent(deps, "typing", where(f.general.id), t + 3);
    expect(woken).toHaveLength(1);
    // A new window: counting again from nothing.
    await noteWakeIntent(deps, "open", where(f.general.id), t + INTENT_WINDOW_MS);
    expect(woken).toHaveLength(1);
  });

  test("a DM with its agent, `@` and an agent, or a voice message: at once", async () => {
    const { machineId, woken, deps, where } = await asleep();
    const t = Date.now();
    const dm = await openDm(f.db, f.owner.id, f.org.id, { agentId: f.agent.id });
    expect(await noteWakeIntent(deps, "open", where(dm.id), t)).toEqual([machineId]);
    const room = await createChannel(f.db, f.owner.id, f.org.id, { name: "squad" });
    // The agent named isn't in the channel: its computer still wakes.
    expect(await noteWakeIntent(deps, "mention", where(room.id, { agentId: f.agent.id }), t)).toEqual([machineId]);
    expect(await noteWakeIntent(deps, "voice", where(f.general.id), t)).toEqual([machineId]);
    expect(woken.every(([, why]) => why === "intent")).toBe(true);
  });

  test("typing alone: its second frame; a thread with the app just opened: at once", async () => {
    const { machineId, deps, where } = await asleep();
    const t = Date.now();
    expect(await noteWakeIntent(deps, "typing", where(f.general.id), t)).toEqual([]);
    expect(await noteWakeIntent(deps, "typing", where(f.general.id), t + 2000)).toEqual([machineId]);
    const thread = crypto.randomUUID();
    await noteWakeIntent(deps, "app", { orgId: f.org.id, userId: f.owner.id }, t);
    expect(await noteWakeIntent(deps, "open", where(f.general.id, { threadId: thread }), t + 1)).toEqual([machineId]);
  });

  test("only computers asleep that its agents work on: none awake, none of a channel without agents", async () => {
    const { machineId, woken, deps, where } = await asleep();
    const t = Date.now();
    const room = await createChannel(f.db, f.owner.id, f.org.id, { name: "people" });
    expect(await noteWakeIntent(deps, "voice", where(room.id), t)).toEqual([]);
    await setMachineStandby({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, false);
    expect(await noteWakeIntent(deps, "voice", where(f.general.id), t)).toEqual([]);
    // An archived agent's computer neither.
    await setMachineStandby({ db: f.db, pubsub: f.pubsub }, f.org.id, machineId, true);
    const other = await createAgent(f.db, f.owner.id, f.org.id, { name: "Ops", handle: "ops" }, NEW_AGENT_DEFAULTS);
    await f.db.update(schema.agents).set({ machineId, archivedAt: new Date() }).where(eq(schema.agents.id, other.id));
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
    const squad = await createChannel(f.db, f.owner.id, f.org.id, { name: "squad" });
    expect(await noteWakeIntent(deps, "mention", where(squad.id, { agentId: other.id }), t)).toEqual([]);
    expect(woken).toEqual([]);
  });
});
