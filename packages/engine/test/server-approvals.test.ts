import { afterEach, describe, expect, test } from "bun:test";
import { asc, eq, schema } from "@agenteschat/db";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  acceptCustomSuggestion,
  type CustomDeps,
  cancelRun,
  connectCustomServer,
  createConnectorToolSource,
  createToolGateway,
  decideApproval,
  drainOutbox,
  expireApprovals,
  listApprovals,
  listMessages,
  type McpConnect,
  mcpSessionOver,
  postPersonMessage,
  saveCustomTools,
  serverPauseOf,
  type ToolSource,
  updateAgent,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
/** The agent's reason, kept on a card when its call asks (and dropped when it doesn't). */
const WHY = "Ana asked to move the standup to 10h: this patches that event.";
afterEach(() => f?.close());

const paused = (requestId: string, tool: string) =>
  JSON.stringify({
    status: "approval-required",
    requestId,
    invocation: { tool, kind: "mutation", args: { eventId: "e1" } },
    elicitation: { mode: "form", message: `Approve ${tool}? It changes the event.` },
  });

describe("reading a server's own approval request", () => {
  test("only the whole result as that one object, with a request id and no form to fill", () => {
    expect(serverPauseOf(paused("apr_1", "api.calendar.patch"))).toEqual({
      requestId: "apr_1",
      message: "Approve api.calendar.patch? It changes the event.",
      action: "api.calendar.patch",
    });
    expect(serverPauseOf(` ${JSON.stringify({ status: "approval-required", requestId: "apr_2" })}\n`)).toEqual({
      requestId: "apr_2",
      message: "",
      action: null,
    });
    // Text that only mentions it, another status, an id of another kind, a form asking for fields: none of them.
    expect(serverPauseOf(`The page says: ${paused("apr_1", "x")}`)).toBeNull();
    expect(serverPauseOf(JSON.stringify({ status: "input-required", requestId: "elc_1" }))).toBeNull();
    expect(serverPauseOf(JSON.stringify({ status: "approval-required", requestId: "elc_1" }))).toBeNull();
    expect(serverPauseOf(JSON.stringify({ status: "approval-required", requestId: "apr_1 2" }))).toBeNull();
    expect(serverPauseOf(JSON.stringify({ status: "approval-required" }))).toBeNull();
    expect(
      serverPauseOf(
        JSON.stringify({
          status: "approval-required",
          requestId: "apr_3",
          elicitation: {
            mode: "form",
            message: "Pick",
            requestedSchema: { properties: { color: { type: "string" } } },
          },
        }),
      ),
    ).toBeNull();
    expect(serverPauseOf("[1,2]")).toBeNull();
    expect(serverPauseOf("{not json")).toBeNull();
  });
});

/**
 * A gateway shaped like Executor: `call` runs actions by path and pauses a write for approval; `resume` answers a
 * paused request; `search` reads. `pauses`: how many approvals each program asks for in a row; `callSensitive`: `call`
 * marked destructive, as a gateway that runs writes may mark it.
 */
function gatewayMcp(options: { resume?: boolean; pauses?: number; callSensitive?: boolean } = {}) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const pauses = options.pauses ?? 1;
  let asked = 0;
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const build = () => {
    const server = new McpServer({ name: "executor", version: "1" });
    server.registerTool(
      "call",
      {
        description: "Calls app tools by path",
        inputSchema: { calls: z.object({ path: z.string(), input: z.record(z.string(), z.unknown()) }) },
        ...(options.callSensitive ? { annotations: { destructiveHint: true } } : {}),
      },
      async (args) => {
        calls.push({ tool: "call", args });
        asked++;
        return text(paused(`apr_${asked}`, args.calls.path));
      },
    );
    if (options.resume !== false) {
      server.registerTool(
        "resume",
        {
          description: "Continue a paused program",
          inputSchema: { requestId: z.string(), response: z.object({ action: z.string() }) },
          annotations: { destructiveHint: true },
        },
        async (args) => {
          calls.push({ tool: "resume", args });
          if (args.response.action !== "accept") return text(`ended: ${args.response.action}`);
          if (asked < pauses) {
            asked++;
            return text(paused(`apr_${asked}`, "api.calendar.notify"));
          }
          return text(`{"ok":true,"value":"event patched (${args.requestId})"}`);
        },
      );
    }
    server.registerTool(
      "search",
      { description: "Searches tools", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } },
      async (args) => {
        calls.push({ tool: "search", args });
        return text("[]");
      },
    );
    return server;
  };
  const connect: McpConnect = async () => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    await build().connect(server);
    return mcpSessionOver(client);
  };
  return { connect, calls };
}

/** The model: calls the gateway once, then reports what came back. */
const reply = (req: Parameters<NonNullable<NonNullable<Parameters<typeof setup>[0]>["reply"]>>[0]) => {
  const last = req.messages.at(-1);
  const results =
    typeof last?.content === "string" ? [] : (last?.content ?? []).filter((b) => b.type === "tool_result");
  if (results.length > 0) return { chunks: ["Reported."] };
  return {
    chunks: ["Patching the event."],
    toolUses: [
      {
        name: "executor_call",
        input: { calls: { path: "api.calendar.patch", input: { eventId: "e1" } }, why: WHY },
      },
    ],
  };
};

/** A workspace whose agent reaches an Executor-like server connected by address, `call` freed to run alone. */
async function world(options: Parameters<typeof gatewayMcp>[0] & { callAsks?: boolean; trusted?: boolean } = {}) {
  const mcp = gatewayMcp({ ...options, callSensitive: options.callSensitive ?? options.trusted });
  let source: ToolSource | null = null;
  f = await setup({
    reply,
    toolSources: [{ name: "connectors", tools: (ctx) => source?.tools(ctx) ?? Promise.resolve([]) }],
  });
  const deps: CustomDeps = {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    publicUrl: "https://chat.example.com",
    resolveHost: async () => ["93.184.216.34"],
    connect: mcp.connect,
  };
  source = createConnectorToolSource(deps);
  const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
    serverUrl: "https://mcp.executor.example/mcp",
    apiKey: "fake_key_for_tests",
    label: "Executor",
  });
  if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
  await acceptCustomSuggestion(deps, f.owner.id, f.org.id, started.server.id);
  await saveCustomTools(deps, f.owner.id, f.org.id, started.server.id, {
    label: "Executor",
    // Trusting the connection (ADR 0175) moves what the save leaves out: `call` and `resume`, both sensitive.
    tools: options.trusted
      ? [{ name: "search", access: "read", label: "Search" }]
      : [
          { name: "call", access: options.callAsks ? "approval" : "write", label: "Call" },
          { name: "search", access: "read", label: "Search" },
          ...(options.resume === false ? [] : [{ name: "resume", access: "approval" as const, label: "Resume" }]),
        ],
    ...(options.trusted ? { trusted: true } : {}),
  });
  return { mcp, serverId: started.server.id, source };
}

const go = async () => {
  await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev move the standup to 10h",
  });
  await drainOutbox(f.db, f.handlers);
};
const runStatus = async () => (await f.db.select().from(schema.agentRuns))[0]?.status;
const pending = () => listApprovals(f.db, f.owner.id, f.org.id, { status: "pending" });
const decide = async (id: string, decision: "approve" | "refuse", reason?: string) => {
  await decideApproval({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, id, { decision, reason });
  await drainOutbox(f.db, f.handlers);
};
/** What the model read back for its call, after the run resumed. */
const toolResultText = () => {
  const messages = f.provider.calls.at(-1)?.request.messages ?? [];
  const last = [...messages].reverse().find((m) => m.role === "user" && typeof m.content !== "string");
  const block = typeof last?.content === "string" ? undefined : last?.content.find((b) => b.type === "tool_result");
  return block?.type === "tool_result" ? block.content : "";
};

describe("a server that asks for approval itself (ADR 0180)", () => {
  test("its request is our card, and approving it calls the server's resume once, with no second card", async () => {
    const { mcp } = await world();
    await go();
    expect(await runStatus()).toBe("waiting_approval");
    const [card, ...more] = await pending();
    expect(more).toEqual([]);
    expect(card).toMatchObject({
      tool: "executor_resume",
      title: "Executor: api.calendar.patch",
      detail: "Approve api.calendar.patch? It changes the event.",
      params: { requestId: "apr_1", response: { action: "accept" } },
      serverRequest: {
        server: "Executor",
        action: "api.calendar.patch",
        message: "Approve api.calendar.patch? It changes the event.",
      },
      approveAlways: null,
      canDecide: true,
    });
    // The card is in the chat; the model never read the server's request.
    const main = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    expect(main.at(-1)?.meta).toMatchObject({ approvalId: card?.id });
    expect(f.provider.calls).toHaveLength(1);

    await decide(card?.id ?? "", "approve");
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.map((c) => [c.tool, c.args])).toEqual([
      ["call", { calls: { path: "api.calendar.patch", input: { eventId: "e1" } } }],
      ["resume", { requestId: "apr_1", response: { action: "accept" } }],
    ]);
    expect(await pending()).toEqual([]);
    // The model reads what the action did, as the answer to its own call.
    expect(toolResultText()).toContain("event patched (apr_1)");
    expect(toolResultText()).not.toContain("approval-required");
    const [ran] = await listApprovals(f.db, f.owner.id, f.org.id, { status: "decided" });
    expect(ran?.executedAt).not.toBeNull();
    // The audit: the call asked, then the approved resume ran.
    const audit = await f.db
      .select({ outcome: schema.auditLog.outcome, tool: schema.auditLog.targetId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "tool.call"))
      .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));
    expect(audit.map((a) => [a.outcome, a.tool])).toEqual([
      ["pending", "executor_call"],
      ["done", "executor_resume"],
    ]);
  });

  test("refused: the server is told no through resume, the model reads the refusal", async () => {
    const { mcp } = await world();
    await go();
    const [card] = await pending();
    await decide(card?.id ?? "", "refuse", "not today");
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.map((c) => [c.tool, c.args])).toEqual([
      ["call", expect.anything()],
      ["resume", { requestId: "apr_1", response: { action: "decline" } }],
    ]);
    expect(toolResultText()).toContain("not today");
    expect(toolResultText()).not.toContain("ended: decline");
  });

  test("left alone until it expires: the server's request is canceled", async () => {
    const { mcp } = await world();
    await go();
    await expireApprovals({ db: f.db, pubsub: f.pubsub }, new Date(Date.now() + 25 * 3600_000));
    await drainOutbox(f.db, f.handlers);
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.at(-1)).toEqual({ tool: "resume", args: { requestId: "apr_1", response: { action: "cancel" } } });
  });

  test("a server that pauses again opens the next card, and the run waits on it", async () => {
    const { mcp } = await world({ pauses: 2 });
    await go();
    const [first] = await pending();
    await decide(first?.id ?? "", "approve");
    expect(await runStatus()).toBe("waiting_approval");
    const [second, ...more] = await pending();
    expect(more).toEqual([]);
    expect(second).toMatchObject({
      tool: "executor_resume",
      title: "Executor: api.calendar.notify",
      params: { requestId: "apr_2", response: { action: "accept" } },
    });
    // The model hasn't been asked anything since its call.
    expect(f.provider.calls).toHaveLength(1);
    await decide(second?.id ?? "", "approve");
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.filter((c) => c.tool === "resume").map((c) => c.args.requestId)).toEqual(["apr_1", "apr_2"]);
    expect(toolResultText()).toContain("event patched (apr_2)");
  });

  test("a call that asks too (not freed): our card for it, then the server's own, never the model's", async () => {
    const { mcp } = await world({ callAsks: true });
    await go();
    const [own] = await pending();
    expect(own).toMatchObject({ tool: "executor_call", why: WHY, serverRequest: null });
    await decide(own?.id ?? "", "approve");
    expect(await runStatus()).toBe("waiting_approval");
    const [server] = await pending();
    // The person's reason carries over to the server's card.
    expect(server).toMatchObject({ tool: "executor_resume", why: WHY, params: { requestId: "apr_1" } });
    await decide(server?.id ?? "", "approve");
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.map((c) => c.tool)).toEqual(["call", "resume"]);
    expect(toolResultText()).toContain("event patched (apr_1)");
  });

  test("a trusted connection (ADR 0175): the call runs unasked, and the server's own request is still our card", async () => {
    const { mcp } = await world({ trusted: true });
    await go();
    const [card, ...more] = await pending();
    expect(more).toEqual([]);
    expect(card).toMatchObject({ tool: "executor_resume", params: { requestId: "apr_1" } });
    await decide(card?.id ?? "", "approve");
    expect(await runStatus()).toBe("done");
    expect(mcp.calls.map((c) => c.tool)).toEqual(["call", "resume"]);
    expect(await pending()).toEqual([]);
  });

  test("a run canceled while it waits: the card is canceled and nothing reaches the server", async () => {
    const { mcp } = await world();
    await go();
    const [run] = await f.db.select().from(schema.agentRuns);
    await cancelRun({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, run?.id ?? "");
    await drainOutbox(f.db, f.handlers);
    expect(await runStatus()).toBe("canceled");
    expect(await pending()).toEqual([]);
    expect(mcp.calls.map((c) => c.tool)).toEqual(["call"]);
  });

  test("a retried job that finds the approved call ran waits on the server's next card again", async () => {
    const { source } = await world({ pauses: 2 });
    await go();
    const [first] = await pending();
    await decide(first?.id ?? "", "approve");
    const [second] = await pending();
    const [row] = await f.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, first?.id ?? ""));
    const [run] = await f.db.select().from(schema.agentRuns);
    if (!row || !run) throw new Error("no approval or run");
    const gateway = createToolGateway({ sources: [source] });
    const again = await gateway.executeApproved(
      {
        db: f.db,
        orgId: f.org.id,
        agentId: f.agent.id,
        runId: run.id,
        channelId: run.channelId,
        threadRootId: run.threadRootId,
        triggerMessageId: run.triggerMessageId,
      },
      row,
    );
    expect(again.waitForApproval?.id).toBe(second?.id);
  });

  test("an agent that never asks answers the server yes at once, with no card", async () => {
    const { mcp } = await world();
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: "never" });
    await go();
    expect(await runStatus()).toBe("done");
    expect(await pending()).toEqual([]);
    expect(mcp.calls.map((c) => c.tool)).toEqual(["call", "resume"]);
    expect(toolResultText()).toContain("event patched (apr_1)");
  });

  test("a server without resume (or with it off) keeps today's way: the model reads the request", async () => {
    const { mcp } = await world({ resume: false });
    await go();
    expect(await runStatus()).toBe("done");
    expect(await pending()).toEqual([]);
    expect(mcp.calls.map((c) => c.tool)).toEqual(["call"]);
    expect(toolResultText()).toContain('"status":"approval-required"');
  });
});
