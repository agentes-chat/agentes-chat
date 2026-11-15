import { parseClaudeDesignResult } from "@agenteschat/adapters";
import { and, desc, type Executor, eq, inArray, schema } from "@agenteschat/db";
import { untrustedBlock } from "../untrusted";
import { designProgressOf } from "./progress";
import { hasConfirmedDesignContent } from "./publication";

/** Current status only in the original reply location; never equate historical consent text with a live ask. */
export async function designWorkBrief(
  db: Executor,
  run: { orgId: string; agentId: string; channelId: string; triggerMessageId: string },
): Promise<string | null> {
  const [trigger] = await db
    .select({ threadId: schema.messages.threadId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.orgId, run.orgId),
        eq(schema.messages.channelId, run.channelId),
        eq(schema.messages.id, run.triggerMessageId),
      ),
    );
  if (!trigger) return null;
  const candidates = await db
    .select()
    .from(schema.claudeDesignJobs)
    .where(
      and(
        eq(schema.claudeDesignJobs.orgId, run.orgId),
        eq(schema.claudeDesignJobs.agentId, run.agentId),
        eq(schema.claudeDesignJobs.channelId, run.channelId),
      ),
    )
    .orderBy(desc(schema.claudeDesignJobs.createdAt))
    .limit(20);
  if (!candidates.length) return null;
  const origins = await db
    .select({ id: schema.messages.id, threadId: schema.messages.threadId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.orgId, run.orgId),
        eq(schema.messages.channelId, run.channelId),
        inArray(
          schema.messages.id,
          candidates.map((j) => j.triggerMessageId),
        ),
      ),
    );
  const jobs = candidates
    .filter((job) => {
      const original = origins.find((m) => m.id === job.triggerMessageId);
      return (original ? original.threadId : job.threadRootId) === trigger.threadId;
    })
    .slice(0, 5);
  if (!jobs.length) return null;
  const progress = await designProgressOf(db, jobs);
  const snapshots = jobs.map((job) => {
    const result = parseClaudeDesignResult(job.result);
    return {
      jobId: job.id,
      title: job.title,
      ...progress.get(job.id),
      remote: hasConfirmedDesignContent(job, result) ? (result?.remote ?? null) : null,
    };
  });
  return `# Current Claude Design work\nThese are the current native jobs in this conversation, refreshed this turn. This status overrides old approval notices and earlier claims of progress. Ask the owner to review only when pendingConsentId is present. Approved, consumed, closed or expired requests are not pending. Do not create another board task, start a second design, or schedule polling: tracking and completion are automatic. For unknown or failed, say it stopped or is uncertain; do not say it is still generating. Report a ready design only with confirmed remote and succeeded; do not automatically retry an uncertain result.\n${untrustedBlock("current Claude Design status", JSON.stringify(snapshots))}`;
}
