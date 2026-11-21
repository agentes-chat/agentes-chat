import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  asksDestructiveOf,
  autonomyOf,
  createAgent,
  destructiveTool,
  ForbiddenError,
  getOrgSettings,
  type RunAuthority,
  setAgentAutonomy,
  type ToolDefinition,
  unaskedAtNever,
  updateAgent,
} from "../src";
import { approvalsLine } from "../src/context";
import { approvalsLevelOf } from "../src/tools/run-policy";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const person: RunAuthority = { kind: "person", personId: "user_ana" };
const appTool = (name: string, scope = "custom:shop:write"): ToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  scope,
  connectionId: "00000000-0000-4000-8000-0000000000aa",
  sensitive: true,
  execute: async () => ({ content: "done" }),
});

describe("Autonomia dos agentes", () => {
  test("is the workspace's level seen as one switch", () => {
    expect(autonomyOf("risky")).toEqual({ on: false, asksDestructive: true });
    expect(autonomyOf("always")).toEqual({ on: false, asksDestructive: true });
    expect(autonomyOf(undefined)).toEqual({ on: false, asksDestructive: true });
    expect(autonomyOf("never")).toEqual({ on: true, asksDestructive: false });
    expect(autonomyOf("autonomous")).toEqual({ on: true, asksDestructive: true });
  });

  test("destructive means a connected app's delete, payment or send, never our own tools", () => {
    expect(destructiveTool(appTool("delete_order"))).toBe(true);
    expect(destructiveTool(appTool("create_payment"))).toBe(true);
    expect(destructiveTool(appTool("gmail_send_email"))).toBe(true);
    expect(destructiveTool(appTool("merge_pull_request"))).toBe(false);
    expect(destructiveTool(appTool("deploy_service"))).toBe(false);
    expect(destructiveTool(appTool("update_order"))).toBe(false);
    expect(destructiveTool({ ...appTool("delete_issue"), connectionId: undefined, scope: "issues:write" })).toBe(false);
  });

  test("on with the guard, an agent that never asks still asks before a destructive call, and nothing else", () => {
    expect(unaskedAtNever("never", appTool("merge_pull_request"), person, true)).toBe(true);
    expect(unaskedAtNever("never", appTool("delete_order"), person, true)).toBe(false);
    expect(unaskedAtNever("never", appTool("delete_order"), person, false)).toBe(true);
  });

  test("turning it on sets every agent that follows the workspace to never ask, and off puts it back", async () => {
    f = await setup();
    const defaults = { model: f.agent.model };
    const bia = await createAgent(f.db, f.owner.id, f.org.id, { name: "Bia", handle: "bia" }, defaults);
    await updateAgent(f.db, f.owner.id, f.org.id, bia.id, { approvalsLevel: "always" });

    expect(await setAgentAutonomy(f.db, f.owner.id, f.org.id, { on: true, asksDestructive: true })).toEqual({
      on: true,
      asksDestructive: true,
      ownAgents: 1,
    });
    const settings = await getOrgSettings(f.db, f.owner.id, f.org.id);
    expect(settings.agentAutonomy).toEqual({ on: true, asksDestructive: true });
    expect(settings.approvalsLevel).toBe("never");
    expect(await approvalsLevelOf(f.db, f.org.id, f.agent.id)).toBe("never");
    expect(await asksDestructiveOf(f.db, f.org.id, f.agent.id)).toBe(true);
    // An agent with its own level keeps it, and the guard is the workspace's, not its.
    expect(await approvalsLevelOf(f.db, f.org.id, bia.id)).toBe("always");
    expect(await asksDestructiveOf(f.db, f.org.id, bia.id)).toBe(false);
    // A new agent follows the workspace at `never`, never at the stored `autonomous`.
    const caio = await createAgent(f.db, f.owner.id, f.org.id, { name: "Caio", handle: "caio" }, defaults);
    expect(caio.approvalsLevel).toBe("never");

    await setAgentAutonomy(f.db, f.owner.id, f.org.id, { on: true, asksDestructive: false });
    expect(await asksDestructiveOf(f.db, f.org.id, f.agent.id)).toBe(false);
    expect((await getOrgSettings(f.db, f.owner.id, f.org.id)).agentAutonomy).toEqual({
      on: true,
      asksDestructive: false,
    });

    await setAgentAutonomy(f.db, f.owner.id, f.org.id, { on: false, asksDestructive: true });
    expect(await approvalsLevelOf(f.db, f.org.id, f.agent.id)).toBe("risky");
    const [row] = await f.db
      .select({ level: schema.organizationSettings.approvalsLevel })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.orgId, f.org.id));
    expect(row?.level).toBe("risky");
  });

  test("only owners and administrators turn it", async () => {
    f = await setup();
    const member = await addMember(f.db, f.org.id, "member");
    await expect(
      setAgentAutonomy(f.db, member.id, f.org.id, { on: true, asksDestructive: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the prompt says what still asks", () => {
    const line = approvalsLine("never", false, true);
    expect(line).toContain("do it, without asking first");
    expect(line).toContain("deleting, paying or sending to people outside the workspace");
    expect(approvalsLine("never", false)).toContain("You are set to never ask");
  });
});
