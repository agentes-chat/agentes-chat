import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { syncClaudeDesignIssue } from "../src/claude-design/board";
import {
  claimClaudeDesignJob,
  designJobView,
  recordClaudeDesignResult,
  reserveClaudeDesignJob,
} from "../src/claude-design/ledger";
import { createIssue, getIssue } from "../src/issues";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
const input = { action: "create" as const, title: "Synthetic Design", brief: "Synthetic", sourceArtifactIds: [] };
async function setup(existing?: "private" | "workspace") {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  if (existing) {
    const issue = await createIssue({ db: f.db }, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "Existing request",
      ...(existing === "private"
        ? {
            source: {
              type: "message" as const,
              channelId: f.ctx.channelId,
              messageId: f.ctx.triggerMessageId,
              designOwnerUserId: f.owner.id,
            },
          }
        : {}),
      assignee: { type: "agent", id: f.agent.id },
      channelId: f.ctx.channelId,
      ...(existing === "workspace" ? { audience: { mode: "everyone" as const } } : {}),
    });
    await f.db.update(schema.agentRuns).set({ issueId: issue.id }).where(eq(schema.agentRuns.id, f.ctx.runId));
  }
  return reserveClaudeDesignJob(f.designDeps, f.ctx, input);
}
test("Design reserves one private board card without dispatching another run", async () => {
  const view = await setup();
  expect(view.issue?.number).toBeGreaterThan(0);
  expect(view.progress?.stage).toBe("queued");
  expect(
    (await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: view.issue!.id })).work,
  ).toBeNull();
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  expect(job?.issueId).toBe(view.issue?.id);
  const [issue] = await f.db.select().from(schema.issues).where(eq(schema.issues.id, view.issue!.id));
  expect(issue).toMatchObject({ assigneeType: "agent", assigneeId: f.agent.id, status: "todo" });
  expect(
    issue?.channelId === f.ctx.channelId || (issue?.restricted && issue.audienceUserIds.join() === f.owner.id),
  ).toBe(true);
  const repeated = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  expect(repeated.issue).toEqual(view.issue);
  expect(await f.db.select().from(schema.issues)).toHaveLength(1);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(1);
  expect(await f.db.select().from(schema.machineTasks)).toHaveLength(0);
});
test("native work stays active after the agent turn ends, and shell failure is blocked instead of done", async () => {
  const view = await setup();
  await claimClaudeDesignJob(f.designDeps, view.id);
  await f.db
    .update(schema.agentRuns)
    .set({ status: "done", finishedAt: new Date() })
    .where(eq(schema.agentRuns.id, f.ctx.runId));
  let issue = await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: view.issue!.id });
  expect(issue).toMatchObject({ status: "in_progress", work: { state: "running" } });
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  if (!job) throw Error("No job");
  const remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "shell" };
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "published",
    publicationSequence: 1,
    remote,
    sourceFiles: [],
  });
  issue = await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: view.issue!.id });
  expect(issue.status).toBe("in_progress");
  expect(
    (
      await designJobView(
        f.db,
        (
          await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id))
        )[0]!,
      )
    ).progress?.stage,
  ).toBe("working");
  await recordClaudeDesignResult(f.designDeps, job.taskId, {
    jobId: job.id,
    state: "unknown",
    remote,
    sourceFiles: [],
    error: { code: "guard_failed", message: "Synthetic interruption" },
  });
  issue = await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: view.issue!.id });
  expect(issue).toMatchObject({ status: "in_progress", blocked: { reason: "failed" }, work: { state: "stalled" } });
  await expect(
    reserveClaudeDesignJob(
      f.designDeps,
      { ...f.ctx, toolUseId: "another" },
      { ...input, action: "update", designId: job.designId, expectedRevision: 1 },
    ),
  ).rejects.toThrow();
});

test.each(["deleted", "reassigned", "foreign", "widened"])(
  "Design does not recreate or take over a %s card",
  async (mode) => {
    const view = await setup();
    const id = view.issue!.id;
    if (mode === "deleted") await f.db.delete(schema.issues).where(eq(schema.issues.id, id));
    if (mode === "reassigned")
      await f.db.update(schema.issues).set({ assigneeId: null, assigneeType: null }).where(eq(schema.issues.id, id));
    if (mode === "foreign")
      await f.db
        .update(schema.claudeDesignJobs)
        .set({ issueId: crypto.randomUUID() })
        .where(eq(schema.claudeDesignJobs.id, view.id));
    if (mode === "widened")
      await f.db
        .update(schema.issues)
        .set({ channelId: null, restricted: false, audienceUserIds: [] })
        .where(eq(schema.issues.id, id));
    await claimClaudeDesignJob(f.designDeps, view.id);
    await syncClaudeDesignIssue(f.designDeps, view.id, { create: true });
    const rows = await f.db.select().from(schema.issues);
    expect(rows).toHaveLength(mode === "deleted" ? 0 : 1);
    if (rows[0]) expect(rows[0].status).toBe("todo");
  },
);
test("repeated callbacks and retained jobs keep one card and one activity per actual transition", async () => {
  const view = await setup();
  await claimClaudeDesignJob(f.designDeps, view.id);
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  if (!job) throw Error("No job");
  await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  const result = {
    jobId: job.id,
    state: "published" as const,
    publicationSequence: 1,
    remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "shell" },
    sourceFiles: [],
  };
  await Promise.all([
    recordClaudeDesignResult(f.designDeps, job.taskId, result),
    recordClaudeDesignResult(f.designDeps, job.taskId, result),
  ]);
  await syncClaudeDesignIssue(f.designDeps, job.id, { create: true });
  expect(await f.db.select().from(schema.issues)).toHaveLength(1);
  const events = await f.db
    .select()
    .from(schema.issueActivity)
    .where(eq(schema.issueActivity.event, "claude_design_progress"));
  expect(events.map((e) => e.data.stage)).toEqual(["queued", "working"]);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
});

test.each(["private", "workspace"] as const)("only a compatible %s request card can be reused", async (scope) => {
  const view = await setup(scope);
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  expect(view.issue?.id === run?.issueId).toBe(scope === "private");
  expect(await f.db.select().from(schema.issues)).toHaveLength(scope === "private" ? 1 : 2);
});
