import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  CAPABILITIES_LIMIT,
  createAppGuideToolSource,
  createToolGateway,
  ensureRightHand,
  FIND_IN_APP_TOOL,
  getAgent,
  HOW_YOU_WORK,
  insertMessage,
  isCore,
  type ToolContext,
} from "../src";
import { toolKind } from "../src/tools/run-policy";
import { type Fixture, setup } from "./fixtures";

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

/** A run of @dev on a message the owner wrote in #general. */
async function runOf(fx: Fixture): Promise<ToolContext> {
  const trigger = await insertMessage(fx.db, {
    orgId: fx.org.id,
    channelId: fx.general.id,
    author: { type: "person", userId: fx.owner.id },
    body: "where do I put an API key?",
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
      status: "running",
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

async function find(fx: Fixture, what: string, cloud = false) {
  const gateway = createToolGateway({ sources: [createAppGuideToolSource({ cloud })] });
  const res = await gateway.invoke(await runOf(fx), {
    toolUseId: `tu_${crypto.randomUUID()}`,
    name: FIND_IN_APP_TOOL,
    input: { what },
  });
  if (res.type !== "result") throw new Error(`not a result: ${res.type}`);
  return res.output;
}

test("any agent finds a screen and offers it with its card; without the card it names the right hand", async () => {
  f = await setup();
  const out = await find(f, "API keys AI accounts");
  expect(out.isError).toBeFalsy();
  expect(out.content).toContain("Settings › AI and usage");
  expect(out.content).toContain('offer_open_page (page "ai_accounts")');

  const handId = await ensureRightHand(f.db, f.org.id);
  const hand = handId ? await getAgent(f.db, f.org.id, handId) : null;
  await f.db
    .delete(schema.agentScopes)
    .where(and(eq(schema.agentScopes.agentId, f.agent.id), eq(schema.agentScopes.scope, "setup:write")));
  const without = await find(f, "API keys AI accounts");
  expect(without.content).not.toContain("offer it with offer_open_page");
  expect(without.content).toContain(`@${hand?.handle} can open it`);
});

test("a change people make points to the right hand, never a can't", async () => {
  f = await setup();
  await ensureRightHand(f.db, f.org.id);
  const out = await find(f, "create a role with permissions");
  expect(out.content).toContain("A change people make");
  expect(out.content).toContain("does it as them");
});

test("help sections come with their link, and only this edition's", async () => {
  f = await setup();
  const wiki = await find(f, "wiki pages");
  expect(wiki.content).toContain("https://agentes.chat/docs/wiki#");
  const selfHosted = await find(f, "install on a server docker");
  expect(selfHosted.content).toContain("docs/install-on-a-server#");
  const cloud = await find(f, "install on a server docker", true);
  expect(cloud.content).not.toContain("docs/install-on-a-server#");
});

test("nothing found says so, never that the app can't", async () => {
  f = await setup();
  const out = await find(f, "zzqx");
  expect(out.content).toContain("never that it can't be done");
});

test("every agent has it up front, as a read, and the prompt sends app questions to it", () => {
  const tool = { name: FIND_IN_APP_TOOL, scope: "", connectionId: null };
  expect(isCore(tool)).toBe(true);
  expect(toolKind(tool).kind).toBe("read");
  expect(HOW_YOU_WORK).toContain("`find_in_app`");
  expect(CAPABILITIES_LIMIT).toContain("not the app's");
});
