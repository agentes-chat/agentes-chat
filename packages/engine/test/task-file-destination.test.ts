import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import * as Y from "yjs";
import { askAgentToImplement, createArtifact, createIssue, setFileSharing, updateArtifact } from "../src";
import { appendChanges } from "../src/live/store";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => f?.close());

async function privateWork(kind: "table" | "document" = "table") {
  f = await setup();
  const outsider = await addMember(f.db, f.org.id, "member", "outsider");
  const task = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
    title: "Private delivery",
    audience: { mode: "people", userIds: [f.owner.id] },
  });
  await askAgentToImplement({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, task.id, f.agent.id);
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, task.id));
  if (!run) throw new Error("The private task did not start");
  const actor = { type: "agent" as const, agentId: f.agent.id, channelId: run.channelId, runId: run.id };
  const file = await createArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
    title: "Private draft",
    channelId: run.channelId,
    content: kind === "document" ? { kind, markdown: "Original" } : { kind, columns: ["Text"], rows: [["Original"]] },
  });
  return { actor, file, outsider };
}

test("a private task can edit a people-shared file when every effective reader can see the task", async () => {
  const { actor, file } = await privateWork();
  await setFileSharing(f.artifactDeps, f.owner.id, f.org.id, file.id, { mode: "people", userIds: [f.owner.id] });
  const updated = await updateArtifact(f.artifactDeps, actor, f.org.id, file.id, {
    baseVersion: 1,
    content: { kind: "table", columns: ["Text"], rows: [["Private revision"]] },
  });
  expect(updated.version).toBe(2);
});

test("a private task cannot edit a people-shared file with a reader outside its audience", async () => {
  const { actor, file, outsider } = await privateWork();
  await setFileSharing(f.artifactDeps, f.owner.id, f.org.id, file.id, { mode: "people", userIds: [outsider.id] });
  await expect(
    updateArtifact(f.artifactDeps, actor, f.org.id, file.id, {
      baseVersion: 1,
      content: { kind: "table", columns: ["Text"], rows: [["Private revision"]] },
    }),
  ).rejects.toMatchObject({ code: "issue.task_destination_private" });
  const [saved] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, file.id));
  expect(saved?.currentVersion).toBe(1);
});

test("a private task still cannot publish a new version to the shared Drive", async () => {
  const { actor } = await privateWork();
  const file = await createArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
    title: "Shared document",
    content: { kind: "table", columns: ["Text"], rows: [["Public original"]] },
  });
  await expect(
    updateArtifact(f.artifactDeps, actor, f.org.id, file.id, {
      baseVersion: 1,
      content: { kind: "table", columns: ["Text"], rows: [["Private revision"]] },
    }),
  ).rejects.toMatchObject({ code: "issue.task_destination_private" });
});

test("a sharing change during blob storage is revalidated before a private version becomes visible", async () => {
  const { actor, file } = await privateWork();
  let reached!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const continueWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.artifactDeps.blobs;
  const held = {
    ...f.artifactDeps,
    blobs: {
      forConfig: original.forConfig,
      forOrg: async (orgId: string) => {
        const location = await original.forOrg(orgId);
        return {
          ...location,
          store: {
            ...location.store,
            put: async (...args: Parameters<typeof location.store.put>) => {
              reached();
              await continueWrite;
              return location.store.put(...args);
            },
          },
        };
      },
    },
  };
  const updating = updateArtifact(held, actor, f.org.id, file.id, {
    baseVersion: 1,
    content: { kind: "table", columns: ["Text"], rows: [["Private revision"]] },
  });
  await writing;
  await setFileSharing(f.artifactDeps, f.owner.id, f.org.id, file.id, { mode: "everyone" });
  release();
  await expect(updating).rejects.toMatchObject({ code: "issue.task_destination_private" });
  const [saved] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, file.id));
  expect(saved?.currentVersion).toBe(1);
});

for (const allowed of [true, false]) {
  test(`a live document's task updates ${allowed ? "reach authorized readers" : "never reach a reader outside the task"}`, async () => {
    const { actor, file, outsider } = await privateWork("document");
    await setFileSharing(f.artifactDeps, f.owner.id, f.org.id, file.id, {
      mode: "people",
      userIds: [allowed ? f.owner.id : outsider.id],
    });
    const doc = new Y.Doc();
    doc.getMap("private-test").set("finding", "Private revision");
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    const saving = appendChanges(
      f.db,
      f.org.id,
      file.id,
      [
        {
          update,
          actor: { type: "agent", id: actor.agentId, runId: actor.runId },
        },
      ],
      new Date(),
    );
    if (allowed) expect((await saving).headSeq).toBe(1);
    else await expect(saving).rejects.toMatchObject({ code: "issue.task_destination_private" });
    const updates = await f.db
      .select()
      .from(schema.liveDocUpdates)
      .where(eq(schema.liveDocUpdates.artifactId, file.id));
    expect(updates).toHaveLength(allowed ? 1 : 0);
    const [head] = await f.db.select().from(schema.liveDocs).where(eq(schema.liveDocs.artifactId, file.id));
    expect(head?.headSeq).toBe(allowed ? 1 : 0);
  });
}
