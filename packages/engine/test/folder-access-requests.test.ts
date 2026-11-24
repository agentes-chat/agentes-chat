import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { allowFolderCommand, createOrganization, ForbiddenError, listFolderAccessRequests } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

async function seed() {
  f = await setup();
  const id = Bun.randomUUIDv7();
  await f.db.insert(schema.machines).values({
    id,
    orgId: f.org.id,
    name: "Test computer",
    pairedByUserId: f.owner.id,
    executors: { mode: "system" },
  });
  const requestId = Bun.randomUUIDv7();
  await f.db.insert(schema.machineAccessRequests).values({
    id: requestId,
    orgId: f.org.id,
    agentId: f.agent.id,
    machineId: id,
    channelId: f.general.id,
    path: "/home/test/Project's docs",
    reason: "Read the project",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { id, requestId };
}

test("folder requests are read-only views, scoped to the org, machine and conversations the reader can see", async () => {
  const { id, requestId } = await seed();
  const rows = await listFolderAccessRequests(f.db, f.owner.id, f.org.id, id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: requestId,
    status: "pending",
    reason: "Read the project",
    command: "sudo agentes-runner folders allow '/home/test/Project'\\''s docs' --agent dev",
  });
  const other = await addMember(f.db, f.org.id, "member", "reader");
  await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: f.general.id, userId: other.id });
  await expect(listFolderAccessRequests(f.db, other.id, f.org.id, id)).rejects.toThrow(ForbiddenError);
  expect(await listFolderAccessRequests(f.db, other.id, f.org.id, id, requestId)).toHaveLength(1);

  const outsider = await addMember(f.db, f.org.id, "member", "outside");
  expect(await listFolderAccessRequests(f.db, outsider.id, f.org.id, id, requestId)).toEqual([]);
  const anotherOrg = await createOrganization(f.db, f.owner.id, { name: "Other workspace" });
  await expect(listFolderAccessRequests(f.db, f.owner.id, anotherOrg.organization.id, id)).rejects.toThrow(
    "Computer not found",
  );
  expect((await f.db.select().from(schema.machineAccessRequests))[0]?.status).toBe("pending");
});

test("a computer's manager cannot read another person's DM or enumerate another machine's requests", async () => {
  const { id, requestId } = await seed();
  const member = await addMember(f.db, f.org.id, "member", "private");
  const channelId = Bun.randomUUIDv7();
  await f.db.insert(schema.channels).values({
    id: channelId,
    orgId: f.org.id,
    name: "Private DM",
    kind: "dm",
    visibility: "private",
  });
  await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId, userId: member.id });
  await f.db
    .update(schema.machineAccessRequests)
    .set({ channelId })
    .where(eq(schema.machineAccessRequests.id, requestId));
  expect(await listFolderAccessRequests(f.db, f.owner.id, f.org.id, id)).toEqual([]);
  expect(await listFolderAccessRequests(f.db, f.owner.id, f.org.id, id, requestId)).toEqual([]);
  expect(await listFolderAccessRequests(f.db, member.id, f.org.id, id, requestId)).toHaveLength(1);
  const another = Bun.randomUUIDv7();
  await f.db
    .insert(schema.machines)
    .values({ id: another, orgId: f.org.id, name: "Other", pairedByUserId: f.owner.id });
  expect(await listFolderAccessRequests(f.db, f.owner.id, f.org.id, another, requestId)).toEqual([]);
});

test("expiry is visible while offline without changing stored decisions, and old cards can fetch their exact request", async () => {
  const { id, requestId } = await seed();
  await f.db
    .update(schema.machineAccessRequests)
    .set({
      expiresAt: new Date(Date.now() - 1000),
    })
    .where(eq(schema.machineAccessRequests.id, requestId));
  expect((await listFolderAccessRequests(f.db, f.owner.id, f.org.id, id, requestId))[0]?.status).toBe("expired");
  expect((await f.db.select().from(schema.machineAccessRequests))[0]?.status).toBe("pending");
  for (const status of ["granted", "denied", "failed"]) {
    await f.db
      .update(schema.machineAccessRequests)
      .set({ status })
      .where(eq(schema.machineAccessRequests.id, requestId));
    expect((await listFolderAccessRequests(f.db, f.owner.id, f.org.id, id, requestId))[0]?.status).toBe(status);
  }
});

test("local commands quote paths and handles as arguments, not shell instructions", () => {
  expect(allowFolderCommand("/srv/site", "dev")).toBe("agentes-runner folders allow /srv/site --agent dev");
  const path = "/srv/$(printf injected); 'a'";
  const handle = "dev; echo nope";
  const command = allowFolderCommand(path, handle);
  const result = Bun.spawnSync(["bash", "-c", `agentes-runner() { printf '%s\\n' "$@"; }; ${command}`]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim().split("\n")).toEqual(["folders", "allow", path, "--agent", handle]);
});
