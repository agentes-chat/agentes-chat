import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(() => t?.close());
test("task links API reads both directions and removes from either endpoint", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const root = `/api/app/organizations/${orgId}/issues`;
  const a = (await (await owner(root, { json: { title: "A" } })).json()) as { id: string };
  const b = (await (await owner(root, { json: { title: "B" } })).json()) as { id: string };
  const add = await owner(`${root}/${a.id}/links`, { json: { toIssueId: b.id, type: "blocks" } });
  expect(add.status).toBe(200);
  const links = (await add.json()) as { id: string }[];
  const link = links[0];
  if (!link) throw new Error("Missing link");
  expect(await (await owner(`${root}/${b.id}/links`)).json()).toMatchObject([{ incoming: true, task: { id: a.id } }]);
  expect((await owner(`${root}/${a.id}/links`, { json: { toIssueId: b.id, type: "blocks" } })).status).toBe(409);
  expect((await owner(`${root}/${b.id}/links`, { method: "DELETE", json: { id: link.id } })).status).toBe(200);
  expect(await (await owner(`${root}/${a.id}/links`)).json()).toEqual([]);
  expect((await browser(t)(`${root}/${a.id}/links`)).status).toBe(401);
});
