import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

/** A workspace's risk tolerance over the API (ADR 0181): on its settings, and an agent's own on the agent. */

let t: TestServer;
afterEach(() => t.close());

type Agent = { id: string; unaskedRisks: string[] | null };
type Settings = { unaskedRisks: string[] };

test("the workspace's risk tolerance: empty by default, set by admins, an agent's own by who manages agents", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const org = `/api/app/organizations/${orgId}`;

  expect(((await (await owner(`${org}/settings`)).json()) as Settings).unaskedRisks).toEqual([]);
  const saved = await owner(`${org}/settings`, { method: "PATCH", json: { unaskedRisks: ["deploys", "deletes"] } });
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as Settings).unaskedRisks).toEqual(["deletes", "deploys"]);
  expect(((await (await bia(`${org}/settings`)).json()) as Settings).unaskedRisks).toEqual(["deletes", "deploys"]);
  expect((await bia(`${org}/settings`, { method: "PATCH", json: { unaskedRisks: [] } })).status).toBe(403);
  expect((await owner(`${org}/settings`, { method: "PATCH", json: { unaskedRisks: ["everything"] } })).status).toBe(
    400,
  );

  const created = (await (await owner(`${org}/agents`, { json: { name: "Ada", handle: "ada" } })).json()) as Agent;
  expect(created.unaskedRisks).toBeNull();
  const own = await owner(`${org}/agents/${created.id}`, { method: "PATCH", json: { unaskedRisks: ["spends_money"] } });
  expect(((await own.json()) as Agent).unaskedRisks).toEqual(["spends_money"]);
  expect(
    (await bia(`${org}/agents/${created.id}`, { method: "PATCH", json: { unaskedRisks: ["deletes"] } })).status,
  ).toBe(403);
  const back = await owner(`${org}/agents/${created.id}`, { method: "PATCH", json: { unaskedRisks: null } });
  expect(((await back.json()) as Agent).unaskedRisks).toBeNull();

  const doc = (await (await owner("/api/openapi.json")).json()) as {
    components: { schemas: Record<string, { enum?: string[] }> };
  };
  expect(doc.components.schemas.RiskClass?.enum).toEqual([
    "deletes",
    "spends_money",
    "reaches_people",
    "shares_outside",
    "replaces_data",
    "deploys",
  ]);
});
