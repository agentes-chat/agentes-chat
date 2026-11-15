import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { claimClaudeDesignJob, recordClaudeDesignResult, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
const input = { action: "create" as const, title: "Sample", brief: "Create a sample", sourceArtifactIds: [] };
async function prepare() {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
}
test("invocation identity is mandatory and reuse with changed inputs conflicts", async () => {
  await prepare();
  await expect(reserveClaudeDesignJob(f.designDeps, { ...f.ctx, toolUseId: undefined }, input)).rejects.toThrow();
  const a = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  expect((await reserveClaudeDesignJob(f.designDeps, f.ctx, input)).id).toBe(a.id);
  await expect(reserveClaudeDesignJob(f.designDeps, f.ctx, { ...input, brief: "different" })).rejects.toThrow();
  expect((await reserveClaudeDesignJob(f.designDeps, { ...f.ctx, toolUseId: "call-2" }, input)).id).not.toBe(a.id);
  expect(await claimClaudeDesignJob(f.designDeps, a.id)).toBe(true);
  expect(await claimClaudeDesignJob(f.designDeps, a.id)).toBe(false);
});
test("unknown holds a durable lock; late proof advances once and stale updates cannot race", async () => {
  await prepare();
  const a = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, a.id));
  if (!job) throw new Error("no job");
  await claimClaudeDesignJob(f.designDeps, a.id);
  const unknown = { jobId: a.id, state: "unknown" as const, sourceFiles: [] };
  await recordClaudeDesignResult(f.designDeps, job.taskId, unknown);
  const remote = {
    id: "synthetic",
    url: new URL("/artifact/synthetic", "https://claude.ai").href,
    version: "opaque-v1",
  };
  const published = { ...unknown, state: "published" as const, remote };
  await recordClaudeDesignResult(f.designDeps, job.taskId, published);
  await recordClaudeDesignResult(f.designDeps, job.taskId, published);
  const [current] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, a.id));
  const update = {
    action: "update" as const,
    brief: "Change sample",
    sourceArtifactIds: [],
    designId: current?.designId ?? "",
    expectedRevision: 1,
  };
  await expect(reserveClaudeDesignJob(f.designDeps, { ...f.ctx, toolUseId: "blocked" }, update)).rejects.toThrow();
  await recordClaudeDesignResult(f.designDeps, job.taskId, { ...published, state: "succeeded" });
  await recordClaudeDesignResult(f.designDeps, job.taskId, unknown);
  const outcomes = await Promise.allSettled(
    ["one", "two"].map((toolUseId) => reserveClaudeDesignJob(f.designDeps, { ...f.ctx, toolUseId }, update)),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const [design] = await f.db
    .select()
    .from(schema.claudeDesignArtifacts)
    .where(eq(schema.claudeDesignArtifacts.id, update.designId));
  expect(design?.revision).toBe(1);
});
test("unrelated task results and account revocation cannot release an uncertain design", async () => {
  await prepare();
  const a = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  await expect(
    recordClaudeDesignResult(f.designDeps, crypto.randomUUID(), { jobId: a.id, state: "failed", sourceFiles: [] }),
  ).rejects.toThrow();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, a.id));
  expect(job?.cancelRequestedAt).not.toBeNull();
  expect(await claimClaudeDesignJob(f.designDeps, a.id)).toBe(false);
});

test("published references survive cancellation and account removal invalidates grants without deleting history", async () => {
  await prepare();
  const a = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, a.id));
  if (!job) throw new Error("no job");
  const remote = {
    id: "synthetic",
    url: new URL("/artifact/synthetic", "https://claude.ai").href,
    version: "version-one",
  };
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "published",
    remote,
    sourceFiles: [],
  });
  await recordClaudeDesignResult(f.designDeps, job.taskId, { jobId: job.id, state: "canceled", sourceFiles: [] });
  const { removeMachineAccount } = await import("../src/machine-accounts");
  let removalCalls = 0;
  await removeMachineAccount(
    {
      db: f.db,
      pubsub: f.pubsub,
      hub: {
        call: async () => {
          removalCalls++;
          return {} as never;
        },
        status: async () => null,
      },
    },
    f.owner.id,
    f.org.id,
    f.machineId,
    f.accountId,
  );
  expect(removalCalls).toBe(1);
  expect(
    await f.db.select().from(schema.machineAccounts).where(eq(schema.machineAccounts.id, f.accountId)),
  ).toHaveLength(0);
  const [retained] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, a.id));
  expect(retained?.state).toBe("published");
  expect(retained?.cancelRequestedAt).not.toBeNull();
  const [grant] = await f.db
    .select()
    .from(schema.claudeDesignGrants)
    .where(eq(schema.claudeDesignGrants.agentId, f.agent.id));
  expect(grant?.enabled).toBe(false);
  const [design] = await f.db
    .select()
    .from(schema.claudeDesignArtifacts)
    .where(eq(schema.claudeDesignArtifacts.id, job.designId));
  expect(design?.remoteId).toBe(remote.id);
  expect(design?.unavailable).toBe(true);
});
