import { createHash } from "node:crypto";
import {
  type ClaudeDesignAction,
  type ClaudeDesignRemote,
  type ClaudeDesignResult,
  type ClaudeDesignState,
  parseClaudeDesignResult,
  parseClaudeDesignTask,
} from "@agenteschat/adapters";
import { and, type Executor, eq, inArray, isNull, schema } from "@agenteschat/db";
import { publishClaudeDesignIssue, syncClaudeDesignIssue } from "./board";
import { designReplyThreadId } from "./delivery";
import { type DesignProgress, designProgressOf } from "./progress";

export { designReplyThreadId } from "./delivery";

import { fileContentType } from "../artifacts";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { ToolContext } from "../tools/types";
import { ACTIVE_DESIGN_STATES, authorizeDesignIn, type ClaudeDesignDeps } from "./access";
import { hasConfirmedDesignContent } from "./publication";
import { enqueueClaudeDesignReconciliation } from "./queue";

const { claudeDesignJobs: jobs, claudeDesignArtifacts: designs } = schema;
export interface DesignInput {
  action: ClaudeDesignAction;
  title?: string;
  brief: string;
  sourceArtifactIds: string[];
  designId?: string;
  expectedRevision?: number;
}
export interface DesignJobView {
  issue?: { id: string; number: number } | null;
  progress?: DesignProgress;
  id: string;
  state: ClaudeDesignState;
  designId: string | null;
  revision: number | null;
  remote: ClaudeDesignRemote | null;
  artifactIds: string[];
  title?: string;
  preview?: {
    version: string;
    files: {
      artifactId: string;
      version: number;
      relativePath: string;
      sha256: string;
      size: number;
      contentType: string;
    }[];
  };
  error?: ClaudeDesignResult["error"];
}
export type DesignJob = typeof jobs.$inferSelect;
export type DesignSourcePin = NonNullable<DesignJob["sourceManifest"]>[number];
export const designSourcePinValues = (pin: DesignSourcePin) => [
  pin.artifactId,
  pin.version,
  pin.sha256,
  pin.name,
  pin.relativePath,
];
const hashInput = (input: DesignInput, sources: DesignSourcePin[]) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        action: input.action,
        title: input.title ?? null,
        brief: input.brief,
        sourceArtifactIds: input.sourceArtifactIds,
        designId: input.designId ?? null,
        expectedRevision: input.expectedRevision ?? null,
        ...(sources.length ? { sourceManifest: sources.map(designSourcePinValues) } : {}),
      }),
    )
    .digest("hex");
export async function designJobView(db: Executor, job: DesignJob): Promise<DesignJobView> {
  const [design] = await db
    .select()
    .from(designs)
    .where(and(eq(designs.orgId, job.orgId), eq(designs.id, job.designId)));
  const result = parseClaudeDesignResult(job.result);
  const ready = hasConfirmedDesignContent(job, result);
  const replyThreadId = await designReplyThreadId(db, job);
  let preview: DesignJobView["preview"];
  if (ready && job.sourceTaskId && result?.remote) {
    const imports = result.sourceFiles.map((file) => job.fileImports[`${job.sourceTaskId}:${file.relativePath}`]);
    const ids = imports.flatMap((entry) => (entry ? [entry.uploadId] : []));
    const uploads = ids.length
      ? await db
          .select()
          .from(schema.artifactUploads)
          .where(and(eq(schema.artifactUploads.orgId, job.orgId), inArray(schema.artifactUploads.id, ids)))
      : [];
    const files: NonNullable<DesignJobView["preview"]>["files"] = [];
    for (const [index, file] of result.sourceFiles.entries()) {
      const entry = imports[index],
        upload = uploads.find((row) => row.id === entry?.uploadId);
      if (
        !entry ||
        entry.sha256 !== file.sha256 ||
        !upload ||
        upload.status !== "done" ||
        !upload.artifactId ||
        !upload.version ||
        upload.agentId !== job.agentId ||
        upload.machineId !== job.machineId ||
        upload.computer !== `machine:${job.machineId}` ||
        upload.channelId !== job.channelId ||
        (upload.threadId !== job.threadRootId && upload.threadId !== replyThreadId) ||
        upload.path !== `designs/${job.sourceTaskId}/work/${file.relativePath}` ||
        upload.maxBytes !== file.size ||
        upload.expectedSha256 !== file.sha256
      )
        break;
      files.push({
        artifactId: upload.artifactId,
        version: upload.version,
        ...file,
        contentType: fileContentType(file.relativePath, file.contentType),
      });
    }
    if (files.length === result.sourceFiles.length) preview = { version: result.remote.version, files };
  }
  const progress = (await designProgressOf(db, [job])).get(job.id);
  return {
    issue: progress?.issue ?? null,
    progress,
    title: job.title,
    ...(preview ? { preview } : {}),
    id: job.id,
    state:
      progress?.stage === "unknown"
        ? "unknown"
        : job.state === "published" && !ready
          ? result?.error || job.cancelRequestedAt
            ? "unknown"
            : "running"
          : job.state,
    designId: job.designId,
    revision: design?.revision ?? null,
    remote: ready ? (result?.remote ?? null) : null,
    artifactIds: preview
      ? [...(job.referenceArtifactId ? [job.referenceArtifactId] : []), ...preview.files.map((file) => file.artifactId)]
      : [],
    ...(result?.error ? { error: result.error } : {}),
  };
}
export async function reserveClaudeDesignJob(
  deps: ClaudeDesignDeps,
  ctx: ToolContext,
  input: DesignInput,
  sourceManifest: DesignSourcePin[] = [],
): Promise<DesignJobView> {
  if (!ctx.toolUseId || ctx.toolUseId.length > 128) throw new ValidationError("A tool invocation id is required");
  if (
    !Array.isArray(input.sourceArtifactIds) ||
    input.sourceArtifactIds.length > 10 ||
    new Set(input.sourceArtifactIds).size !== input.sourceArtifactIds.length
  )
    throw new ValidationError("Invalid sources");
  if (
    !Array.isArray(sourceManifest) ||
    sourceManifest.length !== input.sourceArtifactIds.length ||
    sourceManifest.some(
      (pin, index) =>
        !pin ||
        pin.artifactId !== input.sourceArtifactIds[index] ||
        !Number.isSafeInteger(pin.version) ||
        pin.version < 1 ||
        !/^[a-f0-9]{64}$/.test(pin.sha256) ||
        !/^[\w.-]{1,200}$/.test(pin.name) ||
        pin.relativePath !== `sources/${index + 1}-${pin.name}`,
    )
  )
    throw new ValidationError("Exact source versions are required");
  const view = await deps.db.transaction(async (tx) => {
    // Serializes idempotency, including two creates where no design exists yet.
    await tx
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.orgId, ctx.orgId), eq(schema.agentRuns.id, ctx.runId)))
      .for("update");
    const authority = await authorizeDesignIn(tx, deps.enabled, ctx, input.action, input.designId);
    const [existing] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.runId, ctx.runId), eq(jobs.toolUseId, ctx.toolUseId ?? "")));
    if (existing) {
      if (existing.inputHash !== hashInput(input, sourceManifest)) throw new ConflictError("Invocation input changed");
      return designJobView(tx, existing);
    }
    if (input.action === "create") {
      // An uncertain create cannot be bypassed with a new invocation or a new run.
      await tx
        .select()
        .from(schema.claudeDesignGrants)
        .where(eq(schema.claudeDesignGrants.id, authority.grantId))
        .for("update");
      const [uncertain] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.orgId, ctx.orgId),
            eq(jobs.accountId, authority.accountId),
            eq(jobs.agentId, ctx.agentId),
            eq(jobs.channelId, ctx.channelId),
            eq(jobs.action, "create"),
            eq(jobs.state, "unknown"),
          ),
        );
      if (uncertain) throw new ConflictError("A previous creation still has an unknown result");
    }
    let design: typeof designs.$inferSelect | undefined;
    if (input.action === "update") {
      [design] = await tx
        .select()
        .from(designs)
        .where(and(eq(designs.orgId, ctx.orgId), eq(designs.id, input.designId ?? "")))
        .for("update");
      if (
        !design ||
        design.revision !== input.expectedRevision ||
        !design.remoteId ||
        !design.remoteUrl ||
        !design.remoteVersion
      )
        throw new ConflictError("Design revision changed");
      const rows = await tx
        .select({ state: jobs.state })
        .from(jobs)
        .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.designId, design.id)));
      if (rows.some((r) => ACTIVE_DESIGN_STATES.includes(r.state as (typeof ACTIVE_DESIGN_STATES)[number])))
        throw new ConflictError("This design has unfinished work");
    }
    const title = design?.title ?? input.title ?? "";
    const candidate = {
      mode: "execute",
      jobId: crypto.randomUUID(),
      action: input.action,
      title,
      brief: input.brief,
      sources: [],
      grantRevision: authority.grantRevision,
      ...(design
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
    if (!parseClaudeDesignTask(candidate)) throw new ValidationError("Invalid design input");
    if (!design)
      [design] = await tx
        .insert(designs)
        .values({
          orgId: ctx.orgId,
          agentId: ctx.agentId,
          ownerUserId: authority.ownerUserId,
          accountId: authority.accountId,
          machineId: authority.machineId,
          channelId: ctx.channelId,
          title,
        })
        .returning();
    if (!design) throw new Error("Design reservation failed");
    const [job] = await tx
      .insert(jobs)
      .values({
        id: candidate.jobId,
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        ownerUserId: authority.ownerUserId,
        accountId: authority.accountId,
        machineId: authority.machineId,
        channelId: ctx.channelId,
        threadRootId: ctx.threadRootId,
        triggerMessageId: ctx.triggerMessageId,
        runId: ctx.runId,
        toolUseId: ctx.toolUseId ?? "",
        inputHash: hashInput(input, sourceManifest),
        grantId: authority.grantId,
        grantRevision: authority.grantRevision,
        action: input.action,
        title,
        brief: input.brief,
        sourceArtifactIds: input.sourceArtifactIds,
        sourceManifest,
        designId: design.id,
        expectedRevision: design.revision,
        taskId: crypto.randomUUID(),
      })
      .returning();
    if (!job) throw new Error("Job reservation failed");
    await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, job.id, { create: true });
    const [linkedJob] = await tx.select().from(jobs).where(eq(jobs.id, job.id));
    await enqueueClaudeDesignReconciliation({ ...deps, db: tx }, job.orgId, job.id, job.taskId);
    return designJobView(tx, linkedJob ?? job);
  });
  await publishClaudeDesignIssue(deps, view.id);
  return view;
}
export async function claimClaudeDesignJob(deps: ClaudeDesignDeps, jobId: string): Promise<boolean> {
  const claimed = await deps.db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (job?.state !== "queued" || job.cancelRequestedAt) return false;
    const authority = await authorizeDesignIn(
      tx,
      deps.enabled,
      { db: deps.db, ...job },
      job.action,
      job.action === "update" ? job.designId : undefined,
    );
    if (
      authority.grantRevision !== job.grantRevision ||
      authority.accountId !== job.accountId ||
      authority.machineId !== job.machineId
    )
      return false;
    const claimed = await tx
      .update(jobs)
      .set({ state: "running", updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.state, "queued"), isNull(jobs.cancelRequestedAt)))
      .returning({ id: jobs.id });
    if (claimed.length) await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, jobId);
    return claimed.length === 1;
  });
  if (claimed) await publishClaudeDesignIssue(deps, jobId);
  return claimed;
}
export async function recordClaudeDesignResult(
  deps: ClaudeDesignDeps,
  taskId: string,
  raw: ClaudeDesignResult,
): Promise<void> {
  const result = parseClaudeDesignResult(raw);
  if (!result) throw new ValidationError("Malformed design result");
  await deps.db.transaction(async (tx) => {
    const [initial] = await tx.select().from(jobs).where(eq(jobs.id, result.jobId));
    if (!initial || (initial.taskId !== taskId && initial.recoveryTaskId !== taskId)) throw new NotFoundError();
    const [design] = await tx
      .select()
      .from(designs)
      .where(and(eq(designs.orgId, initial.orgId), eq(designs.id, initial.designId)))
      .for("update");
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, initial.id)).for("update");
    if (!design || !job) throw new NotFoundError();
    if (["succeeded", "failed", "canceled"].includes(job.state)) return;
    const previous = parseClaudeDesignResult(job.result);
    const recovery = taskId === job.recoveryTaskId;
    // A failed ownership read proves nothing about the interrupted publication.
    if (recovery && !result.remote) return;
    if (recovery && result.remote?.url !== job.recoveryCandidateUrl) throw new ConflictError("Recovery target changed");
    if (recovery && result.remote && design.remoteVersion && result.remote.version !== design.remoteVersion)
      throw new ConflictError("Recovery target version changed");
    const previousPhase = previous?.publicationSequence ?? 1;
    const phase = result.publicationSequence ?? (recovery ? previousPhase : 1);
    if (result.remote && previous?.remote && !recovery && phase < previousPhase) return;
    if (
      result.remote &&
      previous?.remote &&
      result.remote.version !== previous.remote.version &&
      (recovery || phase <= previousPhase)
    )
      throw new ConflictError("Remote version changed without a newer native publication phase");
    if (result.remote) {
      if (design.remoteId && (design.remoteId !== result.remote.id || design.remoteUrl !== result.remote.url))
        throw new ConflictError("Remote identity changed");
      if (design.lastJobId !== job.id) {
        if (design.revision !== job.expectedRevision) throw new ConflictError("Design revision changed");
        await tx
          .update(designs)
          .set({
            remoteId: result.remote.id,
            remoteUrl: result.remote.url,
            remoteVersion: result.remote.version,
            revision: design.revision + 1,
            lastJobId: job.id,
            updatedAt: new Date(),
          })
          .where(eq(designs.id, design.id));
      } else if (design.remoteVersion !== result.remote.version) {
        await tx
          .update(designs)
          .set({ remoteVersion: result.remote.version, updatedAt: new Date() })
          .where(eq(designs.id, design.id));
      }
    }
    // A remote checkpoint is irreversible locally. Cancellation or a later CLI failure cannot erase it.
    const retained = result.remote
      ? {
          ...result,
          publicationSequence: phase,
          ...(previous?.remote?.version === result.remote.version
            ? {
                sourceFiles: result.sourceFiles.length ? result.sourceFiles : previous.sourceFiles,
                ...(!result.error && previous.error ? { error: previous.error } : {}),
              }
            : {}),
        }
      : previous?.remote
        ? { ...result, remote: previous.remote, publicationSequence: previousPhase, sourceFiles: previous.sourceFiles }
        : result;
    const state = retained.remote && result.state !== "succeeded" ? "published" : result.state;
    await tx
      .update(jobs)
      .set({
        state,
        result: { ...retained, state },
        ...(result.remote && result.sourceFiles.length ? { sourceTaskId: taskId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, job.id);
  });
  await publishClaudeDesignIssue(deps, result.jobId);
}

/** Zero authorized effects plus a terminal state closes every later effect request atomically. */
export async function settleClaudeDesignBeforeEffect(
  deps: ClaudeDesignDeps,
  jobId: string,
  canceled: boolean,
): Promise<boolean> {
  const settled = await deps.db.transaction(async (tx) => {
    const [initial] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!initial) return false;
    await tx.select().from(designs).where(eq(designs.id, initial.designId)).for("update");
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (
      !job ||
      !["queued", "running"].includes(job.state) ||
      job.recoveryTaskId ||
      job.effectSequence !== 0 ||
      parseClaudeDesignResult(job.result)?.remote
    )
      return false;
    const state = canceled ? "canceled" : "failed";
    await tx
      .update(jobs)
      .set({
        state,
        cancelRequestedAt: new Date(),
        updatedAt: new Date(),
        result: {
          jobId: job.id,
          state,
          sourceFiles: [],
          error: {
            code: canceled ? "canceled" : "unavailable",
            message: canceled
              ? "Canceled before any remote effect was authorized"
              : "Design dispatch expired before any remote effect was authorized",
          },
        },
      })
      .where(eq(jobs.id, job.id));
    await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, job.id);
    return true;
  });
  if (settled) await publishClaudeDesignIssue(deps, jobId);
  return settled;
}
