import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, isNull, rowsOf, schema, sql } from "@agenteschat/db";
import {
  createFileArtifact,
  drainOutbox,
  enqueueWaitingResets,
  ORG_RESET_JOB,
  postPersonMessage,
  RESET_ERASES,
  RESET_KEEPS,
  RESET_TOMBSTONES,
  requestReset,
  resetWorkspace,
  scheduleDeletion,
  setDeletionHold,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

const count = async (table: string, orgId = f.org.id) =>
  Number(
    rowsOf<{ n: number }>(
      await f.db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where org_id = ${orgId}::uuid`),
    )[0]?.n,
  );

const resetDeps = () => ({ db: f.db, pubsub: f.pubsub, artifacts: f.artifactDeps, blobs: f.artifactDeps.blobs });

describe("workspace reset", () => {
  test("every tenant table is kept, tombstoned or erased, once", async () => {
    f = await setup();
    const tables = rowsOf<{ name: string }>(
      await f.db.execute(sql`
        select distinct c.table_name as name from information_schema.columns c
        join information_schema.tables t on t.table_name = c.table_name and t.table_schema = 'public'
        where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
          and c.table_name not like 'messages\\_%'`),
    ).map((r) => r.name);
    const listed: string[] = [...RESET_KEEPS, ...RESET_TOMBSTONES, ...RESET_ERASES];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...tables].sort());
  });

  test("keeps the workspace, its people, AI accounts and usage, and starts it over", async () => {
    f = await setup({ rightHand: true });
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body: "oi" });
    const file = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "notes.txt",
      name: "notes.txt",
      bytes: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      channelId: null,
    });
    await f.db.insert(schema.usageRecords).values({
      orgId: f.org.id,
      agentId: f.agent.id,
      credentialId: f.credential.id,
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      requestedModel: "claude-sonnet-5-5",
      inputTokens: 10,
      outputTokens: 0,
      costNanoUsd: 5,
    });
    const stored = [...f.platformBlobs.objects.keys()];
    expect(stored.length).toBeGreaterThan(0);

    const { started } = await requestReset(f.db, f.owner.id, f.org.id);
    expect(started).toBe(true);
    await drainOutbox(f.db, f.handlers);

    const [org] = await f.db.select().from(schema.organizations).where(eq(schema.organizations.id, f.org.id));
    expect(org?.name).toBe("Acme");
    expect(org?.resetRequestedAt).toBeNull();
    expect(org?.onboardedAt).toBeNull();
    expect(org?.onboardingStep).toBe("context");
    expect(await count("organization_members")).toBe(2);
    expect(await count("provider_credentials")).toBe(1);
    expect(await count("usage_records")).toBe(1);
    expect(await count("artifacts")).toBe(0);
    expect(await count("artifact_versions")).toBe(0);
    for (const key of stored) expect(f.platformBlobs.objects.has(key)).toBe(false);
    expect(file.id).toBeTruthy();

    const live = await f.db
      .select({ handle: schema.agents.handle, builtin: schema.agents.builtin })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, f.org.id), isNull(schema.agents.deletedAt)));
    expect(live).toEqual([{ handle: "lodi", builtin: "right_hand" }]);
    const [dev] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
    expect(dev?.deletedAt).not.toBeNull();

    const channels = await f.db.select().from(schema.channels).where(eq(schema.channels.orgId, f.org.id));
    expect(channels.map((c) => c.name)).toEqual(["general"]);
    expect(channels[0]?.createdByUserId).toBe(f.owner.id);
    const members = await f.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(and(eq(schema.channelMembers.channelId, channels[0]?.id ?? ""), isNull(schema.channelMembers.agentId)));
    expect(members.map((m) => m.userId).sort()).toEqual([f.owner.id, bia.id].sort());
    expect(
      rowsOf<{ n: number }>(
        await f.db.execute(sql`select count(*)::int as n from messages where org_id = ${f.org.id}::uuid`),
      )[0]?.n,
    ).toBe(0);
    const audit = await f.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, f.org.id));
    expect(audit.map((a) => a.action)).toContain("organization.reset");
  });

  test("running it again erases nothing made after it", async () => {
    f = await setup({ rightHand: true });
    await requestReset(f.db, f.owner.id, f.org.id);
    expect(await resetWorkspace(resetDeps(), f.org.id)).toBe(true);
    const [general] = await f.db.select().from(schema.channels).where(eq(schema.channels.orgId, f.org.id));
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, general?.id ?? "", { body: "new" });
    expect(await resetWorkspace(resetDeps(), f.org.id)).toBe(false);
    await drainOutbox(f.db, { [ORG_RESET_JOB]: () => resetWorkspace(resetDeps(), f.org.id).then(() => undefined) });
    expect(await count("channels")).toBe(1);
    expect(
      rowsOf<{ n: number }>(
        await f.db.execute(sql`select count(*)::int as n from messages where org_id = ${f.org.id}::uuid`),
      )[0]?.n,
    ).toBe(1);
  });

  test("only an owner, never while it is being deleted, and once at a time", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "admin", "bia");
    expect(await requestReset(f.db, bia.id, f.org.id).catch((e) => e.code)).toBe("forbidden");
    const first = await requestReset(f.db, f.owner.id, f.org.id);
    const again = await requestReset(f.db, f.owner.id, f.org.id);
    expect(again).toEqual({ startedAt: first.startedAt, started: false });
    await resetWorkspace(resetDeps(), f.org.id);
    await scheduleDeletion({ db: f.db }, f.owner.id, f.org.id, "owner");
    expect(await requestReset(f.db, f.owner.id, f.org.id).catch((e) => e.code)).toBe("org.deleting");
  });

  test("waits while the operator holds the workspace, and the hourly tick takes it once the hold lifts", async () => {
    f = await setup();
    await setDeletionHold(f.db, f.org.id, { held: true, reason: "legal" });
    await requestReset(f.db, f.owner.id, f.org.id);
    expect(await resetWorkspace(resetDeps(), f.org.id)).toBe(false);
    expect(await count("channels")).toBeGreaterThan(0);
    const [held] = await f.db.select().from(schema.organizations).where(eq(schema.organizations.id, f.org.id));
    expect(held?.resetRequestedAt).not.toBeNull();
    const later = new Date(Date.now() + 3600_000);
    expect(await enqueueWaitingResets(f.db, later)).toBe(0);

    await setDeletionHold(f.db, f.org.id, { held: false, reason: null });
    expect(await enqueueWaitingResets(f.db, later)).toBe(1);
    await drainOutbox(f.db, { [ORG_RESET_JOB]: () => resetWorkspace(resetDeps(), f.org.id).then(() => undefined) });
    const [done] = await f.db.select().from(schema.organizations).where(eq(schema.organizations.id, f.org.id));
    expect(done?.resetRequestedAt).toBeNull();
  });
});
