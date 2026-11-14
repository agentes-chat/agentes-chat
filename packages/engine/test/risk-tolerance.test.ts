import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type CustomDeps,
  connectCustomServer,
  connectorGrantValidator,
  createConnectorToolSource,
  createToolGateway,
  decideApproval,
  ForbiddenError,
  gatewayCallPaths,
  getAgent,
  getOrgSettings,
  grantScopes,
  insertMessage,
  type McpConnect,
  mcpSessionOver,
  type RoutineBrief,
  riskClassesOf,
  saveCustomTools,
  setAgentScopes,
  type ToolContext,
  type ToolDefinition,
  type ToolSource,
  unaskedRisksOf,
  updateAgent,
  updateOrgSettings,
  ValidationError,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const WHY = "The customer asked for this twice today and the order is already closed on our side.";
const CONNECTION = "00000000-0000-4000-8000-0000000000aa";

describe("the risk classes a call carries", () => {
  test("read from every name it runs; unknown when nothing names one or it runs whatever it is told", () => {
    const cases: [string[], ReturnType<typeof riskClassesOf>][] = [
      [["shop_delete_customer"], ["deletes"]],
      [["GMAIL_SEND_EMAIL"], ["reaches_people"]],
      [["GOOGLEDRIVE_SHARE_FILE"], ["shares_outside"]],
      [["stripe_create_refund"], ["spends_money"]],
      [["VERCEL_BUY_DOMAINS"], ["spends_money"]],
      [["sheet_overwrite_range"], ["replaces_data"]],
      [["github_merge_pull_request", "github:pr.merge"], ["deploys"]],
      [["VERCEL_CREATE_NEW_DEPLOYMENT"], ["deploys"]],
      [["tools.google.api.calendar.calendars.calendarEventsDelete", "custom:x:write"], ["deletes"]],
      [
        ["GMAIL_SEND_EMAIL", "GMAIL_DELETE_DRAFT"],
        ["deletes", "reaches_people"],
      ],
      // Executor's own tool name says nothing of what it runs.
      [["call"], null],
      [["campaign_status_toggle"], null],
      // It runs whatever its arguments say: GraphQL, SQL, a raw request, a command.
      [["SHOPIFY_GRAPH_QL_QUERY"], null],
      [["COMPOSIO_PROXY_EXECUTE"], null],
      [["VERCEL_EXECUTE_SANDBOX_COMMAND", "VERCEL_DELETE_PROJECT"], null],
    ];
    expect(cases.map(([names]) => [names, riskClassesOf(names)])).toEqual(cases);
  });
});

describe("the paths one call of a gateway's `call` runs", () => {
  test("Executor's shape, one call or a list; anything else says nothing", () => {
    const path = "tools.google.api.calendar.calendars.calendarEventsPatch";
    const cases: [Record<string, unknown>, string[] | null][] = [
      [{ calls: { path, input: { id: "1" } } }, [path]],
      [
        {
          calls: [
            { path, input: {} },
            { path: "tools.github.issues.list", input: {} },
            { path, input: {} },
          ],
        },
        [path, "tools.github.issues.list"],
      ],
      [{ calls: [] }, null],
      [{ calls: { input: {} } }, null],
      [{ calls: { path: "tools github", input: {} } }, null],
      [{ calls: { path: `tools.${"x".repeat(130)}`, input: {} } }, null],
      [{ calls: { path, input: {} }, also: true }, null],
      [{ calls: [path] }, null],
    ];
    expect(cases.map(([input]) => gatewayCallPaths(input))).toEqual(cases.map(([, out]) => out));
  });
});

// ── Through the gateway ──────────────────────────────────────────────────────

const ran: string[] = [];
const shopTool = (name: string, scope: string, extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  scope,
  connectionId: CONNECTION,
  connectorLabel: "Shop",
  execute: async () => {
    ran.push(name);
    return { content: "done" };
  },
  ...extra,
});
/** Sensitive by what its classification found: a delete. */
const DELETE = shopTool("shop_delete_customer", "shop:customers.write", { sensitive: true, asksByRisk: true });
/** Sensitive by its verb, a payment. */
const REFUND = shopTool("shop_create_refund", "shop:orders.write", { sensitive: true, asksByRisk: true });
/** Marked destructive by its server with no word that names the risk. */
const TOGGLE = shopTool("shop_status_toggle", "shop:orders.write", { sensitive: true, asksByRisk: true });
/** A person set it to ask: its sensitivity isn't the classification's. */
const ASKED = shopTool("shop_delete_note", "shop:notes.write", { sensitive: true });
/** Asks by its name, whatever a connector says. */
const DEPLOY = shopTool("shop_deploy_site", "shop:sites.write");
/** Runs other actions by slug, as Composio's executor does. */
const EXECUTOR = shopTool("shop_execute", "shop:any.write", {
  sensitive: true,
  asksByRisk: true,
  inputSchema: { type: "object", properties: { slugs: { type: "array" } }, required: ["slugs"] },
  actions: (input) =>
    Array.isArray(input.slugs) && input.slugs.every((s) => typeof s === "string") ? input.slugs : null,
});
const shop: ToolSource = { name: "shop", tools: async () => [DELETE, REFUND, TOGGLE, ASKED, DEPLOY, EXECUTOR] };

async function world() {
  ran.length = 0;
  f = await setup({ toolSources: [shop] });
  await grantScopes(f.db, f.org.id, f.agent.id, [{ connectionId: null, scope: "*" }]);
}

const tools = () => {
  if (!f.tools) throw new Error("no gateway");
  return f.tools;
};

async function runAs(kind: "person" | "routine"): Promise<ToolContext> {
  const brief: RoutineBrief | null =
    kind === "routine"
      ? {
          routineId: "00000000-0000-4000-8000-000000000001",
          routineRunId: "00000000-0000-4000-8000-000000000002",
          name: "Pedidos do dia",
          creatorUserId: f.owner.id,
          deliverTo: { channelId: f.general.id, threadId: null },
          access: "act",
          report: "when_new",
          trigger: "schedule",
          dueAt: new Date().toISOString(),
        }
      : null;
  const trigger = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "hi",
    meta: brief ? { routineBrief: brief } : undefined,
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: trigger.id,
      triggerMessageId: trigger.id,
      trigger: "mention",
      hop: 1,
      ...(brief ? { background: true } : {}),
    })
    .returning();
  if (!run) throw new Error("no run");
  return {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: run.channelId,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
    ...(brief ? { background: true } : {}),
  };
}

const call = async (ctx: ToolContext, tool: ToolDefinition, input: Record<string, unknown> = { id: "1" }) =>
  (
    await tools().invoke(ctx, {
      toolUseId: `tu_${crypto.randomUUID()}`,
      name: tool.name,
      input: { ...input, why: WHY },
    })
  ).type;

describe("a workspace's risk tolerance", () => {
  test("by default every class asks, as before", async () => {
    await world();
    expect((await getOrgSettings(f.db, f.owner.id, f.org.id)).unaskedRisks).toEqual([]);
    const ctx = await runAs("person");
    for (const tool of [DELETE, REFUND, TOGGLE, ASKED, DEPLOY]) {
      expect({ tool: tool.name, type: await call(ctx, tool) }).toEqual({ tool: tool.name, type: "approval" });
    }
    expect(ran).toEqual([]);
  });

  test("a tolerated class runs without a card, audited with its classes; the rest still ask", async () => {
    await world();
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["deploys", "deletes"] });
    // Stored once each, in the canonical order, and the change is audited.
    expect((await getOrgSettings(f.db, f.owner.id, f.org.id)).unaskedRisks).toEqual(["deletes", "deploys"]);
    const changed = (await f.db.select().from(schema.auditLog)).filter(
      (a) => a.action === "organization.risk_tolerance_changed",
    );
    expect(changed.map((a) => a.details)).toEqual([{ from: [], to: ["deletes", "deploys"] }]);

    const ctx = await runAs("person");
    // The listing shows it as it runs: no card, no `why`.
    const listed = await tools().list(ctx);
    expect(listed.find((t) => t.name === DELETE.name)).toMatchObject({ sensitive: false, unasked: true });
    expect(listed.find((t) => t.name === REFUND.name)?.sensitive).toBe(true);

    expect(await tools().invoke(ctx, { toolUseId: "tu_1", name: DELETE.name, input: { id: "1" } })).toMatchObject({
      type: "result",
    });
    expect(await call(ctx, DEPLOY)).toBe("result");
    expect(await call(ctx, REFUND)).toBe("approval");
    // Destructive with no word that names the risk: unknown, so it asks.
    expect(await call(ctx, TOGGLE)).toBe("approval");
    // A person set it to ask: their choice on that tool beats the workspace's.
    expect(await call(ctx, ASKED)).toBe("approval");
    expect(ran).toEqual([DELETE.name, DEPLOY.name]);
    const calls = (await f.db.select().from(schema.auditLog)).filter(
      (a) => a.action === "tool.call" && a.targetId === DELETE.name,
    );
    expect(calls.map((a) => (a.details as { unaskedRisks?: string[] }).unaskedRisks)).toEqual([["deletes"]]);
  });

  test("a tool that runs others is judged by what this call runs", async () => {
    await world();
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["reaches_people"] });
    const ctx = await runAs("person");
    expect(await call(ctx, EXECUTOR, { slugs: ["GMAIL_SEND_EMAIL"] })).toBe("result");
    expect(await call(ctx, EXECUTOR, { slugs: ["GMAIL_SEND_EMAIL", "GMAIL_DELETE_DRAFT"] })).toBe("approval");
    expect(await call(ctx, EXECUTOR, { slugs: [{ slug: "GMAIL_SEND_EMAIL" }] })).toBe("approval");
  });

  test("an agent's own list replaces the workspace's; null follows it again", async () => {
    await world();
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["deletes"] });
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { unaskedRisks: [] });
    expect((await getAgent(f.db, f.org.id, f.agent.id))?.unaskedRisks).toEqual([]);
    expect(await unaskedRisksOf(f.db, f.org.id, f.agent.id)).toEqual([]);
    const ctx = await runAs("person");
    expect(await call(ctx, DELETE)).toBe("approval");
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { unaskedRisks: ["spends_money", "spends_money"] });
    expect(await unaskedRisksOf(f.db, f.org.id, f.agent.id)).toEqual(["spends_money"]);
    expect(await call(ctx, REFUND)).toBe("result");
    expect(await call(ctx, DELETE)).toBe("approval");
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { unaskedRisks: null });
    expect(await call(ctx, DELETE)).toBe("result");
  });

  test("a routine's run and an agent that always asks still ask; one that never asks never did", async () => {
    await world();
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["deletes"] });
    expect(await call(await runAs("routine"), DELETE)).toBe("approval");
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: "always" });
    expect(await call(await runAs("person"), DELETE)).toBe("approval");
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: "never" });
    expect(await call(await runAs("person"), REFUND)).toBe("result");
  });

  test("who may set it: admins for the workspace, who manages agents for an agent; only known classes", async () => {
    await world();
    const member = await addMember(f.db, f.org.id, "member");
    await expect(updateOrgSettings(f.db, member.id, f.org.id, { unaskedRisks: ["deletes"] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateAgent(f.db, member.id, f.org.id, f.agent.id, { unaskedRisks: ["deletes"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["everything"] as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { unaskedRisks: ["everything"] as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── Executor's gateway: "Aprovar sempre" one path at a time ──────────────────

function executorMcp() {
  const calls: string[] = [];
  const connect: McpConnect = async () => {
    const server = new McpServer({ name: "executor", version: "1" });
    const one = z.object({ path: z.string(), input: z.unknown() });
    server.registerTool(
      "call",
      {
        description: "Call Executor app tools directly by exact path from search.",
        inputSchema: { calls: z.union([one, z.array(one)]) },
        annotations: { destructiveHint: true },
      },
      async (args) => {
        const list = Array.isArray(args.calls) ? args.calls : [args.calls];
        calls.push(...list.map((c) => c.path));
        return { content: [{ type: "text", text: "ok" }] };
      },
    );
    server.registerTool(
      "resume",
      {
        description: "Resume a paused execution.",
        inputSchema: { id: z.string() },
        annotations: { destructiveHint: true },
      },
      async () => ({ content: [{ type: "text", text: "resumed" }] }),
    );
    const [client, end] = InMemoryTransport.createLinkedPair();
    await server.connect(end);
    return mcpSessionOver(client);
  };
  return { connect, calls };
}

const PATCH = "tools.google.api.calendar.calendars.calendarEventsPatch";
const REMOVE = "tools.google.api.calendar.calendars.calendarEventsDelete";

describe("Executor's `call`", () => {
  test('kept by "Aprovar sempre" per path, judged by the risk of the paths it runs', async () => {
    f = await setup();
    const mcp = executorMcp();
    const deps: CustomDeps = {
      db: f.db,
      keyWrappers: [f.keyWrapper],
      publicUrl: "https://chat.example.com",
      resolveHost: async () => ["93.184.216.34"],
      connect: mcp.connect,
    };
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: "https://mcp.executor.example/mcp",
      apiKey: "exec_secret_12345",
      label: "Executor",
    });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    const server = started.server;
    await saveCustomTools(deps, f.owner.id, f.org.id, server.id, {
      label: "Executor",
      tools: [
        { name: "call", access: "approval", label: "Call" },
        { name: "resume", access: "approval", label: "Resume" },
      ],
    });
    await setAgentScopes(
      f.db,
      f.owner.id,
      f.org.id,
      f.agent.id,
      [{ connectionId: server.id, scope: `custom:${server.id}:write` }],
      connectorGrantValidator,
    );
    const gateway = createToolGateway({ sources: [createConnectorToolSource(deps)] });
    const ctx = await runAs("person");
    const name = (await gateway.list(ctx)).find((t) => t.name.endsWith("call"))?.name ?? "";
    const invoke = (path: string | string[]) =>
      gateway.invoke(ctx, {
        toolUseId: `tu_${crypto.randomUUID()}`,
        name,
        input: {
          calls: Array.isArray(path) ? path.map((p) => ({ path: p, input: {} })) : { path, input: {} },
          why: WHY,
        },
      });

    const first = await invoke(PATCH);
    if (first.type !== "approval") throw new Error(`expected an approval, got ${first.type}`);
    // The card names the path, and "Aprovar sempre" keeps that path alone.
    expect(first.approval.title).toContain(PATCH);
    expect(first.approval.approveAlways).toEqual({ tool: "call", actions: [PATCH] });
    await decideApproval({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, first.approval.id, {
      decision: "approve",
      always: true,
    });
    expect((await invoke(PATCH)).type).toBe("result");
    expect((await invoke(REMOVE)).type).toBe("approval");
    expect((await invoke([PATCH, REMOVE])).type).toBe("approval");
    expect(mcp.calls).toEqual([PATCH]);

    // Deletes tolerated: a call that only deletes runs; one that also patches still asks for the patch's rule.
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { unaskedRisks: ["deletes"] });
    expect((await invoke(REMOVE)).type).toBe("result");
    expect((await invoke("tools.google.api.calendar.calendars.calendarEventsInsert")).type).toBe("approval");
    expect(mcp.calls).toEqual([PATCH, REMOVE]);
    const rules = await f.db.select().from(schema.approvalRules).where(eq(schema.approvalRules.agentId, f.agent.id));
    expect(rules.map((r) => [r.tool, r.action])).toEqual([["call", PATCH]]);
  });
});
