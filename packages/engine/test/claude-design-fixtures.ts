import { eq, schema } from "@agenteschat/db";
import { openDm } from "../src/dms";
import { grantScopes } from "../src/tools/scopes";
import type { ToolContext } from "../src/tools/types";
import { setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

export async function designFixture() {
  const f = await setup();
  const { machineId } = await pairMachine(f, f.owner.id, f.org.id, { os: "darwin", arch: "arm64", protocol: 65 });
  await f.db
    .update(schema.machines)
    .set({ online: true, executors: { claude: { version: "2.1.322", loggedIn: true } } })
    .where(eq(schema.machines.id, machineId));
  await grantScopes(f.db, f.org.id, f.agent.id, [
    { scope: "claude-design:write", connectionId: null },
    { scope: "claude-design:read", connectionId: null },
  ]);
  const accountId = crypto.randomUUID();
  await f.db.insert(schema.machineAccounts).values({
    id: accountId,
    orgId: f.org.id,
    machineId,
    kind: "claude_code",
    label: "Test",
    createdBy: f.owner.id,
    authMethod: "cli_login",
    status: "active",
  });
  const dm = await openDm(f.db, f.owner.id, f.org.id, { agentId: f.agent.id });
  const [message] = await f.db
    .insert(schema.messages)
    .values({
      orgId: f.org.id,
      channelId: dm.id,
      authorType: "person",
      authorUserId: f.owner.id,
      body: "Design a sample",
    })
    .returning();
  if (!message) throw new Error("missing message");
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: dm.id,
      threadRootId: message.id,
      triggerMessageId: message.id,
      trigger: "dm",
      hop: 1,
    })
    .returning();
  if (!run) throw new Error("missing run");
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    channelId: dm.id,
    threadRootId: message.id,
    triggerMessageId: message.id,
    runId: run.id,
    toolUseId: "call-1",
  };
  return { ...f, machineId, accountId, ctx, designDeps: { db: f.db, enabled: true } };
}
export type DesignFixture = Awaited<ReturnType<typeof designFixture>>;
