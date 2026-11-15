import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { setClaudeDesignGrant } from "../src/claude-design/access";
import { createClaudeDesignToolSource } from "../src/claude-design/tools";
import { createToolGateway } from "../src/tools/gateway";
import { grantScopes } from "../src/tools/scopes";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
async function tools() {
  f = await designFixture();
  let dispatched = 0;
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  await grantScopes(f.db, f.org.id, f.agent.id, [
    { scope: "claude-design:write", connectionId: null },
    { scope: "claude-design:read", connectionId: null },
  ]);
  const hub = {
    status: async () => ({
      id: f.machineId,
      orgId: f.org.id,
      name: "Test",
      online: true,
      execAllowed: true,
      os: "darwin",
      protocol: 64,
      executors: { claude: { version: "2.1.322" } },
    }),
    call: async () => {
      dispatched++;
      return { taskId: "test", startedAt: new Date().toISOString(), cwd: "", command: "" } as never;
    },
  };
  const gateway = createToolGateway({
    sources: [
      createClaudeDesignToolSource({
        ...f.designDeps,
        hub,
        artifacts: f.artifactDeps,
        pubsub: f.pubsub,
        publicUrl: "https://example.invalid",
      }),
    ],
  });
  return { gateway, dispatched: () => dispatched };
}
test("API and existing MCP bridge contexts use the same app tool; never still requires a live grant", async () => {
  const { gateway, dispatched } = await tools();
  await f.db.update(schema.agents).set({ approvalsLevel: "never" }).where(eq(schema.agents.id, f.agent.id));
  const call = {
    toolUseId: "design-1",
    name: "create_claude_design",
    input: { title: "Sample", brief: "Create a sample" },
  };
  expect((await gateway.invoke(f.ctx, call)).type).toBe("result");
  expect(dispatched()).toBe(1);
  const [task] = await f.db.select().from(schema.machineTasks);
  expect(task?.channelId).toBe(f.ctx.channelId);
  expect(task?.threadRootId).toBeNull();
  const bridge = await gateway.invoke(
    { ...f.ctx, bridge: { machineId: f.machineId } },
    { ...call, toolUseId: "design-bridge" },
  );
  expect(bridge.type).toBe("result");
  expect(dispatched()).toBe(2);
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
  const next = await gateway.invoke(
    { ...f.ctx, bridge: { machineId: f.machineId } },
    { ...call, toolUseId: "design-2" },
  );
  expect(next.type).toBe("result");
  expect(dispatched()).toBe(2);
});
test("pending approvals are bound to the selected account grant revision", async () => {
  const { gateway, dispatched } = await tools();
  await f.db.update(schema.agents).set({ approvalsLevel: "always" }).where(eq(schema.agents.id, f.agent.id));
  const result = await gateway.invoke(f.ctx, {
    toolUseId: "design-approve",
    name: "create_claude_design",
    input: { title: "Sample", brief: "Sample", why: "The owner requested this private sample in this conversation." },
  });
  if (result.type !== "approval") throw new Error(JSON.stringify(result));
  expect(result.type).toBe("approval");
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  await f.db.update(schema.approvals).set({ status: "approved" }).where(eq(schema.approvals.id, result.approval.id));
  const output = await gateway.executeApproved(f.ctx, { ...result.approval, status: "approved" });
  expect(output.isError).toBe(true);
  expect(dispatched()).toBe(0);
});
test("extra account/environment/URL inputs and the wrong DM never dispatch", async () => {
  const { gateway, dispatched } = await tools();
  await f.db.update(schema.agents).set({ approvalsLevel: "never" }).where(eq(schema.agents.id, f.agent.id));
  for (const injected of [
    { accountId: f.accountId },
    { cwd: "/tmp" },
    { env: {} },
    { remoteUrl: "https://example.invalid" },
  ]) {
    await gateway.invoke(f.ctx, {
      toolUseId: crypto.randomUUID(),
      name: "create_claude_design",
      input: { title: "Sample", brief: "Sample", ...injected },
    });
  }
  await gateway.invoke(
    { ...f.ctx, channelId: f.general.id },
    { toolUseId: "wrong-dm", name: "create_claude_design", input: { title: "Sample", brief: "Sample" } },
  );
  expect(dispatched()).toBe(0);
});

test("routines and a revoked tool scope cannot dispatch, including after approval", async () => {
  const { gateway, dispatched } = await tools();
  const result = await gateway.invoke(f.ctx, {
    toolUseId: "scope-change",
    name: "create_claude_design",
    input: { title: "Sample", brief: "Sample", why: "The owner requested this private sample in this conversation." },
  });
  if (result.type !== "approval") throw new Error("Expected approval");
  await f.db.delete(schema.agentScopes).where(eq(schema.agentScopes.agentId, f.agent.id));
  const output = await gateway.executeApproved(f.ctx, { ...result.approval, status: "approved" });
  expect(output.isError).toBe(true);
  await grantScopes(f.db, f.org.id, f.agent.id, [{ scope: "claude-design:write", connectionId: null }]);
  await f.db.update(schema.agentRuns).set({ background: true }).where(eq(schema.agentRuns.id, f.ctx.runId));
  await gateway.invoke(f.ctx, {
    toolUseId: "routine",
    name: "create_claude_design",
    input: { title: "Sample", brief: "Sample", why: "The owner requested this private sample in this conversation." },
  });
  expect(dispatched()).toBe(0);
});
