import { afterEach, expect, test } from "bun:test";
import { CUSTOM_PROXY_PROTOCOL } from "@agenteschat/adapters/machine-protocol";
import { eq, schema } from "@agenteschat/db";
import {
  type AgentProxyDeps,
  createSetupToolSource,
  createToolGateway,
  insertMessage,
  listAgentProxies,
  proxiesIn,
  proxyForMachine,
  removeAgentProxy,
  saveProxyFromCard,
  setAgentProxy,
  type ToolContext,
  testAgentProxy,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

const PUBLIC = async () => ["203.0.113.10"];

function depsOf(fx: Fixture) {
  const calls: { machineId: string; url: string | null }[] = [];
  const dialled: string[] = [];
  const deps: AgentProxyDeps = {
    db: fx.db,
    keyWrappers: [fx.keyWrapper],
    pubsub: fx.pubsub,
    resolveHost: PUBLIC,
    hub: {
      call: async (machineId, request) => {
        calls.push({ machineId, url: request.url });
        return { on: request.url !== null };
      },
    },
    exit: async (proxy, address) => {
      dialled.push(address);
      if (proxy.password === "wrong") throw Object.assign(new Error("no"), { reason: "auth" });
      return { ip: "198.51.100.7", country: "DE" };
    },
  };
  return { deps, calls, dialled };
}

const machine = async (fx: Fixture, name: string) => {
  const [row] = await fx.db
    .insert(schema.machines)
    .values({ orgId: fx.org.id, name, protocol: CUSTOM_PROXY_PROTOCOL })
    .returning();
  if (!row) throw new Error("no machine");
  return row;
};

test("the workspace's proxy and a computer's own: sealed, shown without the password, the computer's wins there, each change reaches its computers", async () => {
  f = await setup();
  const { deps, calls } = depsOf(f);
  const mac = await machine(f, "Mac");
  const box = await machine(f, "Box");
  const workspace = await setAgentProxy(deps, f.owner.id, f.org.id, {
    machineId: null,
    url: "socks5://ana:s3cret@proxy.example.com:1080",
  });
  expect(workspace).toMatchObject({ label: "socks5://proxy.example.com:1080", hasAuth: true });
  expect(JSON.stringify(await listAgentProxies(f.db, f.owner.id, f.org.id))).not.toContain("s3cret");
  const [row] = await f.db.select().from(schema.agentProxies);
  expect(JSON.stringify(row)).not.toContain("s3cret");
  // Every computer hears it.
  expect(calls.map((c) => c.machineId).sort()).toEqual([mac.id, box.id].sort());
  expect(calls[0]?.url).toBe("socks5://ana:s3cret@proxy.example.com:1080");

  calls.length = 0;
  await setAgentProxy(deps, f.owner.id, f.org.id, { machineId: mac.id, url: "http://mac-proxy.example.com:3128" });
  expect(calls).toEqual([{ machineId: mac.id, url: "http://mac-proxy.example.com:3128" }]);
  expect(await proxyForMachine(deps, mac)).toBe("http://mac-proxy.example.com:3128");
  expect(await proxyForMachine(deps, box)).toBe("socks5://ana:s3cret@proxy.example.com:1080");

  // A new workspace proxy leaves the computer that has its own alone.
  calls.length = 0;
  await setAgentProxy(deps, f.owner.id, f.org.id, { machineId: null, url: "socks5://proxy2.example.com:1080" });
  expect(calls.map((c) => c.machineId)).toEqual([box.id]);

  calls.length = 0;
  await removeAgentProxy(deps, f.owner.id, f.org.id, mac.id);
  expect(calls).toEqual([{ machineId: mac.id, url: "socks5://proxy2.example.com:1080" }]);
  expect(await testAgentProxy(deps, f.owner.id, f.org.id, { machineId: null })).toEqual({
    ok: true,
    ip: "198.51.100.7",
    country: "DE",
  });

  // A member sets neither the workspace's nor a computer they didn't connect; a private host is refused.
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  await expect(
    setAgentProxy(deps, bia.id, f.org.id, { machineId: null, url: "socks5://x.example.com:1080" }),
  ).rejects.toMatchObject({ code: "proxy.forbidden" });
  await expect(
    setAgentProxy(deps, bia.id, f.org.id, { machineId: mac.id, url: "socks5://x.example.com:1080" }),
  ).rejects.toMatchObject({ code: "proxy.forbidden" });
  await expect(
    setAgentProxy({ ...deps, resolveHost: async () => ["10.0.0.5"] }, f.owner.id, f.org.id, {
      machineId: null,
      url: "socks5://inside.example.com:1080",
    }),
  ).rejects.toMatchObject({ code: "url.internal" });
  await expect(
    setAgentProxy(deps, f.owner.id, f.org.id, { machineId: null, url: "ftp://x.example.com" }),
  ).rejects.toMatchObject({ code: "proxy.invalid" });
});

test("from the chat: the card holds no password; saving reads it from the message, hides it there and in the transcript, tests it and tells the agent", async () => {
  f = await setup();
  const { deps } = depsOf(f);
  const said = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "use the proxy socks5://ana:s3cret@proxy.example.com:1080 for the browser",
  });
  await f.db.insert(schema.notifications).values({
    orgId: f.org.id,
    userId: f.owner.id,
    kind: "mention",
    groupKey: `mention:${said.id}`,
    latest: { quote: "use the proxy socks5://ana:s3cret@proxy.example.com:1080" },
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: said.id,
      triggerMessageId: said.id,
      trigger: "mention",
      hop: 1,
      status: "done",
      transcript: { messages: [{ role: "user", content: said.body }] },
    })
    .returning();
  if (!run) throw new Error("no run");
  // An agent that repeated it, and an inbox row that quotes it.
  const echoed = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "agent", agentId: f.agent.id, runId: run.id, hop: 1 },
    body: "Saving socks5://ana:s3cret@proxy.example.com:1080 now",
  });
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: said.id,
    triggerMessageId: said.id,
  };
  const gateway = createToolGateway({ sources: [createSetupToolSource({ pubsub: f.pubsub })] });
  const res = await gateway.invoke(ctx, {
    toolUseId: "tu_1",
    name: "offer_proxy",
    input: { host: "proxy.example.com", why: "For the browser." },
  });
  if (res.type !== "result") throw new Error(res.type);
  expect(res.output.isError).toBeUndefined();
  const cardId = (res.output.data as { actionCard: { messageId: string } }).actionCard.messageId;
  const [card] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, cardId));
  expect(card?.meta.actionCard).toMatchObject({
    kind: "proxy_setup",
    params: { sourceMessageId: said.id, label: "socks5://proxy.example.com:1080", hasAuth: true, machineId: null },
  });
  expect(JSON.stringify(card)).not.toContain("s3cret");

  const saved = await saveProxyFromCard(deps, f.owner.id, f.org.id, cardId);
  expect(saved.test).toEqual({ ok: true, ip: "198.51.100.7", country: "DE" });
  expect(await proxyForMachine(deps, { id: crypto.randomUUID(), orgId: f.org.id })).toBe(
    "socks5://ana:s3cret@proxy.example.com:1080",
  );
  const [hidden] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, said.id));
  expect(hidden?.body).toBe("use the proxy socks5://ana:•••@proxy.example.com:1080 for the browser");
  const [echo] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, echoed.id));
  expect(echo?.body).toBe("Saving socks5://ana:•••@proxy.example.com:1080 now");
  expect(JSON.stringify(await f.db.select().from(schema.notifications))).not.toContain("s3cret");
  const reindexed = (await f.db.select().from(schema.outbox)).filter((j) => j.kind === "search.index");
  expect(reindexed.map((j) => (j.payload as { sourceId: string }).sourceId)).toEqual(
    expect.arrayContaining([said.id, echoed.id]),
  );
  const [cleaned] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  expect(JSON.stringify(cleaned?.transcript)).not.toContain("s3cret");
  const [after] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, cardId));
  expect(after?.meta.actionCard).toMatchObject({ savedAt: expect.any(String), exit: { ip: "198.51.100.7" } });
  const notices = (await f.db.select().from(schema.messages).where(eq(schema.messages.orgId, f.org.id))).filter(
    (m) => (m.meta.notice as { refs?: { messageId?: string } } | undefined)?.refs?.messageId === cardId,
  );
  expect(notices).toHaveLength(1);
  await expect(saveProxyFromCard(deps, f.owner.id, f.org.id, cardId)).rejects.toMatchObject({
    code: "proxy.card_saved",
  });

  // A host nobody typed: no card.
  const none = await gateway.invoke(ctx, {
    toolUseId: "tu_2",
    name: "offer_proxy",
    input: { host: "other.example.com", why: "x" },
  });
  expect(none.type === "result" && none.output.isError).toBe(true);
});

test("a test dials the proxy at the address it checked; a name that now points inside is never dialled", async () => {
  f = await setup();
  const { deps, dialled } = depsOf(f);
  const url = "socks5://proxy.example.com:1080";
  expect(await testAgentProxy(deps, f.owner.id, f.org.id, { machineId: null, url })).toMatchObject({ ok: true });
  expect(dialled).toEqual(["203.0.113.10"]);
  let asked = 0;
  const rebinding = async () => (asked++ === 0 ? ["203.0.113.10"] : ["127.0.0.1"]);
  expect(
    await testAgentProxy({ ...deps, resolveHost: rebinding }, f.owner.id, f.org.id, { machineId: null, url }),
  ).toEqual({ ok: false, reason: "unreachable" });
  expect(dialled).toHaveLength(1);
});

test("proxies in a message: SOCKS, or HTTP with a port or a user, a sentence's punctuation left out; a plain link is none", () => {
  expect(
    proxiesIn(
      "use (socks5://ana:pw@a.example.com:1080). or http://b.example.com:3128, not https://c.example.com/page",
    ).map((p) => `${p.scheme}://${p.host}:${p.port}`),
  ).toEqual(["socks5://a.example.com:1080", "http://b.example.com:3128"]);
  // Many closing marks in a row read in one pass.
  expect(proxiesIn(`socks5://a.example.com:1080${")".repeat(50_000)}x`)).toEqual([]);
});
