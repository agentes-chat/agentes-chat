import { parseClaudeDesignResult } from "@agenteschat/adapters";
import { desc, type Executor, inArray, schema } from "@agenteschat/db";
import { serverText } from "@agenteschat/i18n";
import type { AppLocale } from "@agenteschat/i18n/locale";
import { designTaskOwner } from "../task-access";
import type { DesignJob } from "./ledger";
import { hasConfirmedDesignContent } from "./publication";

export type DesignStage =
  | "queued"
  | "working"
  | "waiting_approval"
  | "recovering"
  | "importing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "unknown";
export interface DesignProgress {
  stage: DesignStage;
  updatedAt: string;
  pendingConsentId: string | null;
  issue: { id: string; number: number } | null;
}
/** Tracking never widens the original DM's audience or takes over another agent's card. */
export function matchesDesignIssue(job: DesignJob, issue: typeof schema.issues.$inferSelect): boolean {
  return (
    designTaskOwner(issue.source) === job.ownerUserId &&
    issue.orgId === job.orgId &&
    issue.assigneeType === "agent" &&
    issue.assigneeId === job.agentId &&
    (issue.channelId === job.channelId ||
      (issue.restricted && issue.audienceUserIds.length === 1 && issue.audienceUserIds[0] === job.ownerUserId))
  );
}

/** Batched and read-only: the same native state is used by the board, chat and agent context. */
export async function designProgressOf(
  db: Executor,
  jobs: DesignJob[],
  now = new Date(),
): Promise<Map<string, DesignProgress>> {
  if (!jobs.length) return new Map();
  const [consents, tasks, issues, grants] = await Promise.all([
    db
      .select()
      .from(schema.claudeDesignConsents)
      .where(
        inArray(
          schema.claudeDesignConsents.jobId,
          jobs.map((j) => j.id),
        ),
      )
      .orderBy(desc(schema.claudeDesignConsents.createdAt)),
    db
      .select()
      .from(schema.machineTasks)
      .where(
        inArray(
          schema.machineTasks.id,
          jobs.map((j) => j.recoveryTaskId ?? j.taskId),
        ),
      ),
    db
      .select()
      .from(schema.issues)
      .where(
        inArray(
          schema.issues.id,
          jobs.flatMap((j) => (j.issueId ? [j.issueId] : [])),
        ),
      ),
    db
      .select()
      .from(schema.claudeDesignGrants)
      .where(
        inArray(
          schema.claudeDesignGrants.id,
          jobs.map((j) => j.grantId),
        ),
      ),
  ]);
  return new Map(
    await Promise.all(
      jobs.map(async (job) => {
        const taskId = job.recoveryTaskId ?? job.taskId;
        const consent = consents.find((c) => c.orgId === job.orgId && c.jobId === job.id && c.taskId === taskId);
        const task = tasks.find((t) => t.orgId === job.orgId && t.id === taskId && t.agentId === job.agentId);
        const terminal = ["succeeded", "failed", "canceled"].includes(job.state);
        const liveTask = !task || ["queued", "running"].includes(task.status);
        const grant = grants.find((g) => g.id === job.grantId && g.orgId === job.orgId);
        const currentGrant = !!(
          grant?.enabled &&
          grant.agentId === job.agentId &&
          grant.accountId === job.accountId &&
          grant.machineId === job.machineId &&
          grant.ownerUserId === job.ownerUserId &&
          grant.revision === (job.recoveryTaskId ? (job.recoveryGrantRevision ?? job.grantRevision) : job.grantRevision)
        );
        const validConsent =
          consent?.status === "pending"
            ? await (await import("./consent")).isClaudeDesignConsentCurrent(db, job, consent)
            : true;
        const pending =
          !terminal &&
          liveTask &&
          currentGrant &&
          validConsent &&
          !job.cancelRequestedAt &&
          consent?.status === "pending" &&
          consent.expiresAt > now;
        const result = parseClaudeDesignResult(job.result);
        let stage: DesignStage;
        const stoppedConsent =
          consent &&
          (["denied", "expired", "canceled"].includes(consent.status) ||
            (consent.status === "pending" && (!validConsent || consent.expiresAt <= now)));
        if (terminal) stage = job.state as "succeeded" | "failed" | "canceled";
        else if (!currentGrant || job.cancelRequestedAt || stoppedConsent) stage = "unknown";
        else if (pending) stage = "waiting_approval";
        else if (job.recoveryTaskId && task && liveTask) stage = "recovering";
        else if (hasConfirmedDesignContent(job, result)) stage = "importing";
        else if (job.state === "unknown" || result?.error || (task && !liveTask)) stage = "unknown";
        else stage = job.state === "queued" ? "queued" : "working";
        const issue = issues.find((i) => i.id === job.issueId && matchesDesignIssue(job, i));
        return [
          job.id,
          {
            stage,
            updatedAt: new Date(
              Math.max(
                job.updatedAt.getTime(),
                consent?.decidedAt?.getTime() ?? consent?.createdAt.getTime() ?? 0,
                task?.updatedAt.getTime() ?? 0,
              ),
            ).toISOString(),
            pendingConsentId: pending ? consent.id : null,
            issue: issue ? { id: issue.id, number: issue.number } : null,
          },
        ] as const;
      }),
    ),
  );
}

export function designBlocked(
  progress: DesignProgress,
  locale: AppLocale | null,
  previous?: { reason: string; since: string; text?: string } | null,
) {
  const reason =
    progress.stage === "waiting_approval"
      ? "waiting_you"
      : ["unknown", "failed"].includes(progress.stage)
        ? "failed"
        : null;
  if (!reason) return null;
  const text = locale
    ? serverText(locale, `claudeDesign.progress.${progress.stage}`)
    : previous?.reason === reason
      ? previous.text
      : undefined;
  return {
    reason,
    since: previous?.reason === reason ? previous.since : progress.updatedAt,
    ...(text ? { text } : {}),
  };
}
