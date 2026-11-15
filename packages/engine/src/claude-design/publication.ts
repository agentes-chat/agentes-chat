import type { ClaudeDesignResult } from "@agenteschat/adapters";
import type { DesignJob } from "./ledger";

/** Content publication and an authorized recovery read are distinct proofs; a create shell proves neither. */
export function hasConfirmedDesignContent(job: DesignJob, result: ClaudeDesignResult | null): boolean {
  if (!result?.remote || !result.sourceFiles.length) return false;
  if (result.recoveryEvidence === "owner_association")
    return !!(
      job.recoveryTaskId &&
      job.sourceTaskId === job.recoveryTaskId &&
      job.recoveryEffectSequence > 0 &&
      job.recoveryCandidateUrl === result.remote.url
    );
  return job.action !== "create" || result.publicationSequence === 2;
}
