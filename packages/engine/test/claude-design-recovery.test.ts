import { afterEach, expect, test } from "bun:test";
import type { MachineRequest } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { recordClaudeDesignResult, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { reconcileClaudeDesignJob, recoverClaudeDesignJob } from "../src/claude-design/service";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";
import { addMember } from "./fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
const remoteUrl = new URL("/artifact/synthetic", "https://claude.ai").href;
async function setup() {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const v = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Test",
    brief: "Test",
    sourceArtifactIds: [],
  });
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, v.id));
  if (!job) throw Error("job");
  await recordClaudeDesignResult(f.designDeps, job.taskId, { jobId: job.id, state: "unknown", sourceFiles: [] });
  const calls: MachineRequest[] = [];
  const deps = {
    ...f.designDeps,
    artifacts: f.artifactDeps,
    publicUrl: "https://example.invalid",
    hub: {
      status: async () => ({ online: true, execAllowed: true }) as never,
      call: async (_m: string, r: MachineRequest) => {
        calls.push(r);
        return (
          r.op === "task.status"
            ? { tasks: [] }
            : { taskId: r.op === "task.start" ? r.taskId : "unexpected", startedAt: new Date().toISOString() }
        ) as never;
      },
    },
  };
  return { job, deps, calls };
}
test("unknown creation blocks a new invocation and reconciliation never repeats the remote operation", async () => {
  const p = await setup();
  await expect(
    reserveClaudeDesignJob(
      f.designDeps,
      { ...f.ctx, toolUseId: "another-create" },
      { action: "create", title: "Again", brief: "Again", sourceArtifactIds: [] },
    ),
  ).rejects.toThrow();
  expect((await reconcileClaudeDesignJob(p.deps, p.job.id)).state).toBe("unknown");
  expect(p.calls.every((r) => r.op === "task.status")).toBe(true);
});
test("only the owner can associate a canonical reference in a new readonly task; failed recovery retains unknown", async () => {
  const p = await setup();
  await expect(
    recoverClaudeDesignJob(
      p.deps,
      (await addMember(f.db, f.org.id, "member", "other")).id,
      f.org.id,
      p.job.id,
      remoteUrl,
    ),
  ).rejects.toThrow();
  for (const url of ["https://example.invalid/artifact/x", `${remoteUrl}?x=1`])
    await expect(recoverClaudeDesignJob(p.deps, f.owner.id, f.org.id, p.job.id, url)).rejects.toThrow();
  await recoverClaudeDesignJob(p.deps, f.owner.id, f.org.id, p.job.id, remoteUrl);
  expect(p.calls).toHaveLength(1);
  const req = p.calls[0];
  if (req?.op !== "task.start" || !req.claudeDesign) throw Error("Expected recovery task");
  expect(req.claudeDesign.mode).toBe("recover");
  expect(req.taskId).not.toBe(p.job.taskId);
  expect(req.account).toBe(f.accountId);
  await recordClaudeDesignResult(f.designDeps, req.taskId, { jobId: p.job.id, state: "failed", sourceFiles: [] });
  const [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.state).toBe("unknown");
  expect(j?.taskId).toBe(p.job.taskId);
});
test("purging a transient run does not remove the durable unknown lock", async () => {
  const p = await setup();
  await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  const [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.state).toBe("unknown");
});

test("pre-effect cancellation settles durably and a post-claim crash has a reconciliation job", async () => {
  const p = await setup();
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ state: "queued", result: null, cancelRequestedAt: null })
    .where(eq(schema.claudeDesignJobs.id, p.job.id));
  const { cancelClaudeDesignJob } = await import("../src/claude-design/service");
  const { claimClaudeDesignJob } = await import("../src/claude-design/ledger");
  expect((await cancelClaudeDesignJob(p.deps, f.owner.id, f.org.id, p.job.id)).state).toBe("canceled");
  expect(await claimClaudeDesignJob(f.designDeps, p.job.id)).toBe(false);
  const queued = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "claude_design.reconcile"));
  expect(queued).toHaveLength(1);
});
test("an expired claim with no authorized effect settles without replaying a start", async () => {
  const p = await setup();
  const { claimClaudeDesignJob } = await import("../src/claude-design/ledger");
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ state: "queued", result: null, createdAt: new Date(Date.now() - 1000 * 1000) })
    .where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(await claimClaudeDesignJob(f.designDeps, p.job.id)).toBe(true);
  const queued = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "claude_design.reconcile"));
  expect(queued).toHaveLength(1);
  expect((await reconcileClaudeDesignJob(p.deps, p.job.id)).state).toBe("failed");
  expect(p.calls.every((r) => r.op === "task.status")).toBe(true);
});
test("read-only recovery respects the same operator hold as other paid work", async () => {
  const p = await setup();
  await f.db.update(schema.agents).set({ operatorHoldAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
  await expect(recoverClaudeDesignJob(p.deps, f.owner.id, f.org.id, p.job.id, remoteUrl)).rejects.toThrow();
  expect(p.calls).toHaveLength(0);
  const [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.recoveryTaskId).toBeNull();
});

test("recovery cannot advance a known target version when the unknown job has no remote checkpoint", async () => {
  const p = await setup();
  await f.db
    .update(schema.claudeDesignArtifacts)
    .set({ remoteId: "synthetic", remoteUrl, remoteVersion: "known-v1", revision: 1 })
    .where(eq(schema.claudeDesignArtifacts.id, p.job.designId));
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ action: "update", expectedRevision: 1 })
    .where(eq(schema.claudeDesignJobs.id, p.job.id));
  await recoverClaudeDesignJob(p.deps, f.owner.id, f.org.id, p.job.id, remoteUrl);
  const request = p.calls[0];
  if (request?.op !== "task.start") throw Error("Expected recovery task");
  await expect(
    recordClaudeDesignResult(f.designDeps, request.taskId, {
      jobId: p.job.id,
      state: "published",
      sourceFiles: [],
      recoveryEvidence: "owner_association",
      remote: { id: "synthetic", url: remoteUrl, version: "changed-v2" },
    }),
  ).rejects.toThrow();
  const [design] = await f.db
    .select()
    .from(schema.claudeDesignArtifacts)
    .where(eq(schema.claudeDesignArtifacts.id, p.job.designId));
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(design?.remoteVersion).toBe("known-v1");
  expect(job?.state).toBe("unknown");
});
