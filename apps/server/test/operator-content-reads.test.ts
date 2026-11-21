import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { type Database, eq, schema } from "@agenteschat/db";
import { addRunStep, markThreadConfidential } from "@agenteschat/engine";
import { createLogger } from "../src/logger";
import { createOperatorApp } from "../src/operator/app";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

/**
 * The reveal door's investigation reads: a conversation's messages, a run's transcript, an agent's settings. Only
 * the reveal token opens them, each is on record (feed and workspace audit log) before any text, and the door's
 * bounds hold: credentials masked, confidential threads and what two people said to each other kept out.
 */

const TOKEN = "operator-test-token-".padEnd(48, "x");
const READ = "operator-read-token-".padEnd(48, "x");
const REVEAL = "operator-reveal-token-".padEnd(48, "x");
const UNKNOWN = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const FAKE_KEY = "sk-ant-FAKEFAKEFAKEFAKE0000";
const WHY = { reason: "Find why the agent answered the wrong channel", caseRef: "case-42", operator: "ops:ana" };
const HOUR = 3600_000;

let t: TestServer;
let db: Database;
let app: ReturnType<typeof createOperatorApp>;
const w = {} as Record<"orgId" | "generalId" | "agentId" | "dmId" | "runId" | "sealedRunId" | "otherOrgId", string>;

const post = (path: string, json: unknown, token = REVEAL) =>
  app.request(`/api/operator/v1/reveal/orgs/${w.orgId}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...WHY, assistedByAi: true, ...(json as object) }),
  });
const window = () => ({
  from: new Date(Date.now() - HOUR).toISOString(),
  to: new Date(Date.now() + HOUR).toISOString(),
});
const events = () => db.select().from(schema.operatorEvents).where(eq(schema.operatorEvents.type, "content.viewed"));
const entries = () =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, "operator.content_read"))
    .then((rows) => rows.filter((r) => r.orgId === w.orgId));

beforeAll(async () => {
  t = await createTestServer({
    env: {
      OPERATOR_API_TOKEN: TOKEN,
      OPERATOR_API_READ_TOKEN: READ,
      OPERATOR_API_REVEAL_TOKEN: REVEAL,
      ALLOW_SIGNUP: "true",
    },
  });
  db = t.db;
  const unlimited = {
    consume: async () => ({ allowed: true, remaining: 1, resetAt: new Date(0) }),
    release: async () => {},
  };
  app = createOperatorApp(
    { db, config: t.config, version: "test", log: createLogger("error"), rateLimiter: unlimited },
    TOKEN,
    READ,
    REVEAL,
  );
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const org = await seedOrg(owner);
  const other = browser(t);
  await signUp(other, "other@example.com");
  Object.assign(w, {
    orgId: org.orgId,
    generalId: org.channelId,
    agentId: org.agentId,
    otherOrgId: (await seedOrg(other)).orgId,
  });
  const [ownerUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, "owner@example.com"));
  const ownerId = ownerUser?.id ?? "";
  await db
    .update(schema.agents)
    .set({ instructions: `Answer in rhyme. Deploy key ${FAKE_KEY}`, role: "Support" })
    .where(eq(schema.agents.id, w.agentId));

  const [dm] = await db
    .insert(schema.channels)
    .values({ orgId: w.orgId, name: "dm-two-people", kind: "dm", visibility: "private", dmKey: "dm-two-people" })
    .returning({ id: schema.channels.id });
  w.dmId = dm?.id ?? "";

  const say = async (channelId: string, body: string, over: Partial<typeof schema.messages.$inferInsert> = {}) => {
    const [m] = await db
      .insert(schema.messages)
      .values({ orgId: w.orgId, channelId, authorType: "person", authorUserId: ownerId, body, ...over })
      .returning({ id: schema.messages.id });
    return m?.id ?? "";
  };
  const asked = await say(w.generalId, `@dev deploy with ${FAKE_KEY}`);
  await say(w.generalId, "a second message");
  await say(w.generalId, "deleted words", { deletedAt: new Date() });
  const sealed = await say(w.generalId, "sealed words");
  await markThreadConfidential(db, { orgId: w.orgId, channelId: w.generalId, rootId: sealed });
  await say(w.dmId, "what two people said");

  const run = async (trigger: string) => {
    const [r] = await db
      .insert(schema.agentRuns)
      .values({
        orgId: w.orgId,
        agentId: w.agentId,
        channelId: w.generalId,
        threadRootId: trigger,
        triggerMessageId: trigger,
        trigger: "mention",
        hop: 1,
        status: "done",
        brain: "model",
      })
      .returning({ id: schema.agentRuns.id });
    return r?.id ?? "";
  };
  w.runId = await run(asked);
  w.sealedRunId = await run(sealed);
  const reply = await say(w.generalId, "Deployed.", {
    authorType: "agent",
    authorUserId: null,
    authorAgentId: w.agentId,
    agentRunId: w.runId,
  });
  const step = (kind: Parameters<typeof addRunStep>[2], data: Record<string, unknown>) =>
    addRunStep(db, { id: w.runId, orgId: w.orgId }, kind, data);
  await step("model_call", { model: "fake-model", narration: "Looking it up." });
  await step("tool_call", { toolUseId: "u1", name: "deploy", input: { target: "prod", password: "hunter2-fake" } });
  await step("tool_result", { toolUseId: "u1", name: "deploy", content: "x".repeat(5000), isError: true });
  await step("message", { messageId: reply });
});

afterAll(() => t.close());

beforeEach(async () => {
  await db.delete(schema.operatorEvents);
  await db.delete(schema.auditLog).where(eq(schema.auditLog.action, "operator.content_read"));
});

test("only the reveal token opens the reads", async () => {
  const paths = [
    [`/conversations/${w.generalId}/messages`, window()],
    [`/runs/${w.runId}/transcript`, {}],
    [`/agents/${w.agentId}/settings`, {}],
  ] as const;
  for (const [path, json] of paths) {
    expect((await post(path, json, TOKEN)).status).toBe(403);
    expect((await post(path, json, READ)).status).toBe(403);
    expect((await post(path, json, "wrong")).status).toBe(401);
    expect((await post(path, json)).status).toBe(200);
  }
});

test("a conversation's messages, masked, with what is kept out saying why", async () => {
  const res = await post(`/conversations/${w.generalId}/messages`, window());
  expect(res.status).toBe(200);
  const read = (await res.json()) as {
    messages: { text: string | null; withheld: string | null }[];
    next: string | null;
  };
  const texts = read.messages.map((m) => [m.text, m.withheld]);
  expect(texts).toEqual([
    ["@dev deploy with ••••", null],
    ["a second message", null],
    [null, "deleted"],
    [null, "confidential"],
    ["Deployed.", null],
  ]);
  expect(JSON.stringify(read)).not.toContain(FAKE_KEY);
  expect(read.next).toBeNull();

  const dm = (await (await post(`/conversations/${w.dmId}/messages`, window())).json()) as typeof read;
  expect(dm.messages.map((m) => [m.text, m.withheld])).toEqual([[null, "direct_conversation"]]);
});

test("the read is on record: the reason in the feed, never in the workspace's audit log", async () => {
  await post(`/conversations/${w.generalId}/messages`, window());
  await post(`/conversations/${w.dmId}/messages`, window());
  const [first, second] = await events();
  expect(first?.data).toMatchObject({
    ref: `reveal:conversation:${w.generalId}`,
    purpose: "investigation",
    field: "messages",
    reason: WHY.reason,
    caseRef: WHY.caseRef,
    operator: WHY.operator,
    assistedByAi: true,
    channelId: w.generalId,
  });
  expect(second?.data).toMatchObject({ direct: true, channelId: w.dmId });
  const audit = await entries();
  expect(audit.map((a) => [a.targetType, a.targetId])).toEqual(
    expect.arrayContaining([
      ["conversation", w.generalId],
      ["conversation", null],
    ]),
  );
  expect(JSON.stringify(audit)).not.toContain(WHY.reason);
  expect(JSON.stringify(audit)).not.toContain(WHY.caseRef);
  expect(audit.every((a) => a.details.purpose === "investigation" && a.actorType === "system")).toBe(true);
});

test("pages follow the cursor, and the window and the reason are bounded", async () => {
  const first = (await (await post(`/conversations/${w.generalId}/messages`, { ...window(), limit: 2 })).json()) as {
    messages: { id: string }[];
    next: string;
  };
  expect(first.messages).toHaveLength(2);
  const rest = (await (
    await post(`/conversations/${w.generalId}/messages`, { ...window(), limit: 200, cursor: first.next })
  ).json()) as typeof first;
  expect(rest.messages).toHaveLength(3);
  expect(rest.messages.map((m) => m.id)).not.toContain(first.messages[0]?.id);

  const wide = { from: new Date(Date.now() - 49 * HOUR).toISOString(), to: new Date().toISOString() };
  expect((await post(`/conversations/${w.generalId}/messages`, wide)).status).toBe(400);
  expect((await post(`/conversations/${w.generalId}/messages`, { ...window(), limit: 201 })).status).toBe(400);
  expect((await post(`/conversations/${w.generalId}/messages`, { ...window(), reason: "too short" })).status).toBe(400);
  expect(
    (await post(`/conversations/${w.generalId}/messages`, { ...window(), reason: "See https://example.com/x now" }))
      .status,
  ).toBe(400);
  expect((await post(`/conversations/${UNKNOWN}/messages`, window())).status).toBe(404);
  // Nothing refused is on record.
  expect(await events()).toHaveLength(2);
});

test("another workspace's records answer 404 and leave no record", async () => {
  const [foreign] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(eq(schema.channels.orgId, w.otherOrgId));
  expect((await post(`/conversations/${foreign?.id}/messages`, window())).status).toBe(404);
  expect((await post(`/runs/${UNKNOWN}/transcript`, {})).status).toBe(404);
  expect((await post(`/agents/${UNKNOWN}/settings`, {})).status).toBe(404);
  expect(await events()).toHaveLength(0);
});

test("a run's transcript: the model's words, calls and results masked and cut, what it posted", async () => {
  const res = await post(`/runs/${w.runId}/transcript`, {});
  expect(res.status).toBe(200);
  const read = (await res.json()) as {
    request: { text: string };
    steps: { kind: string; name: string | null; text: string | null; chars: number; cut: boolean; isError: boolean }[];
    nextSeq: number | null;
  };
  expect(read.request.text).toBe("@dev deploy with ••••");
  expect(read.steps.map((s) => [s.kind, s.name])).toEqual([
    ["model_call", "fake-model"],
    ["tool_call", "deploy"],
    ["tool_result", "deploy"],
    ["message", null],
  ]);
  expect(read.steps[0]?.text).toBe("Looking it up.");
  expect(read.steps[1]?.text).toContain("target: prod");
  expect(read.steps[1]?.text).not.toContain("hunter2-fake");
  expect(read.steps[2]).toMatchObject({ isError: true, chars: 5000, cut: true });
  expect(read.steps[2]?.text).toHaveLength(4000);
  expect(read.steps[3]?.text).toBe("Deployed.");
  expect(read.nextSeq).toBeNull();

  const paged = (await (await post(`/runs/${w.runId}/transcript`, { limit: 2 })).json()) as typeof read;
  expect(paged.nextSeq).toBe(2);
  const after = (await (await post(`/runs/${w.runId}/transcript`, { afterSeq: 2 })).json()) as typeof read;
  expect(after.steps.map((s) => s.kind)).toEqual(["tool_result", "message"]);

  const [event] = await events();
  expect(event?.data).toMatchObject({ ref: `reveal:run:${w.runId}`, field: "transcript", runId: w.runId });
  expect((await entries()).map((a) => [a.targetType, a.targetId])).toContainEqual(["run_step", w.runId]);
});

test("a run of a confidential thread is refused, and leaves no record", async () => {
  const res = await post(`/runs/${w.sealedRunId}/transcript`, {});
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reveal.confidential");
  expect(await events()).toHaveLength(0);
});

test("an agent's instructions and settings, masked", async () => {
  const res = await post(`/agents/${w.agentId}/settings`, {});
  expect(res.status).toBe(200);
  const read = (await res.json()) as { instructions: string; role: string; model: string };
  expect(read.instructions).toBe("Answer in rhyme. Deploy key ••••");
  expect(read.role).toBe("Support");
  expect(typeof read.model).toBe("string");
  const [entry] = await entries();
  expect(entry).toMatchObject({ targetType: "agent", targetId: w.agentId });
  expect(entry?.details).toMatchObject({ field: "settings", purpose: "investigation", agentId: w.agentId });
});
