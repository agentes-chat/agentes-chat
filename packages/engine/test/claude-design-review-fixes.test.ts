import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type MachineRequest, parseClaudeDesignResult } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { createArtifact, updateArtifact } from "../src/artifacts";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { recordClaudeDesignResult, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { acceptClaudeDesignTaskResult, authorizeClaudeDesignEffect } from "../src/claude-design/lifecycle";
import {
  checkClaudeDesignInput,
  reconcileClaudeDesignJob,
  recoverClaudeDesignJob,
  startClaudeDesignTask,
} from "../src/claude-design/service";
import { createClaudeDesignToolSource } from "../src/claude-design/tools";
import { applyTaskDone } from "../src/machine-tasks";
import { createToolGateway } from "../src/tools/gateway";
import { receiveMachineUpload } from "../src/uploads";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function setup() {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const calls: MachineRequest[] = [];
  const deps = {
    ...f.designDeps,
    artifacts: f.artifactDeps,
    publicUrl: "https://example.invalid",
    hub: {
      status: async () => ({ online: true, execAllowed: true }) as never,
      call: async (_machine: string, request: MachineRequest) => {
        calls.push(request);
        return {
          taskId: request.op === "task.start" ? request.taskId : "unused",
          startedAt: new Date().toISOString(),
        } as never;
      },
    },
  };
  return { deps, calls };
}
async function source() {
  const actor = {
    type: "agent" as const,
    agentId: f.agent.id,
    channelId: f.ctx.channelId,
    threadId: f.ctx.threadRootId,
  };
  const artifact = await createArtifact(f.artifactDeps, actor, f.org.id, {
    title: "Approved source",
    content: { kind: "document", markdown: "Version one" },
  });
  return {
    artifact,
    change: () =>
      updateArtifact(f.artifactDeps, actor, f.org.id, artifact.id, {
        baseVersion: 1,
        content: { kind: "document", markdown: "Replacement version two" },
      }),
  };
}

test("retained recovery accounts usage and imports sources after the original run is purged", async () => {
  const p = await setup();
  const view = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Retained",
    brief: "Retained",
    sourceArtifactIds: [],
  });
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  if (!job) throw Error("No job");
  await recordClaudeDesignResult(f.designDeps, job.taskId, { jobId: job.id, state: "unknown", sourceFiles: [] });
  await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  const remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "v1" };
  await recoverClaudeDesignJob(p.deps, f.owner.id, f.org.id, job.id, remote.url);
  const start = p.calls.find((r) => r.op === "task.start");
  if (start?.op !== "task.start") throw Error("No recovery task");
  expect(
    (
      await authorizeClaudeDesignEffect(f.designDeps, f.org.id, f.machineId, {
        type: "design.authorize",
        requestId: crypto.randomUUID(),
        taskId: start.taskId!,
        jobId: job.id,
        grantRevision: job.grantRevision,
        sequence: 1,
        effect: "read_target",
        remoteId: remote.id,
      })
    ).allow,
  ).toBe(true);
  const bytes = Buffer.from("<title>Recovered</title>"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = {
    jobId: job.id,
    state: "published" as const,
    remote,
    recoveryEvidence: "owner_association" as const,
    sourceFiles: [{ relativePath: "project/sample.dc.html", sha256, size: bytes.length, contentType: "text/html" }],
    usage: { model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
  for (let i = 0; i < 2; i++) {
    await acceptClaudeDesignTaskResult(f.designDeps, f.org.id, f.machineId, start.taskId!, result);
    await applyTaskDone({ db: f.db, pubsub: f.pubsub }, f.machineId, {
      type: "task.done",
      taskId: start.taskId!,
      exitCode: 0,
      seconds: 1,
      claudeDesign: result,
    });
  }
  const usages = await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.id, start.taskId!));
  expect(usages).toHaveLength(1);
  expect(usages[0]?.runId).toBeNull();
  expect(usages[0]?.brainAccountId).toBe(f.accountId);
  const [task] = await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, start.taskId!));
  expect(task?.endedAt).not.toBeNull();
  const [checkpoint] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  expect(parseClaudeDesignResult(checkpoint?.result)?.publicationSequence).toBe(1);
  const imported = await reconcileClaudeDesignJob(
    {
      ...p.deps,
      hub: {
        ...p.deps.hub,
        call: async (_machine: string, request: MachineRequest) => {
          if (request.op === "task.status") return { tasks: [] } as never;
          if (request.op !== "push" || request.claudeDesignSource?.taskId !== start.taskId)
            throw Error("Unbound source transfer");
          await receiveMachineUpload(
            { db: f.db, artifacts: f.artifactDeps, pubsub: f.pubsub },
            {
              uploadId: request.uploadId,
              machineId: f.machineId,
              name: "sample.dc.html",
              body: bytes,
              sha256,
              contentType: "text/html",
            },
          );
          return { name: "sample.dc.html", size: bytes.length, sha256, contentType: "text/html" } as never;
        },
      },
    },
    job.id,
  );
  expect(imported).toMatchObject({ state: "succeeded", remote });
  expect(imported.artifactIds).toHaveLength(2);
  expect(p.calls.filter((r) => r.op === "task.start")).toHaveLength(1);
});

test("an approved source cannot be replaced before executing the approved tool", async () => {
  const p = await setup(),
    s = await source();
  await f.db.update(schema.agents).set({ approvalsLevel: "always" }).where(eq(schema.agents.id, f.agent.id));
  const gateway = createToolGateway({ sources: [createClaudeDesignToolSource(p.deps)] });
  const outcome = await gateway.invoke(f.ctx, {
    toolUseId: "source-approval",
    name: "create_claude_design",
    input: {
      title: "Source test",
      brief: "Use the supplied source",
      source_artifact_ids: [s.artifact.id],
      why: "The owner requested this private design in this conversation.",
    },
  });
  if (outcome.type !== "approval") throw Error(JSON.stringify(outcome));
  await f.db.update(schema.approvals).set({ status: "approved" }).where(eq(schema.approvals.id, outcome.approval.id));
  await s.change();
  const output = await gateway.executeApproved(f.ctx, { ...outcome.approval, status: "approved" });
  expect(output.isError).toBe(true);
  expect(p.calls.filter((r) => r.op === "task.start")).toHaveLength(0);
});

test("a source changed after reservation is rejected before task dispatch", async () => {
  const p = await setup(),
    s = await source();
  const input = {
    action: "create" as const,
    title: "Pinned",
    brief: "Use the source",
    sourceArtifactIds: [s.artifact.id],
  };
  const authority = await checkClaudeDesignInput(p.deps, f.ctx, input);
  const view = await reserveClaudeDesignJob(p.deps, f.ctx, input, authority.sourceManifest);
  await s.change();
  await startClaudeDesignTask(p.deps, authority, view.id);
  expect(p.calls.filter((r) => r.op === "task.start")).toHaveLength(0);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  expect(job?.state).toBe("failed");
});

test("dispatch retains approved source bytes when a new version lands after the copy", async () => {
  const p = await setup(),
    s = await source();
  const input = {
    action: "create" as const,
    title: "Pinned",
    brief: "Use the source",
    sourceArtifactIds: [s.artifact.id],
  };
  const authority = await checkClaudeDesignInput(p.deps, f.ctx, input);
  const view = await reserveClaudeDesignJob(p.deps, f.ctx, input, authority.sourceManifest);
  const call = p.deps.hub.call;
  const deps = {
    ...p.deps,
    hub: {
      ...p.deps.hub,
      call: async (machine: string, request: MachineRequest) => {
        if (request.op === "write") await s.change();
        return call(machine, request);
      },
    },
  };
  await startClaudeDesignTask(deps, authority, view.id);
  const start = p.calls.find((r) => r.op === "task.start");
  if (start?.op !== "task.start" || start.claudeDesign?.mode !== "execute") throw Error("No dedicated source task");
  expect(start.claudeDesign.sources[0]?.sha256).toBe(authority.sourceManifest[0]?.sha256);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  expect(job?.sourceManifest?.[0]?.version).toBe(1);
  const versions = await f.db
    .select()
    .from(schema.artifactVersions)
    .where(eq(schema.artifactVersions.artifactId, s.artifact.id));
  expect(versions).toHaveLength(2);
  expect(versions.find((v) => v.version === 2)?.sha256).not.toBe(start.claudeDesign.sources[0]?.sha256);
});

test("legacy jobs without a source manifest cannot select current attachment bytes", async () => {
  const p = await setup(),
    s = await source();
  const input = { action: "create" as const, title: "Legacy", brief: "Use a source", sourceArtifactIds: [] };
  const view = await reserveClaudeDesignJob(p.deps, f.ctx, input);
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ sourceArtifactIds: [s.artifact.id], sourceManifest: null })
    .where(eq(schema.claudeDesignJobs.id, view.id));
  const authority = await checkClaudeDesignInput(p.deps, f.ctx, { ...input, sourceArtifactIds: [s.artifact.id] });
  await startClaudeDesignTask(p.deps, authority, view.id);
  expect(p.calls.filter((r) => r.op === "task.start")).toHaveLength(0);
});
