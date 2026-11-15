import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type MachineRequest, parseClaudeDesignResult } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { getArtifact } from "../src/artifacts";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { storeClaudeDesignFiles } from "../src/claude-design/files";
import { recordClaudeDesignResult, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { getIssue } from "../src/issues";
import { receiveMachineUpload } from "../src/uploads";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";
import { addMember } from "./fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
const bytes = Buffer.from("<!doctype html><title>Test</title>");
const sha256 = createHash("sha256").update(bytes).digest("hex");
async function setup(publicationSequence = 2) {
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
  const result = {
    jobId: job.id,
    state: "published" as const,
    publicationSequence,
    remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "opaque1" },
    sourceFiles: [{ relativePath: "project/probe.dc.html", sha256, size: bytes.length, contentType: "text/html" }],
  };
  await recordClaudeDesignResult(f.designDeps, job.taskId, result);
  let pushes = 0,
    fail = false,
    wrongBytes = false;
  const deps = {
    ...f.designDeps,
    artifacts: f.artifactDeps,
    publicUrl: "https://example.invalid",
    hub: {
      status: async () => null,
      call: async (_machine: string, r: MachineRequest) => {
        expect(r.op).toBe("push");
        if (r.op !== "push" || !r.claudeDesignSource) throw new Error("Expected task-bound push");
        expect(r.claudeDesignSource.taskId).toBe(job.taskId);
        pushes++;
        if (fail) throw Error("storage offline");
        await receiveMachineUpload(
          { db: f.db, artifacts: f.artifactDeps, pubsub: f.pubsub },
          {
            uploadId: r.uploadId,
            machineId: f.machineId,
            name: "probe.dc.html",
            body: wrongBytes ? Buffer.from("wrong") : bytes,
            sha256,
            contentType: "text/html",
          },
        );
        return { sha256, size: bytes.length, name: "probe.dc.html", contentType: "text/html" } as never;
      },
    },
  };
  return {
    job,
    result,
    deps,
    pushes: () => pushes,
    setFail: (v: boolean) => {
      fail = v;
    },
    setWrong: () => {
      wrongBytes = true;
    },
  };
}
test("published sources import once into the original DM; retries never republish", async () => {
  const p = await setup();
  const a = await storeClaudeDesignFiles(p.deps, p.job.id, p.result);
  const b = await storeClaudeDesignFiles(p.deps, p.job.id, p.result);
  expect(b.artifactIds).toEqual(a.artifactIds);
  expect(a.artifactIds).toHaveLength(2);
  expect(p.pushes()).toBe(1);
  for (const id of a.artifactIds) {
    const detail = await getArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, id);
    expect(detail.threadId).toBeNull();
    await expect(
      getArtifact(
        f.artifactDeps,
        { type: "person", userId: (await addMember(f.db, f.org.id, "member", "other")).id },
        f.org.id,
        id,
      ),
    ).rejects.toThrow();
  }
  const [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.state).toBe("succeeded");
  expect(await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: p.job.issueId! })).toMatchObject({
    status: "done",
    blocked: null,
    work: null,
  });
});
test("storage failure preserves publication and retries only bytes; incorrect content never succeeds", async () => {
  const p = await setup();
  p.setFail(true);
  await expect(storeClaudeDesignFiles(p.deps, p.job.id, p.result)).rejects.toThrow();
  let [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.state).toBe("published");
  expect(parseClaudeDesignResult(j?.result)?.error?.code).toBe("sources_incomplete");
  p.setFail(false);
  p.setWrong();
  await expect(storeClaudeDesignFiles(p.deps, p.job.id, p.result)).rejects.toThrow();
  [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(j?.state).toBe("published");
});
test("an empty shell cannot finish importing or release its lock", async () => {
  const p = await setup();
  const empty = { ...p.result, sourceFiles: [] };
  await recordClaudeDesignResult(f.designDeps, p.job.taskId, empty);
  await expect(storeClaudeDesignFiles(p.deps, p.job.id, empty)).rejects.toThrow();
  expect(p.pushes()).toBe(0);
});

test("a delayed shell cannot replace a later confirmed version with missing sources", async () => {
  const p = await setup();
  await f.db
    .update(schema.claudeDesignJobs)
    .set({ result: null, sourceTaskId: null })
    .where(eq(schema.claudeDesignJobs.id, p.job.id));
  const shell = { ...p.result, publicationSequence: 1, sourceFiles: [], remote: { ...p.result.remote, version: "v1" } };
  const publication = {
    ...shell,
    publicationSequence: 2,
    remote: { ...shell.remote, version: "v2" },
    error: { code: "sources_incomplete" as const, message: "Sources missing after publication" },
  };
  await recordClaudeDesignResult(f.designDeps, p.job.taskId, shell);
  await recordClaudeDesignResult(f.designDeps, p.job.taskId, publication);
  await recordClaudeDesignResult(f.designDeps, p.job.taskId, shell);
  const [j] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(parseClaudeDesignResult(j?.result)?.remote?.version).toBe("v2");
  expect(parseClaudeDesignResult(j?.result)?.error?.code).toBe("sources_incomplete");
});

test("unknown-result notices contain localized words instead of an untranslated key", async () => {
  const p = await setup();
  const { claudeDesignNotice } = await import("../src/claude-design/notice");
  const { designJobView } = await import("../src/claude-design/ledger");
  const [task] = await f.db
    .insert(schema.machineTasks)
    .values({
      id: p.job.taskId,
      orgId: f.org.id,
      agentId: f.agent.id,
      machineId: f.machineId,
      channelId: p.job.channelId,
      threadRootId: p.job.threadRootId,
      title: p.job.title,
      executor: "claude",
      status: "interrupted",
      endedAt: new Date(),
    })
    .returning();
  if (!task) throw Error("task");
  const view = { ...(await designJobView(f.db, p.job)), state: "unknown" as const };
  expect(claudeDesignNotice(view)(task, null, "en").body).toContain("is unknown");
  expect(claudeDesignNotice(view)(task, null, "pt-BR").body).toContain("incerto");
});

test("preview files identify the job's verified source uploads and reject a substituted task path", async () => {
  const p = await setup();
  const imported = await storeClaudeDesignFiles(p.deps, p.job.id, p.result);
  const { designJobView } = await import("../src/claude-design/ledger");
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  if (!job) throw Error("No completed job");
  const view = await designJobView(f.db, job);
  expect(view).toMatchObject({
    title: "Test",
    preview: {
      version: "opaque1",
      files: [
        {
          artifactId: imported.artifactIds[1],
          version: 1,
          relativePath: "project/probe.dc.html",
          sha256,
          size: bytes.length,
          contentType: "text/html; charset=utf-8",
        },
      ],
    },
  });
  const entry = Object.values(job.fileImports)[0];
  if (!entry) throw Error("No import");
  await f.db
    .update(schema.artifactUploads)
    .set({ path: "designs/other/work/project/probe.dc.html" })
    .where(eq(schema.artifactUploads.id, entry.uploadId));
  expect((await designJobView(f.db, job)) as unknown).not.toHaveProperty("preview");
});

test("a shell with a premature manifest cannot finalize imports or release the update lock", async () => {
  const p = await setup(1);
  await expect(storeClaudeDesignFiles(p.deps, p.job.id, p.result)).rejects.toThrow("Published sources are incomplete");
  expect(p.pushes()).toBe(0);
  const [saved] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, p.job.id));
  expect(saved?.state).toBe("published");
  await expect(
    reserveClaudeDesignJob(
      f.designDeps,
      { ...f.ctx, toolUseId: "after-shell" },
      {
        action: "update",
        designId: p.job.designId,
        expectedRevision: 1,
        brief: "Blocked",
        sourceArtifactIds: [],
      },
    ),
  ).rejects.toThrow();
});
