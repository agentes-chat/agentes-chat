import type { Executor } from "@agenteschat/db";
import { enqueue } from "./outbox";

/** A workspace endpoint's effort check in the background (ADR 0187). */
export const CREDENTIAL_EFFORTS_JOB = "credential.efforts";

/**
 * Queues the check of a workspace endpoint's models: one short call per effort level and model, so the apps offer
 * the levels each takes and the gateway sends none it doesn't (ADR 0187). The key's owner hears from the right hand
 * when it ends. Enqueued in the same transaction as the credential it belongs to.
 */
export async function enqueueCredentialEfforts(
  db: Executor,
  input: { orgId: string; credentialId: string; userId: string; force?: boolean },
): Promise<void> {
  const at = Date.now();
  await enqueue(db, {
    orgId: input.orgId,
    kind: CREDENTIAL_EFFORTS_JOB,
    payload: { credentialId: input.credentialId, userId: input.userId, force: input.force === true },
    dedupeKey: `credential.efforts:${input.credentialId}:${at}`,
  });
}
