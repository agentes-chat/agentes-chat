import { afterEach, beforeEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ reply: () => ({ chunks: ["Ok."] }) });
});
afterEach(() => t.close());

test("a channel's dashboard (ADR 0135 §21): its manager links one through PATCH, every member reads it in the list", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  const channel = ((await (await api("/channels", { json: { name: "vendas" } })).json()) as { id: string }).id;
  const board = (await (
    await api("/dashboards", { json: { title: "Vendas", audience: "workspace", editPolicy: "owner" } })
  ).json()) as { id: string };

  const linked = await api(`/channels/${channel}`, { method: "PATCH", json: { dashboardId: board.id } });
  expect(linked.status).toBe(200);
  expect(((await linked.json()) as { dashboardId: string | null }).dashboardId).toBe(board.id);

  const member = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const asMember = (path: string, init?: Parameters<typeof member>[1]) =>
    member(`/api/app/organizations/${orgId}${path}`, init);
  const list = (await (await asMember("/channels")).json()) as { channels: { id: string; dashboardId: string }[] };
  expect(list.channels.find((c) => c.id === channel)?.dashboardId).toBe(board.id);
  // Not hers to change: the same rule as the channel's name and topic.
  expect((await asMember(`/channels/${channel}`, { method: "PATCH", json: { dashboardId: null } })).status).toBe(403);

  // A board she can't see doesn't link, and the id must be a board's.
  expect((await api(`/channels/${channel}`, { method: "PATCH", json: { dashboardId: "x" } })).status).toBe(400);
  const missing = await api(`/channels/${channel}`, {
    method: "PATCH",
    json: { dashboardId: crypto.randomUUID() },
  });
  expect(missing.status).toBe(404);

  const unlinked = await api(`/channels/${channel}`, { method: "PATCH", json: { dashboardId: null } });
  expect(((await unlinked.json()) as { dashboardId: string | null }).dashboardId).toBeNull();
});
