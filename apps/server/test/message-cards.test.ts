import { afterEach, beforeEach, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import { createArtifact, createConversationArtifact, insertMessage } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
});
afterEach(() => t.close());

test("a conversation's page brings what its cards show (include=cards), so they draw whole at once", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId, agentId } = await seedOrg(owner);
  const actor = { type: "agent" as const, agentId, channelId };
  const choices = await createConversationArtifact(t.engine.artifacts, actor, orgId, {
    title: "Deploy",
    content: {
      kind: "choices",
      questions: [{ question: "Faço agora?", options: [{ label: "Sim" }, { label: "Não" }] }],
    },
  });
  const poll = await createConversationArtifact(t.engine.artifacts, actor, orgId, {
    title: "Qual dia?",
    content: { kind: "poll", question: "Qual dia?", options: ["Terça", "Sexta"], multiple: false },
  });
  await t.db
    .insert(schema.polls)
    .values({ artifactId: poll.id, orgId, runId: crypto.randomUUID(), closesAt: new Date(Date.now() + 3_600_000) });
  // A file is a tile of one size: nothing of it comes with the page.
  const doc = await createArtifact(t.engine.artifacts, actor, orgId, {
    title: "Notas",
    channelId,
    content: { kind: "document", markdown: "# Notas" },
  });
  const ref = (a: { id: string; version: number; title: string }) => ({ id: a.id, version: a.version, title: a.title });
  await insertMessage(t.db, {
    orgId,
    channelId,
    author: { type: "agent", agentId, runId: null, hop: 0, stretchId: null },
    body: "Decide aí.",
    meta: {
      artifacts: [ref(choices), ref(poll), ref(doc), { id: crypto.randomUUID(), deleted: true, title: "Velho" }],
    },
  });
  const read = async (query: string) =>
    (await (await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages${query}`)).json()) as {
      messages: unknown[];
      cards?: {
        artifacts: { id: string; shownVersion: number; content: { kind: string } }[];
        polls: { id: string; votes: unknown[] }[];
        choices: { id: string; answer: unknown }[];
        blocks: unknown[];
      };
    };

  expect((await read("")).cards).toBeUndefined();
  const { cards } = await read("?include=cards");
  expect(cards?.artifacts.map((a) => [a.id, a.shownVersion, a.content.kind]).sort()).toEqual(
    [
      [choices.id, 1, "choices"],
      [poll.id, 1, "poll"],
    ].sort(),
  );
  expect(cards?.polls).toEqual([expect.objectContaining({ id: poll.id, votes: [] })]);
  expect(cards?.choices).toEqual([{ id: choices.id, answer: null }]);
  expect(cards?.blocks).toEqual([]);
});

test("a picture keeps its size: its ref and its content say it, so its box holds before it loads", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  const form = new FormData();
  // A PNG's signature and header: its size is all the server reads of it.
  const header = new Uint8Array(24);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, 36);
  new DataView(header.buffer).setUint32(20, 72);
  form.set("file", new File([header], "captura.png", { type: "image/png" }));
  form.set("channelId", channelId);
  const uploaded = (await (await api("/artifacts/files", { body: form, method: "POST" })).json()) as {
    id: string;
    content: { width?: number; height?: number };
  };
  expect(uploaded.content).toMatchObject({ width: 36, height: 72 });
  const posted = (await (
    await api(`/channels/${channelId}/messages`, { json: { body: "", attachments: [uploaded.id] } })
  ).json()) as { meta: { artifacts: unknown[] } };
  expect(posted.meta.artifacts).toEqual([
    { id: uploaded.id, version: 1, title: "captura.png", kind: "file", width: 36, height: 72 },
  ]);
});
