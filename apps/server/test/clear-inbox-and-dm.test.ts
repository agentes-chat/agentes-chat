import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { notify } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(() => t?.close());

interface Item {
  id: string;
  kind: string;
  waiting: boolean;
  doneAt: string | null;
}
interface Page {
  items: Item[];
  counts: Record<string, number>;
}
interface Msg {
  body: string;
  authorType: string;
}
interface Dm {
  channelId: string;
  with: { type: string; id: string };
  lastMessage: { body: string } | null;
  unread: number;
}

async function signedIn() {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const seeded = await seedOrg(owner);
  const me = (await (await owner("/api/app/me")).json()) as { user: { id: string } };
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${seeded.orgId}${path}`, init);
  return { owner, api, userId: me.user.id, ...seeded };
}

test("Concluir todas: everything in the filter leaves the inbox for Concluídas, but what waits on me stays", async () => {
  t = await createTestServer({ reply: () => ({ chunks: ["ok"] }) });
  const { api, orgId, userId, agentId } = await signedIn();
  const deps = { db: t.db, pubsub: t.adapters.pubsub };
  for (const key of ["a", "b", "c"])
    await notify(deps, {
      orgId,
      userIds: [userId],
      kind: "dm",
      groupKey: `dm:${key}`,
      actor: { type: "agent", id: agentId },
      source: { label: key },
    });
  await notify(deps, {
    orgId,
    userIds: [userId],
    kind: "agent_question",
    groupKey: "question:q1",
    waiting: true,
    actor: { type: "agent", id: agentId },
    source: { label: "q1" },
  });
  expect(((await (await api("/notifications")).json()) as Page).counts.all).toBe(4);

  // Nothing to conclude in "Esperando" or "Concluídas".
  expect(await (await api("/notifications/done-all", { json: { filter: "waiting" } })).json()).toEqual({ ids: [] });
  expect(await (await api("/notifications/done-all", { json: { filter: "done" } })).json()).toEqual({ ids: [] });

  const res = await api("/notifications/done-all", { json: {} });
  expect(res.status).toBe(200);
  const { ids } = (await res.json()) as { ids: string[] };
  expect(ids).toHaveLength(3);
  const left = (await (await api("/notifications")).json()) as Page;
  expect(left.items.map((i) => i.kind)).toEqual(["agent_question"]);
  expect(await (await api("/notifications/count")).json()).toEqual({ unread: 1, waiting: 1 });
  const done = (await (await api("/notifications?filter=done")).json()) as Page;
  expect(done.items.map((i) => i.id).sort()).toEqual([...ids].sort());

  // The undo is each one's own "Mover de volta".
  const back = await api(`/notifications/${ids[0]}/done`, { json: { done: false } });
  expect(((await back.json()) as Item).doneAt).toBeNull();
  expect(((await (await api("/notifications")).json()) as Page).counts.all).toBe(2);

  expect((await api("/notifications/done-all", { json: { filter: "everything" } })).status).toBe(400);
  // Another origin is refused before anything changes.
  expect((await api("/notifications/done-all", { json: {}, origin: "https://evil.example" })).status).toBe(403);
});

test("Limpar conversa hides a DM's past for me alone; the agent keeps its context and nothing is deleted", async () => {
  const seen: string[] = [];
  t = await createTestServer({
    reply: (req) => {
      seen.push(JSON.stringify(req.messages));
      return { chunks: ["noted"] };
    },
  });
  const { owner, api, orgId, channelId, agentId } = await signedIn();
  const { channelId: dmId } = (await (await api("/dms", { json: { agentId } })).json()) as { channelId: string };
  await api(`/channels/${dmId}/messages`, { json: { body: "my favorite color is teal" } });
  await t.drain();
  const messages = async () =>
    ((await (await api(`/channels/${dmId}/messages`)).json()) as { messages: Msg[] }).messages;
  const dm = async () => ((await (await api("/dms")).json()) as { dms: Dm[] }).dms.find((d) => d.channelId === dmId);
  expect((await messages()).map((m) => m.body)).toEqual(["my favorite color is teal", "noted"]);

  const cleared = await api(`/channels/${dmId}/clear`, { json: {} });
  expect(cleared.status).toBe(200);
  expect(typeof ((await cleared.json()) as { clearedAt: string }).clearedAt).toBe("string");
  expect(await messages()).toEqual([]);
  expect(await dm()).toMatchObject({ lastMessage: null, unread: 0 });

  // What comes next shows; the agent still had the old conversation in its context.
  await api(`/channels/${dmId}/messages`, { json: { body: "what is my favorite color?" } });
  await t.drain();
  expect((await messages()).map((m) => m.body)).toEqual(["what is my favorite color?", "noted"]);
  expect(seen.at(-1)).toContain("my favorite color is teal");
  const kept = await t.db.select().from(schema.messages).where(eq(schema.messages.channelId, dmId));
  expect(kept.filter((m) => !m.deletedAt).map((m) => m.body)).toContain("my favorite color is teal");
  expect((await dm())?.lastMessage?.body).toBe("noted");

  // Only a DM, and only my own.
  expect((await api(`/channels/${channelId}/clear`, { json: {} })).status).toBe(400);
  await owner(`/api/app/organizations/${orgId}/invitations`, { json: { email: "bia@example.com", role: "member" } });
  const bia = browser(t);
  await signUp(bia, "bia@example.com");
  // Someone outside the DM never learns it exists.
  expect((await bia(`/api/app/organizations/${orgId}/channels/${dmId}/clear`, { json: {} })).status).toBe(404);
  expect((await messages()).map((m) => m.body)).toEqual(["what is my favorite color?", "noted"]);
});
