import { afterEach, describe, expect, test } from "bun:test";
import { createMemoryBlobStore } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  AGENT_PHOTO_PATH,
  agentChats,
  agentPhotoFile,
  ForbiddenError,
  getAgent,
  NotFoundError,
  removeAgentPhoto,
  setAgentAppearance,
  setAgentPhoto,
} from "../src";
import { addMember, addUser, type Fixture, setup } from "./fixtures";

// VPS Zen: an agent's photo (agent-photo.ts) and each agent's recent conversations for the sidebar (agent-chats.ts).

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
]);
const image = { imageBase64: Buffer.from(PNG).toString("base64"), contentType: "image/png" };

describe("an agent's photo", () => {
  test("its owner sets it, it stays across a new look, others can't, members read the file, removal keeps the look", async () => {
    f = await setup();
    const blobs = createMemoryBlobStore();
    const deps = { db: f.db, blobs };
    const bia = await addMember(f.db, f.org.id, "member", "bia");

    await expect(setAgentPhoto(deps, bia.id, f.org.id, f.agent.id, image)).rejects.toBeInstanceOf(ForbiddenError);

    const { photo } = await setAgentPhoto(deps, f.owner.id, f.org.id, f.agent.id, image);
    const m = AGENT_PHOTO_PATH.exec(photo);
    expect(m?.[1]).toBe(f.org.id);
    expect(m?.[2]).toBe(f.agent.id);
    expect((await getAgent(f.db, f.org.id, f.agent.id))?.appearance).toMatchObject({ color: "sky", photo });

    // A member reads the file; someone outside the workspace doesn't.
    const file = m?.[3] ?? "";
    expect((await agentPhotoFile(deps, bia.id, f.org.id, f.agent.id, file)).contentType).toBe("image/png");
    const stranger = await addUser(f.db, "zé");
    await expect(agentPhotoFile(deps, stranger.id, f.org.id, f.agent.id, file)).rejects.toBeInstanceOf(NotFoundError);
    await expect(agentPhotoFile(deps, bia.id, f.org.id, f.agent.id, "../x.png")).rejects.toBeInstanceOf(NotFoundError);

    // A new look, or back to the default, keeps the photo.
    const look = { color: "rose", eyes: "happy", accessory: "crown" };
    expect((await setAgentAppearance(f.db, f.owner.id, f.org.id, f.agent.id, look)).appearance as unknown).toEqual({
      ...look,
      photo,
    });
    expect((await setAgentAppearance(f.db, f.owner.id, f.org.id, f.agent.id, null)).appearance).toMatchObject({
      photo,
    });

    await setAgentAppearance(f.db, f.owner.id, f.org.id, f.agent.id, look);
    await removeAgentPhoto(deps, f.owner.id, f.org.id, f.agent.id);
    expect((await getAgent(f.db, f.org.id, f.agent.id))?.appearance).toEqual(look);
    expect(await blobs.get(`agent-photos/${f.org.id}/${f.agent.id}/${file}`)).toBeNull();
    const audit = await f.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, f.org.id), eq(schema.auditLog.targetId, f.agent.id)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["agent.photo_changed", "agent.photo_removed"]));
  });
});

describe("each agent's recent conversations", () => {
  test("where it spoke, latest first, its last line, only where the viewer reads", async () => {
    f = await setup();
    const say = async (channelId: string, body: string, at: Date, meta: Record<string, unknown> = {}) =>
      f.db.insert(schema.messages).values({
        orgId: f.org.id,
        channelId,
        authorType: "agent",
        authorAgentId: f.agent.id,
        body,
        meta,
        hop: 1,
        createdAt: at,
      });
    const [secret] = await f.db
      .insert(schema.channels)
      .values({ orgId: f.org.id, name: "secret", visibility: "private" })
      .returning();
    if (!secret) throw new Error("no channel");
    const t0 = Date.now();
    await say(f.general.id, "first", new Date(t0 - 60_000));
    await say(f.general.id, "  latest\n words ", new Date(t0 - 30_000));
    await say(secret.id, "hidden", new Date(t0 - 10_000));
    await say(f.general.id, "too old", new Date(t0 - 20 * 86_400_000));

    // An administrator reads every channel (ADR 0151): both, latest first, the old one left out.
    const chats = await agentChats(f.db, f.owner.id, f.org.id);
    expect(chats.map((c) => c.channelId)).toEqual([secret.id, f.general.id]);
    expect(chats[1]).toMatchObject({ agentId: f.agent.id, name: "general", preview: "latest words" });
    // A member sees only where they are.
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    expect((await agentChats(f.db, bia.id, f.org.id)).map((c) => c.channelId)).not.toContain(secret.id);
    await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: secret.id, userId: bia.id });
    expect((await agentChats(f.db, bia.id, f.org.id)).map((c) => c.channelId)).toContain(secret.id);
  });
});
