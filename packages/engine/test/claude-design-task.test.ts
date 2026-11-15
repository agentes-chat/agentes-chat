import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { claimClaudeDesignJob, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { acceptClaudeDesignTaskResult, authorizeClaudeDesignEffect } from "../src/claude-design/lifecycle";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function job() {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const view = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Sample",
    brief: "Sample",
    sourceArtifactIds: [],
  });
  await claimClaudeDesignJob(f.designDeps, view.id);
  const [row] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  if (!row) throw new Error("no job");
  await f.db.insert(schema.machineTasks).values({
    id: row.taskId,
    orgId: row.orgId,
    agentId: row.agentId,
    machineId: row.machineId,
    channelId: row.channelId,
    threadRootId: row.threadRootId,
    runId: row.runId,
    executor: "claude",
    title: row.title,
    status: "running",
    requestedByUserId: row.ownerUserId,
  });
  return row;
}
test("effect authorization binds connection, task, grant and sequence and refuses revoked/disabled requests", async () => {
  const row = await job();
  const request = {
    type: "design.authorize" as const,
    requestId: "request-1",
    taskId: row.taskId,
    jobId: row.id,
    grantRevision: row.grantRevision,
    sequence: 1,
    effect: "create" as const,
  };
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, crypto.randomUUID(), request)).allow).toBe(false);
  expect(
    (await authorizeClaudeDesignEffect({ ...f.designDeps, enabled: false }, f.org.id, f.machineId, request)).allow,
  ).toBe(false);
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, request)).allow).toBe(true);
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, request)).allow).toBe(false);
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
  expect(
    (await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, { ...request, sequence: 2 })).allow,
  ).toBe(false);
});
test("a shell checkpoint binds the subsequent target; final version advances local revision once", async () => {
  const row = await job();
  const request = {
    type: "design.authorize" as const,
    requestId: "request-1",
    taskId: row.taskId,
    jobId: row.id,
    grantRevision: row.grantRevision,
    sequence: 1,
    effect: "create" as const,
  };
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, request)).allow).toBe(true);
  const remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "v1" };
  const checkpoint = { jobId: row.id, state: "published" as const, sourceFiles: [], remote };
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        ...request,
        sequence: 2,
        effect: "read_target",
        remoteId: remote.id,
        remoteVersion: remote.version,
        checkpoint,
      })
    ).allow,
  ).toBe(true);
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        ...request,
        sequence: 3,
        effect: "publish",
        remoteId: "other",
        remoteVersion: "v1",
      })
    ).allow,
  ).toBe(false);
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        ...request,
        sequence: 3,
        effect: "publish",
        remoteId: remote.id,
        remoteVersion: "v1",
      })
    ).allow,
  ).toBe(true);
  const done = {
    taskId: row.taskId,
    result: { ...checkpoint, publicationSequence: 2, remote: { ...remote, version: "v2" } },
  };
  await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, done.taskId, done.result);
  await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, done.taskId, done.result);
  const [design] = await f.db
    .select()
    .from(schema.claudeDesignArtifacts)
    .where(eq(schema.claudeDesignArtifacts.id, row.designId));
  expect(design?.revision).toBe(1);
  expect(design?.remoteVersion).toBe("v2");
  // A delayed pre-publication frame cannot restore the older opaque version.
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        ...request,
        sequence: 2,
        effect: "read_target",
        remoteId: remote.id,
        remoteVersion: "v1",
        checkpoint,
      })
    ).allow,
  ).toBe(false);
  const [retained] = await f.db
    .select()
    .from(schema.claudeDesignArtifacts)
    .where(eq(schema.claudeDesignArtifacts.id, row.designId));
  expect(retained?.remoteVersion).toBe("v2");
  await expect(
    acceptClaudeDesignTaskResult(f.designDeps, f.org.id, crypto.randomUUID(), done.taskId, done.result),
  ).rejects.toThrow();
});

test("the Design grant adds an account loan without changing the main brain; revocation releases just that loan", async () => {
  await job();
  const main = crypto.randomUUID();
  await f.db.insert(schema.machineAccounts).values({
    id: main,
    orgId: f.org.id,
    machineId: f.machineId,
    kind: "claude_code",
    label: "Main",
    createdBy: f.owner.id,
  });
  await f.db
    .update(schema.agents)
    .set({ brain: "claude_code", brainAccountId: main, machineId: f.machineId })
    .where(eq(schema.agents.id, f.agent.id));
  const { machineAgents } = await import("../src/machines");
  const before = (await machineAgents(f.db, f.org.id, f.machineId)).find((a) => a.id === f.agent.id);
  expect(before?.account).toBe(main);
  expect(before?.accounts).toContain(f.accountId);
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
  const after = (await machineAgents(f.db, f.org.id, f.machineId)).find((a) => a.id === f.agent.id);
  expect(after?.account).toBe(main);
  expect(after?.accounts ?? []).not.toContain(f.accountId);
});

test("completion replay records plan usage once against the dedicated account", async () => {
  const row = await job();
  const result = {
    jobId: row.id,
    state: "failed" as const,
    sourceFiles: [],
    usage: {
      model: "claude-sonnet-5-5",
      inputTokens: 1000,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    },
  };
  await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, row.taskId, result);
  await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, row.taskId, result);
  const usage = await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.id, row.taskId));
  expect(usage).toHaveLength(1);
  expect(usage[0]?.brainAccountId).toBe(f.accountId);
  expect(usage[0]?.costNanoUsd).toBe(0);
});

test("an interrupted Design task never enters generic session resume", async () => {
  const row = await job();
  let resumed = 0;
  await f.db
    .update(schema.machineTasks)
    .set({ sessionId: crypto.randomUUID() })
    .where(eq(schema.machineTasks.id, row.taskId));
  const [task] = await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, row.taskId));
  if (!task) throw new Error("no task");
  const { settleInterruptedTask } = await import("../src/machine-tasks");
  await settleInterruptedTask(
    {
      db: f.db,
      pubsub: f.pubsub,
      start: async () => {
        resumed++;
        return task;
      },
    },
    task,
  );
  expect(resumed).toBe(0);
  const [current] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, row.id));
  expect(current?.state).toBe("unknown");
});

test("removing the write scope after dispatch blocks the next native effect", async () => {
  const row = await job();
  await f.db.delete(schema.agentScopes).where(eq(schema.agentScopes.agentId, f.agent.id));
  const request = {
    type: "design.authorize" as const,
    requestId: "scope-revoked",
    taskId: row.taskId,
    jobId: row.id,
    grantRevision: row.grantRevision,
    sequence: 1,
    effect: "create" as const,
  };
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, request)).allow).toBe(false);
});
