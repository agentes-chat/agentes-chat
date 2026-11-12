import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  type AgentRun,
  addChannelMember,
  createFeedbackToolSource,
  FEEDBACK_JOB,
  FEEDBACK_PER_HOUR,
  type Feedback,
  feedbackOfferOf,
  listApprovals,
  postPersonMessage,
  renderFeedback,
  type ToolContext,
  toolPolicy,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/**
 * ADR 0160 §11: `send_feedback` queues the form's email in the name of the person who asked the agent, says which
 * agent wrote it, and sends none where the server takes no feedback or nobody is behind the run.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const TO = "feedback@example.com";

/** A limiter that counts per key, as the server's does within one window. */
const limiter = () => {
  const used = new Map<string, number>();
  return {
    used,
    async consume(key: string, rule: { limit: number; windowMs: number }) {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), resetAt: new Date(0) };
    },
  };
};

const source = (over: Partial<Parameters<typeof createFeedbackToolSource>[0]> = {}) =>
  createFeedbackToolSource({ to: TO, version: "1.2.3", ...over });

const toolOf = async (from = source()) => {
  const [tool] = await from.tools({} as ToolContext);
  if (!tool) throw new Error("no tool");
  return tool;
};

const runOf = async (triggerMessageId: string): Promise<AgentRun> => {
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.triggerMessageId, triggerMessageId), eq(schema.agentRuns.agentId, f.agent.id)));
  if (!run) throw new Error("no run");
  return run;
};

const ctxOf = (run: AgentRun, toolUseId = "call-1") =>
  ({
    db: f.db,
    orgId: f.org.id,
    agentId: run.agentId,
    runId: run.id,
    channelId: run.channelId,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
    toolUseId,
  }) as ToolContext;

const queued = async () =>
  (await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, FEEDBACK_JOB))).map(
    (job) => job.payload.feedback as Feedback,
  );

/** Bia, a member, asks the agent in the channel; the run her message started. */
async function askedByBia() {
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: bia.id });
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, bia.id, f.org.id, f.general.id, {
    body: "@dev manda um feedback: o céu fica escuro demais à noite",
  });
  return { bia, run: await runOf(message.id) };
}

test("listed only where the server takes feedback", async () => {
  expect(await source({ to: undefined }).tools({} as ToolContext)).toEqual([]);
  expect((await source().tools({} as ToolContext)).map((t) => t.name)).toEqual(["send_feedback", "offer_feedback"]);
});

test("a person asks: one email queued in their name, saying which agent wrote it", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf();
  const out = await tool.execute({ text: "  The sky is too dark at night.  " }, ctxOf(run));
  expect(out.isError).toBeUndefined();
  // The same call run again goes once.
  await tool.execute({ text: "The sky is too dark at night." }, ctxOf(run));
  const [sent, ...more] = await queued();
  expect(more).toEqual([]);
  expect(sent).toMatchObject({
    to: TO,
    name: "bia",
    email: bia.email,
    orgName: "Acme",
    text: "The sky is too dark at night.",
    app: "agent",
    version: "1.2.3",
  });
  const mail = renderFeedback(sent as Feedback);
  expect(mail.subject).toBe("Feedback from bia");
  expect(mail.text).toContain("Written by: Dev (@dev), an agent, when they asked");
  expect(mail.text).toContain("Workspace: Acme");
});

test("it counts toward the person's hour, the form's own", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const rateLimiter = limiter();
  rateLimiter.used.set(`feedback:${bia.id}`, FEEDBACK_PER_HOUR.limit);
  const out = await (await toolOf(source({ rateLimiter }))).execute({ text: "One more." }, ctxOf(run));
  expect(out.isError).toBe(true);
  expect(await queued()).toEqual([]);
});

test("nobody behind the call, or a person who left: nothing sent", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf();
  const nobody = { ...ctxOf(run), runId: "", triggerMessageId: "" } as ToolContext;
  expect((await tool.execute({ text: "By itself." }, nobody)).isError).toBe(true);
  await f.db
    .delete(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.orgId, f.org.id), eq(schema.organizationMembers.userId, bia.id)));
  expect((await tool.execute({ text: "After leaving." }, ctxOf(run))).isError).toBe(true);
  expect(await queued()).toEqual([]);
});

test("a routine's run never sends feedback", async () => {
  const tool = await toolOf();
  expect(toolPolicy({ kind: "routine", personId: null, brief: null }, tool).action).toBe("refuse");
});

test("each call asks the person it speaks for, and only them, showing the text", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf();
  expect(tool.sensitive).toBe(true);
  expect(tool.describe?.({ text: " Too dark. " }).detail).toBe("Too dark.");
  const asked = await tool.approvers?.({ text: "Too dark." }, ctxOf(run), bia.id);
  expect(asked).toMatchObject({ ok: true, approvers: { userIds: [bia.id], required: true, requestedBy: null } });
  const nobody = { ...ctxOf(run), runId: "", triggerMessageId: "" } as ToolContext;
  expect((await tool.approvers?.({ text: "By itself." }, nobody, null))?.ok).toBe(false);
});

/**
 * ADR 0160 §11 and §12, amended 2026-11-11: the run's side, from stored data. A computer brain on a Mac, one model
 * call, a failure of one of the app's own tools and one of a connected app's (whose text is that app's data).
 */
async function withRunFacts(run: AgentRun) {
  const [mac] = await f.db
    .insert(schema.machines)
    .values({ orgId: f.org.id, name: "MacBook da Bia", os: "darwin", arch: "arm64", runnerVersion: "0.11.0" })
    .returning();
  await f.db.update(schema.agents).set({ machineId: mac?.id }).where(eq(schema.agents.id, run.agentId));
  await f.db.update(schema.agentRuns).set({ brain: "claude_code" }).where(eq(schema.agentRuns.id, run.id));
  await f.db.insert(schema.usageRecords).values({
    orgId: f.org.id,
    agentId: run.agentId,
    runId: run.id,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    requestedModel: "sonnet",
    inputTokens: 10,
    outputTokens: 5,
    costNanoUsd: 0,
  });
  const step = (seq: number, data: Record<string, unknown>) => ({
    orgId: f.org.id,
    runId: run.id,
    seq,
    kind: "tool_result" as const,
    data,
  });
  await f.db.insert(schema.agentRunSteps).values([
    step(1001, {
      toolUseId: "t1",
      name: "browser_do",
      isError: true,
      content: "\nThe browser closed while opening the page\n  at frame 3",
    }),
    step(1002, {
      toolUseId: "t2",
      name: "gmail_send",
      isError: true,
      external: true,
      content: "Bounce: ana@example.com is full",
    }),
    step(1003, { toolUseId: "t3", name: "web_search", isError: false, content: "ok" }),
  ]);
}

const RUN_FACTS = (runId: string) => [
  ["Brain", "Claude Code"],
  ["Model", "claude-sonnet-5-5 (anthropic)"],
  ["Computer", "darwin arm64, runner 0.11.0"],
  ["Tool error", "browser_do: The browser closed while opening the page"],
  ["Run", runId],
];

test("what goes along: the run's brain, model, computer and own tool failures, never its name or an app's data", async () => {
  f = await setup();
  const { run } = await askedByBia();
  await withRunFacts(run);
  await (await toolOf()).execute({ text: "The page never opened." }, ctxOf(run));
  const [sent] = await queued();
  const facts = sent?.facts ?? [];
  expect(facts.slice(0, 2).map(([k]) => k)).toEqual(["Role", "Written by"]);
  expect(facts.slice(2, 7)).toEqual(RUN_FACTS(run.id) as [string, string][]);
  expect(facts[7]?.[0]).toBe("Run started");
  const mail = renderFeedback(sent as Feedback).text;
  expect(mail).toContain("Tool error: browser_do: The browser closed while opening the page");
  expect(mail).not.toContain("MacBook da Bia");
  expect(mail).not.toContain("is full");
});

test("the approval's card lists the same lines before the person approves", async () => {
  f = await setup();
  const { run } = await askedByBia();
  await withRunFacts(run);
  await f.db.insert(schema.approvals).values({
    orgId: f.org.id,
    runId: run.id,
    agentId: run.agentId,
    channelId: run.channelId,
    threadRootId: run.threadRootId,
    toolUseId: "call-9",
    tool: "send_feedback",
    scope: "",
    params: { text: "The page never opened." },
    actionHash: "feedback-1",
    title: "Send feedback to whoever runs this server",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [card] = await listApprovals(f.db, f.owner.id, f.org.id, { status: "pending" });
  expect(card?.feedback?.facts.slice(0, 5)).toEqual(RUN_FACTS(run.id) as [string, string][]);
  // Any other action carries none.
  expect((await listApprovals(f.db, f.owner.id, f.org.id)).filter((a) => a.tool !== "send_feedback")).toEqual([]);
});

test("an offer keeps the lines on its row, and they are what its email carries", async () => {
  f = await setup();
  const { run } = await askedByBia();
  await withRunFacts(run);
  const [, offer] = await source().tools({} as ToolContext);
  const out = await offer?.execute(
    { summary: "the browser closed while opening a page", text: "I was opening the report and the browser closed." },
    ctxOf(run),
  );
  const view = (out?.data?.feedbackOffer as { view: unknown } | undefined)?.view;
  const read = feedbackOfferOf({ feedbackOffer: view });
  expect(read?.facts?.slice(0, 5)).toEqual(RUN_FACTS(run.id) as [string, string][]);
  // Read back safely: odd lines and too many are left out.
  const odd = feedbackOfferOf({
    feedbackOffer: { ...(view as object), facts: [["ok", "yes"], ["no"], [1, 2], ...Array(20).fill(["k", "v"])] },
  });
  expect(odd?.facts?.[0]).toEqual(["ok", "yes"]);
  expect(odd?.facts).toHaveLength(12);
});

test("a run with nothing to say adds only itself", async () => {
  f = await setup();
  const { run } = await askedByBia();
  await (await toolOf()).execute({ text: "Just this." }, ctxOf(run));
  const [sent] = await queued();
  expect((sent?.facts ?? []).map(([k]) => k)).toEqual(["Role", "Written by", "Run", "Run started"]);
});
