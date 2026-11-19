import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  addRunStep,
  CENTRAL_QUIET_MS,
  CENTRAL_STALLED_MS,
  centralState,
  centralView,
  continueWorkAtStepLimit,
  createAgent,
  insertMessage,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const model = { model: "claude-sonnet-5-5" };
const NOW = Date.parse("2026-11-19T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const task = (status: "queued" | "running" | "waiting_input" | "waiting_approval", state?: string) =>
  ({ status, held: null, work: state ? { state, since: ago(0), card: null } : null }) as never;

describe("how a task stands", () => {
  test("running reads by its last sign of life, never by the clock of the whole task", () => {
    expect(centralState(task("running"), ago(1000), NOW)).toBe("working");
    expect(centralState(task("running"), ago(CENTRAL_QUIET_MS), NOW)).toBe("quiet");
    expect(centralState(task("running"), ago(CENTRAL_STALLED_MS), NOW)).toBe("stalled");
  });
  test("a wait on the viewer differs from a wait on anything else", () => {
    expect(centralState(task("waiting_input", "you"), ago(0), NOW)).toBe("waiting_you");
    expect(centralState(task("waiting_input", "computer"), ago(0), NOW)).toBe("waiting_other");
    expect(centralState(task("queued"), ago(0), NOW)).toBe("queued");
  });
});

async function endedAtLimit(meta: Record<string, unknown>, triggerMeta: Record<string, unknown> = {}) {
  const agent = await createAgent(f.db, f.owner.id, f.org.id, { name: "Ada", handle: "ada" }, model);
  const asked = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "faça",
    meta: triggerMeta,
  });
  const reply = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "agent", agentId: agent.id, runId: null, hop: 1, stretchId: null },
    body: "Acabaram meus passos.",
    meta,
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: agent.id,
      channelId: f.general.id,
      triggerMessageId: asked.id,
      threadRootId: asked.id,
      trigger: "mention",
      hop: 1,
      stretchId: asked.id,
      status: "done",
      replyMessageId: reply.id,
      startedAt: new Date(),
      finishedAt: new Date(),
      transcript: { messages: [{ role: "user", content: "faça" }], postedCount: 1, postedUpTo: 1 },
    })
    .returning();
  return { agent, run: run as NonNullable<typeof run> };
}

describe("work at its step limit", () => {
  test("goes on by itself, once", async () => {
    f = await setup();
    const { run } = await endedAtLimit({ stepLimit: {} });
    const first = await continueWorkAtStepLimit({ db: f.db, pubsub: f.pubsub });
    expect(first).toHaveLength(1);
    expect(await continueWorkAtStepLimit({ db: f.db, pubsub: f.pubsub })).toEqual([]);
    const [next] = await f.db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, first[0] as string));
    expect(next?.triggerMessageId).toBe(run.replyMessageId as string);
    expect(JSON.stringify(next?.transcript)).toContain("You reached your step limit");
  }, 30_000);
  test("a stuck run, and one that was itself a continuation, wait for a person", async () => {
    f = await setup();
    await endedAtLimit({ stepLimit: { stuck: true } });
    expect(await continueWorkAtStepLimit({ db: f.db, pubsub: f.pubsub })).toEqual([]);
    await f.db.delete(schema.agentRuns);
    await f.db.delete(schema.agents).where(eq(schema.agents.handle, "ada"));
    await endedAtLimit({ stepLimit: {} }, { stepLimit: {} });
    expect(await continueWorkAtStepLimit({ db: f.db, pubsub: f.pubsub })).toEqual([]);
  });
});

describe("the Central", () => {
  test("shows a running task's last step, and an agents' talk only in words to who manages them", async () => {
    f = await setup();
    const a = await createAgent(f.db, f.owner.id, f.org.id, { name: "Ada", handle: "ada" }, model);
    const b = await createAgent(f.db, f.owner.id, f.org.id, { name: "Bia", handle: "bia" }, model);
    const asked = await insertMessage(f.db, {
      orgId: f.org.id,
      channelId: f.general.id,
      author: { type: "person", userId: f.owner.id },
      body: "faça",
    });
    const [run] = await f.db
      .insert(schema.agentRuns)
      .values({
        orgId: f.org.id,
        agentId: a.id,
        channelId: f.general.id,
        triggerMessageId: asked.id,
        threadRootId: asked.id,
        stretchId: asked.id,
        trigger: "mention",
        hop: 1,
        status: "running",
        transcript: { messages: [], postedCount: 0, postedUpTo: 0 },
        startedAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();
    await addRunStep(f.db, run as never, "tool_call", { name: "Bash", toolUseId: "1" });
    await f.db.insert(schema.agentConsultations).values({
      orgId: f.org.id,
      askerRunId: run?.id,
      askerAgentId: a.id,
      targetAgentId: b.id,
      messageId: asked.id,
      waitId: crypto.randomUUID(),
      channelId: f.general.id,
      question: "segredo",
      chain: [a.id],
      kind: "question",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const view = await centralView(f.db, f.owner.id, f.org.id);
    const shown = view.tasks.find((t) => t.runId === run?.id);
    expect(shown?.state).toBe("working");
    expect(shown?.title).toBe("faça");
    expect(shown?.requester).toMatchObject({ kind: "person", id: f.owner.id });
    expect(view.talks[0]?.question).toBe("segredo");
    const member = await addMember(f.db, f.org.id, "member", "Bea");
    const theirs = await centralView(f.db, member.id, f.org.id);
    expect(theirs.talks[0]?.question).toBeNull();
    expect(theirs.computers).toEqual([]);
  });
});
