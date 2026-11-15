import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { brainAccountFor, type MachineStatus } from "../src";
import { backgroundAiState } from "../src/ai-status";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/**
 * ADR 0187: an agent with no account picked, on a computer that never proved a sign-in of its own for that CLI,
 * thinks with a connected account of that CLI there that may think for it, so its routines run.
 */

let f: Fixture;
afterEach(() => {
  const fx: Fixture | undefined = f;
  f = undefined as unknown as Fixture;
  return fx?.close();
});

const RUNNER = {
  hostname: "box",
  os: "linux" as const,
  arch: "x64",
  version: "0.8.0",
  protocol: MACHINE_PROTOCOL_VERSION,
  workspace: "/home/agentes/agentes",
};

const statusOf = (machineId: string): MachineStatus => ({
  id: machineId,
  orgId: "org",
  name: "Box",
  online: true,
  execAllowed: true,
  os: "linux",
  protocol: MACHINE_PROTOCOL_VERSION,
  pairedByUserId: f.owner.id,
  executors: { antigravity: { version: "1.5.9" }, detectedAt: new Date().toISOString() },
});

/** Dev on Gemini with no account picked, on a computer its owner connected. */
async function noAccount(fx: Fixture) {
  const deps = { db: fx.db, pubsub: fx.pubsub, publicUrl: "https://agentes.chat" };
  const { machineId } = await pairMachine(deps, fx.owner.id, fx.org.id, { name: "Box", ...RUNNER, exec: true });
  await fx.db
    .update(schema.agents)
    .set({ machineId, brain: "antigravity", brainAccountId: null, brainFallback: true })
    .where(eq(schema.agents.id, fx.agent.id));
  const [agent] = await fx.db.select().from(schema.agents).where(eq(schema.agents.id, fx.agent.id));
  if (!agent) throw new Error("no agent");
  const account = (values: Partial<typeof schema.machineAccounts.$inferInsert> = {}) => {
    const id = crypto.randomUUID();
    return fx.db
      .insert(schema.machineAccounts)
      .values({
        orgId: fx.org.id,
        machineId,
        kind: "antigravity",
        createdBy: fx.owner.id,
        label: "Gemini",
        id,
        ...values,
      })
      .then(() => id);
  };
  return { machineId, agent, account };
}

test("no account and no own sign-in proven: the owner's connected account of that CLI thinks", async () => {
  f = await setup();
  const { machineId, agent, account } = await noAccount(f);
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toBeUndefined();
  const id = await account();
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toEqual({
    id,
    label: "Gemini",
    status: "active",
  });
});

test("a routine of that agent has an AI: the account, never the API key it would fall back to", async () => {
  f = await setup();
  const { machineId, agent, account } = await noAccount(f);
  const machines = { status: async () => statusOf(machineId) };
  const deps = { db: f.db, gateway: { hasModelCredential: async () => false }, machines };
  // Before: the computer's own sign-in passes the pre-check, and the turn fails `not_logged_in` there.
  await account({ status: "removing" });
  await account();
  expect(await backgroundAiState(deps, agent)).toEqual({ state: "ready" });
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.status).toBe("active");
});

test("the owner's account first, then the oldest; one that serves only another person never", async () => {
  f = await setup();
  const { machineId, agent, account } = await noAccount(f);
  const bea = await addMember(f.db, f.org.id, "member", "bea");
  await account({ createdBy: bea.id, serves: "owner", label: "Bea's", createdAt: new Date(1000) });
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toBeUndefined();
  const shared = await account({ createdBy: bea.id, serves: "everyone", label: "Shared", createdAt: new Date(2000) });
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(shared);
  const first = await account({ label: "Ana 1", createdAt: new Date(3000) });
  await account({ label: "Ana 2", createdAt: new Date(4000) });
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.id).toBe(first);
});

test("a proven own sign-in, another CLI's account, or a computer in system mode: no account, as before", async () => {
  f = await setup();
  const { machineId, agent, account } = await noAccount(f);
  await account();
  await account({ kind: "codex", label: "ChatGPT" });
  const executors = (e: schema.MachineExecutors) =>
    f.db.update(schema.machines).set({ executors: e }).where(eq(schema.machines.id, machineId));

  await executors({ ownUsage: { antigravity: { at: new Date().toISOString(), source: "probe", windows: [] } } });
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toBeUndefined();

  await executors({ mode: "system" });
  expect(await brainAccountFor(f.db, agent, "antigravity", machineId)).toBeUndefined();

  await executors({});
  expect((await brainAccountFor(f.db, agent, "antigravity", machineId))?.label).toBe("Gemini");
  expect(await brainAccountFor(f.db, agent, "codex", machineId)).toBeUndefined();
});

test("Claude Code: `claude auth status` signed in keeps the computer's own sign-in, signed out takes the account", async () => {
  f = await setup();
  const { machineId, account } = await noAccount(f);
  await f.db.update(schema.agents).set({ brain: "claude_code" }).where(eq(schema.agents.id, f.agent.id));
  const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
  if (!agent) throw new Error("no agent");
  const id = await account({ kind: "claude_code", label: "Claude" });
  const claude = (loggedIn: boolean) =>
    f.db
      .update(schema.machines)
      .set({ executors: { claude: { version: "2.1.0", loggedIn } } })
      .where(eq(schema.machines.id, machineId));
  await claude(true);
  expect(await brainAccountFor(f.db, agent, "claude_code", machineId)).toBeUndefined();
  await claude(false);
  expect((await brainAccountFor(f.db, agent, "claude_code", machineId))?.id).toBe(id);
});
