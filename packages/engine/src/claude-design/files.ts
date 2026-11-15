import { type ClaudeDesignResult, parseClaudeDesignResult } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import { createArtifact } from "../artifacts";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { createUpload, getUpload } from "../uploads";
import { publishClaudeDesignIssue, syncClaudeDesignIssue } from "./board";
import { designReplyThreadId } from "./delivery";
import { hasConfirmedDesignContent } from "./publication";
import type { ClaudeDesignServiceDeps } from "./service";

const { claudeDesignJobs: jobs, claudeDesignArtifacts: designs } = schema;
const manifest = (r: ClaudeDesignResult | null) =>
  JSON.stringify(r?.sourceFiles.map((f) => [f.relativePath, f.sha256, f.size, f.contentType]));
/** Imports only the manifest journaled by the authorized native task. Never invokes the model or republishes. */
export async function storeClaudeDesignFiles(
  deps: ClaudeDesignServiceDeps,
  jobId: string,
  raw: ClaudeDesignResult,
): Promise<{ artifactIds: string[] }> {
  const result = parseClaudeDesignResult(raw);
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || !result || result.jobId !== job.id) throw new NotFoundError();
  const saved = parseClaudeDesignResult(job.result);
  if (job.state === "succeeded") {
    const [d] = await deps.db.select().from(designs).where(eq(designs.id, job.designId));
    return { artifactIds: d?.artifactIds ?? [] };
  }
  try {
    if (
      job.state !== "published" ||
      !hasConfirmedDesignContent(job, saved) ||
      !job.sourceTaskId ||
      !result.remote ||
      !saved?.remote ||
      result.remote.version !== saved.remote.version ||
      result.remote.url !== saved.remote.url ||
      manifest(result) !== manifest(saved) ||
      !result.sourceFiles.length
    )
      throw new ValidationError("Published sources are incomplete");
    const [agent] = await deps.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, job.orgId), eq(schema.agents.id, job.agentId)));
    if (!agent) throw new NotFoundError();
    const artifactIds: string[] = [];
    const replyThreadId = await designReplyThreadId(deps.db, job);
    for (const file of result.sourceFiles) {
      const upload = await deps.db.transaction(async (tx) => {
        const [live] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
        if (
          !live ||
          live.sourceTaskId !== job.sourceTaskId ||
          manifest(parseClaudeDesignResult(live.result)) !== manifest(result)
        )
          throw new ConflictError("Design sources changed");
        const key = `${job.sourceTaskId}:${file.relativePath}`;
        const entry = live.fileImports[key];
        let existing = entry && entry.sha256 === file.sha256 ? await getUpload(tx, entry.uploadId) : null;
        if (
          existing &&
          (existing.status === "failed" ||
            (existing.status === "pending" && existing.expiresAt.getTime() <= Date.now()))
        )
          existing = null;
        if (existing) return existing;
        const row = await createUpload(tx, {
          orgId: job.orgId,
          agentId: job.agentId,
          channelId: job.channelId,
          threadId: replyThreadId,
          computer: `machine:${job.machineId}`,
          machineId: job.machineId,
          path: `designs/${job.sourceTaskId}/work/${file.relativePath}`,
          maxBytes: file.size,
          expectedSha256: file.sha256,
          title: `${job.title} — ${file.relativePath.split("/").pop()}`,
        });
        await tx
          .update(jobs)
          .set({ fileImports: { ...live.fileImports, [key]: { sha256: file.sha256, uploadId: row.id } } })
          .where(eq(jobs.id, job.id));
        return row;
      });
      if (upload.status !== "done") {
        try {
          await deps.hub.call(job.machineId, {
            op: "push",
            agent: { id: agent.id, handle: agent.handle },
            path: upload.path,
            url: `${deps.publicUrl.replace(/\/$/, "")}/api/machines/uploads/${upload.id}`,
            uploadId: upload.id,
            maxBytes: file.size,
            claudeDesignSource: {
              taskId: job.sourceTaskId,
              relativePath: file.relativePath,
              sha256: file.sha256,
              size: file.size,
            },
          });
        } catch {
          const landed = await getUpload(deps.db, upload.id);
          if (landed?.status !== "done") throw new Error("Design source transfer unavailable");
        }
      }
      const done = await getUpload(deps.db, upload.id);
      if (done?.status !== "done" || !done.artifactId) throw new Error("Design source transfer incomplete");
      artifactIds.push(done.artifactId);
    }
    const location = await deps.artifacts.blobs.forOrg(job.orgId);
    const stored = await deps.db.transaction(async (tx) => {
      const [live] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      if (
        !live ||
        live.sourceTaskId !== job.sourceTaskId ||
        !hasConfirmedDesignContent(live, parseClaudeDesignResult(live.result)) ||
        parseClaudeDesignResult(live.result)?.remote?.version !== result.remote?.version
      )
        throw new ConflictError("Design sources changed");
      if (!live.referenceArtifactId) {
        const reference = await createArtifact(
          {
            ...deps.artifacts,
            db: tx,
            blobs: { ...deps.artifacts.blobs, forOrg: async () => location },
            pubsub: undefined,
          },
          { type: "agent", agentId: job.agentId, channelId: job.channelId, threadId: replyThreadId },
          job.orgId,
          {
            title: job.title,
            content: {
              kind: "document",
              markdown: `[Open in Claude](${result.remote?.url})\n\nOpening this design requires access in the Claude account that owns it. The attached files are source snapshots; this app does not run them.\n\nVersion: ${result.remote?.version}`,
            },
          },
        );
        live.referenceArtifactId = reference.id;
      }
      const ids = [live.referenceArtifactId, ...artifactIds];
      await tx
        .update(designs)
        .set({ artifactIds: ids, updatedAt: new Date() })
        .where(and(eq(designs.orgId, job.orgId), eq(designs.id, job.designId), eq(designs.lastJobId, job.id)));
      await tx
        .update(jobs)
        .set({
          referenceArtifactId: live.referenceArtifactId,
          state: "succeeded",
          result: { ...saved, state: "succeeded", error: undefined },
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      await syncClaudeDesignIssue({ ...deps, db: tx, pubsub: undefined }, job.id);
      return { artifactIds: ids };
    });
    await publishClaudeDesignIssue(deps, job.id);
    return stored;
  } catch (error) {
    await deps.db
      .update(jobs)
      .set({
        result: {
          ...saved,
          state: "published",
          error: {
            code: "sources_incomplete",
            message: "The design is published; its source files still need to be imported",
          },
        },
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.state, "published")));
    throw error;
  }
}
