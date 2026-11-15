import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(async () => {
  await t?.close();
});
async function setup(enabled = true) {
  t = await createTestServer({ env: { CLAUDE_DESIGN_EXPERIMENTAL: String(enabled), ALLOW_SIGNUP: "true" } });
  const b = browser(t);
  await signUp(b, "design-owner@example.com");
  const org = await seedOrg(b);
  const [owner] = await t.db.select().from(schema.users).where(eq(schema.users.email, "design-owner@example.com"));
  if (!owner) throw new Error("No owner");
  const [machine] = await t.db
    .insert(schema.machines)
    .values({
      orgId: org.orgId,
      name: "Design test",
      os: "darwin",
      arch: "arm64",
      protocol: 68,
      pairedByUserId: owner.id,
      executors: { claude: { version: "2.1.322 (Claude Code)" } },
    })
    .returning();
  if (!machine) throw new Error("No machine");
  const accountId = crypto.randomUUID();
  await t.db.insert(schema.machineAccounts).values({
    id: accountId,
    orgId: org.orgId,
    machineId: machine.id,
    kind: "claude_code",
    label: "Design",
    createdBy: owner.id,
    authMethod: "cli_login",
    status: "active",
  });
  const path = `/api/app/organizations/${org.orgId}/claude-design/agents/${org.agentId}/grant`;
  return { b, ...org, owner, machine, accountId, path };
}
test("grant routes use session, origin checks and strict owner-controlled input", async () => {
  const f = await setup();
  expect((await browser(t)(f.path)).status).toBe(401);
  expect(
    (await f.b(f.path, { method: "PUT", origin: "https://example.invalid", json: { accountId: f.accountId } })).status,
  ).toBe(403);
  expect((await f.b(f.path, { method: "PUT", json: { accountId: f.accountId, cwd: "/tmp" } })).status).toBe(400);
  const granted = await f.b(f.path, { method: "PUT", json: { accountId: f.accountId } });
  expect(granted.status).toBe(403);
  expect(await (await f.b(f.path)).json()).toMatchObject({ enabled: false, available: false, reason: "disabled" });
  expect((await f.b(f.path, { method: "PUT", json: { accountId: null } })).status).toBe(200);
  expect(await (await f.b(f.path)).json()).toMatchObject({ enabled: false });
});
test("the feature is off by default and arbitrary jobs are not disclosed", async () => {
  const f = await setup(false);
  expect(await (await f.b(f.path)).json()).toMatchObject({ available: false, reason: "disabled" });
  expect((await f.b(f.path, { method: "PUT", json: { accountId: f.accountId } })).status).toBe(403);
  const route = `/api/app/organizations/${f.orgId}/claude-design/jobs/${crypto.randomUUID()}`;
  expect((await f.b(route)).status).toBe(404);
  expect((await f.b(`${route}/cancel`, { json: {} })).status).toBe(404);
});

test("another member cannot read or cancel an existing private job", async () => {
  const f = await setup();
  await f.b(f.path, { method: "PUT", json: { accountId: f.accountId } });
  const { openDm, reserveClaudeDesignJob, setClaudeDesignGrant } = await import("@agenteschat/engine");
  await setClaudeDesignGrant({ db: t.db, enabled: true }, f.owner.id, f.orgId, f.agentId, f.accountId);
  const dm = await openDm(t.db, f.owner.id, f.orgId, { agentId: f.agentId });
  const [message] = await t.db
    .insert(schema.messages)
    .values({ orgId: f.orgId, channelId: dm.id, authorType: "person", authorUserId: f.owner.id, body: "A design" })
    .returning();
  if (!message) throw new Error("no message");
  const [run] = await t.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.orgId,
      agentId: f.agentId,
      channelId: dm.id,
      threadRootId: message.id,
      triggerMessageId: message.id,
      trigger: "dm",
      hop: 1,
    })
    .returning();
  if (!run) throw new Error("no run");
  const job = await reserveClaudeDesignJob(
    { db: t.db, enabled: true },
    {
      db: t.db,
      orgId: f.orgId,
      agentId: f.agentId,
      channelId: dm.id,
      threadRootId: message.id,
      triggerMessageId: message.id,
      runId: run.id,
      toolUseId: "private-job",
    },
    { action: "create", title: "Private", brief: "Private", sourceArtifactIds: [] },
  );
  const route = `/api/app/organizations/${f.orgId}/claude-design/jobs/${job.id}`;
  expect((await f.b(route)).status).toBe(200);
  const consentId = crypto.randomUUID();
  const [saved] = await t.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!saved) throw Error("Missing job");
  await t.db.insert(schema.claudeDesignConsents).values({
    id: consentId,
    orgId: f.orgId,
    jobId: job.id,
    taskId: saved.taskId,
    accountId: f.accountId,
    machineId: f.machine.id,
    ownerUserId: f.owner.id,
    grantRevision: saved.grantRevision,
    sequence: 1,
    toolUseId: "read-synthetic",
    inputHash: "a".repeat(64),
    remoteId: "synthetic",
    remoteUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
    description: "read an artifact (read-only)",
    expiresAt: new Date(Date.now() + 60000),
  });
  const consentRoute = `/api/app/organizations/${f.orgId}/claude-design/consents/${consentId}`;
  expect((await browser(t)(consentRoute)).status).toBe(401);
  expect((await f.b(consentRoute)).status).toBe(200);
  expect(await (await f.b(consentRoute)).json()).toMatchObject({
    accountLabel: "Design",
    canDecide: false,
    status: "canceled",
  });
  expect(
    (await f.b(consentRoute, { json: { decision: "approve", reviewed: true }, origin: "https://foreign.invalid" }))
      .status,
  ).toBe(403);
  expect((await f.b(consentRoute, { json: { decision: "approve", reviewed: false } })).status).toBe(400);
  expect((await f.b(consentRoute, { json: { decision: "approve", reviewed: true, always: true } })).status).toBe(400);
  expect((await f.b(consentRoute, { json: { decision: "approve", reviewed: true } })).status).toBe(409);

  const other = browser(t);
  await signUp(other, "other-design-member@example.com");
  const [member] = await t.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "other-design-member@example.com"));
  if (!member) throw new Error("no member");
  await t.db.insert(schema.organizationMembers).values({ orgId: f.orgId, userId: member.id, role: "member" });
  expect((await other(consentRoute)).status).toBe(404);
  expect((await other(consentRoute, { json: { decision: "approve", reviewed: true } })).status).toBe(404);
  expect((await other(route)).status).toBe(404);
  expect((await other(`${route}/cancel`, { json: {} })).status).toBe(404);
});

test("an environment flag alone cannot enable the unverified native consent flow", async () => {
  const f = await setup(true);
  const before = await (await f.b(f.path)).json();
  expect(before).toMatchObject({ available: false, reason: "disabled" });
  expect((await f.b(f.path, { method: "PUT", json: { accountId: f.accountId } })).status).toBe(403);
});
