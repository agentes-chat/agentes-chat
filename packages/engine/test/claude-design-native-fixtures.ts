import { expect } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { claimClaudeDesignJob, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { acceptClaudeDesignTaskResult, authorizeClaudeDesignEffect } from "../src/claude-design/lifecycle";
import { designFixture } from "./claude-design-fixtures";
export async function nativeDesignReadFixture() {
  const f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const v = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Test design",
    brief: "Test",
    sourceArtifactIds: [],
  });
  await claimClaudeDesignJob(f.designDeps, v.id);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, v.id));
  if (!job) throw Error("job");
  await f.db.insert(schema.machineTasks).values({
    id: job.taskId,
    orgId: f.org.id,
    agentId: f.agent.id,
    machineId: f.machineId,
    channelId: job.channelId,
    threadRootId: job.threadRootId,
    runId: job.runId,
    requestedByUserId: f.owner.id,
    title: job.title,
    executor: "claude",
    status: "running",
  });
  const base = {
    type: "design.authorize" as const,
    requestId: crypto.randomUUID(),
    taskId: job.taskId,
    jobId: job.id,
    grantRevision: job.grantRevision,
  };
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        ...base,
        sequence: 1,
        effect: "create",
        toolUseId: "native-create",
        inputHash: "a".repeat(64),
      })
    ).allow,
  ).toBe(true);
  const remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "v1" };
  await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, job.taskId, {
    jobId: job.id,
    state: "published",
    remote,
    publicationSequence: 1,
    sourceFiles: [],
  });
  const read = {
    ...base,
    requestId: crypto.randomUUID(),
    sequence: 2,
    effect: "read_target" as const,
    toolUseId: "native-read",
    inputHash: "b".repeat(64),
    remoteId: remote.id,
    remoteVersion: remote.version,
  };
  expect((await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, read)).allow).toBe(true);
  const request = {
    type: "design.consent" as const,
    requestId: crypto.randomUUID(),
    jobId: job.id,
    taskId: job.taskId,
    grantRevision: job.grantRevision,
    sequence: 2,
    toolUseId: read.toolUseId,
    inputHash: read.inputHash,
    remoteId: remote.id,
    description: "read an artifact (read-only)",
  };
  return { f, job, read, request };
}
