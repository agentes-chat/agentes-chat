import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import {
  closeClaudeDesignConsents,
  decideClaudeDesignConsent,
  getClaudeDesignConsentForOwner,
  pollClaudeDesignConsent,
} from "../src/claude-design/consent";
import { authorizeClaudeDesignEffect } from "../src/claude-design/lifecycle";
import { getIssue } from "../src/issues";
import { type DesignFixture } from "./claude-design-fixtures";
import { nativeDesignReadFixture } from "./claude-design-native-fixtures";
import { addMember } from "./fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function setup() {
  const result = await nativeDesignReadFixture();
  f = result.f;
  return result;
}

test("one native operation creates one owner-only reviewed consent, consumed and reauthorized once", async () => {
  const p = await setup();
  const deps = { ...f.designDeps, pubsub: f.pubsub };
  const first = await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request);
  expect(first).toMatchObject({ pending: true, allow: false });
  const card = await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: p.job.issueId! });
  expect(card).toMatchObject({
    status: "in_progress",
    blocked: { reason: "waiting_you" },
    work: { state: "waiting_approval" },
  });
  expect(await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).toEqual(first);
  const rows = await f.db.select().from(schema.claudeDesignConsents);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Missing consent");
  const [notice] = await f.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, row.messageId ?? ""));
  expect(notice?.channelId).toBe(p.job.channelId);
  expect(notice?.threadId).toBeNull();
  const id = row.id;
  const other = await addMember(f.db, f.org.id, "admin", "other");
  await expect(getClaudeDesignConsentForOwner(deps, other.id, f.org.id, id)).rejects.toThrow();
  await expect(
    decideClaudeDesignConsent(deps, other.id, f.org.id, id, { decision: "approve", reviewed: true }),
  ).rejects.toThrow();
  await expect(
    decideClaudeDesignConsent(deps, f.owner.id, f.org.id, id, { decision: "approve", reviewed: false }),
  ).rejects.toThrow();
  expect((await getClaudeDesignConsentForOwner(deps, f.owner.id, f.org.id, id)).status).toBe("pending");
  await decideClaudeDesignConsent(deps, f.owner.id, f.org.id, id, { decision: "approve", reviewed: true });
  expect(await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: p.job.issueId! })).toMatchObject({
    blocked: null,
    work: { state: "running" },
  });
  expect(await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).toMatchObject({
    pending: false,
    allow: true,
  });
  expect(await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).toMatchObject({
    pending: false,
    allow: false,
  });
  const fresh = { ...p.read, requestId: crypto.randomUUID(), sequence: 3, consentRequestId: p.request.requestId };
  expect((await authorizeClaudeDesignEffect(deps, f.org.id, f.machineId, fresh)).allow).toBe(true);
  expect(
    (
      await authorizeClaudeDesignEffect(deps, f.org.id, f.machineId, {
        ...fresh,
        requestId: crypto.randomUUID(),
        sequence: 4,
      })
    ).allow,
  ).toBe(false);
  const [stored] = await f.db.select().from(schema.claudeDesignConsents);
  expect(stored?.reauthorizedAt).not.toBeNull();
  expect(stored?.decidedByUserId).toBe(f.owner.id);
});
test("unknown or changed operation, another machine and revocation cannot become native approval", async () => {
  const p = await setup();
  const deps = { ...f.designDeps, pubsub: f.pubsub };
  for (const patch of [
    { toolUseId: "different" },
    { inputHash: "c".repeat(64) },
    { remoteId: "other" },
    { sequence: 1 },
    { grantRevision: 99 },
  ])
    expect((await pollClaudeDesignConsent(deps, f.org.id, f.machineId, { ...p.request, ...patch })).allow).toBe(false);
  expect(await f.db.select().from(schema.claudeDesignConsents)).toHaveLength(0);
  expect((await pollClaudeDesignConsent(deps, f.org.id, crypto.randomUUID(), p.request)).pending).toBe(false);
  await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request);
  const [row] = await f.db.select().from(schema.claudeDesignConsents);
  if (!row) throw Error("consent");
  await decideClaudeDesignConsent(deps, f.owner.id, f.org.id, row.id, { decision: "approve", reviewed: true });
  await setClaudeDesignGrant(deps, f.owner.id, f.org.id, f.agent.id, null);
  expect((await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).allow).toBe(false);
  expect(
    (
      await authorizeClaudeDesignEffect(deps, f.org.id, f.machineId, {
        ...p.read,
        requestId: crypto.randomUUID(),
        sequence: 3,
        consentRequestId: p.request.requestId,
      })
    ).allow,
  ).toBe(false);
});
test("expiry, operator hold and ended tasks close pending consent rather than approving", async () => {
  const p = await setup();
  const deps = { ...f.designDeps, pubsub: f.pubsub };
  await f.db.update(schema.agents).set({ operatorHoldAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
  expect((await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).pending).toBe(false);
  await f.db.update(schema.agents).set({ operatorHoldAt: null }).where(eq(schema.agents.id, f.agent.id));
  await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request);
  const [row] = await f.db.select().from(schema.claudeDesignConsents);
  if (!row) throw Error("consent");
  await f.db
    .update(schema.claudeDesignConsents)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.claudeDesignConsents.id, row.id));
  expect((await pollClaudeDesignConsent(deps, f.org.id, f.machineId, p.request)).allow).toBe(false);
  await expect(
    decideClaudeDesignConsent(deps, f.owner.id, f.org.id, row.id, { decision: "approve", reviewed: true }),
  ).rejects.toThrow();
  const next = { ...p.request, requestId: crypto.randomUUID() };
  await f.db
    .update(schema.machineTasks)
    .set({ endedAt: new Date(), status: "failed" })
    .where(eq(schema.machineTasks.id, p.job.taskId));
  expect((await pollClaudeDesignConsent(deps, f.org.id, f.machineId, next)).pending).toBe(false);
});

test("a different request id cannot create a second consent for the same native tool call", async () => {
  const p = await setup();
  await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, p.request);
  expect(
    await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, {
      ...p.request,
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ pending: false, allow: false });
  expect(await f.db.select().from(schema.claudeDesignConsents)).toHaveLength(1);
});
test("a fresh recovery task has its own consent deadline even when the original job is old", async () => {
  const p = await setup();
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ state: "unknown", createdAt: new Date(Date.now() - 86400000) })
    .where(eq(schema.claudeDesignJobs.id, p.job.id));
  await f.db
    .update(schema.machineTasks)
    .set({ status: "interrupted", endedAt: new Date() })
    .where(eq(schema.machineTasks.id, p.job.taskId));
  const { recoverClaudeDesignJob } = await import("../src/claude-design/service");
  await recoverClaudeDesignJob(
    {
      ...f.designDeps,
      artifacts: f.artifactDeps,
      publicUrl: "https://example.invalid",
      hub: {
        status: async () => ({ online: true, execAllowed: true }) as never,
        call: async () => ({ startedAt: new Date().toISOString() }) as never,
      },
    },
    f.owner.id,
    f.org.id,
    p.job.id,
    new URL("/artifact/synthetic", "https://claude.ai").href,
  );
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  if (!job?.recoveryTaskId) throw Error("recovery task");
  const read = { ...p.read, requestId: crypto.randomUUID(), taskId: job.recoveryTaskId, sequence: 1 };
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, read)).allow).toBe(true);
  const r = { ...p.request, requestId: crypto.randomUUID(), taskId: job.recoveryTaskId, sequence: 1 };
  expect((await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, r)).pending).toBe(true);
  expect((await getClaudeDesignConsentForOwner(f.designDeps, f.owner.id, f.org.id, r.requestId)).canDecide).toBe(true);
});

test("task completion or disconnect closes its pending native consent without losing the remote reference", async () => {
  const { request } = await setup();
  expect((await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, request)).pending).toBe(true);
  await closeClaudeDesignConsents(f.designDeps, f.org.id, f.machineId, request.taskId);
  const [row] = await f.db.select().from(schema.claudeDesignConsents);
  expect(row?.status).toBe("canceled");
  expect((await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, request)).allow).toBe(false);
  const [job] = await f.db.select().from(schema.claudeDesignJobs);
  expect(job?.state).toBe("published");
});

test("board badges use live authority even before the runner polls a revoked request", async () => {
  const p = await setup();
  await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, p.request);
  await f.db
    .update(schema.claudeDesignGrants)
    .set({ enabled: false })
    .where(eq(schema.claudeDesignGrants.id, p.job.grantId));
  expect(await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: p.job.issueId! })).toMatchObject({
    blocked: { reason: "failed" },
    work: { state: "stalled" },
  });
});

test.each(["scope", "run", "account"])(
  "unavailable %s consent clears the live pending reference and waiting badge",
  async (cause) => {
    const p = await setup();
    await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, p.request);
    if (cause === "scope") await f.db.delete(schema.agentScopes).where(eq(schema.agentScopes.agentId, f.agent.id));
    if (cause === "run") await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
    if (cause === "account")
      await f.db
        .update(schema.machineAccounts)
        .set({ status: "signed_out" })
        .where(eq(schema.machineAccounts.id, f.accountId));
    expect(
      (await getClaudeDesignConsentForOwner(f.designDeps, f.owner.id, f.org.id, p.request.requestId)).canDecide,
    ).toBe(false);
    const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
    if (!job) throw Error("No job");
    const { designJobView } = await import("../src/claude-design/ledger");
    expect((await designJobView(f.db, job)).progress).toMatchObject({ stage: "unknown", pendingConsentId: null });
    expect(
      (await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: job.issueId! })).blocked?.reason,
    ).toBe("failed");
  },
);
test.each(["denied", "expired", "revoked", "canceled"])(
  "stopped recovery %s is not reported as actively recovering",
  async (cause) => {
    const p = await setup();
    await f.db
      .update(schema.claudeDesignJobs)
      .set({ state: "unknown" })
      .where(eq(schema.claudeDesignJobs.id, p.job.id));
    await f.db
      .update(schema.machineTasks)
      .set({ status: "interrupted", endedAt: new Date() })
      .where(eq(schema.machineTasks.id, p.job.taskId));
    const { recoverClaudeDesignJob } = await import("../src/claude-design/service");
    await recoverClaudeDesignJob(
      {
        ...f.designDeps,
        artifacts: f.artifactDeps,
        publicUrl: "https://example.invalid",
        hub: {
          status: async () => ({ online: true, execAllowed: true }) as never,
          call: async () => ({ startedAt: new Date().toISOString() }) as never,
        },
      },
      f.owner.id,
      f.org.id,
      p.job.id,
      new URL("/artifact/synthetic", "https://claude.ai").href,
    );
    const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
    if (!job?.recoveryTaskId) throw Error("No recovery");
    const read = { ...p.read, requestId: crypto.randomUUID(), taskId: job.recoveryTaskId, sequence: 1 };
    expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, read)).allow).toBe(true);
    const request = { ...p.request, requestId: crypto.randomUUID(), taskId: job.recoveryTaskId, sequence: 1 };
    expect((await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, request)).pending).toBe(true);
    if (cause === "denied")
      await decideClaudeDesignConsent(f.designDeps, f.owner.id, f.org.id, request.requestId, {
        decision: "deny",
        reviewed: true,
      });
    if (cause === "expired")
      await f.db
        .update(schema.claudeDesignConsents)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.claudeDesignConsents.id, request.requestId));
    if (cause === "revoked") await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
    if (cause === "canceled")
      await f.db
        .update(schema.claudeDesignJobs)
        .set({ cancelRequestedAt: new Date() })
        .where(eq(schema.claudeDesignJobs.id, p.job.id));
    const current = (
      await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id))
    )[0];
    if (!current) throw Error("No job");
    const { designJobView } = await import("../src/claude-design/ledger");
    expect((await designJobView(f.db, current)).progress).toMatchObject({ stage: "unknown", pendingConsentId: null });
    expect(
      (await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: job.issueId! })).work?.state,
    ).toBe("stalled");
  },
);
