import { afterEach, describe, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  acceptCustomSuggestion,
  type CustomDeps,
  connectCustomServer,
  createConnectorToolSource,
  createToolGateway,
  insertMessage,
  type McpConnect,
  mcpSessionOver,
  posthogReads,
  type RoutineBrief,
  type ToolContext,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

describe("which calls of PostHog's exec only read", () => {
  test("its catalog and a call of a read tool; a write, --confirm, several lines or another shape don't", () => {
    const cases: [unknown, boolean][] = [
      ["search query-", true],
      ["info query-trends", true],
      ["schema query-trends series", true],
      ["tools", true],
      ["help call", true],
      ['call query-trends {"series":[]}', true],
      ['call --json execute-sql {"query":"select 1"}', true],
      ['call read-data-schema {"query":{"kind":"events"}}', true],
      ["call insight-get {}", true],
      ["call dashboards-get-all {}", true],
      ["call feature-flag-get-all {}", true],
      ["  call  web-analytics-list {}  ", true],
      ['call dashboard-create {"name":"x"}', false],
      ['call feature-flag-update {"id":1}', false],
      ["call insight-delete {}", false],
      ["call switch-project {}", false],
      ["call --confirm insight-get {}", false],
      ["call", false],
      ["call --json", false],
      ["info query-trends\ncall dashboard-create {}", false],
      ["learn posthog:querying-posthog-data", false],
      ["", false],
      [3, false],
      [undefined, false],
    ];
    expect(cases.map(([command]) => [command, posthogReads({ command })])).toEqual(cases);
  });
});

/** PostHog's server as it answers: one `exec` tool. */
function posthogMcp() {
  const calls: string[] = [];
  const connect: McpConnect = async () => {
    const server = new McpServer({ name: "posthog", version: "1" });
    server.registerTool(
      "exec",
      { description: "Run a PostHog command", inputSchema: { command: z.string(), context: z.string().optional() } },
      async (args) => {
        calls.push(args.command);
        return { content: [{ type: "text" as const, text: "[1, 2, 3]" }] };
      },
    );
    const [client, end] = InMemoryTransport.createLinkedPair();
    await server.connect(end);
    return mcpSessionOver(client);
  };
  return { connect, calls };
}

/** A widget's refresh run (its trigger's brief names the widget), to call tools in. */
async function widgetRun(fx: Fixture): Promise<ToolContext> {
  const brief: RoutineBrief = {
    routineId: crypto.randomUUID(),
    routineRunId: crypto.randomUUID(),
    name: "Visitas por dia",
    creatorUserId: fx.owner.id,
    deliverTo: { channelId: fx.general.id, threadId: null },
    access: "act",
    report: "when_new",
    trigger: "schedule",
    dueAt: new Date().toISOString(),
    widget: { widgetId: crypto.randomUUID(), dashboardId: crypto.randomUUID() },
  };
  const msg = await insertMessage(fx.db, {
    orgId: fx.org.id,
    channelId: fx.general.id,
    author: { type: "person", userId: fx.owner.id },
    body: "Visitas por dia",
    meta: { routineBrief: brief, background: true },
  });
  const [run] = await fx.db
    .insert(schema.agentRuns)
    .values({
      orgId: fx.org.id,
      agentId: fx.agent.id,
      channelId: fx.general.id,
      threadRootId: msg.id,
      triggerMessageId: msg.id,
      trigger: "mention",
      hop: 1,
      background: true,
    })
    .returning();
  if (!run) throw new Error("no run");
  return {
    db: fx.db,
    orgId: fx.org.id,
    agentId: fx.agent.id,
    runId: run.id,
    channelId: fx.general.id,
    threadRootId: msg.id,
    triggerMessageId: msg.id,
    background: true,
  };
}

describe("PostHog in a widget's refresh run (ADR 0135 §5)", () => {
  test("exec is listed, its reads run and its writes are refused with why", async () => {
    f = await setup();
    const mcp = posthogMcp();
    const deps: CustomDeps = {
      db: f.db,
      keyWrappers: [f.keyWrapper],
      publicUrl: "https://chat.example.com",
      resolveHost: async () => ["93.184.216.34"],
      connect: mcp.connect,
    };
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: "https://mcp.posthog.com/mcp",
      apiKey: "phx_fake_key_for_tests",
      label: "PostHog",
    });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    await acceptCustomSuggestion(deps, f.owner.id, f.org.id, started.server.id);
    const gateway = createToolGateway({ sources: [createConnectorToolSource(deps)] });
    const ctx = await widgetRun(f);

    const exec = (await gateway.granted(ctx)).find((t) => t.connectionId === started.server.id);
    expect(exec).toBeDefined();
    const name = exec?.name ?? "";
    const invoke = (command: string) =>
      gateway.invoke(ctx, { toolUseId: crypto.randomUUID(), name, input: { command, context: "a widget" } });

    const read = await invoke('call query-trends {"series":[]}');
    expect(read).toMatchObject({ type: "result", output: { isError: false } });
    const write = await invoke('call dashboard-create {"name":"x"}');
    expect(write).toMatchObject({ type: "result", output: { isError: true } });
    expect(mcp.calls).toEqual(['call query-trends {"series":[]}']);
  });
});
