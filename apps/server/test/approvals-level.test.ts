import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

/** An agent's approvals level over the API (ADR 0173): on the agent, changed by who manages agents. */

let t: TestServer;
afterEach(() => t.close());

type Agent = { id: string; approvalsLevel: string };

test("an agent's approvals level: risky when made, changed by PATCH, never by a member, in the OpenAPI document", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const org = `/api/app/organizations/${orgId}`;
  const created = (await (await owner(`${org}/agents`, { json: { name: "Ada", handle: "ada" } })).json()) as Agent;
  expect(created.approvalsLevel).toBe("risky");

  const patched = await owner(`${org}/agents/${created.id}`, { method: "PATCH", json: { approvalsLevel: "never" } });
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as Agent).approvalsLevel).toBe("never");
  const list = (await (await owner(`${org}/agents`)).json()) as { agents: Agent[] };
  expect(list.agents.find((a) => a.id === created.id)?.approvalsLevel).toBe("never");

  expect(
    (await owner(`${org}/agents/${created.id}`, { method: "PATCH", json: { approvalsLevel: "sometimes" } })).status,
  ).toBe(400);
  expect(
    (await bia(`${org}/agents/${created.id}`, { method: "PATCH", json: { approvalsLevel: "always" } })).status,
  ).toBe(403);
  const after = (await (await owner(`${org}/agents`)).json()) as { agents: Agent[] };
  expect(after.agents.find((a) => a.id === created.id)?.approvalsLevel).toBe("never");

  const doc = (await (await owner("/api/openapi.json")).json()) as {
    components: { schemas: Record<string, { enum?: string[] }> };
  };
  expect(doc.components.schemas.ApprovalsLevel?.enum).toEqual(["always", "risky", "never"]);
});
