import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, schema } from "@agenteschat/db";
import {
  type CustomDeps,
  connectCustomServer,
  createConnectorToolSource,
  createToolGateway,
  openConnectionSecret,
  postPersonMessage,
  revokeConnection,
  saveCustomTools,
  setAgentAccess,
  withStdioMcp,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture | undefined;
const folders: string[] = [];
afterEach(async () => {
  await f?.close();
  f = undefined;
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const config = () => ({
  command: process.execPath,
  args: [resolve(import.meta.dir, "fixtures/stdio-mcp.ts")],
  env: { STDIO_VALUE: "private-child-value" },
});
function deps(f: Fixture, allowed = true): CustomDeps {
  const base = { db: f.db, keyWrappers: [f.keyWrapper], publicUrl: "http://localhost:4311", stdioAllowed: allowed };
  return {
    ...base,
    connect: withStdioMcp(base, async () => {
      throw new Error("No remote network in this test");
    }),
  };
}

test("stores stdio encrypted, exposes the real tool, reconnects and enforces org/revocation at execution", async () => {
  f = await setup();
  const d = deps(f);
  const connected = await connectCustomServer(d, f.owner.id, f.org.id, { label: "Local context", stdio: config() });
  if (connected.status !== "connected") throw new Error("expected connected");
  expect(connected.server.authType).toBe("stdio");
  expect(connected.server.tools.map((t) => t.name)).toContain("read_context");
  expect(JSON.stringify(connected.server)).not.toContain("private-child-value");
  expect(JSON.stringify(connected.server)).not.toContain("stdio-mcp.ts");
  const [stored] = await f.db
    .select()
    .from(schema.connectorConnections)
    .where(eq(schema.connectorConnections.id, connected.server.id));
  if (!stored || !d.connect) throw new Error("missing connection");
  expect(stored.secretCiphertext).not.toContain("private-child-value");
  expect((await openConnectionSecret([f.keyWrapper], stored))?.stdio).toEqual(config());
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "Read the stdio test context",
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      threadRootId: message.id,
      triggerMessageId: message.id,
      trigger: "mention",
      hop: 1,
    })
    .returning();
  if (!run) throw new Error("missing test run");
  const ctx = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: message.id,
    triggerMessageId: message.id,
  };
  const source = createConnectorToolSource(d);
  expect(await source.tools(ctx)).toEqual([]);
  await saveCustomTools(d, f.owner.id, f.org.id, stored.id, {
    label: stored.label,
    tools: [{ name: "read_context", access: "read", label: "Read test context" }],
  });
  const offered = await source.tools(ctx);
  expect(offered.some((tool) => tool.name.endsWith("read_context"))).toBe(true);
  const gateway = createToolGateway({ sources: [source] });
  const name = offered[0]?.name;
  if (!name) throw new Error("missing stdio tool");
  const output = await gateway.invoke(ctx, { toolUseId: "stdio-call", name, input: {} });
  expect(output.type).toBe("result");
  expect(JSON.stringify(output)).toContain("private-child-value");
  await setAgentAccess(f.db, f.owner.id, f.org.id, f.agent.id, {
    all: false,
    connectors: {},
    scopes: [],
    tools: { allow: [], deny: [] },
  });
  expect(await gateway.list(ctx)).toEqual([]);
  const session = await d.connect(stored, {});
  try {
    expect(JSON.parse((await session.callTool("read_context", {})).content).value).toBe("private-child-value");
  } finally {
    await session.close();
  }
  await expect(d.connect({ ...stored, orgId: crypto.randomUUID() }, {})).rejects.toThrow("unavailable");
  await expect(deps(f, false).connect?.(stored, {})).rejects.toThrow("disabled");
  const next = { ...config(), env: { STDIO_VALUE: "reconnected" } };
  const reconnected = await connectCustomServer(d, f.owner.id, f.org.id, { connectionId: stored.id, stdio: next });
  if (reconnected.status !== "connected") throw new Error("expected reconnected");
  expect(reconnected.outcome).toBe("reconnected");
  expect(reconnected.server.id).toBe(stored.id);
  const changed = await d.connect(stored, {});
  try {
    expect(JSON.parse((await changed.callTool("read_context", {})).content).value).toBe("reconnected");
  } finally {
    await changed.close();
  }
  await revokeConnection(f.db, f.owner.id, f.org.id, stored.id);
  await expect(d.connect(stored, {})).rejects.toThrow("unavailable");
});

test("member, disabled transport and invalid process cannot create a connection or launch a child", async () => {
  f = await setup();
  const member = await addMember(f.db, f.org.id, "member", "reader");
  const folder = mkdtempSync(join(tmpdir(), "agentes-stdio-denied-"));
  folders.push(folder);
  const pid = join(folder, "pid");
  const stdio = { ...config(), env: { STDIO_PID_FILE: pid } };
  await expect(connectCustomServer(deps(f), member.id, f.org.id, { stdio })).rejects.toThrow();
  await expect(connectCustomServer(deps(f, false), f.owner.id, f.org.id, { stdio })).rejects.toThrow("disabled");
  expect(existsSync(pid)).toBe(false);
  await expect(
    connectCustomServer(deps(f), f.owner.id, f.org.id, { stdio: { ...config(), command: join(folder, "absent") } }),
  ).rejects.toThrow();
  expect(await f.db.select().from(schema.connectorConnections)).toEqual([]);
});
