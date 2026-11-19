import { afterEach, describe, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION, type MachineRequest, type ServerFrame } from "@agenteschat/adapters";
import { countQueries, eq, schema, sql } from "@agenteschat/db";
import { systemText } from "@agenteschat/providers";
import * as engine from "../src";
import {
  type AgentRun,
  agentScopeFromDb,
  archiveAgent,
  buildRunContext,
  computerDrivers,
  computerDriving,
  createAgent,
  createAgentRuns,
  deleteAgent,
  desktopTarget,
  detachMachine,
  enableCaches,
  ensureRightHand,
  ForbiddenError,
  getAgent,
  getAgentCached,
  grantScopes,
  insertMessage,
  type MachineHub,
  MachineRequestError,
  machineAccessText,
  machineAgents,
  machineScope,
  membersOf,
  moveAgentsFromMachine,
  NotFoundError,
  postPersonMessage,
  RIGHT_HAND,
  releaseHold,
  resolveForRow,
  setAgentCoAuthor,
  setAgentComputerTarget,
  setAgentHold,
  setWorksOn,
  startMachineTask,
  stopMembersWork,
  stopOrgWork,
  type ToolContext,
  unarchiveAgent,
  ValidationError,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { fakeRunner, pairMachine } from "./machine-fixtures";

/**
 * "Works on the computer of" (ADR 0202): agent M works, on agent L's computer, as L does there (L's id and handle on every
 * request), and stays its own agent everywhere else. M = member, L = lead in the names below (never in the product's
 * words). Every check reads its expected value from the rules, not from the code's output.
 */

let f: Fixture;
afterEach(async () => {
  enableCaches(false);
  await f?.machineHub?.stop();
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub, publicUrl: "https://agentes.chat" });
const RUNNER = { hostname: "box", os: "linux", arch: "x64", version: "0.1.0", workspace: "/home/u/agentes" };

const addAgent = (name: string, ownerId: string | null = f.owner.id, orgId = f.org.id) =>
  createAgent(
    f.db,
    f.owner.id,
    orgId,
    { name, handle: name.toLowerCase(), role: "Dev", credentialId: f.credential.id, ownerUserId: ownerId },
    { model: "claude-sonnet-5-5" },
  );
const pair = (name = "Build box", actorId = f.owner.id) =>
  pairMachine(deps(), actorId, f.org.id, { name, ...RUNNER, protocol: MACHINE_PROTOCOL_VERSION, exec: true });
const row = async (id: string) => {
  const [r] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, id));
  if (!r) throw new Error("no agent");
  return r;
};
const link = (memberId: string, leadId: string | null, actorId = f.owner.id) =>
  setWorksOn(deps(), actorId, f.org.id, memberId, leadId);
const ctxOf = (agentId: string) => ({ db: f.db, orgId: f.org.id, agentId });
const scopeOf = (agentId: string, machineId: string) =>
  machineScope(f.machineHub as MachineHub, ctxOf(agentId), machineId);

/** A lead on a computer and a member on the same one, not yet linked. */
async function crew() {
  f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
  const box = await pair();
  const lead = await addAgent("Ada");
  const member = await addAgent("Bia");
  await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, box.machineId);
  await setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, box.machineId);
  return { box, lead, member };
}

const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(Error);
  return e as Error;
};

const SANDBOX = [{ connectionId: null, scope: "sandbox:run" }];
/** A runner that answers the task ops (start, cancel, status) and records them. */
function taskRunner(token: string) {
  const hub = f.machineHub as MachineHub;
  const sent: ServerFrame[] = [];
  const reply = (frame: unknown) => hub.message(conn, JSON.stringify(frame));
  const conn = hub.open({
    send(text: string) {
      const frame = JSON.parse(text) as ServerFrame;
      sent.push(frame);
      if (frame.type !== "request") return;
      setTimeout(() => {
        const ok = (data: unknown) => void reply({ type: "result", id: frame.id, ok: true, data });
        if (frame.op === "task.start")
          return ok({
            taskId: frame.taskId,
            pid: 100,
            startedAt: new Date().toISOString(),
            cwd: "",
            command: "bun dev",
          });
        if (frame.op === "task.cancel") return ok({ canceled: true });
        if (frame.op === "task.status") return ok({ tasks: [] });
        if (frame.op === "exec") return ok({ exitCode: 0, stdout: "", stderr: "" });
        ok({});
      }, 1);
    },
    close() {
      void hub.close(conn);
    },
  });
  return {
    sent,
    hello: (extra: Record<string, unknown> = {}) =>
      hub.message(
        conn,
        JSON.stringify({
          type: "hello",
          token,
          ...RUNNER,
          protocol: MACHINE_PROTOCOL_VERSION,
          exec: true,
          mode: "system",
          executors: {},
          ...extra,
        }),
      ),
    disconnect: () => hub.close(conn),
  };
}

/** A tool call as `agent` makes it, with a run of its own (the gateway checks scopes, holds and the run's agent). */
async function toolsFor(agent: { id: string }, _machineId: string) {
  await grantScopes(f.db, f.org.id, agent.id, SANDBOX);
  await engine.addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { agentId: agent.id }).catch(() => null);
  const message = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "go",
  });
  const [run] = await f.db.transaction((tx) => createAgentRuns(tx, message, [agent.id], "mention"));
  if (!run) throw new Error("no run");
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    agentId: agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
  };
  const call = async (name: string, input: Record<string, unknown>) => {
    const outcome = await f.tools?.invoke(ctx, { toolUseId: crypto.randomUUID(), name, input });
    if (outcome?.type !== "result") throw new Error(`expected a result, got ${outcome?.type}`);
    return outcome.output;
  };
  return { ctx, call, run };
}

describe("setting it", () => {
  test("links: the member's worksOnAgentId is the lead's, it moves to the lead's computer and drops its old sign-in, and the next read shows it", async () => {
    f = await setup({ machines: true });
    const lead = await addAgent("Ada");
    const member = await addAgent("Bia");
    const here = await pair("Lead box");
    const there = await pair("Member box");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, here.machineId);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, there.machineId);
    expect((await getAgentCached(f.db, f.org.id, member.id))?.worksOnAgentId ?? null).toBeNull();

    await link(member.id, lead.id);

    const after = await row(member.id);
    expect(after.worksOnAgentId).toBe(lead.id);
    expect(after.machineId).toBe(here.machineId);
    expect((await getAgentCached(f.db, f.org.id, member.id))?.worksOnAgentId).toBe(lead.id);
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "agent.works_on_changed"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(member.id);
  });

  test("a member's sign-in on its old computer is cleared by the move, like any move", async () => {
    f = await setup({ machines: true });
    const lead = await addAgent("Ada");
    const member = await addAgent("Bia");
    const here = await pair("Lead box");
    const there = await pair("Member box");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, here.machineId);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, there.machineId);
    const [acc] = await f.db
      .insert(schema.machineAccounts)
      .values({
        id: crypto.randomUUID(),
        orgId: f.org.id,
        machineId: there.machineId,
        kind: "claude_code",
        label: "Bia",
        status: "active",
        createdBy: f.owner.id,
      })
      .returning();
    await f.db
      .update(schema.agents)
      .set({ brain: "claude_code", brainAccountId: acc?.id ?? null })
      .where(eq(schema.agents.id, member.id));
    await link(member.id, lead.id);
    expect((await row(member.id)).brainAccountId).toBeNull();
  });

  test("linking sets reports_to nowhere: the line is a separate thing (ADR 0148)", async () => {
    const { lead, member } = await crew();
    await f.db.update(schema.agents).set({ reportsToAgentId: null }).where(eq(schema.agents.id, member.id));
    await link(member.id, lead.id);
    expect((await row(member.id)).reportsToAgentId).toBeNull();
    expect((await row(lead.id)).reportsToAgentId).toBeNull();
  });

  test("unlinking clears the link, keeps the computer the member is on, and a repeat changes and audits nothing", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await link(member.id, null);
    expect(await row(member.id)).toMatchObject({ worksOnAgentId: null, machineId: box.machineId });
    await link(member.id, null);
    // Setting the same lead twice is one change, not two.
    await link(member.id, lead.id);
    await link(member.id, lead.id);
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "agent.works_on_changed"));
    expect(audit).toHaveLength(3);
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("refused, each leaving both agents as they were: itself, nobody, another workspace, archived, deleted, the right hand at either end", async () => {
    const { box, lead, member } = await crew();
    // The control: the same actor and agents link fine.
    await link(member.id, lead.id);
    await link(member.id, null);

    const [other] = await f.db.insert(schema.organizations).values({ name: "Other" }).returning();
    const [foreign] = await f.db
      .insert(schema.agents)
      .values({
        orgId: other?.id ?? "",
        name: "Zed",
        handle: "zed",
        role: "x",
        model: "claude-sonnet-5-5",
        ownerUserId: f.owner.id,
      })
      .returning();
    const archived = await addAgent("Old");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, archived.id, box.machineId);
    await archiveAgent(f.db, f.owner.id, f.org.id, archived.id);
    const gone = await addAgent("Gone");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, gone.id, box.machineId);
    await deleteAgent({ db: f.db, pubsub: f.pubsub, hub: f.machineHub }, f.owner.id, f.org.id, gone.id);
    await ensureRightHand(f.db, f.org.id);
    const [hand] = await f.db.select().from(schema.agents).where(eq(schema.agents.builtin, RIGHT_HAND));

    const cases: [string, () => Promise<unknown>, unknown][] = [
      ["itself", () => link(member.id, member.id), ValidationError],
      ["nobody", () => link(member.id, crypto.randomUUID()), NotFoundError],
      ["archived lead", () => link(member.id, archived.id), ValidationError],
      ["deleted lead", () => link(member.id, gone.id), NotFoundError],
      ...(hand
        ? ([
            ["right hand as lead", () => link(member.id, hand.id), ValidationError],
            ["right hand as member", () => link(hand.id, lead.id), ValidationError],
          ] as [string, () => Promise<unknown>, unknown][])
        : []),
      ...(foreign
        ? ([["lead of another workspace", () => link(member.id, foreign.id), NotFoundError]] as [
            string,
            () => Promise<unknown>,
            unknown,
          ][])
        : []),
    ];
    for (const [, run, kind] of cases) expect(await refusal(run())).toBeInstanceOf(kind as typeof Error);
    // Refused twice in a row: still refused, still nothing changed.
    expect(await refusal(link(member.id, member.id))).toBeInstanceOf(ValidationError);
    expect(hand).toBeDefined();
    expect(foreign).not.toBeNull();
    expect(await row(member.id)).toMatchObject({ worksOnAgentId: null, machineId: box.machineId });
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
  });

  test("one level: a lead can't work on another, and one that has members can't become a member", async () => {
    const { box, lead, member } = await crew();
    const third = await addAgent("Cy");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, third.id, box.machineId);
    await link(member.id, lead.id);
    // At the limit: a second member under the same lead is fine.
    await link(third.id, lead.id);
    expect((await membersOf(f.db, f.org.id, lead.id)).map((m: { id: string }) => m.id).sort()).toEqual(
      [member.id, third.id].sort(),
    );
    // One past it: a member as lead (L → M → X), and a lead as member (L → X).
    const x = await addAgent("Xi");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, x.id, box.machineId);
    const deep = await refusal(link(x.id, member.id));
    expect(deep).toBeInstanceOf(ValidationError);
    expect(deep.message).toContain("Bia");
    const upward = await refusal(link(lead.id, x.id));
    expect(upward).toBeInstanceOf(ValidationError);
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
    expect((await row(x.id)).worksOnAgentId).toBeNull();
  });

  test("only agents with the same, non-null owner", async () => {
    const { box, lead, member } = await crew();
    const bob = await addMember(f.db, f.org.id, "admin", "bob");
    const bobs = await addAgent("Bobby", bob.id);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, bobs.id, box.machineId);
    const mixed = await refusal(link(bobs.id, lead.id));
    expect(mixed).toBeInstanceOf(ValidationError);
    expect(mixed.message).toContain("Ada");
    const ownerless = await addAgent("Nobody", null);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, ownerless.id, box.machineId);
    expect(await refusal(link(ownerless.id, lead.id))).toBeInstanceOf(ValidationError);
    expect(await refusal(link(member.id, ownerless.id))).toBeInstanceOf(ValidationError);
    expect((await row(bobs.id)).worksOnAgentId).toBeNull();
    await link(member.id, lead.id);
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("a lead with no computer can't be worked on", async () => {
    f = await setup({ machines: true });
    const lead = await addAgent("Ada");
    const member = await addAgent("Bia");
    const e = await refusal(link(member.id, lead.id));
    expect(e).toBeInstanceOf(ValidationError);
    expect((await row(member.id)).worksOnAgentId).toBeNull();
  });

  test("who may: manages both agents AND may put the member on the lead's computer", async () => {
    f = await setup({ machines: true });
    const bob = await addMember(f.db, f.org.id, "member", "bob");
    const mine = await addAgent("Mine", bob.id);
    const mine2 = await addAgent("Mine2", bob.id);
    const mineBox = await pair("Bob's", bob.id);
    const adminBox = await pair("Admin's"); // paired by the owner: bob may not use it for his agents
    await setAgentComputerTarget(deps(), bob.id, f.org.id, mine.id, mineBox.machineId);
    await setAgentComputerTarget(deps(), bob.id, f.org.id, mine2.id, mineBox.machineId);
    // Not managing the member: a bystander who is not its owner.
    const eve = await addMember(f.db, f.org.id, "member", "eve");
    expect(await refusal(setWorksOn(deps(), eve.id, f.org.id, mine2.id, mine.id))).toBeInstanceOf(ForbiddenError);
    // Managing the member, not the lead: bob owns Mine2, the lead is the owner's, private to them.
    const adminLead = await addAgent("Led");
    await f.db.update(schema.agents).set({ audienceMode: "owner" }).where(eq(schema.agents.id, adminLead.id));
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, adminLead.id, mineBox.machineId);
    const e = await refusal(setWorksOn(deps(), bob.id, f.org.id, mine2.id, adminLead.id));
    expect(e).toBeInstanceOf(ForbiddenError);
    expect((await row(mine2.id)).worksOnAgentId).toBeNull();
    // The computer rule: an agent bob manages on a computer he did not pair, led by one of his own there.
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, mine.id, adminBox.machineId);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, mine.id, mineBox.machineId);
    // A plain owner without manage_agents is refused (the line's precedent, ADR 0148): both agents need managesAgent.
    expect(await refusal(setWorksOn(deps(), bob.id, f.org.id, mine2.id, mine.id))).toBeInstanceOf(ForbiddenError);
    // The control: an admin who manages both, on a computer the setter's rule lets them use.
    await setWorksOn(deps(), f.owner.id, f.org.id, mine2.id, mine.id);
    expect((await row(mine2.id)).worksOnAgentId).toBe(mine.id);
    // Unlinking needs managing the member too.
    expect(await refusal(setWorksOn(deps(), bob.id, f.org.id, mine2.id, null))).toBeInstanceOf(ForbiddenError);
    await setWorksOn(deps(), f.owner.id, f.org.id, mine2.id, null);
    expect((await row(mine2.id)).worksOnAgentId).toBeNull();
  });
});

describe("placement", () => {
  test("a linked member can't choose its own computer, nor none; unlinked it can", async () => {
    const { lead, member } = await crew();
    const other = await pair("Other box");
    await link(member.id, lead.id);
    for (const target of [other.machineId, null]) {
      const e = await refusal(setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, target));
      expect(e).toBeInstanceOf(ForbiddenError);
      expect(e.message).toContain("Ada");
    }
    expect((await row(member.id)).machineId).toBe((await row(lead.id)).machineId);
    await link(member.id, null);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, other.machineId);
    expect((await row(member.id)).machineId).toBe(other.machineId);
  });

  test("the lead's move takes its members along and clears their sign-in; moving to the same computer changes nothing", async () => {
    const { box, lead, member } = await crew();
    const third = await addAgent("Cy");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, third.id, box.machineId);
    await link(member.id, lead.id);
    await link(third.id, lead.id);
    const newer = await pair("New box");
    const [acc] = await f.db
      .insert(schema.machineAccounts)
      .values({
        id: crypto.randomUUID(),
        orgId: f.org.id,
        machineId: box.machineId,
        kind: "claude_code",
        label: "Bia",
        status: "active",
        createdBy: f.owner.id,
      })
      .returning();
    await f.db
      .update(schema.agents)
      .set({ brain: "claude_code", brainAccountId: acc?.id ?? null })
      .where(eq(schema.agents.id, member.id));

    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId);
    for (const id of [lead.id, member.id, third.id]) expect((await row(id)).machineId).toBe(newer.machineId);
    expect((await row(member.id)).brainAccountId).toBeNull();
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
    // Moving it to where it is changes nothing for anyone.
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId);
    for (const id of [lead.id, member.id, third.id]) expect((await row(id)).machineId).toBe(newer.machineId);
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("the lead's move to no computer takes the members to none too", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, null);
    expect((await row(member.id)).machineId).toBeNull();
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("a move that fails on the lead leaves the members where they were", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const e = await refusal(setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, crypto.randomUUID()));
    expect(e).toBeInstanceOf(NotFoundError);
    expect((await row(member.id)).machineId).toBe(box.machineId);
    expect((await row(lead.id)).machineId).toBe(box.machineId);
  });

  test("an outage move: the lead moves once with its member, a member listed in the same move is skipped, never reported forbidden", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const pro = await pair("Pro");
    await f.db
      .update(schema.machines)
      .set({
        online: true,
        lastSeenAt: new Date(),
        protocol: MACHINE_PROTOCOL_VERSION,
        execAllowed: true,
        executors: { claude: { version: "2.1.300", loggedIn: true } },
      })
      .where(eq(schema.machines.id, pro.machineId));
    const result = await moveAgentsFromMachine({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, box.machineId, {
      agentIds: [lead.id, member.id],
      target: { kind: "machine", machineId: pro.machineId },
    });
    expect(result.moved).toEqual([lead.id]);
    expect(result.skipped).toEqual([{ agentId: member.id, reason: "works_on" }]);
    expect((await row(member.id)).machineId).toBe(pro.machineId);
    expect((await row(lead.id)).machineId).toBe(pro.machineId);
  });

  test("a member alone in an outage move is skipped: it follows its lead", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const pro = await pair("Pro");
    await f.db
      .update(schema.machines)
      .set({
        online: true,
        lastSeenAt: new Date(),
        protocol: MACHINE_PROTOCOL_VERSION,
        execAllowed: true,
        executors: { claude: { version: "2.1.300", loggedIn: true } },
      })
      .where(eq(schema.machines.id, pro.machineId));
    const result = await moveAgentsFromMachine({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, box.machineId, {
      agentIds: [member.id],
      target: { kind: "machine", machineId: pro.machineId },
    });
    expect(result.moved).toEqual([]);
    expect(result.skipped).toEqual([{ agentId: member.id, reason: "works_on" }]);
    expect((await row(member.id)).machineId).toBe(box.machineId);
  });
});

describe("the resolver", () => {
  test("an unlinked agent resolves to exactly its own id, handle and name, on every entry point, with no member key", async () => {
    const { box, member } = await crew();
    const want = { id: member.id, handle: "bia", name: "Bia" };
    expect(await scopeOf(member.id, box.machineId)).toStrictEqual(want);
    expect(await agentScopeFromDb(f.db)({ orgId: f.org.id, agentId: member.id } as never)).toStrictEqual(want);
    expect(await resolveForRow(f.db, await row(member.id), box.machineId)).toStrictEqual(want);
  });

  test("an unlinked agent's resolution reads one row: no query beyond the agent's own", async () => {
    const { box, member } = await crew();
    const { queries } = await countQueries(() => scopeOf(member.id, box.machineId));
    expect(queries).toBe(1);
  });

  test("a linked member carries the lead's id, handle and name, and itself as the member; its brain turn too, its session ids stay its own", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const want = { id: lead.id, handle: "ada", name: "Ada", member: member.id };
    expect(await scopeOf(member.id, box.machineId)).toStrictEqual(want);
    expect(await agentScopeFromDb(f.db)({ orgId: f.org.id, agentId: member.id } as never)).toStrictEqual(want);
    // The lead itself is unchanged.
    expect(await scopeOf(lead.id, box.machineId)).toStrictEqual({ id: lead.id, handle: "ada", name: "Ada" });
  });

  test("unlinked again: the member is back to its own scope at once", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await link(member.id, null);
    expect(await scopeOf(member.id, box.machineId)).toStrictEqual({ id: member.id, handle: "bia", name: "Bia" });
  });

  test("a lead that renames is followed: the member's scope says the new handle", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await f.db.update(schema.agents).set({ handle: "ada2" }).where(eq(schema.agents.id, lead.id));
    expect((await scopeOf(member.id, box.machineId)).handle).toBe("ada2");
  });

  test("not honored, naming the lead: the lead's owner changed, the member is on another computer than the lead, the lead is archived", async () => {
    const { box, lead, member } = await crew();
    const other = await pair("Other");
    await link(member.id, lead.id);
    const ok = await scopeOf(member.id, box.machineId);
    expect(ok.id).toBe(lead.id);
    // Asked for another computer than the lead's: not the lead's scope there.
    expect((await refusal(scopeOf(member.id, other.machineId))).message).toContain("Ada");

    const bob = await addMember(f.db, f.org.id, "member", "bob");
    await f.db.update(schema.agents).set({ ownerUserId: bob.id }).where(eq(schema.agents.id, lead.id));
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
    await f.db.update(schema.agents).set({ ownerUserId: f.owner.id }).where(eq(schema.agents.id, lead.id));
    await f.db.update(schema.agents).set({ ownerUserId: null }).where(eq(schema.agents.id, lead.id));
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
    await f.db.update(schema.agents).set({ ownerUserId: f.owner.id }).where(eq(schema.agents.id, lead.id));
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);

    // A writer that moves the member without the cascade (a removed computer, a host that joined): refused, never run as M.
    await f.db.update(schema.agents).set({ machineId: other.machineId }).where(eq(schema.agents.id, member.id));
    expect((await refusal(scopeOf(member.id, other.machineId))).message).toContain("Ada");
    await f.db.update(schema.agents).set({ machineId: box.machineId }).where(eq(schema.agents.id, member.id));

    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id);
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
    // The link is kept: back from the archive, the member works there again.
    await unarchiveAgent(f.db, f.owner.id, f.org.id, lead.id);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("a removed computer: the member can't be run as its own user on it either", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await f.db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.machines).where(eq(schema.machines.id, box.machineId));
      if (m) await detachMachine(tx, m);
    });
    expect((await row(member.id)).machineId).toBeNull();
    expect((await row(lead.id)).machineId).toBeNull();
    // Both are on no computer now; nothing is asked of one.
    expect((await row(member.id)).worksOnAgentId).toBe(lead.id);
  });

  test("forced rows are not honored: a link across workspaces, a lead that is itself a member, a right-hand lead", async () => {
    const { box, lead, member } = await crew();
    const third = await addAgent("Cy");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, third.id, box.machineId);
    const set = (id: string, to: string | null) =>
      f.db.execute(sql`update agents set works_on_agent_id = ${to} where id = ${id}`);
    // A lead that works on another (depth 2).
    await set(member.id, lead.id);
    await set(lead.id, third.id);
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
    await set(lead.id, null);
    // Another workspace's agent.
    const [org2] = await f.db.insert(schema.organizations).values({ name: "Other" }).returning();
    const [alien] = await f.db
      .insert(schema.agents)
      .values({
        orgId: org2?.id ?? "",
        name: "Alien",
        handle: "alien",
        role: "x",
        model: "claude-sonnet-5-5",
        ownerUserId: f.owner.id,
      })
      .returning();
    // The composite key may refuse the row itself; if it lets it in, the resolver refuses it.
    const forged = await set(member.id, alien?.id ?? null).then(
      () => refusal(scopeOf(member.id, box.machineId)),
      (e: unknown) => e,
    );
    expect(forged).toBeInstanceOf(Error);
    // The right hand.
    await ensureRightHand(f.db, f.org.id);
    const [hand] = await f.db.select().from(schema.agents).where(eq(schema.agents.builtin, RIGHT_HAND));
    await set(member.id, hand?.id ?? null);
    expect(hand).toBeDefined();
    expect(await refusal(scopeOf(member.id, box.machineId))).toBeInstanceOf(Error);
    // The control: put back, it resolves.
    await set(member.id, lead.id);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);
  });

  test("a lead deleted: the links are cleared in the deletion, and the member keeps its computer and its own identity", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await deleteAgent({ db: f.db, pubsub: f.pubsub, hub: f.machineHub }, f.owner.id, f.org.id, lead.id);
    expect(await row(member.id)).toMatchObject({ worksOnAgentId: null, machineId: box.machineId });
    expect(await scopeOf(member.id, box.machineId)).toStrictEqual({ id: member.id, handle: "bia", name: "Bia" });
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
  });

  test("a member deleted: it leaves its lead's list", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    await deleteAgent({ db: f.db, pubsub: f.pubsub, hub: f.machineHub }, f.owner.id, f.org.id, member.id);
    expect(await membersOf(f.db, f.org.id, lead.id)).toEqual([]);
  });

  test("the column starts null for every agent and has an index; an agent that has any member, archived ones too, can't become a member", async () => {
    const { box, lead, member } = await crew();
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
    expect((await row(f.agent.id)).worksOnAgentId).toBeNull();
    const idx = await f.db.execute(
      sql`select indexname from pg_indexes where tablename = 'agents' and indexdef ilike '%works_on_agent_id%'`,
    );
    expect((idx as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    await link(member.id, lead.id);
    await archiveAgent(f.db, f.owner.id, f.org.id, member.id);
    const x = await addAgent("Xi");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, x.id, box.machineId);
    // The archived member still counts: unarchived later it would make a chain of two.
    expect(await refusal(link(lead.id, x.id))).toBeInstanceOf(ValidationError);
    await unarchiveAgent(f.db, f.owner.id, f.org.id, member.id);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);
    expect((await row(lead.id)).worksOnAgentId).toBeNull();
  });

  test("the lead's members list is one function: only unarchived members, none for an agent that is not a lead", async () => {
    const { lead, member } = await crew();
    expect(await membersOf(f.db, f.org.id, lead.id)).toEqual([]);
    await link(member.id, lead.id);
    expect(await membersOf(f.db, f.org.id, lead.id)).toEqual([{ id: member.id, handle: "bia", name: "Bia" }]);
    expect(await membersOf(f.db, f.org.id, member.id)).toEqual([]);
    await archiveAgent(f.db, f.owner.id, f.org.id, member.id);
    expect(await membersOf(f.db, f.org.id, lead.id)).toEqual([]);
  });

  test("the API row says who an agent works on and who works on it", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    expect(await getAgent(f.db, f.org.id, member.id)).toMatchObject({ worksOnAgentId: lead.id });
    expect(await getAgent(f.db, f.org.id, lead.id)).toMatchObject({ worksOnAgentId: null });
  });
});

describe("the frame for the runner", () => {
  async function account(machineId: string, agentId: string, label: string) {
    const [acc] = await f.db
      .insert(schema.machineAccounts)
      .values({
        id: crypto.randomUUID(),
        orgId: f.org.id,
        machineId,
        kind: "claude_code",
        label,
        status: "active",
        createdBy: f.owner.id,
      })
      .returning();
    await f.db
      .update(schema.agents)
      .set({ brain: "claude_code", brainAccountId: acc?.id ?? null })
      .where(eq(schema.agents.id, agentId));
    return acc?.id ?? "";
  }

  test("the lead's entry lists its members' accounts; they go once unlinked; an unlinked pair is as before", async () => {
    const { box, lead, member } = await crew();
    const mine = await account(box.machineId, lead.id, "Ada");
    const theirs = await account(box.machineId, member.id, "Bia");
    const entry = async () => (await machineAgents(f.db, f.org.id, box.machineId)).find((a) => a.id === lead.id);
    expect(await entry()).toMatchObject({ account: mine });
    expect((await entry())?.accounts ?? []).not.toContain(theirs);

    await link(member.id, lead.id);
    // Linking moved the member: its sign-in was on this very computer, and a move clears it (ADR 0041), so give it again.
    const again = await account(box.machineId, member.id, "Bia 2");
    expect((await entry())?.accounts).toContain(again);
    expect((await entry())?.account).toBe(mine);
    // The member's own entry stays in the frame (the runner never takes it for removed) but names no account: its
    // account is listed under the lead's, so the runner's lent folder can't be reclaimed to the member's uid.
    const own = (await machineAgents(f.db, f.org.id, box.machineId)).find((a) => a.id === member.id);
    expect(own).toBeDefined();
    expect(own?.account).toBeUndefined();
    expect(own?.accounts).toBeUndefined();

    await link(member.id, null);
    expect((await entry())?.accounts ?? []).not.toContain(again);
  });

  test("a member with no account adds nothing; two members add each their own once", async () => {
    const { box, lead, member } = await crew();
    const third = await addAgent("Cy");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, third.id, box.machineId);
    await link(member.id, lead.id);
    await link(third.id, lead.id);
    const a = await account(box.machineId, member.id, "Bia");
    const b = await account(box.machineId, third.id, "Cy");
    const entry = (await machineAgents(f.db, f.org.id, box.machineId)).find((x) => x.id === lead.id);
    expect([...(entry?.accounts ?? [])].sort()).toEqual([a, b].sort());
  });
});

describe("the hub", () => {
  const exec = (agent: unknown) =>
    ({ op: "exec" as const, command: "ls", timeoutSeconds: 5, stream: false, agent }) as never;

  test("a member's request reaches the runner as the lead's id, handle and name with the member's co-author line, and no member key on the wire", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    await hub.call(box.machineId, exec(await scopeOf(member.id, box.machineId)));
    await hub.call(box.machineId, exec(await scopeOf(lead.id, box.machineId)));
    const sent = runner.sent.filter((s) => s.type === "request" && s.op === "exec");
    expect(sent).toHaveLength(2);
    const [m, l] = sent.map((s) => (s.type === "request" ? s.agent : undefined));
    expect(m).toEqual({
      id: lead.id,
      handle: "ada",
      name: "Ada",
      coAuthors: ["Co-authored-by: Bia <noreply@agentes.chat>"],
    });
    expect(l).toEqual({
      id: lead.id,
      handle: "ada",
      name: "Ada",
      coAuthors: ["Co-authored-by: Ada <noreply@agentes.chat>"],
    });
    expect(JSON.stringify(sent)).not.toContain('"member"');
    expect(JSON.stringify(sent)).not.toContain(member.id);
  });

  test("an unlinked agent's request is what it was: id, handle, name, co-author line, nothing else", async () => {
    const { box, member } = await crew();
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    await hub.call(box.machineId, exec(await scopeOf(member.id, box.machineId)));
    const req = runner.sent.find((s) => s.type === "request" && s.op === "exec");
    expect(req && req.type === "request" ? req.agent : null).toStrictEqual({
      id: member.id,
      handle: "bia",
      name: "Bia",
      coAuthors: ["Co-authored-by: Bia <noreply@agentes.chat>"],
    });
  });

  test("the co-author switch off: the member's command goes without a line, still as the lead's scope", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await setAgentCoAuthor(f.db, f.org.id, false);
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    await hub.call(box.machineId, exec(await scopeOf(member.id, box.machineId)));
    const req = runner.sent.find((s) => s.type === "request" && s.op === "exec");
    expect(req && req.type === "request" ? req.agent?.coAuthors : "x").toBeUndefined();
  });

  test("a member scope under a right-hand lead id is refused at the hub, and nothing is sent", async () => {
    const { box, member } = await crew();
    await ensureRightHand(f.db, f.org.id);
    const [hand] = await f.db.select().from(schema.agents).where(eq(schema.agents.builtin, RIGHT_HAND));
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    const e = await refusal(
      hub.call(box.machineId, exec({ id: hand?.id, handle: "lodi", name: "Bia", member: member.id })),
    );
    expect(e).toBeInstanceOf(MachineRequestError);
    expect((e as MachineRequestError).code).toBe("not_allowed");
    expect(runner.sent.some((s) => s.type === "request" && s.op === "exec")).toBe(false);
  });
});

describe("standing and lifecycle", () => {
  async function task(machineId: string, member: { id: string; handle: string }, leadId: string) {
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "go",
    });
    const row = await startMachineTask({ db: f.db, pubsub: f.pubsub, call: (f.machineHub as MachineHub).call }, {
      orgId: f.org.id,
      agent: { id: member.id, handle: member.handle },
      machineId,
      protocol: MACHINE_PROTOCOL_VERSION,
      machineName: "Build box",
      channelId: f.general.id,
      threadRootId: msg.id,
      runId: null,
      requestedByUserId: f.owner.id,
      title: "dev server",
      executor: "shell",
      command: "bun dev",
    } as never);
    return row.id;
  }
  const canceledBy = async (id: string) =>
    (await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, id)))[0]?.canceledBy ?? null;
  const taskStatus = async (id: string) =>
    (await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, id)))[0]?.status;

  test("archiving the lead stops its members' running tasks on the computer and refuses their next request", async () => {
    const { box, lead, member } = await crew();
    await grantScopes(f.db, f.org.id, member.id, SANDBOX);
    const runner = taskRunner(box.token);
    await runner.hello();
    await link(member.id, lead.id);
    const id = await task(box.machineId, member, lead.id);
    expect(await taskStatus(id)).toBe("running");
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    await stopMembersWork({ db: f.db, pubsub: f.pubsub }, f.org.id, lead.id);
    // The computer is told to stop it, on the lead's scope, where it runs.
    const cancels = runner.sent.flatMap((x) => (x.type === "request" && x.op === "task.cancel" ? [x] : []));
    expect(cancels.map((c) => c.taskId)).toEqual([id]);
    expect(cancels[0]?.agent?.id).toBe(lead.id);
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
  });

  // Pins existing behavior (a task is cancelled on its scope_id): the start through the tool is in "every kind of request".
  test("stopping a member's work stops its task and leaves the lead's task running", async () => {
    const { box, lead, member } = await crew();
    const runner = taskRunner(box.token);
    await runner.hello();
    await link(member.id, lead.id);
    const theirs = await task(box.machineId, member, lead.id);
    const mine = await task(box.machineId, lead, lead.id);
    await stopOrgWork(
      { db: f.db, pubsub: f.pubsub, hub: f.machineHub as MachineHub },
      f.org.id,
      "stopped",
      "deleted",
      member.id,
    );
    const cancels = runner.sent.flatMap((x) => (x.type === "request" && x.op === "task.cancel" ? [x] : []));
    // Its task is cancelled on the lead's scope (that is where it runs); the lead's own is left alone.
    expect(cancels.map((c) => c.taskId)).toEqual([theirs]);
    expect(cancels[0]?.agent?.id).toBe(lead.id);
    expect(await canceledBy(theirs)).not.toBeNull();
    expect(await canceledBy(mine)).toBeNull();
    expect(await taskStatus(mine)).toBe("running");
    expect(
      runner.sent.some((s) => s.type === "request" && s.op === "desktop.session.stop" && s.agent?.id === lead.id),
    ).toBe(false);
  });

  test("lead on hold: the member's request is refused, naming the lead; member on hold: refused by its own id and the lead keeps working", async () => {
    const { box, lead, member } = await crew();
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    await link(member.id, lead.id);
    const run = async (id: string) =>
      hub.call(box.machineId, {
        op: "exec",
        command: "ls",
        timeoutSeconds: 5,
        stream: false,
        agent: await scopeOf(id, box.machineId),
      } as never);
    await setAgentHold(f.db, f.org.id, lead.id, { held: true, reason: "operator" }, f.pubsub);
    const e = await refusal(run(member.id));
    expect(e.message).toContain("Ada");
    await setAgentHold(f.db, f.org.id, lead.id, { held: false, reason: null }, f.pubsub);
    await run(member.id);
    const sentBefore = runner.sent.filter((s) => s.type === "request" && s.op === "exec").length;
    // Member held, lead not: the gateway refuses the member by its own id before anything reaches the computer.
    await setAgentHold(f.db, f.org.id, member.id, { held: true, reason: "operator" }, f.pubsub);
    const t = await toolsFor(member, box.machineId);
    const refused = await t.call("run_code", { language: "bash", code: "ls" });
    expect(refused.isError).toBe(true);
    expect(runner.sent.filter((s) => s.type === "request" && s.op === "exec")).toHaveLength(sentBefore);
    // The lead keeps working.
    await run(lead.id);
  });

  test("every kind of request, made through its real tool for the member, reaches the runner as the lead's scope", async () => {
    const { box, lead, member } = await crew();
    const runner = taskRunner(box.token);
    await runner.hello();
    await link(member.id, lead.id);
    const t = await toolsFor(member, box.machineId);
    const asLead = (x: ServerFrame | undefined) => {
      expect(x?.type === "request" ? x.agent : null).toMatchObject({ id: lead.id, handle: "ada", name: "Ada" });
    };
    const frames = (op: string) => runner.sent.filter((x) => x.type === "request" && x.op === op);

    // exec through run_code
    expect((await t.call("run_code", { language: "bash", code: "ls" })).isError).toBeFalsy();
    asLead(frames("exec")[0]);
    // a background task through start_task: on the lead's scope, in the database too
    const started = await t.call("start_task", { title: "dev server", command: "bun dev" });
    expect(started.isError).toBeFalsy();
    asLead(frames("task.start")[0]);
    const [taskRow] = await f.db.select().from(schema.machineTasks);
    expect(taskRow).toMatchObject({ agentId: member.id, scopeId: null });
    // a folder grant
    await t.call("request_folder_access", { path: "/srv/site", reason: "the site" });
    asLead(frames("access.request")[0]);
    // keep_running: start and end carry the same scope
    const kept = await t.call("keep_running", { what: "bot", why: "answers customers", pid: 4242 });
    expect(kept.isError).toBeFalsy();
    asLead(frames("keep.start")[0]);
    const [hold] = await f.db.select().from(schema.machineHolds);
    expect(hold?.agentId).toBe(member.id);
    await t.call("keep_running", { end: hold?.id });
    asLead(frames("keep.end")[0]);
    expect(
      runner.sent.filter((x) => x.type === "request").every((x) => x.type !== "request" || x.agent?.id !== member.id),
    ).toBe(true);
  });

  test("stopping the members after archiving the lead cancels the member's task on the computer", async () => {
    const { box, lead, member } = await crew();
    await grantScopes(f.db, f.org.id, member.id, SANDBOX);
    const runner = taskRunner(box.token);
    await runner.hello();
    await link(member.id, lead.id);
    const id = await task(box.machineId, member, lead.id);
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    await stopMembersWork({ db: f.db, pubsub: f.pubsub }, f.org.id, lead.id);
    const cancels = runner.sent.flatMap((x) => (x.type === "request" && x.op === "task.cancel" ? [x] : []));
    expect(cancels.map((c) => c.taskId)).toEqual([id]);
    expect(cancels[0]?.agent?.id).toBe(lead.id);
  });
});

describe("lifecycle and failure paths", () => {
  test("a computer that joined, or was provisioned, after a removal: both agents land on it and the member is the lead's again", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await f.db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.machines).where(eq(schema.machines.id, box.machineId));
      if (m) await detachMachine(tx, m);
    });
    const next = await pair("Next box");
    await f.db.update(schema.agents).set({ machineId: next.machineId }).where(eq(schema.agents.orgId, f.org.id));
    expect((await scopeOf(member.id, next.machineId)).id).toBe(lead.id);
  });

  test("a lead's move wakes the members' waiting runs and moves them in one step", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    const newer = await pair("New box");
    const [waiting] = await f.db
      .insert(schema.agentRuns)
      .values({
        orgId: f.org.id,
        agentId: member.id,
        channelId: f.general.id,
        threadRootId: crypto.randomUUID(),
        triggerMessageId: crypto.randomUUID(),
        trigger: "mention",
        hop: 1,
        status: "waiting_input",
        transcript: {
          waitingForBrain: {
            kind: "claude_code",
            machineId: (await row(member.id)).machineId,
            code: "machine_offline",
            waitId: Bun.randomUUIDv7(),
          },
        },
      })
      .returning();
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId);
    const jobs = (await f.db.select().from(schema.outbox)).filter((j) =>
      j.dedupeKey?.startsWith(`agent_run.execute:${waiting?.id}:`),
    );
    expect(jobs.length).toBeGreaterThan(0);
    expect((await row(member.id)).machineId).toBe(newer.machineId);
  });

  test("the resolver's read of the lead fails: nothing is sent, and it works again when the read does", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const hub = f.machineHub as MachineHub;
    const runner = fakeRunner(hub, { execAllowed: true });
    await runner.hello(box.token);
    const real = f.db.select.bind(f.db);
    (f.db as { select: unknown }).select = () => {
      throw new Error("db down");
    };
    const failed = await refusal(scopeOf(member.id, box.machineId));
    (f.db as { select: unknown }).select = real;
    expect(failed.message).toContain("db down");
    expect(runner.sent.some((x) => x.type === "request")).toBe(false);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);
  });

  test("a runner that never answers task.cancel: the member's stop ends the row after the timeout", async () => {
    const { box, lead, member } = await crew();
    const hub = f.machineHub as MachineHub;
    const conn = hub.open({ send() {}, close() {} });
    await hub.message(
      conn,
      JSON.stringify({ type: "hello", token: box.token, ...RUNNER, protocol: MACHINE_PROTOCOL_VERSION, exec: true }),
    );
    await link(member.id, lead.id);
    const [t] = await f.db
      .insert(schema.machineTasks)
      .values({
        orgId: f.org.id,
        agentId: member.id,
        machineId: box.machineId,
        channelId: f.general.id,
        threadRootId: crypto.randomUUID(),
        title: "x",
        executor: "shell",
        command: "bun dev",
        status: "running",
        startedAt: new Date(),
      } as never)
      .returning();
    const quick = { call: (m: string, r: never) => hub.call(m, r, { timeoutMs: 30 }) };
    await engine.cancelOrgTasks({ db: f.db, call: quick.call as never }, f.org.id, "system", member.id);
    const [after] = await f.db
      .select()
      .from(schema.machineTasks)
      .where(eq(schema.machineTasks.id, t?.id ?? ""));
    expect(after?.status).toBe("canceled");
  });

  test("two people linking in opposite directions at once leave one link, never a mutual pair", async () => {
    const { lead, member } = await crew();
    const settled = await Promise.allSettled([link(member.id, lead.id), link(lead.id, member.id)]);
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const links = [(await row(member.id)).worksOnAgentId, (await row(lead.id)).worksOnAgentId].filter(Boolean);
    expect(links).toHaveLength(1);
  });

  test("with caches on, every change shows in the member's next resolve: link, lead's move, archive", async () => {
    const { box, lead, member } = await crew();
    enableCaches(true);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(member.id);
    await link(member.id, lead.id);
    expect((await scopeOf(member.id, box.machineId)).id).toBe(lead.id);
    const newer = await pair("New box");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId);
    expect((await scopeOf(member.id, newer.machineId)).id).toBe(lead.id);
    expect((await refusal(scopeOf(member.id, box.machineId))).message).toContain("Ada");
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    expect((await refusal(scopeOf(member.id, newer.machineId))).message).toContain("Ada");
  });

  test("the computer move an AI-account switch makes for a linked member (settings-proposals) names its lead and changes nothing", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    const other = await pair("Other box");
    const e = await refusal(
      setAgentComputerTarget(deps(), f.owner.id, f.org.id, member.id, other.machineId, { wakeWaits: false }),
    );
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.message).toContain("Ada");
    expect((await row(member.id)).machineId).toBe((await row(lead.id)).machineId);
  });

  test("a linked member's run context names the lead's computer and folder, and drops 'only your own folder'", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    const t = await toolsFor(member, "");
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, member.id));
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, t.run.id));
    if (!agent || !run) throw new Error("no rows");
    const ctx = await buildRunContext(f.db, run as AgentRun, agent, { maxMessages: 30, toolsAvailable: true });
    const text = systemText(ctx.system);
    expect(text).toContain("Ada");
    expect(text.toLowerCase()).not.toContain("only your own folder");
    // An unlinked one reads what it always read.
    const [lone] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, lead.id));
    const t2 = await toolsFor(lead, "");
    const [run2] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, t2.run.id));
    const plain = systemText(
      (await buildRunContext(f.db, run2 as AgentRun, lone as typeof agent, { maxMessages: 30, toolsAvailable: true }))
        .system,
    );
    expect(plain).not.toContain("works on");
  });
});

describe("turns, holds, followers and the prompt", () => {
  test("a member's brain turn is resolved against the turn's own computer: another computer, or none, is refused", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const other = await pair("Other box");
    const turn = (machineId?: string) =>
      ({
        orgId: f.org.id,
        agentId: member.id,
        ...(machineId ? { session: { id: crypto.randomUUID(), resume: false, machineId, cwd: "" } } : {}),
      }) as never;
    const scopeFor = agentScopeFromDb(f.db);
    expect((await scopeFor(turn(box.machineId))).id).toBe(lead.id);
    expect((await refusal(scopeFor(turn(other.machineId)))).message).toContain("Ada");
    await f.db.update(schema.agents).set({ machineId: null }).where(eq(schema.agents.id, lead.id));
    await f.db.update(schema.agents).set({ machineId: null }).where(eq(schema.agents.id, member.id));
    expect(await refusal(scopeFor(turn()))).toBeInstanceOf(Error);
  });

  test("a held lead refuses the member with the held class, naming the lead; the wire never carries the member field", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await setAgentHold(f.db, f.org.id, lead.id, { held: true, reason: "operator" }, f.pubsub);
    const e = await refusal(engine.assertCanWorkFor(f.db, f.org.id, await scopeOf(member.id, box.machineId)));
    expect(e).toBeInstanceOf(engine.AgentHeldError);
    expect(e.message).toContain("Ada");
    expect((e as { retryable?: boolean }).retryable).toBe(false);
    await setAgentHold(f.db, f.org.id, lead.id, { held: false, reason: null }, f.pubsub);
    await setAgentHold(f.db, f.org.id, member.id, { held: true, reason: "operator" }, f.pubsub);
    expect(
      await refusal(engine.assertCanWorkFor(f.db, f.org.id, await scopeOf(member.id, box.machineId))),
    ).toBeInstanceOf(engine.AgentHeldError);
  });

  test("the lead's move tells each follower's apps its new computer", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    const newer = await pair("New box");
    const events: { event?: { type?: string; agentId?: string } }[] = [];
    f.pubsub.subscribe(`org:${f.org.id}`, (e) => events.push(e as never));
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId);
    const told = events.filter((e) => e.event?.type === "agent.computer").map((e) => e.event?.agentId);
    expect(told).toEqual(expect.arrayContaining([lead.id, member.id]));
  });

  test("an archived lead: no 'Where you work' block, and the list still names it and the archived member", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    const t = await toolsFor(member, "");
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, member.id));
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, t.run.id));
    const text = async () =>
      systemText(
        (await buildRunContext(f.db, run as AgentRun, agent as never, { maxMessages: 30, toolsAvailable: true }))
          .system,
      );
    expect(await text()).toContain("# Where you work");
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    expect(await text()).not.toContain("# Where you work");
    const views = await engine.worksOnViewsOf(f.db, f.org.id);
    expect(views.get(member.id)?.worksOn).toMatchObject({ id: lead.id, archived: true });
    await archiveAgent(f.db, f.owner.id, f.org.id, member.id, f.pubsub);
    expect(views.get(lead.id)).toBeDefined();
    expect((await engine.worksOnViewsOf(f.db, f.org.id)).get(lead.id)?.crew).toMatchObject([
      { id: member.id, archived: true },
    ]);
  });
});

describe("what the member is told", () => {
  const access = { name: "Build box", folders: [], tools: { claude: true, codex: true, commands: true } };

  test("unlinked agents' text is the text it always was", () => {
    expect(machineAccessText(access)).toBe(
      '# Your folders on the computer "Build box"\nOnly your own folder there; no other folders are allowed for you.\nAnything else is refused. For another folder, ask its owner with request_folder_access (they decide on that computer); never ask people to change settings by hand.',
    );
  });

  test("a linked member is told it works in the lead's folder, shared with the lead and its other members", () => {
    const text = machineAccessText({ ...access, worksOn: { name: "Ada", others: ["Cy"] } } as never);
    expect(text).toContain("Ada");
    expect(text).toContain("Cy");
    expect(text).not.toBe(machineAccessText(access));
    expect(text.toLowerCase()).not.toContain("only your own folder");
  });
});

/** What a person drives when they drive a member: the lead's OS user, with every sign-in its crew lent to it. */
describe("driving a linked member (the lead's rule applies too)", () => {
  async function systemCrew() {
    const c = await crew();
    await link(c.member.id, c.lead.id);
    await f.db
      .update(schema.machines)
      .set({ executors: { mode: "system" } as never })
      .where(eq(schema.machines.id, c.box.machineId));
    // Caio controls computers but doesn't manage agents: the owner's plan is not his, so he can't drive it.
    const caio = await addMember(f.db, f.org.id, "member", "caio");
    const [base] = await f.db
      .select({ permissions: schema.orgRoles.permissions })
      .from(schema.orgRoles)
      .where(eq(schema.orgRoles.orgId, f.org.id));
    await f.db
      .update(schema.orgRoles)
      .set({ permissions: [...(base?.permissions ?? []), "control_computers"] })
      .where(sql`${schema.orgRoles.orgId} = ${f.org.id} and ${schema.orgRoles.kind} = 'everyone'`);
    const accountId = crypto.randomUUID();
    await f.db.insert(schema.machineAccounts).values({
      id: accountId,
      orgId: f.org.id,
      machineId: c.box.machineId,
      kind: "claude_code",
      label: "Claude Max",
      status: "active",
      createdBy: f.owner.id,
    });
    const onPlan = (agentId: string, on: boolean) =>
      f.db
        .update(schema.agents)
        .set(on ? { brain: "claude_code", brainAccountId: accountId } : { brain: "model", brainAccountId: null })
        .where(eq(schema.agents.id, agentId));
    const drives = (userId: string, agentId: string) =>
      engine.requireComputerDriver(f.db, userId, f.org.id, agentId).then(
        () => true,
        (e: unknown) => {
          if (e instanceof ForbiddenError) return false;
          throw e;
        },
      );
    return { ...c, caio, onPlan, drives };
  }

  test("an admin refused on the lead for the owner's plan is refused on the member too, and the other way round", async () => {
    const { lead, member, caio, onPlan, drives } = await systemCrew();
    // Control: nothing is lent, so the person who controls computers drives both.
    expect([await drives(caio.id, lead.id), await drives(caio.id, member.id)]).toEqual([true, true]);
    await onPlan(lead.id, true);
    expect(await drives(caio.id, lead.id)).toBe(false);
    expect(await drives(caio.id, member.id)).toBe(false);
    expect((await computerDriving(f.db, caio.id, f.org.id, member.id)).refusal).toBe("owner_plan");
    // Only the member thinks with a plan: its sign-in is lent to the lead's OS user, which both desktops run as.
    await onPlan(lead.id, false);
    await onPlan(member.id, true);
    expect(await drives(caio.id, member.id)).toBe(false);
    expect(await drives(caio.id, lead.id)).toBe(false);
    // The owner drives both, whatever is lent.
    expect([await drives(f.owner.id, lead.id), await drives(f.owner.id, member.id)]).toEqual([true, true]);
  });

  test("who a member's desktop asks for help leaves out whoever the lead's rule refuses", async () => {
    const { lead, member, caio, onPlan } = await systemCrew();
    // Nobody owns them (the owner answers alone when there is one), so every admin who controls computers is asked.
    await f.db.update(schema.agents).set({ ownerUserId: null }).where(eq(schema.agents.orgId, f.org.id));
    expect(await computerDrivers(f.db, f.org.id, member.id)).toContain(caio.id);
    await onPlan(lead.id, true);
    const drivers = await computerDrivers(f.db, f.org.id, member.id);
    expect(drivers).not.toContain(caio.id);
    expect(drivers).toContain(f.owner.id);
  });

  test("an unlinked agent is judged on its own row alone", async () => {
    const { lead, member, caio, onPlan, drives } = await systemCrew();
    await link(member.id, null);
    await onPlan(lead.id, true);
    expect(await drives(caio.id, member.id)).toBe(true);
    expect(await drives(caio.id, lead.id)).toBe(false);
  });

  test("a member whose lead is archived: its desktop is none, not a refusal thrown at the viewer", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    expect(await engine.viewerScope(f.db, f.org.id, member.id, f.owner.id, undefined, false)).toMatchObject({
      scope: null,
      seat: false,
    });
    const target = await desktopTarget(f.db, { isLocal: () => true }, f.org.id, member.id, "desktop", f.owner.id);
    expect(target).not.toHaveProperty("agent");
  });
});

describe("a member's background tasks (no seat; the lead's scope rides along)", () => {
  async function started() {
    const { box, lead, member } = await crew();
    const runner = taskRunner(box.token);
    await runner.hello();
    await link(member.id, lead.id);
    const t = await toolsFor(member, box.machineId);
    expect((await t.call("start_task", { title: "dev server", command: "bun dev" })).isError).toBeFalsy();
    const [first] = await f.db.select().from(schema.machineTasks);
    if (!first) throw new Error("no task");
    return { box, lead, member, runner, t, first };
  }
  const frames = <Op extends MachineRequest["op"]>(sent: ServerFrame[], op: Op) =>
    sent.flatMap((x) => (x.type === "request" && x.op === op ? [x as Extract<typeof x, { op: Op }>] : []));

  test("it is the member's row with no seat; it starts as the lead's scope; the member lists, looks at and stops it as that scope", async () => {
    const { lead, runner, t, first } = await started();
    expect(first).toMatchObject({ scopeId: null });
    expect(frames(runner.sent, "task.start")[0]?.agent).toMatchObject({ id: lead.id, handle: "ada" });
    expect((await t.call("list_tasks", {})).content).toContain(first.id);
    expect((await t.call("task_status", { task_id: first.id })).isError).toBeFalsy();
    expect((await t.call("cancel_task", { task_id: first.id })).isError).toBeFalsy();
    const cancels = frames(runner.sent, "task.cancel");
    expect(cancels.map((c) => c.taskId)).toEqual([first.id]);
    expect(cancels[0]?.agent?.id).toBe(lead.id);
  });

  test("dropped with its computer, it starts again as the lead's scope, still the member's row with no seat", async () => {
    const { box, lead, member, runner, first } = await started();
    await runner.disconnect();
    const back = taskRunner(box.token);
    await back.hello({ tasks: [] });
    const starts = frames(back.sent, "task.start");
    expect(starts).toHaveLength(1);
    expect(starts[0]?.agent).toMatchObject({ id: lead.id, handle: "ada" });
    const again = (await f.db.select().from(schema.machineTasks)).find((r) => r.resumedFromId === first.id);
    expect(again).toMatchObject({ agentId: member.id, scopeId: null, status: "running" });
  });

  test("a link that is no longer honored (the owner changed): the dropped task does not start again, as nobody", async () => {
    const { box, lead, runner } = await started();
    await runner.disconnect();
    await f.db.update(schema.agents).set({ ownerUserId: null }).where(eq(schema.agents.id, lead.id));
    const back = taskRunner(box.token);
    await back.hello({ tasks: [] });
    expect(frames(back.sent, "task.start")).toHaveLength(0);
    expect((await f.db.select().from(schema.machineTasks)).filter((r) => r.resumedFromId)).toHaveLength(0);
  });

  test("a held lead: the dropped member task is not started again (its resume checks the hold of the scope it uses)", async () => {
    const { box, lead, runner } = await started();
    await runner.disconnect();
    await setAgentHold(f.db, f.org.id, lead.id, { held: true, reason: "operator" }, f.pubsub);
    const back = taskRunner(box.token);
    await back.hello({ tasks: [] });
    expect(frames(back.sent, "task.start")).toHaveLength(0);
  });
});

describe("holds of a member and the wire", () => {
  const hold = async (memberId: string, machineId: string, leadId: string) =>
    (
      await f.db
        .insert(schema.machineHolds)
        .values({
          orgId: f.org.id,
          agentId: memberId,
          runnerScopeId: leadId,
          machineId,
          what: "The bot",
          why: "answers customers",
          until: new Date(Date.now() + 86_400_000),
        })
        .returning()
    )[0] as typeof schema.machineHolds.$inferSelect;
  const kept = (sent: ServerFrame[], op: string) =>
    sent.flatMap((x) => (x.type === "request" && x.op === op ? [x] : []));

  test("the computer's hello retakes a member's time hold as the lead's scope, and the member field never goes on the wire", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const row = await hold(member.id, box.machineId, lead.id);
    const runner = taskRunner(box.token);
    await runner.hello({ holds: { live: [], ended: [] } });
    for (let i = 0; i < 100 && kept(runner.sent, "keep.start").length === 0; i++) await Bun.sleep(10);
    const [start] = kept(runner.sent, "keep.start");
    expect(start).toMatchObject({ holdId: row.id });
    expect(start?.agent).toEqual({ id: lead.id, handle: "ada" });
    const requests = JSON.stringify(runner.sent.filter((x) => x.type === "request"));
    expect(requests).not.toContain('"member"');
    expect(requests).not.toContain(member.id);
  });

  test("releasing a hold when the resolver refuses (lead archived) still tells the lead's user, by the link", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const row = await hold(member.id, box.machineId, lead.id);
    const hub = f.machineHub as MachineHub;
    const runner = taskRunner(box.token);
    await runner.hello();
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    await releaseHold({ db: f.db, call: hub.call as never }, row, { reason: "stopped_by_person", userId: f.owner.id });
    const [end] = kept(runner.sent, "keep.end");
    expect(end).toMatchObject({ holdId: row.id, stop: true });
    expect(end?.agent?.id).toBe(lead.id);
    expect((await f.db.select().from(schema.machineHolds))[0]?.endReason).toBe("stopped_by_person");
  });
});

describe("the link racing the lead's move", () => {
  test("whichever lands first, the member ends on the lead's computer", async () => {
    for (const linkFirst of [true, false]) {
      const { lead, member } = await crew();
      const newer = await pair(`New box ${linkFirst}`);
      const jobs = linkFirst
        ? [link(member.id, lead.id), setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId)]
        : [setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, newer.machineId), link(member.id, lead.id)];
      await Promise.allSettled(jobs);
      const [m, l] = [await row(member.id), await row(lead.id)];
      expect(l.machineId).toBe(newer.machineId);
      if (m.worksOnAgentId) expect(m.machineId).toBe(l.machineId);
      if (linkFirst) {
        await f.machineHub?.stop();
        await f.close();
      }
    }
  });
});

/**
 * A member's computer work started under its lead's scope (ADR 0202) when the link changes: running tasks, queued
 * tasks and time holds end under the OLD scope, and what starts afterwards resolves its scope when it starts.
 */
describe("a link that changes ends the work started under the old scope", () => {
  const frames = <Op extends MachineRequest["op"]>(sent: ServerFrame[], op: Op) =>
    sent.flatMap((x) => (x.type === "request" && x.op === op ? [x as Extract<typeof x, { op: Op }>] : []));
  const tasks = () => f.db.select().from(schema.machineTasks);
  const holds = () => f.db.select().from(schema.machineHolds);

  async function working() {
    const { box, lead, member } = await crew();
    const other = await addAgent("Cy");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, other.id, box.machineId);
    await link(member.id, lead.id);
    const runner = taskRunner(box.token);
    await runner.hello();
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "go",
    });
    const input = (title: string) => ({
      orgId: f.org.id,
      agent: { id: member.id, handle: member.handle },
      machineId: box.machineId,
      protocol: MACHINE_PROTOCOL_VERSION,
      machineName: "Build box",
      channelId: f.general.id,
      threadRootId: msg.id,
      runId: null,
      requestedByUserId: f.owner.id,
      title,
      executor: "shell" as const,
      command: "bun dev",
    });
    const hub = f.machineHub as MachineHub;
    const running = await startMachineTask({ db: f.db, pubsub: f.pubsub, call: hub.call }, input("running") as never);
    const queued = await engine.queueMachineTask({ db: f.db, pubsub: f.pubsub }, input("queued") as never);
    const [hold] = await f.db
      .insert(schema.machineHolds)
      .values({
        orgId: f.org.id,
        agentId: member.id,
        runnerScopeId: lead.id,
        machineId: box.machineId,
        what: "The bot",
        why: "answers customers",
        until: new Date(Date.now() + 86_400_000),
      })
      .returning();
    return { box, lead, member, other, runner, running, queued, hold: hold as NonNullable<typeof hold> };
  }

  const events: [string, (w: Awaited<ReturnType<typeof working>>) => Promise<unknown>][] = [
    ["its link is set to another agent", (w) => link(w.member.id, w.other.id)],
    ["its link is cleared", (w) => link(w.member.id, null)],
    [
      "its lead is archived",
      async (w) => {
        await archiveAgent(f.db, f.owner.id, f.org.id, w.lead.id, f.pubsub);
        await stopMembersWork({ db: f.db, pubsub: f.pubsub }, f.org.id, w.lead.id);
      },
    ],
    [
      "its lead is deleted",
      (w) => deleteAgent({ db: f.db, pubsub: f.pubsub, hub: f.machineHub }, f.owner.id, f.org.id, w.lead.id),
    ],
    [
      "its lead moves to another computer",
      async (w) => setAgentComputerTarget(deps(), f.owner.id, f.org.id, w.lead.id, (await pair("Moved box")).machineId),
    ],
  ];

  for (const [name, event] of events) {
    test(`${name}: the running task is cancelled, the queued one ends and the time hold ends, all as the old lead`, async () => {
      const w = await working();
      await event(w);
      const cancels = frames(w.runner.sent, "task.cancel");
      expect(cancels.map((c) => c.taskId)).toEqual([w.running.id]);
      expect(cancels[0]?.agent?.id).toBe(w.lead.id);
      const queuedNow = (await tasks()).find((t) => t.id === w.queued.id);
      expect(queuedNow).toMatchObject({ status: "canceled" });
      const [end] = frames(w.runner.sent, "keep.end");
      expect(end).toMatchObject({ holdId: w.hold.id });
      expect(end?.agent?.id).toBe(w.lead.id);
      // A lead deleted has lost its handle: the computer finds its user by the id.
      if (!name.includes("deleted")) expect(end?.agent).toMatchObject({ handle: "ada", name: "Ada" });
      expect((await holds())[0]?.endedAt).not.toBeNull();
    });
  }

  test("a queued item saved under the lead's scope starts as nobody once the link is gone: the start resolves again", async () => {
    const w = await working();
    // The link goes with no rule run (a forced row), so only the start can notice.
    await f.db.update(schema.agents).set({ worksOnAgentId: null }).where(eq(schema.agents.id, w.member.id));
    engine.forgetAgentCaches?.(f.org.id, w.member.id);
    const claimed = await engine.claimQueuedTask(f.db, w.box.machineId);
    expect(claimed?.row.id).toBe(w.queued.id);
    const hub = f.machineHub as MachineHub;
    const row = claimed?.row as NonNullable<typeof claimed>["row"];
    await engine.launchTask({ db: f.db, pubsub: f.pubsub, call: hub.call }, row, claimed?.start as never);
    const starts = frames(w.runner.sent, "task.start").filter((x) => x.taskId === w.queued.id);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.agent?.id).toBe(w.member.id);
  });

  test("owner changed: stop, status and output still reach the lead's user by the link; a retake and a start are refused", async () => {
    const w = await working();
    await f.db.update(schema.agents).set({ ownerUserId: null }).where(eq(schema.agents.id, w.lead.id));
    engine.forgetAgentCaches?.(f.org.id, w.lead.id);
    const row = (await tasks()).find((t) => t.id === w.running.id) as NonNullable<Awaited<ReturnType<typeof tasks>>[0]>;
    expect(engine.taskScope(row, "bia").id).toBe(w.lead.id);
    // The computer says hello holding nothing: the time hold is not taken again as a user nobody honors.
    const again = taskRunner(w.box.token);
    await again.hello({ holds: { live: [], ended: [] } });
    await Bun.sleep(150);
    expect(frames(again.sent, "keep.start")).toHaveLength(0);
    expect((await holds())[0]?.endReason).toBe("restarted");
    const hub = f.machineHub as MachineHub;
    const claimed = await engine.claimQueuedTask(f.db, w.box.machineId);
    await refusal(
      engine.launchTask({ db: f.db, pubsub: f.pubsub, call: hub.call }, claimed?.row as never, claimed?.start as never),
    );
    expect(frames(again.sent, "task.start").filter((x) => x.taskId === w.queued.id)).toHaveLength(0);
  });
});

describe("what a member reads and is told, and who may be asked", () => {
  const promptOf = async (agentId: string) => {
    const t = await toolsFor({ id: agentId }, "");
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, t.run.id));
    return systemText(
      (await buildRunContext(f.db, run as AgentRun, agent as never, { maxMessages: 30, toolsAvailable: true })).system,
    );
  };

  test("a member's prompt lists the lead's folder grants and says git and GitHub are the lead's", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await f.db
      .update(schema.machines)
      .set({
        access: {
          folders: [{ path: "/srv/site", agents: [lead.id] }],
          tools: { claude: true, codex: true, commands: true },
        },
      } as never)
      .where(eq(schema.machines.id, box.machineId));
    const text = await promptOf(member.id);
    expect(text).toContain("/srv/site");
    expect(text).toContain("Git and GitHub are Ada's");
    expect(text).toContain("agentes/ada/");
  });

  test("a lead whose owner is gone leaves the member with no 'Where you work' block (the resolver's rule, not a copy)", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    expect(await promptOf(member.id)).toContain("# Where you work");
    await f.db.update(schema.agents).set({ ownerUserId: null }).where(eq(schema.agents.id, lead.id));
    engine.forgetAgentCaches(f.org.id, lead.id);
    expect(await promptOf(member.id)).not.toContain("# Where you work");
  });

  test("a refused member has no computer for the viewer: none, not its own computer's id", async () => {
    const { lead, member } = await crew();
    await link(member.id, lead.id);
    await archiveAgent(f.db, f.owner.id, f.org.id, lead.id, f.pubsub);
    expect(await engine.viewerScope(f.db, f.org.id, member.id, f.owner.id, undefined, false)).toEqual({
      machineId: null,
      scope: null,
      seat: false,
    });
  });

  test("a lent sign-in of an archived member, or of one on another computer, doesn't count for the lead's driving rule", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    await f.db
      .update(schema.machines)
      .set({ executors: { mode: "system" } as never })
      .where(eq(schema.machines.id, box.machineId));
    const caio = await addMember(f.db, f.org.id, "member", "caio");
    await f.db
      .update(schema.orgRoles)
      .set({ permissions: ["control_computers", "read"] })
      .where(sql`${schema.orgRoles.orgId} = ${f.org.id} and ${schema.orgRoles.kind} = 'everyone'`);
    const accountId = crypto.randomUUID();
    await f.db.insert(schema.machineAccounts).values({
      id: accountId,
      orgId: f.org.id,
      machineId: box.machineId,
      kind: "claude_code",
      label: "Claude Max",
      status: "active",
      createdBy: f.owner.id,
    });
    await f.db
      .update(schema.agents)
      .set({ brain: "claude_code", brainAccountId: accountId })
      .where(eq(schema.agents.id, member.id));
    const drives = () =>
      engine.requireComputerDriver(f.db, caio.id, f.org.id, lead.id).then(
        () => true,
        () => false,
      );
    expect(await drives()).toBe(false);
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, member.id));
    expect(await drives()).toBe(true);
  });
});

/** A task or hold remembers the scope it started under; what changes later never re-derives it (ADR 0202). */
describe("work keeps the scope it started under", () => {
  const frames = <Op extends MachineRequest["op"]>(sent: ServerFrame[], op: Op) =>
    sent.flatMap((x) => (x.type === "request" && x.op === op ? [x as Extract<typeof x, { op: Op }>] : []));
  const startTask = async (box: { machineId: string }, agent: { id: string; handle: string }, title: string) => {
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "go",
    });
    return startMachineTask({ db: f.db, pubsub: f.pubsub, call: (f.machineHub as MachineHub).call }, {
      orgId: f.org.id,
      agent,
      machineId: box.machineId,
      protocol: MACHINE_PROTOCOL_VERSION,
      machineName: "Build box",
      channelId: f.general.id,
      threadRootId: msg.id,
      runId: null,
      requestedByUserId: f.owner.id,
      title,
      executor: "shell",
      command: "bun dev",
    } as never);
  };
  const newHold = async (agentId: string, machineId: string, runnerScopeId: string | null) =>
    (
      await f.db
        .insert(schema.machineHolds)
        .values({
          orgId: f.org.id,
          agentId,
          machineId,
          runnerScopeId,
          what: "The bot",
          why: "answers customers",
          until: new Date(Date.now() + 86_400_000),
        } as never)
        .returning()
    )[0] as typeof schema.machineHolds.$inferSelect;

  test("a link set on an agent that works alone ends its running task, as itself, once the link has committed", async () => {
    const { box, lead, member } = await crew();
    const runner = taskRunner(box.token);
    await runner.hello();
    const own = await startTask(box, member, "own");
    await link(member.id, lead.id);
    const cancels = frames(runner.sent, "task.cancel");
    expect(cancels.map((c) => c.taskId)).toEqual([own.id]);
    expect(cancels[0]?.agent?.id).toBe(member.id);
  });

  test("a link that is refused touches nothing: the running task of the member's old lead is not cancelled", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const runner = taskRunner(box.token);
    await runner.hello();
    const running = await startTask(box, member, "running");
    const stranger = await addAgent("Dee", null);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, stranger.id, box.machineId);
    await refusal(link(member.id, stranger.id));
    expect(frames(runner.sent, "task.cancel")).toHaveLength(0);
    expect(
      (await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, running.id)))[0]?.status,
    ).toBe("running");
  });

  test("a row's stored scope survives the link going: cancel, status text and keep.end still name the lead", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const runner = taskRunner(box.token);
    await runner.hello();
    const running = await startTask(box, member, "running");
    const hold = await newHold(member.id, box.machineId, lead.id);
    await f.db.update(schema.agents).set({ worksOnAgentId: null }).where(eq(schema.agents.id, member.id));
    engine.forgetAgentCaches(f.org.id, member.id);
    const row = (await f.db.select().from(schema.machineTasks).where(eq(schema.machineTasks.id, running.id)))[0];
    expect(row?.runnerScopeId).toBe(lead.id);
    expect(engine.taskScope(row as never, "bia").id).toBe(lead.id);
    const hub = f.machineHub as MachineHub;
    await releaseHold({ db: f.db, call: hub.call as never }, hold, { reason: "stopped_by_person", userId: f.owner.id });
    expect(frames(runner.sent, "keep.end")[0]?.agent?.id).toBe(lead.id);
    await engine.cancelOrgTasks({ db: f.db, call: hub.call as never }, f.org.id, "system", member.id);
    expect(frames(runner.sent, "task.cancel")[0]?.agent?.id).toBe(lead.id);
  });

  test("a seat's task keeps its seat, and a row from before the column (no stored scope) is the agent's own", async () => {
    const { box, member } = await crew();
    const seat = crypto.randomUUID();
    const base = {
      orgId: f.org.id,
      agentId: member.id,
      machineId: box.machineId,
      channelId: f.general.id,
      threadRootId: crypto.randomUUID(),
      title: "x",
      executor: "shell",
      command: "bun dev",
      status: "running",
    };
    const [seated] = await f.db
      .insert(schema.machineTasks)
      .values({ ...base, scopeId: seat } as never)
      .returning();
    const [legacy] = await f.db
      .insert(schema.machineTasks)
      .values(base as never)
      .returning();
    expect(engine.taskScope(seated as never, "bia").id).toBe(seat);
    expect(engine.taskScope(legacy as never, "bia").id).toBe(member.id);
  });

  test("a lead deleted while the computer won't answer: the members' work still ends here and the links are cleared", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const hub = f.machineHub as MachineHub;
    // A computer that answers every request with a failure: the stop can't reach it.
    const conn = hub.open({
      send(text: string) {
        const frame = JSON.parse(text) as ServerFrame;
        if (frame.type !== "request") return;
        setTimeout(
          () =>
            void hub.message(
              conn,
              JSON.stringify({ type: "result", id: frame.id, ok: false, error: { code: "internal", message: "down" } }),
            ),
          1,
        );
      },
      close() {},
    });
    await hub.message(
      conn,
      JSON.stringify({ type: "hello", token: box.token, ...RUNNER, protocol: MACHINE_PROTOCOL_VERSION, exec: true }),
    );
    const running = await startTask(box, member, "running").catch(() => null);
    const [stuck] = running
      ? [running]
      : await f.db
          .insert(schema.machineTasks)
          .values({
            orgId: f.org.id,
            agentId: member.id,
            runnerScopeId: lead.id,
            machineId: box.machineId,
            channelId: f.general.id,
            threadRootId: crypto.randomUUID(),
            title: "x",
            executor: "shell",
            command: "bun dev",
            status: "running",
            startedAt: new Date(),
          } as never)
          .returning();
    const hold = await newHold(member.id, box.machineId, lead.id);
    await deleteAgent({ db: f.db, pubsub: f.pubsub, hub }, f.owner.id, f.org.id, lead.id);
    expect((await row(member.id)).worksOnAgentId).toBeNull();
    expect(
      (
        await f.db
          .select()
          .from(schema.machineTasks)
          .where(eq(schema.machineTasks.id, stuck?.id ?? ""))
      )[0]?.status,
    ).toBe("canceled");
    expect(
      (await f.db.select().from(schema.machineHolds).where(eq(schema.machineHolds.id, hold.id)))[0]?.endedAt,
    ).not.toBeNull();
  });

  test("a lead's move that is told not to stop its members calls no computer", async () => {
    const { box, lead, member } = await crew();
    await link(member.id, lead.id);
    const runner = taskRunner(box.token);
    await runner.hello();
    await startTask(box, member, "running");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, lead.id, (await pair("Moved box")).machineId, {
      stopMembers: false,
    } as never);
    expect(frames(runner.sent, "task.cancel")).toHaveLength(0);
  });
});
