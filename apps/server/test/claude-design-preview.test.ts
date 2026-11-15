import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { MachineRequest } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  artifactFile,
  getArtifact,
  receiveMachineUpload,
  reserveClaudeDesignJob,
  setClaudeDesignGrant,
} from "@agenteschat/engine";
import { storeClaudeDesignFiles } from "../../../packages/engine/src/claude-design/files";
import { designJobView, recordClaudeDesignResult } from "../../../packages/engine/src/claude-design/ledger";
import { type DesignFixture, designFixture } from "../../../packages/engine/test/claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
test("real task-bound sources expose exact stored versions and canonical metadata for secondary downloads", async () => {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const view = await reserveClaudeDesignJob(f.designDeps, f.ctx, {
    action: "create",
    title: "Preview",
    brief: "Preview",
    sourceArtifactIds: [],
  });
  const [job] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, view.id));
  if (!job) throw Error("No job");
  const inputs = [
    {
      relativePath: "project/canvas.json",
      contentType: "application/json",
      text: JSON.stringify({
        v: 3,
        boards: { "sample.dc.html": { w: 480, h: 320, title: "Status" } },
        order: ["sample.dc.html"],
      }),
    },
    { relativePath: "project/sample.dc.html", contentType: "text/html", text: "<div>Real imported layout</div>" },
    { relativePath: "project/unused.css", contentType: "text/css", text: "body{margin:0}" },
  ].map((file) => ({
    ...file,
    bytes: Buffer.from(file.text),
    sha256: createHash("sha256").update(file.text).digest("hex"),
  }));
  const result = {
    jobId: job.id,
    state: "published" as const,
    publicationSequence: 2,
    remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "opaque" },
    sourceFiles: inputs.map((file) => ({
      relativePath: file.relativePath,
      contentType: file.contentType,
      sha256: file.sha256,
      size: file.bytes.length,
    })),
  };
  await recordClaudeDesignResult(f.designDeps, job.taskId, result);
  await storeClaudeDesignFiles(
    {
      ...f.designDeps,
      artifacts: f.artifactDeps,
      publicUrl: "https://example.invalid",
      hub: {
        status: async () => null,
        call: async (_machine: string, request: MachineRequest) => {
          if (request.op !== "push" || !request.claudeDesignSource) throw Error("Expected source transfer");
          const file = inputs.find((input) => input.relativePath === request.claudeDesignSource?.relativePath);
          if (!file) throw Error("Unknown source");
          await receiveMachineUpload(
            { db: f.db, artifacts: f.artifactDeps, pubsub: f.pubsub },
            {
              uploadId: request.uploadId,
              machineId: f.machineId,
              name: file.relativePath.split("/").pop()!,
              body: file.bytes,
              sha256: file.sha256,
              contentType: file.contentType,
            },
          );
          return {
            sha256: file.sha256,
            size: file.bytes.length,
            name: file.relativePath,
            contentType: file.contentType,
          } as never;
        },
      },
    },
    job.id,
    result,
  );
  const [saved] = await f.db.select().from(schema.claudeDesignJobs).where(eq(schema.claudeDesignJobs.id, job.id));
  if (!saved) throw Error("No saved job");
  const completed = await designJobView(f.db, saved);
  if (!completed.preview) throw Error("No verified preview");
  const texts: string[] = [];
  for (const source of completed.preview.files) {
    const artifact = await getArtifact(
      f.artifactDeps,
      { type: "person", userId: f.owner.id },
      f.org.id,
      source.artifactId,
      source.version,
    );
    expect(artifact.shownVersion).toBe(source.version);
    expect(artifact.content).toMatchObject({
      kind: "file",
      contentType: source.contentType,
      sha256: source.sha256,
      size: source.size,
    });
    const file = await artifactFile(f.artifactDeps, f.owner.id, f.org.id, source.artifactId, {
      version: source.version,
    });
    expect(file.body.byteLength).toBe(source.size);
    texts.push(Buffer.from(file.body).toString("utf8"));
  }
  expect(texts.some((text) => text.includes("Real imported layout"))).toBe(true);
  expect(completed.preview.files.map((file) => file.contentType)).toEqual([
    "application/json",
    "text/html; charset=utf-8",
    "text/plain; charset=utf-8",
  ]);
});
