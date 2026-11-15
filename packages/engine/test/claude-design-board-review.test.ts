import { afterEach, expect, test } from "bun:test";
import { eq, schema, sql } from "@agenteschat/db";
import { requireChannelAccess } from "../src/channels";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { publishClaudeDesignIssue } from "../src/claude-design/board";
import { claimClaudeDesignJob, reserveClaudeDesignJob } from "../src/claude-design/ledger";
import { getIssue, listIssueActivity, listIssues, setIssueAudience } from "../src/issues";
import { transitionRun } from "../src/runs";
import { indexSource, searchForUser } from "../src/search";
import { taskSeenSql } from "../src/task-access";
import { ensureTaskConversation } from "../src/task-conversation";
import { endWork, moveToBackground } from "../src/works";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";
import { addMember } from "./fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function setup() {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
}
const input = {
  action: "create" as const,
  title: "Private Design title",
  brief: "Private Design brief",
  sourceArtifactIds: [],
};
test("native tracking preserves owner-only reads, activity, search scopes, conversation access and event delivery", async () => {
  await setup();
  const admin = await addMember(f.db, f.org.id, "admin", "other");
  const view = await reserveClaudeDesignJob(f.designDeps, f.ctx, input);
  const id = view.issue!.id;
  await expect(getIssue(f.db, { type: "person", userId: admin.id }, f.org.id, { id })).rejects.toThrow();
  await expect(listIssueActivity(f.db, { type: "person", userId: admin.id }, f.org.id, id)).rejects.toThrow();
  expect((await listIssues(f.db, { type: "person", userId: admin.id }, f.org.id, {})).some((i) => i.id === id)).toBe(
    false,
  );
  expect(
    await f.db
      .select({ id: schema.issues.id })
      .from(schema.issues)
      .where(taskSeenSql("issues", sql`${admin.id}::text`)),
  ).toHaveLength(0);
  const conversation = await ensureTaskConversation(f.db, id);
  await expect(requireChannelAccess(f.db, admin.id, f.org.id, conversation.channelId)).rejects.toThrow();
  await requireChannelAccess(f.db, f.owner.id, f.org.id, conversation.channelId);
  const topics: string[] = [];
  await publishClaudeDesignIssue(
    {
      ...f.designDeps,
      pubsub: {
        publish: async (topic: string) => {
          topics.push(topic);
        },
      } as never,
    },
    view.id,
  );
  expect(topics.length).toBeGreaterThan(0);
  expect(topics.every((t) => t.includes(f.owner.id) && !t.includes(admin.id))).toBe(true);
  await indexSource(f.context, { orgId: f.org.id, kind: "issue", sourceId: id });
  expect(
    (await searchForUser(f.context, admin.id, f.org.id, { text: "Private Design", kinds: ["issue"] })).some(
      (h) => h.sourceId === id,
    ),
  ).toBe(false);
  expect(
    (await searchForUser(f.context, f.owner.id, f.org.id, { text: "Private Design", kinds: ["issue"] })).some(
      (h) => h.sourceId === id,
    ),
  ).toBe(true);
  await expect(
    setIssueAudience({ db: f.db }, { type: "person", userId: f.owner.id }, f.org.id, id, { mode: "everyone" }),
  ).rejects.toThrow();
  const own = await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id });
  expect(own.source).toMatchObject({ type: "message", channelId: f.ctx.channelId, messageId: f.ctx.triggerMessageId });
});
test("ending generic background work cannot complete the separate native Design card", async () => {
  await setup();
  await transitionRun(f.db, f.ctx.runId, "queued", "running");
  const moved = await moveToBackground({ db: f.db }, f.ctx.runId, { how: "auto", title: "Design request", card: true });
  if (!moved) throw Error("No background work");
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  if (!run) throw Error("No run");
  const view = await reserveClaudeDesignJob(f.designDeps, { ...f.ctx, threadRootId: run.threadRootId }, input);
  expect(view.issue?.id).not.toBe(moved.work.issueId ?? run.issueId);
  await claimClaudeDesignJob(f.designDeps, view.id);
  const ended = await transitionRun(f.db, f.ctx.runId, "running", "done");
  if (!ended) throw Error("No ended run");
  await endWork({ db: f.db }, ended, "done");
  expect(await getIssue(f.db, { type: "person", userId: f.owner.id }, f.org.id, { id: view.issue!.id })).toMatchObject({
    status: "in_progress",
    work: { state: "running" },
  });
});
