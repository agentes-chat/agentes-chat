import { createHash } from "node:crypto";
import {
  CLAUDE_DESIGN_LIMITS,
  type ClaudeDesignExecuteTask,
  claudeDesignRemoteId,
  parseClaudeDesignResult,
} from "@agenteschat/adapters";
import { and, eq, isNull, schema } from "@agenteschat/db";
import { planState } from "@agenteschat/ui/plan-state";
import { type ArtifactDeps, getArtifact } from "../artifacts";
import { recordAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { copyToComputer, type StoredFile } from "../file-pulls";
import type { MachineCaller } from "../machine-hub";
import { createMachineSandboxProvider } from "../machine-provider";
import { requirePermission } from "../organizations";
import { assertPersonUnderLimit } from "../person-usage";
import { assertCanWork } from "../standing";
import type { ToolContext } from "../tools/types";
import {
  type AuthorizedClaudeDesign,
  authorizeClaudeDesign,
  authorizeDesignRecoveryIn,
  type ClaudeDesignDeps,
} from "./access";
import { publishClaudeDesignIssue, syncClaudeDesignIssue } from "./board";
import { storeClaudeDesignFiles } from "./files";
import {
  claimClaudeDesignJob,
  type DesignInput,
  type DesignJobView,
  type DesignSourcePin,
  designJobView,
  designReplyThreadId,
  designSourcePinValues,
  recordClaudeDesignResult,
  reserveClaudeDesignJob,
  settleClaudeDesignBeforeEffect,
} from "./ledger";
import { acceptClaudeDesignTaskResult } from "./lifecycle";
import { enqueueClaudeDesignReconciliation } from "./queue";

const { claudeDesignJobs: jobs, claudeDesignArtifacts: designs } = schema;
export interface ClaudeDesignServiceDeps extends ClaudeDesignDeps {
  hub: Pick<MachineCaller, "call" | "status">;
  artifacts: ArtifactDeps;
  publicUrl: string;
}
/** Shared by normal and recovery turns; both consume the explicitly selected subscription. */
async function assertDesignWorkAdmission(
  deps: ClaudeDesignServiceDeps,
  job: { orgId: string; agentId: string; ownerUserId: string; accountId: string; machineId: string },
) {
  await assertCanWork(deps.db, job.orgId, job.agentId);
  await assertPersonUnderLimit(deps.db, job.orgId, job.ownerUserId);
  const [account] = await deps.db
    .select()
    .from(schema.machineAccounts)
    .where(and(eq(schema.machineAccounts.orgId, job.orgId), eq(schema.machineAccounts.id, job.accountId)));
  if (account?.usage && planState(account.usage).state === "limited")
    throw new ForbiddenError("The selected account is at its plan limit");
  const status = await deps.hub.status(job.machineId);
  if (!status?.online || !status.execAllowed || status.paused)
    throw new ForbiddenError("The Design computer is unavailable");
}
export const designAuthorityBinding = (value: AuthorizedClaudeDesign & { sourceManifest?: DesignSourcePin[] }) => {
  const { sourceManifest, ...authority } = value;
  return createHash("sha256")
    .update(JSON.stringify({ authority, sources: (sourceManifest ?? []).map(designSourcePinValues) }))
    .digest("hex");
};

async function sourcesFor(
  deps: ClaudeDesignServiceDeps,
  ctx: ToolContext,
  ids: string[],
  ownerId: string,
  pins?: DesignSourcePin[],
) {
  if (ids.length > CLAUDE_DESIGN_LIMITS.maxSources || new Set(ids).size !== ids.length)
    throw new ValidationError("Invalid source list");
  if (pins && pins.length !== ids.length) throw new ValidationError("Exact source versions are required");
  const files: { source: ClaudeDesignExecuteTask["sources"][number]; stored: StoredFile; pin: DesignSourcePin }[] = [];
  let total = 0;
  for (const [index, id] of ids.entries()) {
    const detail = await getArtifact(
      deps.artifacts,
      { type: "agent", agentId: ctx.agentId, channelId: ctx.channelId, threadId: ctx.threadRootId, runId: ctx.runId },
      ctx.orgId,
      id,
    );
    await getArtifact(deps.artifacts, { type: "person", userId: ownerId }, ctx.orgId, id, detail.shownVersion);
    const [version] = await deps.db
      .select()
      .from(schema.artifactVersions)
      .where(
        and(
          eq(schema.artifactVersions.orgId, ctx.orgId),
          eq(schema.artifactVersions.artifactId, id),
          eq(schema.artifactVersions.version, detail.shownVersion),
        ),
      );
    if (!version) throw new NotFoundError();
    total += version.size;
    if (total > CLAUDE_DESIGN_LIMITS.maxSourceBytes) throw new ValidationError("Design sources are too large");
    const name =
      (
        version.fileName ??
        `${detail.title}.${detail.kind === "document" ? "md" : detail.kind === "html" ? "html" : "json"}`
      )
        .replace(/[^\w.-]/g, "_")
        .slice(0, 200) || "source.txt";
    const pin = {
      artifactId: id,
      version: detail.shownVersion,
      sha256: version.sha256,
      name,
      relativePath: `sources/${index + 1}-${name}`,
    };
    if (
      pins &&
      (!pins[index] ||
        JSON.stringify(designSourcePinValues(pins[index]!)) !== JSON.stringify(designSourcePinValues(pin)))
    )
      throw new ConflictError("Design source changed. Request a new approval");
    files.push({
      pin,
      source: { name, relativePath: `sources/${index + 1}-${name}`, sha256: version.sha256 },
      stored: {
        storageConfigId: version.storageConfigId,
        blobKey: version.blobKey,
        size: version.size,
        sha256: version.sha256,
      },
    });
  }
  return files;
}
export async function checkClaudeDesignInput(deps: ClaudeDesignServiceDeps, ctx: ToolContext, input: DesignInput) {
  const authority = await authorizeClaudeDesign(deps, ctx, input.action, input.designId);
  const sources = await sourcesFor(deps, ctx, input.sourceArtifactIds, authority.ownerUserId);
  return { ...authority, sourceManifest: sources.map((file) => file.pin) };
}
export async function submitClaudeDesign(
  deps: ClaudeDesignServiceDeps,
  ctx: ToolContext,
  input: DesignInput,
): Promise<DesignJobView> {
  const authority = await checkClaudeDesignInput(deps, ctx, input);
  if (ctx.approvedAuthority && ctx.approvedAuthority !== designAuthorityBinding(authority))
    throw new ForbiddenError("The selected Design account changed. Ask again");
  const view = await reserveClaudeDesignJob(deps, ctx, input, authority.sourceManifest);
  await startClaudeDesignTask(deps, authority, view.id);
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, view.id)));
  if (!job) throw new NotFoundError();
  return designJobView(deps.db, job);
}
/** The only dispatcher for this task variant. A prior reservation never dispatches twice. */
export async function startClaudeDesignTask(
  deps: ClaudeDesignServiceDeps,
  authority: AuthorizedClaudeDesign,
  jobId: string,
): Promise<void> {
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, authority.orgId), eq(jobs.id, jobId), eq(jobs.agentId, authority.agentId)));
  if (!job) throw new NotFoundError();
  if (
    job.grantId !== authority.grantId ||
    job.grantRevision !== authority.grantRevision ||
    job.accountId !== authority.accountId ||
    job.machineId !== authority.machineId ||
    job.ownerUserId !== authority.ownerUserId
  )
    throw new ForbiddenError("Design authority changed before dispatch");
  if (!(await claimClaudeDesignJob(deps, job.id))) return;
  let sent = false;
  try {
    const ctx: ToolContext = { db: deps.db, ...job };
    await assertDesignWorkAdmission(deps, job);
    const [agent] = await deps.db
      .select()
      .from(schema.agents)
      .where(
        and(eq(schema.agents.orgId, job.orgId), eq(schema.agents.id, job.agentId), isNull(schema.agents.deletedAt)),
      );
    const [design] = await deps.db
      .select()
      .from(designs)
      .where(and(eq(designs.orgId, job.orgId), eq(designs.id, job.designId)));
    if (!agent || !design) throw new NotFoundError();
    const sources = await sourcesFor(deps, ctx, job.sourceArtifactIds, job.ownerUserId, job.sourceManifest ?? []);
    const provider = createMachineSandboxProvider(deps.hub, { id: agent.id, handle: agent.handle });
    for (const file of sources)
      await copyToComputer(
        { db: deps.db, blobs: deps.artifacts.blobs, publicUrl: deps.publicUrl },
        ctx,
        { id: job.machineId, machineId: job.machineId, ref: `machine:${job.machineId}`, provider },
        `designs/${job.taskId}/work/${file.source.relativePath}`,
        file.stored,
      );
    const current = await authorizeClaudeDesign(
      deps,
      ctx,
      job.action,
      job.action === "update" ? job.designId : undefined,
    );
    if (
      designAuthorityBinding({ ...current, sourceManifest: job.sourceManifest ?? [] }) !==
      designAuthorityBinding(authority)
    )
      throw new ForbiddenError("Design authority changed before dispatch");
    const [liveJob] = await deps.db
      .select({ canceled: jobs.cancelRequestedAt })
      .from(jobs)
      .where(and(eq(jobs.id, job.id), eq(jobs.orgId, job.orgId)));
    if (!liveJob || liveJob.canceled) throw new ForbiddenError("Design canceled before dispatch");
    await deps.db
      .insert(schema.machineTasks)
      .values({
        id: job.taskId,
        orgId: job.orgId,
        agentId: job.agentId,
        machineId: job.machineId,
        channelId: job.channelId,
        threadRootId: await designReplyThreadId(deps.db, job),
        runId: job.runId,
        requestedByUserId: job.ownerUserId,
        executor: "claude",
        title: job.title,
        status: "queued",
      })
      .onConflictDoNothing();
    const task: ClaudeDesignExecuteTask = {
      mode: "execute",
      jobId: job.id,
      action: job.action,
      title: job.title,
      brief: job.brief,
      sources: sources.map((s) => s.source),
      grantRevision: job.grantRevision,
      ...(job.action === "update" && design.remoteId && design.remoteUrl && design.remoteVersion
        ? {
            target: {
              remoteId: design.remoteId,
              remoteUrl: design.remoteUrl,
              remoteVersion: design.remoteVersion,
              revision: design.revision,
            },
          }
        : {}),
    };
    await enqueueClaudeDesignReconciliation(deps, job.orgId, job.id, job.taskId);
    sent = true;
    const reply = await deps.hub.call(job.machineId, {
      op: "task.start",
      taskId: job.taskId,
      agent: { id: agent.id, handle: agent.handle },
      executor: "claude",
      account: job.accountId,
      claudeDesign: task,
      maxSeconds: CLAUDE_DESIGN_LIMITS.maxSeconds,
    });
    await deps.db
      .update(schema.machineTasks)
      .set({ status: "running", startedAt: new Date(reply.startedAt), updatedAt: new Date() })
      .where(and(eq(schema.machineTasks.id, job.taskId), isNull(schema.machineTasks.endedAt)));
  } catch {
    await recordClaudeDesignResult(deps, job.taskId, {
      jobId: job.id,
      state: sent ? "unknown" : "failed",
      sourceFiles: [],
      error: {
        code: sent ? "result_unknown" : "unavailable",
        message: sent
          ? "The start could not be confirmed; this task will not be repeated automatically"
          : "Claude Design could not start on the selected account",
      },
    });
  }
}
export async function getClaudeDesignJobForContext(
  deps: ClaudeDesignDeps,
  ctx: ToolContext,
  jobId: string,
): Promise<DesignJobView> {
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.orgId, ctx.orgId),
        eq(jobs.id, jobId),
        eq(jobs.agentId, ctx.agentId),
        eq(jobs.channelId, ctx.channelId),
      ),
    );
  if (!job) throw new NotFoundError();
  await requirePermission(deps.db, job.ownerUserId, ctx.orgId, "post");
  const { runAuthorityById } = await import("../authority");
  const authority = await runAuthorityById(deps.db, ctx.orgId, ctx.runId);
  if (authority.kind !== "person" || authority.personId !== job.ownerUserId) throw new NotFoundError();
  const { requireChannelAccess } = await import("../channels");
  await requireChannelAccess(deps.db, job.ownerUserId, ctx.orgId, job.channelId);
  return designJobView(deps.db, job);
}
export async function getClaudeDesignJobForOwner(
  deps: ClaudeDesignDeps,
  actorId: string,
  orgId: string,
  jobId: string,
): Promise<DesignJobView> {
  await requirePermission(deps.db, actorId, orgId, "post");
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId), eq(jobs.ownerUserId, actorId)));
  if (!job) throw new NotFoundError();
  const { requireChannelAccess } = await import("../channels");
  await requireChannelAccess(deps.db, actorId, orgId, job.channelId);
  return designJobView(deps.db, job);
}
export async function cancelClaudeDesignJob(
  deps: ClaudeDesignServiceDeps,
  actorId: string,
  orgId: string,
  jobId: string,
): Promise<DesignJobView> {
  await getClaudeDesignJobForOwner(deps, actorId, orgId, jobId);
  const [job] = await deps.db
    .update(jobs)
    .set({ cancelRequestedAt: new Date() })
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
    .returning();
  if (!job) throw new NotFoundError();
  await settleClaudeDesignBeforeEffect(deps, job.id, true);
  await enqueueClaudeDesignReconciliation(deps, job.orgId, job.id, job.recoveryTaskId ?? job.taskId);
  const [agent] = await deps.db.select().from(schema.agents).where(eq(schema.agents.id, job.agentId));
  if (agent)
    await deps.hub
      .call(job.machineId, {
        op: "task.cancel",
        taskId: job.recoveryTaskId ?? job.taskId,
        agent: { id: agent.id, handle: agent.handle },
      })
      .catch(() => undefined);
  const [current] = await deps.db.select().from(jobs).where(eq(jobs.id, job.id));
  if (!current) throw new NotFoundError();
  return designJobView(deps.db, current);
}

export { CLAUDE_DESIGN_RECONCILE_JOB } from "./queue";
/** Status/byte import only. This path never dispatches a native creation or update. */
export async function reconcileClaudeDesignJob(deps: ClaudeDesignServiceDeps, jobId: string): Promise<DesignJobView> {
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new NotFoundError();
  if (["succeeded", "failed", "canceled"].includes(job.state)) return designJobView(deps.db, job);
  const [agent] = await deps.db.select().from(schema.agents).where(eq(schema.agents.id, job.agentId));
  if (!agent) throw new NotFoundError();
  const taskId = job.recoveryTaskId ?? job.taskId;
  if (!deps.enabled && !job.cancelRequestedAt)
    await deps.db.update(jobs).set({ cancelRequestedAt: new Date() }).where(eq(jobs.id, job.id));
  const expired = Date.now() - job.createdAt.getTime() >= CLAUDE_DESIGN_LIMITS.maxSeconds * 1000;
  if (job.cancelRequestedAt || !deps.enabled || expired) {
    const settled = await settleClaudeDesignBeforeEffect(deps, job.id, !!job.cancelRequestedAt || !deps.enabled);
    if (settled) {
      const [current] = await deps.db.select().from(jobs).where(eq(jobs.id, job.id));
      if (current) return designJobView(deps.db, current);
    }
  }
  const reply = await deps.hub.call(job.machineId, {
    op: "task.status",
    taskId,
    agent: { id: agent.id, handle: agent.handle },
  });
  const task = reply.tasks.find((t) => t.taskId === taskId);
  if (task?.claudeDesign) await acceptClaudeDesignTaskResult(deps, job.orgId, job.machineId, taskId, task.claudeDesign);
  if (task?.status === "running") throw new Error("Design task still running; check its journal again later");
  // Preparation/dispatch may still be underway. A durable bounded outbox retry checks again.
  if (!task && !expired && ["queued", "running"].includes(job.state) && job.effectSequence === 0)
    throw new Error("Design dispatch still being prepared");
  if (!task?.claudeDesign)
    await recordClaudeDesignResult(deps, taskId, {
      jobId: job.id,
      state: "unknown",
      sourceFiles: [],
      error: {
        code: "result_unknown",
        message: "The remote result is unknown. Do not repeat this creation or update.",
      },
    });
  const [current] = await deps.db.select().from(jobs).where(eq(jobs.id, job.id));
  if (!current) throw new NotFoundError();
  const result = parseClaudeDesignResult(current.result);
  if (current.state === "published" && result?.sourceFiles.length) await storeClaudeDesignFiles(deps, job.id, result);
  const [final] = await deps.db.select().from(jobs).where(eq(jobs.id, job.id));
  if (!final) throw new NotFoundError();
  return designJobView(deps.db, final);
}
/** Called only by the session-authenticated owner route with explicit association confirmation. */
export async function recoverClaudeDesignJob(
  deps: ClaudeDesignServiceDeps,
  actorUserId: string,
  orgId: string,
  jobId: string,
  remoteUrl: string,
): Promise<DesignJobView> {
  await getClaudeDesignJobForOwner(deps, actorUserId, orgId, jobId);
  if (!claudeDesignRemoteId(remoteUrl)) throw new ValidationError("Use a canonical Claude artifact reference");
  const [initial] = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)));
  if (!initial) throw new NotFoundError();
  await assertDesignWorkAdmission(deps, initial);
  const reserved = await deps.db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.orgId, orgId), eq(jobs.id, jobId)))
      .for("update");
    if (!job || !["unknown", "published"].includes(job.state))
      throw new ConflictError("This job does not need recovery");
    const authority = await authorizeDesignRecoveryIn(tx, deps.enabled, job);
    const [design] = await tx.select().from(designs).where(eq(designs.id, job.designId));
    if (!design || (design.remoteUrl && design.remoteUrl !== remoteUrl))
      throw new ConflictError("Recovery target differs from the original design");
    const ids = [job.taskId, job.recoveryTaskId].filter((id): id is string => !!id);
    for (const id of ids) {
      const [task] = await tx.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, id));
      if (task && !task.endedAt) throw new ConflictError("The previous task has not stopped");
    }
    const taskId = crypto.randomUUID();
    await tx
      .update(jobs)
      .set({
        recoveryTaskId: taskId,
        recoveryCandidateUrl: remoteUrl,
        recoveryGrantRevision: authority.grantRevision,
        recoveryEffectSequence: 0,
        cancelRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    await tx.insert(schema.machineTasks).values({
      id: taskId,
      orgId,
      agentId: job.agentId,
      machineId: job.machineId,
      channelId: job.channelId,
      threadRootId: await designReplyThreadId(tx, job),
      requestedByUserId: actorUserId,
      executor: "claude",
      title: job.title,
      status: "queued",
    });
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorUserId },
      action: "claude_design.recovery_requested",
      target: { type: "claude_design_job", id: job.id },
      details: { evidence: "owner_association", taskId },
    });
    await enqueueClaudeDesignReconciliation({ ...deps, db: tx }, orgId, job.id, taskId);
    await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, job.id, { create: true });
    return { job, taskId, authority };
  });
  await publishClaudeDesignIssue(deps, reserved.job.id);
  const [agent] = await deps.db.select().from(schema.agents).where(eq(schema.agents.id, reserved.job.agentId));
  if (!agent) throw new NotFoundError();
  let sent = false;
  try {
    await assertDesignWorkAdmission(deps, reserved.job);
    const current = await authorizeDesignRecoveryIn(deps.db, deps.enabled, reserved.job);
    if (designAuthorityBinding(current) !== designAuthorityBinding(reserved.authority))
      throw new ForbiddenError("Recovery authority changed");
    sent = true;
    await deps.hub.call(reserved.job.machineId, {
      op: "task.start",
      taskId: reserved.taskId,
      agent: { id: agent.id, handle: agent.handle },
      account: reserved.job.accountId,
      executor: "claude",
      maxSeconds: CLAUDE_DESIGN_LIMITS.maxSeconds,
      claudeDesign: {
        mode: "recover",
        jobId,
        remoteCandidateUrl: remoteUrl,
        grantRevision: reserved.authority.grantRevision,
      },
    });
  } catch {
    // No start retry. Admission failures before dispatch can be proved terminal locally.
    if (!sent)
      await deps.db
        .update(schema.machineTasks)
        .set({ status: "failed", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.machineTasks.id, reserved.taskId));
  }
  return getClaudeDesignJobForOwner(deps, actorUserId, orgId, jobId);
}
