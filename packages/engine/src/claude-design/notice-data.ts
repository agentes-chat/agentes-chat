import type { DesignJobView } from "./ledger";

/** Only completion cards carry this server-derived public snapshot; consent cards carry just jobId. */
export function designCompletionOf(meta: Record<string, unknown> | null | undefined): DesignJobView | null {
  const design = meta?.claudeDesign as { jobId?: unknown; outcome?: DesignJobView } | undefined;
  const outcome = design?.outcome;
  return outcome &&
    typeof design?.jobId === "string" &&
    outcome.id === design.jobId &&
    ["queued", "running", "published", "succeeded", "unknown", "failed", "canceled"].includes(outcome.state)
    ? outcome
    : null;
}

export const DESIGN_COMPLETION_GUIDANCE =
  "The result card already reports this Design status and its verified link when available. Do not repeat its link or completion announcement. Reply only if you have substantive requested analysis beyond this status; otherwise call pass. Never automatically retry a Design creation or update with an unknown result. Local HTML is a separate alternative only if the person explicitly asks for it.";
