import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

type Overview = { support: { available: boolean; reason: string | null } };
type CasesResponse = { cases: { id: string; situation: string; expectation: string }[] };
type RunResponse = { run: { id: string; status: string } };

let t: TestServer;
afterEach(async () => t?.close());
const item = { id: "first", situation: "Explain refunds", expectation: "Mention the 30-day limit" };

test("instruction test routes persist examples and queue, cancel and remove comparisons", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const callsBefore = t.provider.calls.length;
  const path = `/api/app/organizations/${orgId}/agents/${agentId}`;
  const overview = await owner(`${path}/instruction-tests`);
  expect(overview.status).toBe(200);
  expect(((await overview.json()) as Overview).support.available).toBe(true);
  const save = await owner(`${path}/instruction-test-cases`, { method: "PUT", json: { cases: [item] } });
  expect(save.status).toBe(200);
  expect(((await save.json()) as CasesResponse).cases).toEqual([item]);
  const queued = await owner(`${path}/instruction-tests`, {
    json: { baseInstructions: "", candidateInstructions: "Be concise.", cases: [item] },
  });
  expect(queued.status).toBe(201);
  const { run } = (await queued.json()) as RunResponse;
  expect(run.status).toBe("queued");
  expect(JSON.stringify(run)).not.toContain("credentialId");
  expect(JSON.stringify(run)).not.toContain("snapshot");
  expect((await owner(`${path}/instruction-tests/${run.id}`)).status).toBe(200);
  const stop = await owner(`${path}/instruction-tests/${run.id}/cancel`, { method: "POST", json: {} });
  expect(stop.status).toBe(200);
  expect(((await stop.json()) as RunResponse).run.status).toBe("canceled");
  expect((await owner(`${path}/instruction-tests/${run.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await owner(`${path}/instruction-tests/${run.id}`)).status).toBe(404);
  expect(t.provider.calls).toHaveLength(callsBefore);
});

test("test cases and outputs cannot be accessed by a member or another workspace", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const member = await joinByInvitation(t, owner, orgId, "member@example.com");
  const path = `/api/app/organizations/${orgId}/agents/${agentId}`;
  expect((await member(`${path}/instruction-tests`)).status).toBe(403);
  expect((await member(`${path}/instruction-test-cases`, { method: "PUT", json: { cases: [item] } })).status).toBe(403);
  const [second] = await t.db.insert(schema.organizations).values({ name: "Other workspace" }).returning();
  if (!second) throw new Error("Fixture workspace not created");
  const secondId = second.id;
  expect(secondId).not.toBe(orgId);
  expect((await owner(`/api/app/organizations/${secondId}/agents/${agentId}/instruction-tests`)).status).toBe(403);
  const [user] = await t.db.select().from(schema.users).where(eq(schema.users.email, "owner@example.com"));
  if (!user) throw new Error("Fixture owner missing");
  await t.db.insert(schema.organizationMembers).values({ orgId: secondId, userId: user.id, role: "owner" });
  expect((await owner(`/api/app/organizations/${secondId}/agents/${agentId}/instruction-tests`)).status).toBe(404);
});

test("subscription brains expose a stable explanation and reject API fallback", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const callsBefore = t.provider.calls.length;
  await t.db
    .update(schema.agents)
    .set({ brain: "claude_code", brainModel: "sonnet" })
    .where(eq(schema.agents.id, agentId));
  const path = `/api/app/organizations/${orgId}/agents/${agentId}/instruction-tests`;
  const overview = await owner(path);
  expect(((await overview.json()) as Overview).support).toMatchObject({
    available: false,
    reason: "instructionTests.planUnavailable",
  });
  const refused = await owner(path, {
    json: { baseInstructions: "", candidateInstructions: "Be concise", cases: [item] },
  });
  expect(refused.status).toBe(400);
  expect(t.provider.calls).toHaveLength(callsBefore);
});
