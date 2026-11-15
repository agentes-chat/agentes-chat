import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { systemText } from "@agenteschat/providers";
import { designWorkBrief } from "../src/claude-design/brief";
import { decideClaudeDesignConsent, pollClaudeDesignConsent } from "../src/claude-design/consent";
import { buildRunContext, taskNotice } from "../src/context";
import { type DesignFixture } from "./claude-design-fixtures";
import { nativeDesignReadFixture } from "./claude-design-native-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function setup(status: "pending" | "consumed" | "expired") {
  const fixture = await nativeDesignReadFixture();
  f = fixture.f;
  const job = fixture.job;
  await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, fixture.request);
  if (status === "consumed") {
    await decideClaudeDesignConsent(f.designDeps, f.owner.id, f.org.id, fixture.request.requestId, {
      decision: "approve",
      reviewed: true,
    });
    await pollClaudeDesignConsent(f.designDeps, f.org.id, f.machineId, fixture.request);
  }
  if (status === "expired")
    await f.db
      .update(schema.claudeDesignConsents)
      .set({ status: "expired", expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.claudeDesignConsents.id, fixture.request.requestId));
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, f.ctx.runId));
  if (!run) throw Error("No run");
  return { job, run };
}
test.each(["pending", "consumed", "expired"] as const)(
  "real context uses current %s Design consent instead of a historical request",
  async (status) => {
    const { run } = await setup(status);
    const context = await buildRunContext(f.db, run, f.agent, { maxMessages: 30 });
    const text = systemText(context.system);
    expect(text).toContain("# Current Claude Design work");
    expect(text).toContain(
      `"stage":"${status === "pending" ? "waiting_approval" : status === "consumed" ? "working" : "unknown"}"`,
    );
    expect(text).toContain("Do not create another board task");
    if (status !== "pending") expect(text).toContain('"pendingConsentId":null');
    const historical = taskNotice({
      body: "An old request",
      meta: {
        notice: {
          kind: "design_consent",
          text: "Claude requires the account owner to review one native Artifact read. The agent cannot decide this request.",
        },
      },
    });
    expect(historical).toContain("historical");
    expect(historical).not.toContain("Claude requires the account owner to review");
  },
);

test("revoked Design access is not presented as an actionable pending approval", async () => {
  const { job, run } = await setup("pending");
  await f.db
    .update(schema.claudeDesignGrants)
    .set({ enabled: false })
    .where(eq(schema.claudeDesignGrants.id, job.grantId));
  const text = await designWorkBrief(f.db, run);
  expect(text).toContain('"stage":"unknown"');
  expect(text).toContain('"pendingConsentId":null');
});
test("current Design status stays in its original reply scope and survives run retention", async () => {
  const { job, run } = await setup("consumed");
  const [reply] = await f.db
    .insert(schema.messages)
    .values({
      orgId: job.orgId,
      channelId: job.channelId,
      threadId: job.threadRootId,
      authorType: "person",
      authorUserId: job.ownerUserId,
      body: "Another thread",
    })
    .returning();
  if (!reply) throw Error("No reply");
  expect(await designWorkBrief(f.db, { ...run, triggerMessageId: reply.id })).toBeNull();
  expect(await designWorkBrief(f.db, { ...run, agentId: crypto.randomUUID() })).toBeNull();
  expect(await designWorkBrief(f.db, { ...run, channelId: crypto.randomUUID() })).toBeNull();
  expect(await designWorkBrief(f.db, { ...run, orgId: crypto.randomUUID() })).toBeNull();
  await f.db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  expect(await designWorkBrief(f.db, run)).toContain('"stage":"working"');
  await f.db
    .update(schema.machineTasks)
    .set({ status: "failed", endedAt: new Date() })
    .where(eq(schema.machineTasks.id, job.taskId));
  expect(await designWorkBrief(f.db, run)).toContain('"stage":"unknown"');
});
