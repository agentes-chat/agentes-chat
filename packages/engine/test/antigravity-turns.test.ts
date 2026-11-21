import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION, type PlanUsage } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  type Brain,
  type BrainEvent,
  type BrainTurn,
  clearPlanLimits,
  createJobHandlers,
  drainOutbox,
  listMessages,
  type MachineStatus,
  postPersonMessage,
} from "../src";
import { planLimitOf } from "../src/brains/select";
import { type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/**
 * Antigravity's turns: the model asked comes from the account's `/usage` reading, a refusal never closes the whole
 * account, and a session that took a quota refusal is not resumed (the CLI answers with the same refusal again).
 */
let f: Fixture;
afterEach(() => {
  clearPlanLimits();
  const fx: Fixture | undefined = f;
  f = undefined as unknown as Fixture;
  return fx?.close();
});

const FLASH = "gemini-3.8-flash-medium";
const ARGON = "gemini-4-argon-medium";
const ARGON_WEEK = new Date(Date.now() + 6 * 86_400_000).toISOString();
const REFUSAL = "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 138h.";

const statusOf = (machineId: string): MachineStatus => ({
  id: machineId,
  orgId: "org",
  name: "box",
  online: true,
  execAllowed: true,
  os: "linux",
  protocol: MACHINE_PROTOCOL_VERSION,
  executors: { antigravity: { version: "agy 1.5.9" }, detectedAt: new Date().toISOString() },
});

/** An Antigravity account on a runner, the agent on `FLASH`, the account read with room in Gemini's own windows. */
// `argonUsed`: how much of Argon's own week the reading says is used.
async function geminiAgent(fx: Fixture, argonUsed: number, brainModel = FLASH) {
  const paired = await pairMachine({ db: fx.db, pubsub: fx.pubsub }, fx.owner.id, fx.org.id, {
    name: "box",
    hostname: "box",
    os: "linux",
    arch: "x64",
    version: "0.8.0",
    protocol: MACHINE_PROTOCOL_VERSION,
    workspace: "/home/w/agentes",
    exec: true,
  });
  const accountId = crypto.randomUUID();
  const usage: PlanUsage = {
    source: "probe",
    at: new Date().toISOString(),
    windows: [
      { kind: "seven_day", usedPercent: 3, resetsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() },
      { kind: "five_hour", usedPercent: 2, resetsAt: new Date(Date.now() + 4 * 3600_000).toISOString() },
      { kind: "other", label: "Gemini 4 Argon · 7d", usedPercent: argonUsed, resetsAt: ARGON_WEEK },
    ],
  };
  await fx.db.insert(schema.machineAccounts).values({
    id: accountId,
    orgId: fx.org.id,
    machineId: paired.machineId,
    kind: "antigravity",
    label: "Gemini",
    status: "active",
    createdBy: fx.owner.id,
    usage,
  });
  await fx.db
    .update(schema.agents)
    .set({
      machineId: paired.machineId,
      brain: "antigravity",
      brainModel,
      brainFallback: false,
      brainAccountId: accountId,
    })
    .where(eq(schema.agents.id, fx.agent.id));
  return { accountId, machineId: paired.machineId, usage };
}

function scripted(script: (n: number, turn: BrainTurn) => BrainEvent[]) {
  const seen: BrainTurn[] = [];
  const brain: Brain = {
    kind: "antigravity",
    async *run(turn) {
      const n = seen.length;
      seen.push({ ...turn, system: "", messages: [] });
      yield* script(n, turn);
    },
  };
  return { brain, seen };
}

const handlers = (fx: Fixture, brain: Brain) =>
  createJobHandlers({
    ...fx.jobDeps,
    brains: { antigravity: () => brain },
    machines: { status: async (id) => statusOf(id) },
    planLimitGraceMs: 50,
  });

const post = (fx: Fixture, body: string) =>
  postPersonMessage({ db: fx.db, pubsub: fx.pubsub }, fx.owner.id, fx.org.id, fx.general.id, { body });

const runs = (fx: Fixture) => fx.db.select().from(schema.agentRuns).orderBy(schema.agentRuns.createdAt);

/** A refusal with no reset in the CLI's words. */
const refused = (): BrainEvent[] => [
  { type: "limit" },
  { type: "error", code: "plan_limit", message: REFUSAL, worked: false },
];

const answered = (text: string): BrainEvent[] => [
  { type: "usage", input: 1000, output: 40, source: "plan", model: FLASH },
  { type: "done", text },
];

const waitOf = (run: { transcript: unknown } | undefined) =>
  (run?.transcript as { waitingForBrain?: Record<string, unknown> } | undefined)?.waitingForBrain;

test("the first refusal of a run goes again on a new session, and the account is not closed by it", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { accountId, machineId, usage } = await geminiAgent(f, 100);
  const { brain, seen } = scripted((n) => (n === 0 ? refused() : answered("feito")));
  await post(f, "@dev oi");
  await drainOutbox(f.db, handlers(f, brain));
  expect(seen.map((t) => t.model)).toEqual([FLASH, FLASH]);
  expect(seen[1]?.session?.id).not.toBe(seen[0]?.session?.id);
  expect((await runs(f))[0]?.status).toBe("done");
  expect(planLimitOf(machineId, "antigravity", accountId, usage)).toBeNull();
});

test("a session that took the refusal is not resumed: the thread's next run goes on the new one", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  await geminiAgent(f, 100);
  // The CLI keeps a refusal in the conversation: the first run's session answers with it whenever it is resumed.
  let poisoned: string | undefined;
  const { brain, seen } = scripted((n, turn) => {
    if (n === 0) poisoned = turn.session?.id;
    return n > 0 && turn.session?.id === poisoned ? refused() : answered("feito");
  });
  await post(f, "@dev oi");
  await drainOutbox(f.db, handlers(f, brain));
  await post(f, "@dev e agora?");
  await drainOutbox(f.db, handlers(f, brain));
  expect(seen.map((t) => t.session?.resume)).toEqual([false, true, false]);
  const fresh = seen[2]?.session?.id;
  expect(fresh).not.toBe(seen[1]?.session?.id);
  expect((await runs(f)).map((r) => r.brainSessionId)).toEqual([poisoned ?? null, fresh ?? null]);
  await post(f, "@dev e depois?");
  await drainOutbox(f.db, handlers(f, brain));
  expect(seen.at(-1)?.session).toMatchObject({ id: fresh, resume: true });
});

test("a refusal on a new session too is a real one: the run waits on the re-checks, not on the first window", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  const { accountId, machineId, usage } = await geminiAgent(f, 100);
  const { brain, seen } = scripted(() => refused());
  await post(f, "@dev oi");
  await drainOutbox(f.db, handlers(f, brain));
  // Asked twice (the session, then a new one), not a third time.
  expect(seen).toHaveLength(2);
  const [run] = await runs(f);
  expect(run?.status).toBe("waiting_input");
  // No reset in the refusal and no window full: unknown, so the re-checks, not the five-hour window at 2%.
  expect(waitOf(run)).toMatchObject({ code: "plan_limit" });
  expect(waitOf(run)?.resetsAt).toBeUndefined();
  expect(planLimitOf(machineId, "antigravity", accountId, usage)).toBeNull();
});

test("an agent on Automático is asked a model, of the account's own group first", async () => {
  for (const argonUsed of [100, 0]) {
    f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
    await geminiAgent(f, argonUsed, "auto");
    const { brain, seen } = scripted(() => answered("feito"));
    await post(f, "@dev oi");
    await drainOutbox(f.db, handlers(f, brain));
    expect(seen[0]?.model).toMatch(/^gemini-3\.8-flash-(low|medium|high)$/);
    await f.close();
  }
  f = undefined as unknown as Fixture;
});

test("an agent on a model whose group is full is asked another group's, at the same level", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  await geminiAgent(f, 100, ARGON);
  const { brain, seen } = scripted(() => answered("feito"));
  await post(f, "@dev oi");
  await drainOutbox(f.db, handlers(f, brain));
  expect(seen[0]?.model).toBe(FLASH);
});

test("a question that ended with tools and no words is asked once to answer, not closed with Done.", async () => {
  f = await setup({ reply: () => ({ chunks: ["pela API"] }) });
  await geminiAgent(f, 100);
  const read = {
    type: "tool_call",
    id: "c1",
    name: "list_issues",
    input: {},
    executed: { content: "#1 a\n#2 b" },
  } as const;
  const { brain, seen } = scripted((n) => (n === 0 ? [read, ...answered("")] : answered("Tenho 2 tarefas: #1 e #2.")));
  await post(f, "@dev quais as suas tarefas?");
  await drainOutbox(f.db, handlers(f, brain));
  expect(seen).toHaveLength(2);
  const replies = (await listMessages(f.db, f.owner.id, f.org.id, f.general.id, {})).filter(
    (m) => m.author.type === "agent",
  );
  expect(replies.map((m) => m.body)).toEqual(["Tenho 2 tarefas: #1 e #2."]);
});
