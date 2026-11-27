import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  askAdmins,
  type ConnectAppCard,
  createSetupToolSource,
  createToolGateway,
  insertMessage,
  type ServerProbe,
  settleConnectCards,
  type ToolContext,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

async function runFor(fx: Fixture, userId: string, body: string): Promise<ToolContext> {
  const trigger = await insertMessage(fx.db, {
    orgId: fx.org.id,
    channelId: fx.general.id,
    author: { type: "person", userId },
    body,
  });
  const [run] = await fx.db
    .insert(schema.agentRuns)
    .values({
      orgId: fx.org.id,
      agentId: fx.agent.id,
      channelId: fx.general.id,
      threadRootId: trigger.id,
      triggerMessageId: trigger.id,
      trigger: "mention",
      hop: 1,
      status: "done",
    })
    .returning();
  if (!run) throw new Error("no run");
  return {
    db: fx.db,
    orgId: fx.org.id,
    agentId: fx.agent.id,
    runId: run.id,
    channelId: fx.general.id,
    threadRootId: trigger.id,
    triggerMessageId: trigger.id,
  };
}

const offer = async (fx: Fixture, ctx: ToolContext, input: Record<string, unknown>, probe?: ServerProbe) => {
  const gateway = createToolGateway({
    sources: [createSetupToolSource({ pubsub: fx.pubsub, ...(probe ? { probe: async () => probe } : {}) })],
  });
  const res = await gateway.invoke(ctx, { toolUseId: `tu_${crypto.randomUUID()}`, name: "offer_connect_app", input });
  if (res.type !== "result") throw new Error(res.type);
  const [card] = await fx.db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, fx.org.id), eq(schema.messages.agentRunId, ctx.runId)));
  if (!card) throw new Error(`no card: ${res.output.content}`);
  return card;
};

const connection = async (fx: Fixture, values: { connector: string; serverUrl: string; ownerUserId?: string }) => {
  const [row] = await fx.db
    .insert(schema.connectorConnections)
    .values({
      orgId: fx.org.id,
      label: "Acme",
      toolPrefix: `acme_${crypto.randomUUID().slice(0, 4)}`,
      authType: "none",
      createdByUserId: fx.owner.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error("no connection");
  return row;
};

const noticesFor = async (fx: Fixture, messageId: string) =>
  (await fx.db.select().from(schema.messages).where(eq(schema.messages.orgId, fx.org.id))).filter(
    (m) => (m.meta.notice as { refs?: { messageId?: string } } | undefined)?.refs?.messageId === messageId,
  );

test("a server by address: the card says how it signs in and what it asks; connected, the card settles and wakes its agent once", async () => {
  f = await setup();
  const ctx = await runFor(f, f.owner.id, "connect https://mcp.acme.example.com/mcp");
  const card = await offer(
    f,
    ctx,
    { url: "https://mcp.acme.example.com/mcp", why: "To read Acme's tickets." },
    {
      kind: "oauth",
      resource: "https://mcp.acme.example.com/mcp",
      issuer: "https://auth.acme.example.com",
      scopes: ["read", "write"],
    },
  );
  expect((card.meta.actionCard as ConnectAppCard).params).toEqual({
    url: "https://mcp.acme.example.com/mcp",
    signIn: "oauth",
    scopes: ["read", "write"],
    why: "To read Acme's tickets.",
  });

  // Its tools wait for review: nothing settles yet.
  const c = await connection(f, {
    connector: `custom:${crypto.randomUUID()}`,
    serverUrl: "https://mcp.acme.example.com/mcp/",
  });
  const [tool] = await f.db
    .insert(schema.customTools)
    .values({ orgId: f.org.id, connectionId: c.id, name: "list_tickets" })
    .returning();
  expect(await settleConnectCards(f, c)).toBe(0);
  await f.db
    .update(schema.customTools)
    .set({ access: "read" })
    .where(eq(schema.customTools.id, tool?.id ?? ""));

  const events = f.listen(f.general.id);
  expect(await settleConnectCards(f, c)).toBe(1);
  const [settled] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, card.id));
  expect(settled?.meta.actionCard).toMatchObject({ connectionId: c.id, connectedAt: expect.any(String) });
  expect(events).toContainEqual(expect.objectContaining({ type: "message.created", messageId: card.id }));
  const [notice] = await noticesFor(f, card.id);
  expect(notice?.meta.notice).toMatchObject({
    kind: "proposal_result",
    refs: { runId: ctx.runId, connectionId: c.id },
  });
  expect(String((notice?.meta.notice as { text?: string } | undefined)?.text)).toContain(
    "Go on with what the person asked",
  );
  // The agent's run is over: the notice starts it again in that conversation.
  const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, f.agent.id));
  expect(runs.length).toBe(2);

  // Settled once: another connection of it wakes nobody again.
  expect(await settleConnectCards(f, c)).toBe(0);
  expect(await noticesFor(f, card.id)).toHaveLength(1);
});

test("a catalog card settles on its connector; a personal connection only settles its own person's cards", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  const mine = await offer(f, await runFor(f, f.owner.id, "conecta o linear"), { app: "Linear", why: "x" });
  const hers = await offer(f, await runFor(f, bia.id, "conecta o linear"), { app: "Linear", why: "y" });
  // Bia may not connect it for the team: her card names who may.
  expect((hers.meta.actionCard as ConnectAppCard).params.deciderIds).toEqual([f.owner.id]);
  expect((mine.meta.actionCard as ConnectAppCard).params.deciderIds).toBeUndefined();

  const own = await connection(f, {
    connector: "linear",
    serverUrl: "https://mcp.linear.app/mcp",
    ownerUserId: bia.id,
  });
  expect(await settleConnectCards(f, own)).toBe(1);
  expect(await noticesFor(f, hers.id)).toHaveLength(1);
  expect(await noticesFor(f, mine.id)).toHaveLength(0);

  // Bia asks the admins from her card; the team's connection answers them and settles the rest.
  await askAdmins(f, bia.id, f.org.id, { what: "connector", messageId: hers.id });
  const [asked] = await f.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "admin_ask"));
  expect(asked).toMatchObject({ userId: f.owner.id, latest: { reason: "connector", title: "Linear" } });
  const team = await connection(f, { connector: "linear", serverUrl: "https://mcp.linear.app/mcp" });
  expect(await settleConnectCards(f, team)).toBe(1);
  expect(await noticesFor(f, mine.id)).toHaveLength(1);
});
