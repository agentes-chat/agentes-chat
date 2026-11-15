import {
  type ClaudeDesignEffectReply,
  type ClaudeDesignEffectRequest,
  type ClaudeDesignResult,
  parseClaudeDesignEffectRequest,
} from "@agenteschat/adapters";
import { and, eq, or, schema } from "@agenteschat/db";
import { NotFoundError, ValidationError } from "../errors";
import { ACTIVE_DESIGN_STATES, authorizeDesignIn, authorizeDesignRecoveryIn, type ClaudeDesignDeps } from "./access";
import { recordClaudeDesignResult } from "./ledger";

const { claudeDesignJobs: jobs, claudeDesignArtifacts: designs, machineTasks } = schema;
export async function acceptClaudeDesignTaskResult(
  deps: ClaudeDesignDeps,
  orgId: string,
  machineId: string,
  taskId: string,
  result: ClaudeDesignResult,
): Promise<void> {
  if (["queued", "running", "succeeded"].includes(result.state))
    throw new ValidationError("Only the server can finish importing Design sources");
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.orgId, orgId),
        eq(jobs.id, result.jobId),
        eq(jobs.machineId, machineId),
        or(eq(jobs.taskId, taskId), eq(jobs.recoveryTaskId, taskId)),
      ),
    );
  const [task] = await deps.db
    .select()
    .from(machineTasks)
    .where(and(eq(machineTasks.orgId, orgId), eq(machineTasks.id, taskId), eq(machineTasks.machineId, machineId)));
  if (
    !job ||
    !task ||
    task.agentId !== job.agentId ||
    task.executor !== "claude" ||
    task.runId !== (job.recoveryTaskId === taskId ? null : job.runId) ||
    task.requestedByUserId !== job.ownerUserId
  )
    throw new NotFoundError();
  const recovery = job.recoveryTaskId === taskId;
  if (
    recovery
      ? result.remote && result.recoveryEvidence !== "owner_association"
      : result.recoveryEvidence === "owner_association"
  )
    throw new ValidationError("Result purpose does not match task");
  if (recovery && result.remote && (job.recoveryEffectSequence < 1 || result.remote.url !== job.recoveryCandidateUrl))
    throw new ValidationError("No authorized ownership read");
  if (
    result.publicationSequence !== undefined &&
    (recovery || (result.publicationSequence === 2 && (job.action !== "create" || job.effectSequence < 3)))
  )
    throw new ValidationError("Publication phase does not match authorized effects");
  if (!recovery && result.remote && job.effectSequence < 1) throw new ValidationError("No authorized effect");
  await recordClaudeDesignResult(deps, taskId, result);
  if (recovery && result.remote) {
    const { recordAudit } = await import("../audit");
    await recordAudit(deps.db, {
      orgId,
      actor: { type: "person", id: job.ownerUserId },
      action: "claude_design.owner_association",
      target: { type: "claude_design_job", id: job.id },
      details: { taskId, designId: job.designId, evidence: "owner_association" },
    });
  }
  const usage = result.usage;
  if (usage) {
    const { recordPlanUsage } = await import("../brains/claude-code");
    await deps.db.transaction((tx) =>
      recordPlanUsage(tx, {
        ...usage,
        orgId,
        agentId: job.agentId,
        runId: task.runId ?? undefined,
        personId: job.ownerUserId,
        provider: "claude_code",
        machineId,
        accountId: job.accountId,
        idempotencyKey: taskId,
      }),
    );
  }
}
/** Only the authenticated socket's organization/machine are inputs here. Never accepts model authority. */
export async function authorizeClaudeDesignEffect(
  deps: ClaudeDesignDeps,
  orgId: string,
  machineId: string,
  raw: ClaudeDesignEffectRequest,
): Promise<ClaudeDesignEffectReply> {
  const deny = (): ClaudeDesignEffectReply => ({
    type: "design.authorized",
    requestId: raw.requestId,
    allow: false,
    error: "forbidden",
  });
  const request = parseClaudeDesignEffectRequest(raw);
  if (!request || !deps.enabled) return deny();
  try {
    const allowed = await deps.db.transaction(async (tx) => {
      const [initial] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.orgId, orgId), eq(jobs.id, request.jobId), eq(jobs.machineId, machineId)));
      if (!initial) return false;
      // Same order as revocation/publication: grant, design, job. A rejected replay must not persist an older checkpoint.
      await tx
        .select()
        .from(schema.claudeDesignGrants)
        .where(eq(schema.claudeDesignGrants.id, initial.grantId))
        .for("update");
      await tx.select().from(designs).where(eq(designs.id, initial.designId)).for("update");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, initial.id)).for("update");
      const recovery = job?.recoveryTaskId === request.taskId;
      if (
        !job ||
        job.cancelRequestedAt ||
        !ACTIVE_DESIGN_STATES.includes(job.state as (typeof ACTIVE_DESIGN_STATES)[number]) ||
        (!recovery && (job.state === "unknown" || !!job.recoveryTaskId)) ||
        request.grantRevision !== (recovery ? job.recoveryGrantRevision : job.grantRevision) ||
        request.sequence !== (recovery ? job.recoveryEffectSequence : job.effectSequence) + 1
      )
        return false;
      if ((job.taskId !== request.taskId && !recovery) || (recovery && request.effect !== "read_target")) return false;
      const [task] = await tx
        .select()
        .from(machineTasks)
        .where(
          and(
            eq(machineTasks.id, request.taskId),
            eq(machineTasks.orgId, orgId),
            eq(machineTasks.machineId, machineId),
          ),
        );
      if (
        !task ||
        task.agentId !== job.agentId ||
        task.runId !== (recovery ? null : job.runId) ||
        task.endedAt ||
        task.requestedByUserId !== job.ownerUserId ||
        task.executor !== "claude"
      )
        return false;
      const { freshGrantedKeys, isAllowed, toolAccess } = await import("../tools/scopes");
      if (
        !isAllowed(
          toolAccess(await freshGrantedKeys(tx, orgId, job.agentId), {
            name: recovery ? "get_claude_design_job" : `${job.action}_claude_design`,
            scope: recovery ? "claude-design:read" : "claude-design:write",
            connectionId: null,
          }),
        )
      )
        return false;
      const authority = recovery
        ? await authorizeDesignRecoveryIn(tx, deps.enabled, job)
        : await authorizeDesignIn(
            tx,
            deps.enabled,
            { db: deps.db, ...job },
            job.action,
            job.action === "update" ? job.designId : undefined,
          );
      if (
        authority.grantRevision !== (recovery ? job.recoveryGrantRevision : job.grantRevision) ||
        authority.accountId !== job.accountId ||
        authority.machineId !== machineId
      )
        return false;
      if (request.checkpoint && recovery) return false;
      if (request.checkpoint) {
        if (
          request.checkpoint.remote?.version !== request.remoteVersion ||
          request.checkpoint.remote?.id !== request.remoteId
        )
          return false;
        await acceptClaudeDesignTaskResult({ ...deps, db: tx }, orgId, machineId, request.taskId, request.checkpoint);
      }
      const [design] = await tx
        .select()
        .from(designs)
        .where(and(eq(designs.orgId, orgId), eq(designs.id, job.designId)));
      if (!design || design.unavailable) return false;
      if (recovery) {
        const { claudeDesignRemoteId } = await import("@agenteschat/adapters");
        if (
          request.effect !== "read_target" ||
          request.remoteId !== claudeDesignRemoteId(job.recoveryCandidateUrl) ||
          (design.remoteVersion && request.remoteVersion && request.remoteVersion !== design.remoteVersion)
        )
          return false;
      } else if (request.effect === "create") {
        const [uncertain] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.orgId, orgId),
              eq(jobs.agentId, job.agentId),
              eq(jobs.accountId, job.accountId),
              eq(jobs.channelId, job.channelId),
              eq(jobs.state, "unknown"),
              eq(jobs.action, "create"),
            ),
          );
        if (uncertain) return false;
        if (recovery || job.action !== "create" || job.effectSequence !== 0 || design.remoteId) return false;
      } else if (
        request.remoteId !== design.remoteId ||
        (request.remoteVersion !== undefined && request.remoteVersion !== design.remoteVersion)
      )
        return false;
      if (request.consentRequestId) {
        const [consent] = await tx
          .select()
          .from(schema.claudeDesignConsents)
          .where(
            and(
              eq(schema.claudeDesignConsents.orgId, orgId),
              eq(schema.claudeDesignConsents.id, request.consentRequestId),
            ),
          )
          .for("update");
        const previous = job.lastAuthorization;
        if (
          !consent ||
          consent.status !== "consumed" ||
          consent.reauthorizedAt ||
          !consent.consumedAt ||
          Date.now() - consent.consumedAt.getTime() > 5000 ||
          consent.expiresAt.getTime() <= Date.now() ||
          consent.jobId !== job.id ||
          consent.taskId !== request.taskId ||
          consent.machineId !== machineId ||
          consent.accountId !== job.accountId ||
          consent.ownerUserId !== job.ownerUserId ||
          consent.grantRevision !== request.grantRevision ||
          consent.sequence !== previous?.sequence ||
          consent.sequence !== request.sequence - 1 ||
          consent.toolUseId !== request.toolUseId ||
          consent.inputHash !== request.inputHash ||
          consent.remoteId !== request.remoteId ||
          previous?.toolUseId !== request.toolUseId ||
          previous?.inputHash !== request.inputHash ||
          previous?.taskId !== request.taskId ||
          previous.effect !== "read_target"
        )
          return false;
        await tx
          .update(schema.claudeDesignConsents)
          .set({ reauthorizedAt: new Date() })
          .where(eq(schema.claudeDesignConsents.id, consent.id));
      }
      await tx
        .update(jobs)
        .set({
          ...(recovery ? { recoveryEffectSequence: request.sequence } : { effectSequence: request.sequence }),
          lastAuthorization:
            request.toolUseId && request.inputHash
              ? {
                  taskId: request.taskId,
                  grantRevision: request.grantRevision,
                  sequence: request.sequence,
                  toolUseId: request.toolUseId,
                  inputHash: request.inputHash,
                  effect: request.effect,
                  ...(request.remoteId ? { remoteId: request.remoteId } : {}),
                  ...(request.remoteVersion ? { remoteVersion: request.remoteVersion } : {}),
                  ...(request.consentRequestId ? { consentRequestId: request.consentRequestId } : {}),
                }
              : null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      return true;
    });
    return allowed ? { type: "design.authorized", requestId: request.requestId, allow: true } : deny();
  } catch {
    return deny();
  }
}
