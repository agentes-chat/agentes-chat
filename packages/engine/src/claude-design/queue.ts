import { enqueue } from "../outbox";
import type { ClaudeDesignDeps } from "./access";
export const CLAUDE_DESIGN_RECONCILE_JOB = "claude_design.reconcile";
export async function enqueueClaudeDesignReconciliation(
  deps: ClaudeDesignDeps,
  orgId: string,
  jobId: string,
  taskId: string,
) {
  await enqueue(deps.db, {
    orgId,
    kind: CLAUDE_DESIGN_RECONCILE_JOB,
    payload: { jobId },
    dedupeKey: `design:${jobId}:${taskId}`,
    runAt: new Date(Date.now() + 10_000),
    maxAttempts: 8,
  });
}
