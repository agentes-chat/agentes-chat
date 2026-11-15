import { and, desc, eq, schema } from "@agenteschat/db";
import { serverText } from "@agenteschat/i18n";
import { appLocale } from "@agenteschat/i18n/locale";
import type { ClaudeDesignDeps } from "./access";
import { designBlocked, designProgressOf, matchesDesignIssue } from "./progress";

/** Native tracking only: never calls handTask, creates an agent run, or invokes the provider. */
export async function syncClaudeDesignIssue(deps: ClaudeDesignDeps, jobId: string, options: { create?: boolean } = {}) {
  const issue = await deps.db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.claudeDesignJobs)
      .where(eq(schema.claudeDesignJobs.id, jobId))
      .for("update");
    if (!job) return null;
    if (!job.issueId && options.create) {
      const { createIssue } = await import("../issues");
      const [run] = await tx
        .select()
        .from(schema.agentRuns)
        .where(and(eq(schema.agentRuns.orgId, job.orgId), eq(schema.agentRuns.id, job.runId)));
      const [candidate] = run?.issueId
        ? await tx.select().from(schema.issues).where(eq(schema.issues.id, run.issueId))
        : [];
      const [linked] = candidate
        ? await tx.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.issueId, candidate.id))
        : [];
      const [background] = candidate
        ? await tx
            .select({ id: schema.agentWorks.id })
            .from(schema.agentWorks)
            .where(eq(schema.agentWorks.issueId, candidate.id))
        : [];
      const existing =
        candidate &&
        !linked &&
        !background &&
        matchesDesignIssue(job, candidate) &&
        !["done", "canceled"].includes(candidate.status)
          ? candidate
          : null;
      const created =
        existing ??
        (await createIssue({ db: tx }, { type: "agent", agentId: job.agentId, channelId: job.channelId }, job.orgId, {
          audience: { mode: "people", userIds: [job.ownerUserId] },
          title: job.title,
          description: job.brief,
          assignee: { type: "agent", id: job.agentId },
          channelId: job.channelId,
          source: {
            type: "message",
            channelId: job.channelId,
            messageId: job.triggerMessageId,
            designOwnerUserId: job.ownerUserId,
          },
        }));
      job.issueId = created.id;
      await tx
        .update(schema.claudeDesignJobs)
        .set({ issueId: created.id })
        .where(eq(schema.claudeDesignJobs.id, job.id));
    }
    if (!job.issueId) return null;
    const [card] = await tx
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.id, job.issueId), eq(schema.issues.orgId, job.orgId)))
      .for("update");
    if (!card || !matchesDesignIssue(job, card) || card.status === "canceled") return null;
    const progress = (await designProgressOf(tx, [job])).get(job.id);
    if (!progress) return null;
    const [last] = await tx
      .select()
      .from(schema.issueActivity)
      .where(
        and(
          eq(schema.issueActivity.orgId, job.orgId),
          eq(schema.issueActivity.issueId, card.id),
          eq(schema.issueActivity.event, "claude_design_progress"),
        ),
      )
      .orderBy(desc(schema.issueActivity.createdAt), desc(schema.issueActivity.id))
      .limit(1);
    const tag = JSON.stringify([job.id, progress.stage, progress.pendingConsentId, job.recoveryTaskId]);
    if (last?.data.tag === tag) return null;
    const [person] = await tx
      .select({ locale: schema.users.locale })
      .from(schema.users)
      .where(eq(schema.users.id, job.ownerUserId));
    const text = serverText(appLocale([person?.locale]) ?? "en", `claudeDesign.progress.${progress.stage}`);
    const status =
      progress.stage === "queued"
        ? "todo"
        : progress.stage === "succeeded"
          ? "done"
          : progress.stage === "canceled"
            ? "canceled"
            : "in_progress";
    const blocked = designBlocked(progress, appLocale([person?.locale]) ?? "en", card.blocked);
    await tx
      .update(schema.issues)
      .set({ status, blocked, columnId: status === card.status ? card.columnId : null, updatedAt: new Date() })
      .where(eq(schema.issues.id, card.id));
    const remote = progress.stage === "succeeded" ? (job.result?.remote as { url?: string } | undefined) : undefined;
    await tx.insert(schema.issueActivity).values({
      orgId: job.orgId,
      issueId: card.id,
      kind: "event",
      authorType: "agent",
      authorId: job.agentId,
      text: remote?.url ? `${text}\n${remote.url}` : text,
      event: "claude_design_progress",
      data: { tag, stage: progress.stage, designJobId: job.id, auto: true },
    });
    const { enqueueIndex } = await import("../search");
    await enqueueIndex(tx, { orgId: job.orgId, kind: "issue", sourceId: card.id });
    return { orgId: job.orgId, ownerUserId: job.ownerUserId, id: card.id };
  });
  if (issue) await publishClaudeDesignIssue(deps, jobId);
}

/** Called after the outer journal transaction commits; no disclosure is published from a savepoint. */
export async function publishClaudeDesignIssue(deps: ClaudeDesignDeps, jobId: string) {
  if (!deps.pubsub) return;
  const [job] = await deps.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, jobId));
  if (!job?.issueId) return;
  const [card] = await deps.db.select().from(schema.issues).where(eq(schema.issues.id, job.issueId));
  if (!card || !matchesDesignIssue(job, card)) return;
  const { getIssue, publishToTaskReaders } = await import("../issues");
  const view = await getIssue(deps.db, { type: "agent", agentId: job.agentId, channelId: job.channelId }, job.orgId, {
    id: card.id,
  });
  await publishToTaskReaders(deps, job.orgId, view, { type: "issue.updated", issue: view });
}
