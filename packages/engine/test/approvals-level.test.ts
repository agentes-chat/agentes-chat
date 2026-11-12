import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  type ApprovalsLevel,
  createAgent,
  ForbiddenError,
  grantScopes,
  insertMessage,
  type RunAuthority,
  type ToolContext,
  type ToolDefinition,
  type ToolSource,
  toolPolicy,
  unaskedAtNever,
  updateAgent,
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
const LEVELS: ApprovalsLevel[] = ["always", "risky", "never"];
const ran: string[] = [];

const shopTool = (name: string, scope: string, sensitive = false): ToolDefinition => ({
  name,
  description: name,
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  scope,
  connectionId: CONNECTION,
  connectorLabel: "Shop",
  ...(sensitive ? { sensitive: true } : {}),
  execute: async () => {
    ran.push(name);
    return { content: "done" };
  },
});

const READ = shopTool("shop_get_order", "shop:orders.read");
/** An ordinary write: nothing marks it sensitive. */
const WRITE = shopTool("shop_update_order", "shop:orders.write");
/** Marked sensitive (its level, a delete): asks unless the agent never asks. */
const SENSITIVE = shopTool("shop_delete_customer", "shop:customers.delete", true);
/** The class that always asks, whatever a connector or a level says. */
const MERGE = shopTool("shop_merge_branch", "shop:code.write", true);
const DEPLOY = shopTool("shop_deploy_site", "shop:sites.write");
const shop: ToolSource = { name: "shop", tools: async () => [READ, WRITE, SENSITIVE, MERGE, DEPLOY] };

const person: RunAuthority = { kind: "person", personId: "user_ana" };
const own: RunAuthority = { kind: "unattended", personId: null, reason: "agent" };
/** Nobody behind it, woken by a routine's report: what the routine read feeds it. */
const fed: RunAuthority = { kind: "unattended", personId: null, reason: "routine_report", brief: null };
const routine: RunAuthority = { kind: "routine", personId: null, brief: null };

describe("the policy, by level", () => {
  const action = (authority: RunAuthority, tool: ToolDefinition, level: ApprovalsLevel) =>
    toolPolicy(authority, tool, level).action;

  test("always: every write to a connected app asks, on a person's run and on the agent's own", () => {
    for (const authority of [person, own]) {
      expect(action(authority, WRITE, "always")).toBe("approve");
      expect(action(authority, SENSITIVE, "always")).toBe("approve");
      expect(action(authority, MERGE, "always")).toBe("approve");
      expect(action(authority, READ, "always")).toBe("allow");
    }
  });

  test("risky and never leave the policy as it was: the tools' own marks decide", () => {
    for (const level of ["risky", "never"] as const) {
      for (const tool of [READ, WRITE, SENSITIVE, MERGE]) expect(action(person, tool, level)).toBe("allow");
    }
    expect(toolPolicy(person, WRITE)).toEqual(toolPolicy(person, WRITE, "risky"));
  });

  test("a routine's run and one its reading feeds ask for every write at every level", () => {
    for (const level of LEVELS) {
      for (const authority of [fed, routine]) {
        expect(action(authority, WRITE, level)).toBe("approve");
        expect(action(authority, SENSITIVE, level)).toBe("approve");
        expect(action(authority, MERGE, level)).toBe("approve");
        expect(action(authority, READ, level)).toBe("allow");
      }
    }
  });
});

describe("what never stops asking for", () => {
  const allow = { action: "allow" } as const;
  const covers = (tool: ToolDefinition, authority: RunAuthority | null = person, level: ApprovalsLevel = "never") =>
    unaskedAtNever(level, tool, { id: "1" }, authority, authority ? toolPolicy(authority, tool, level) : allow);

  test("a connected app's sensitive tool, on a person's run and on the agent's own", () => {
    expect(covers(SENSITIVE)).toBe(true);
    expect(covers(SENSITIVE, own)).toBe(true);
  });

  test("only at never", () => {
    expect(covers(SENSITIVE, person, "risky")).toBe(false);
    expect(covers(SENSITIVE, person, "always")).toBe(false);
  });

  test("never merge, deploy, rollback, nor what starts them under another name or runs anything", () => {
    const names = [
      "shop_merge_branch",
      "shop_deploy_site",
      "shop_rollback_release",
      "shop_promote_build",
      "shop_trigger_workflow",
      "shop_run_script",
      "shop_execute_sql",
    ];
    expect(names.filter((name) => covers({ ...SENSITIVE, name }))).toEqual([]);
    expect(covers({ ...SENSITIVE, scope: "shop:deploy" })).toBe(false);
    // The scope alone may say it, as a noun too: what "Aprovar sempre" never covers, this doesn't either.
    expect(covers({ ...SENSITIVE, name: "shop_create_site", scope: "shop:deployments.write" })).toBe(false);
  });

  test("never a run fed by a routine's reading, a routine's own, or a call outside a run", () => {
    expect(covers(SENSITIVE, fed)).toBe(false);
    expect(covers(SENSITIVE, routine)).toBe(false);
    expect(covers(SENSITIVE, null)).toBe(false);
    // Whatever the policy answered for it: the run alone decides.
    for (const authority of [fed, routine]) {
      expect(unaskedAtNever("never", SENSITIVE, { id: "1" }, authority, allow)).toBe(false);
    }
  });

  test("never a tool with its own approvers, nor one of ours", () => {
    expect(covers({ ...SENSITIVE, approvers: async () => ({ ok: true, approvers: null }) })).toBe(false);
    expect(covers({ ...SENSITIVE, connectionId: null })).toBe(false);
  });

  test("a tool that runs other actions: by the actions the call names, and never unseen", () => {
    const executor = (actions: string[] | null): ToolDefinition => ({ ...SENSITIVE, actions: () => actions });
    expect(covers(executor(["GMAIL_SEND_EMAIL", "SLACK_DELETES_A_MESSAGE_FROM_A_CHAT"]))).toBe(true);
    expect(covers(executor(["GMAIL_SEND_EMAIL", "GITHUB_MERGE_A_PULL_REQUEST"]))).toBe(false);
    expect(covers(executor(["VERCEL_CREATE_NEW_DEPLOYMENT"]))).toBe(false);
    expect(covers(executor(null))).toBe(false);
    const tool = executor(["GMAIL_SEND_EMAIL"]);
    expect(unaskedAtNever("never", tool, null, person, allow)).toBe(false);
  });
});

// ── Through the gateway ──────────────────────────────────────────────────────

type Kind = "person" | "fed";

async function world(level: ApprovalsLevel, scopes = [{ connectionId: null, scope: "*" }]) {
  ran.length = 0;
  f = await setup({ toolSources: [shop] });
  await grantScopes(f.db, f.org.id, f.agent.id, scopes);
  if (level !== "risky") await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: level });
}

/** A run of the agent in #general: a person's, or one a routine's report woke (`fed`). */
async function runAs(kind: Kind): Promise<ToolContext> {
  const trigger = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author:
      kind === "fed"
        ? { type: "agent", agentId: f.agent.id, runId: null, hop: 1, stretchId: null }
        : { type: "person", userId: f.owner.id },
    body: "hi",
    meta:
      kind === "fed"
        ? { notice: { kind: "routine_handoff", text: "hi", from: "Routine", refs: { runId: crypto.randomUUID() } } }
        : undefined,
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
  };
}

const tools = () => {
  if (!f.tools) throw new Error("no tools");
  return f.tools;
};
/** What a call does: `ran`, `asked` (an approval card) or the refusal's text. */
async function outcome(ctx: ToolContext, tool: ToolDefinition, input: Record<string, unknown> = { id: "1", why: WHY }) {
  const result = await tools().invoke(ctx, { toolUseId: `tu_${crypto.randomUUID()}`, name: tool.name, input });
  if (result.type === "approval") return "asked";
  if (result.type !== "result") return result.type;
  return result.output.isError ? result.output.content : "ran";
}
const requiresWhy = (t: ToolDefinition | undefined) =>
  Array.isArray(t?.inputSchema.required) && (t.inputSchema.required as string[]).includes("why");
const toolCalls = async (tool: string) =>
  (
    await f.db
      .select({ details: schema.auditLog.details, outcome: schema.auditLog.outcome })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "tool.call"), eq(schema.auditLog.targetId, tool)))
  ).map((row) => ({ outcome: row.outcome, level: (row.details as Record<string, unknown>).approvalsLevel ?? null }));

describe("the gateway, a person's run", () => {
  const table: [ApprovalsLevel, Record<"read" | "write" | "sensitive" | "merge" | "deploy", string>][] = [
    ["always", { read: "ran", write: "asked", sensitive: "asked", merge: "asked", deploy: "asked" }],
    ["risky", { read: "ran", write: "ran", sensitive: "asked", merge: "asked", deploy: "asked" }],
    ["never", { read: "ran", write: "ran", sensitive: "ran", merge: "asked", deploy: "asked" }],
  ];
  for (const [level, expected] of table) {
    test(level, async () => {
      await world(level);
      const ctx = await runAs("person");
      expect({
        read: await outcome(ctx, READ, { id: "1" }),
        write: await outcome(ctx, WRITE),
        sensitive: await outcome(ctx, SENSITIVE),
        merge: await outcome(ctx, MERGE),
        deploy: await outcome(ctx, DEPLOY),
      }).toEqual(expected);
    });
  }
});

describe("the gateway, a run a routine's reading feeds", () => {
  for (const level of LEVELS) {
    test(`${level}: every write to a connected app asks`, async () => {
      await world(level);
      const ctx = await runAs("fed");
      expect({
        read: await outcome(ctx, READ, { id: "1" }),
        write: await outcome(ctx, WRITE),
        sensitive: await outcome(ctx, SENSITIVE),
        merge: await outcome(ctx, MERGE),
      }).toEqual({ read: "ran", write: "asked", sensitive: "asked", merge: "asked" });
      expect(ran).toEqual([READ.name]);
    });
  }
});

describe("never", () => {
  test("the call needs no why, and the audit says it ran unasked because of the level", async () => {
    await world("never");
    const ctx = await runAs("person");
    const listed = new Map((await tools().list(ctx)).map((t) => [t.name, t]));
    expect(requiresWhy(listed.get(SENSITIVE.name))).toBe(false);
    expect(requiresWhy(listed.get(MERGE.name))).toBe(true);
    expect(await outcome(ctx, SENSITIVE, { id: "1" })).toBe("ran");
    expect(await f.db.select().from(schema.approvals)).toEqual([]);
    expect(await toolCalls(SENSITIVE.name)).toEqual([{ outcome: "done", level: "never" }]);
    // An ordinary write never asked: nothing to say about the level.
    expect(await outcome(ctx, WRITE, { id: "1" })).toBe("ran");
    expect(await toolCalls(WRITE.name)).toEqual([{ outcome: "done", level: null }]);
  });

  test("it gives no tool the agent's scopes don't", async () => {
    await world("never", [{ connectionId: null, scope: "issues:read" }]);
    const ctx = await runAs("person");
    expect(await outcome(ctx, SENSITIVE)).toMatch(/^Not allowed/);
    expect(ran).toEqual([]);
  });

  test("narrowed back, the next call asks", async () => {
    await world("never");
    const ctx = await runAs("person");
    expect(await outcome(ctx, SENSITIVE)).toBe("ran");
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: "risky" });
    expect(await outcome(ctx, SENSITIVE)).toBe("asked");
  });
});

describe("always", () => {
  test("a write lists as one that asks and takes its why", async () => {
    await world("always");
    const ctx = await runAs("person");
    const listed = new Map((await tools().list(ctx)).map((t) => [t.name, t]));
    expect(requiresWhy(listed.get(WRITE.name))).toBe(true);
    expect(requiresWhy(listed.get(READ.name))).toBe(false);
    expect(await outcome(ctx, WRITE, { id: "1" })).toMatch(/^Say why first/);
    expect(ran).toEqual([]);
  });
});

describe("who sets it", () => {
  test("a new agent asks for what is risky; whoever manages agents changes it, with a value we know", async () => {
    f = await setup();
    const defaults = { model: f.agent.model };
    const made = await createAgent(f.db, f.owner.id, f.org.id, { name: "Bia", handle: "bia" }, defaults);
    expect(made.approvalsLevel).toBe("risky");
    const member = await addMember(f.db, f.org.id, "member", "Caio");
    // Creating one's own agent is open to members; choosing how much it asks is not.
    await expect(
      createAgent(f.db, member.id, f.org.id, { name: "Edu", handle: "edu", approvalsLevel: "never" }, defaults),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateAgent(f.db, member.id, f.org.id, made.id, { approvalsLevel: "never" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateAgent(f.db, f.owner.id, f.org.id, made.id, { approvalsLevel: "sometimes" as ApprovalsLevel }),
    ).rejects.toBeInstanceOf(ValidationError);
    const admin = await addMember(f.db, f.org.id, "admin", "Davi");
    expect((await updateAgent(f.db, admin.id, f.org.id, made.id, { approvalsLevel: "never" })).approvalsLevel).toBe(
      "never",
    );
    const [audit] = await f.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "agent.updated"), eq(schema.auditLog.targetId, made.id)));
    expect(audit?.details).toMatchObject({ changed: ["approvalsLevel"], approvalsLevel: "never" });
  });
});
