import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { authorizeClaudeDesign, setClaudeDesignGrant } from "../src/claude-design/access";
import { designJobView, recordClaudeDesignResult, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { claudeDesignNotice } from "../src/claude-design/notice";
import { startClaudeDesignTask } from "../src/claude-design/service";
import { taskNotice } from "../src/context";
import { taskEndNotice, wakeConversationForTask } from "../src/machine-tasks";
import { replyPolicyFor } from "../src/reply-policy";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
const remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "shell" };
async function setup(inThread = false) {
  f = await designFixture();
  if (inThread) {
    const [parent] = await f.db
      .insert(schema.messages)
      .values({
        orgId: f.org.id,
        channelId: f.ctx.channelId,
        authorType: "person",
        authorUserId: f.owner.id,
        body: "Thread parent",
      })
      .returning();
    if (!parent) throw Error("No parent");
    await f.db
      .update(schema.messages)
      .set({ threadId: parent.id })
      .where(eq(schema.messages.id, f.ctx.triggerMessageId));
    await f.db.update(schema.agentRuns).set({ threadRootId: parent.id }).where(eq(schema.agentRuns.id, f.ctx.runId));
    f.ctx.threadRootId = parent.id;
  }
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const v = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Test",
    brief: "Test",
    sourceArtifactIds: [],
  });
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, v.id));
  if (!job) throw Error("No job");
  return job;
}
test("empty shell stays internally checkpointed and locked, without a public publication or link", async () => {
  const job = await setup();
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "published",
    publicationSequence: 1,
    remote,
    sourceFiles: [],
  });
  const [saved] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!saved) throw Error("No checkpoint");
  expect(saved.state).toBe("published");
  expect(saved.result?.remote).toEqual(remote);
  expect(await designJobView(f.db, saved)).toMatchObject({ state: "running", remote: null, artifactIds: [] });
  await expect(
    reserveClaudeDesignJob(
      f.designDeps,
      { ...f.ctx, toolUseId: "another-create" },
      { action: "update", designId: job.designId, expectedRevision: 1, brief: "Another", sourceArtifactIds: [] },
    ),
  ).rejects.toThrow();
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "unknown",
    publicationSequence: 1,
    remote,
    sourceFiles: [],
    error: { code: "guard_failed", message: "Stopped with an empty shell" },
  });
  const [stopped] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!stopped) throw Error("No stopped job");
  expect(await designJobView(f.db, stopped)).toMatchObject({ state: "unknown", remote: null });
});
test("confirmed content exposes only this job's remote, not a later mutable design checkpoint", async () => {
  const job = await setup();
  const published = { ...remote, version: "content" };
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "published",
    publicationSequence: 2,
    remote: published,
    sourceFiles: [
      { relativePath: "project/sample.dc.html", size: 10, sha256: "a".repeat(64), contentType: "text/html" },
    ],
  });
  const [saved] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!saved) throw Error("No content");
  await f.db
    .update(schema.claudeDesignArtifacts)
    .set({ remoteVersion: "later", artifactIds: [crypto.randomUUID()] })
    .where(eq(schema.claudeDesignArtifacts.id, job.designId));
  expect(await designJobView(f.db, saved)).toMatchObject({ state: "published", remote: published, artifactIds: [] });
});
test("a create-shell checkpoint cannot advertise content even if a premature manifest is present", async () => {
  const job = await setup();
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "published",
    publicationSequence: 1,
    remote,
    sourceFiles: [
      { relativePath: "project/sample.dc.html", size: 10, sha256: "a".repeat(64), contentType: "text/html" },
    ],
  });
  const [saved] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!saved) throw Error("No shell");
  expect(await designJobView(f.db, saved)).toMatchObject({ state: "running", remote: null });
});
test("delivery preserves root vs existing thread through the durable trigger after run retention", async () => {
  const job = await setup();
  const { designReplyThreadId } = await import("../src/claude-design/ledger");
  expect(await designReplyThreadId(f.db, job)).toBeNull();
  const [reply] = await f.db
    .insert(schema.messages)
    .values({
      orgId: f.org.id,
      channelId: job.channelId,
      threadId: job.threadRootId,
      authorType: "person",
      authorUserId: f.owner.id,
      body: "A design in this thread",
    })
    .returning();
  if (!reply) throw Error("No reply");
  expect(await designReplyThreadId(f.db, { ...job, triggerMessageId: reply.id })).toBe(job.threadRootId);
  await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, job.runId));
  expect(await designReplyThreadId(f.db, job)).toBeNull();
  expect(await designReplyThreadId(f.db, { ...job, triggerMessageId: crypto.randomUUID() })).toBe(job.threadRootId);
  expect(await designReplyThreadId(f.db, { ...job, channelId: crypto.randomUUID() })).toBe(job.threadRootId);
});

test.each([false, true])(
  "Design dispatch and once-only completion preserve original placement (thread=%s)",
  async (inThread) => {
    const job = await setup(inThread);
    const authority = await authorizeClaudeDesign(f.designDeps, f.ctx, "create");
    await startClaudeDesignTask(
      {
        ...f.designDeps,
        artifacts: f.artifactDeps,
        publicUrl: "https://example.invalid",
        hub: {
          status: async () => ({ online: true, execAllowed: true }) as never,
          call: async () => ({ taskId: job.taskId, startedAt: new Date().toISOString() }) as never,
        },
      },
      authority,
      job.id,
    );
    const [task] = await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, job.taskId));
    expect(task?.threadRootId).toBe(inThread ? job.threadRootId : null);
    await f.db
      .update(schema.machineTasks)
      .set({ status: "done", endedAt: new Date() })
      .where(eq(schema.machineTasks.id, job.taskId));
    const view = await designJobView(f.db, job);
    const delivered = await wakeConversationForTask({ db: f.db }, job.taskId, {
      maxHops: 100,
      notice: claudeDesignNotice(view),
    });
    if (!delivered?.message) throw Error("No delivered notice");
    expect(delivered.message.channelId).toBe(job.channelId);
    expect(delivered.message.threadId).toBe(inThread ? job.threadRootId : null);
    expect(
      await wakeConversationForTask({ db: f.db }, job.taskId, { maxHops: 100, notice: claudeDesignNotice(view) }),
    ).toBeNull();
  },
);

test.each(["unknown", "succeeded"] as const)(
  "persisted Design %s completion uses guarded context and may avoid a duplicate announcement",
  async (state) => {
    const job = await setup();
    const [task] = await f.db
      .insert(schema.machineTasks)
      .values({
        id: job.taskId,
        orgId: job.orgId,
        agentId: job.agentId,
        machineId: job.machineId,
        channelId: job.channelId,
        threadRootId: null,
        runId: job.runId,
        requestedByUserId: job.ownerUserId,
        title: job.title,
        executor: "claude",
        status: "done",
        endedAt: new Date(),
        result: "Claude Design: published",
        lastLine: "raw publication checkpoint",
      })
      .returning();
    if (!task) throw Error("No task");
    const view = { ...(await designJobView(f.db, job)), state, remote: state === "succeeded" ? remote : null };
    const delivered = await wakeConversationForTask({ db: f.db }, job.taskId, {
      maxHops: 100,
      notice: claudeDesignNotice(view),
    });
    if (!delivered?.message) throw Error("No completion");
    const context = taskNotice(delivered.message, true);
    expect(context).toContain(`"state":"${state}"`);
    expect(context).toContain("Do not repeat");
    expect(context).toContain("substantive requested analysis");
    expect(context).not.toContain("Claude Design: published");
    expect(context).not.toContain("raw publication checkpoint");
    expect(context).not.toContain("Tell the people what came of it now");
    if (state === "unknown") expect(context).not.toContain(remote.url);
    else expect(context).toContain(remote.url);
    const run = { agentId: job.agentId, trigger: "mention" as const, background: false, hop: 1 };
    expect(replyPolicyFor(run, delivered.message).mayPass).toBe(true);
    expect(replyPolicyFor(run, delivered.message, { answerOwed: true }).mayPass).toBe(false);
    const generic = { ...delivered.message, ...taskEndNotice(task, null) };
    expect(taskNotice(generic, true)).toContain("Tell the people what came of it now");
    expect(replyPolicyFor(run, generic).mayPass).toBe(false);
  },
);
