// VPS Zen: an agent's own Claude account at its limit thinks with another account that has room (`spareAccountFor`).
import { afterEach, describe, expect, test } from "bun:test";
import { ACCOUNTS_PROTOCOL } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { brainAccountFor, clearPlanLimits, notePlanLimit, spareAccountFor } from "../src/brains/select";
import { outOfOffice } from "../src/out-of-office";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

const id = (n: string) => `0193eeee-0000-4000-8000-0000000000${n}`;
let f: Fixture | null = null;
afterEach(async () => {
  clearPlanLimits();
  await f?.close();
  f = null;
});

const week = (usedPercent: number, limited = false) => ({
  at: new Date().toISOString(),
  ...(limited ? { limited: true } : {}),
  windows: [{ kind: "seven_day", usedPercent, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }],
});

async function world() {
  const fx = await setup();
  f = fx;
  const { machineId } = await pairMachine({ db: fx.db, pubsub: fx.pubsub }, fx.owner.id, fx.org.id, {
    name: "vps",
    protocol: ACCOUNTS_PROTOCOL,
    exec: true,
  });
  await fx.db
    .update(schema.machines)
    .set({ executors: { claude: { version: "2.1.304", loggedIn: true }, detectedAt: new Date().toISOString() } })
    .where(eq(schema.machines.id, machineId));
  const account = (id: string, usage: unknown, createdBy = fx.owner.id, extra: Record<string, unknown> = {}) =>
    fx.db.insert(schema.machineAccounts).values({
      id,
      orgId: fx.org.id,
      machineId,
      kind: "claude_code",
      label: id,
      status: "active",
      createdBy,
      usage: usage as never,
      ...extra,
    });
  await account(id("a1"), week(100));
  await fx.db
    .update(schema.agents)
    .set({ machineId, brain: "claude_code", brainAccountId: id("a1") })
    .where(eq(schema.agents.id, fx.agent.id));
  const agent = async () => {
    const [r] = await fx.db.select().from(schema.agents).where(eq(schema.agents.id, fx.agent.id));
    if (!r) throw new Error("no agent");
    return r;
  };
  return { fx, machineId, account, agent };
}

describe("VPS Zen: automatic account switch", () => {
  test("its own account at the limit thinks with the one with the most room, and goes back once it resets", async () => {
    const { fx, machineId, account, agent } = await world();
    await account(id("b1"), week(70));
    await account(id("c1"), week(20));
    expect((await brainAccountFor(fx.db, await agent(), "claude_code", machineId))?.id).toBe(id("c1"));
    // Its own resets: back to it, nothing was stored on the agent.
    await fx.db
      .update(schema.machineAccounts)
      .set({ usage: week(5) as never })
      .where(eq(schema.machineAccounts.id, id("a1")));
    expect((await brainAccountFor(fx.db, await agent(), "claude_code", machineId))?.id).toBe(id("a1"));
    expect((await agent()).brainAccountId).toBe(id("a1"));
  });

  test("the long-work pause (95%) and a refusal seen in this process count as no room", async () => {
    const { fx, machineId, account, agent } = await world();
    await fx.db
      .update(schema.machineAccounts)
      .set({ usage: week(96) as never })
      .where(eq(schema.machineAccounts.id, id("a1")));
    await account(id("b1"), week(30));
    expect((await brainAccountFor(fx.db, await agent(), "claude_code", machineId))?.id).toBe(id("b1"));
    await fx.db
      .update(schema.machineAccounts)
      .set({ usage: week(10) as never })
      .where(eq(schema.machineAccounts.id, id("a1")));
    notePlanLimit(machineId, "claude_code", undefined, Date.now(), id("a1"));
    expect((await brainAccountFor(fx.db, await agent(), "claude_code", machineId))?.id).toBe(id("b1"));
  });

  test("never an account that is spent, signed out, another kind or not the agent's owner's to use", async () => {
    const { fx, machineId, account, agent } = await world();
    const bia = await addMember(fx.db, fx.org.id, "member", "bia");
    await account(id("f1"), week(100, true));
    await account(id("e1"), week(0), fx.owner.id, { status: "signing_in" });
    await account(id("d1"), week(0), fx.owner.id, { kind: "codex" });
    await account(id("b2"), week(0), bia.id, { serves: "owner" });
    const a = await agent();
    expect(await spareAccountFor(fx.db, a, "claude_code", machineId, { id: id("a1") })).toBeUndefined();
    // None with room: it stays on its own and waits, as before.
    expect((await brainAccountFor(fx.db, a, "claude_code", machineId))?.id).toBe(id("a1"));
  });

  test("with a spare account it isn't out of office", async () => {
    const { fx, account, agent } = await world();
    const a = await agent();
    expect((await outOfOffice(fx.db, fx.org.id, [a], { hasModel: async () => false })).get(a.id)?.reason).toBe("plan");
    await account(id("b1"), week(10));
    expect((await outOfOffice(fx.db, fx.org.id, [a], { hasModel: async () => false })).has(a.id)).toBe(false);
  });
});
