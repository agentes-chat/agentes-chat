import type { AgentScope, PubSub } from "@agenteschat/adapters";
import { and, type Database, eq, isNull, ne, schema, sql } from "@agenteschat/db";
import { forgetAgentCaches, getAgent, getAgentCached } from "./agents";
import { managesAgent } from "./audience";
import { recordAudit } from "./audit";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishAgentsChanged, publishOrgEvent } from "./events";
import { requirePermission } from "./organizations";
import { isRightHand } from "./right-hand";
import { AgentHeldError, assertCanWork } from "./standing";

const { agents } = schema;

/**
 * "Works on the computer of" (ADR 0202). Agent M (the member) set on agent L (the lead) uses L's computer as L does
 * there: every machine request of M's carries L's id and handle, so the runner gives it L's OS user, folder, services,
 * browser and desktop. M stays its own agent everywhere else (name, instructions, memory, model, sign-in, budget,
 * approvals). One rule, here: `resolveForRow`, which every place that builds an agent's scope for a computer calls
 * (`agentScopeOn` for a caller with only an id).
 */

/** The error code of every refusal of this rule. */
export const WORKS_ON_CODE = "agent.works_on";

type Row = typeof agents.$inferSelect;

const refusal = (member: Pick<Row, "name">, lead: Pick<Row, "name"> | null, why: string) =>
  new ForbiddenError(
    `${member.name} can't work on ${lead ? lead.name : "that agent"}'s computer now: ${why}`,
    WORKS_ON_CODE,
  );

/**
 * The scope of `agent`'s request to `machineId`. Unlinked: its own, with no other read. Linked: the lead's id, handle
 * and name (the computer's user is the lead's, and so is the name its commits are made under), with the member's id
 * beside them for the hub, which takes the commit line from that row and strips the field before the wire; honored
 * only while the lead is a live agent of the same non-null owner, is itself on no one's computer, is not the right
 * hand, and the member, the lead and the target are all the same computer; else the member is refused, naming the
 * lead, and nothing runs as the member's own user (ADR 0202).
 */
export async function resolveForRow(db: Database, agent: Row, machineId: string): Promise<AgentScope> {
  if (!agent.worksOnAgentId) {
    return { id: agent.id, handle: agent.handle, ...(agent.name ? { name: agent.name } : {}) };
  }
  const lead = await getAgentCached(db, agent.orgId, agent.worksOnAgentId);
  if (!lead) throw refusal(agent, null, "it is gone.");
  if (lead.archivedAt) throw refusal(agent, lead, `${lead.name} is archived.`);
  if (isRightHand(lead) || isRightHand(agent)) throw refusal(agent, lead, "the right hand has no one working on it.");
  if (lead.worksOnAgentId) throw refusal(agent, lead, `${lead.name} works on another agent's computer itself.`);
  if (!agent.ownerUserId || agent.ownerUserId !== lead.ownerUserId) {
    throw refusal(agent, lead, `they no longer have the same owner.`);
  }
  if (!lead.machineId || lead.machineId !== agent.machineId || lead.machineId !== machineId) {
    throw refusal(agent, lead, `it is not on ${lead.name}'s computer.`);
  }
  return { id: lead.id, handle: lead.handle, name: lead.name, member: agent.id };
}

/** The scope `agentId`'s request to `machineId` carries, for a caller that has only the id (`resolveForRow` of its row). */
export async function agentScopeOn(
  db: Database,
  orgId: string,
  agentId: string,
  machineId: string,
): Promise<AgentScope> {
  const agent = await getAgentCached(db, orgId, agentId);
  return agent ? resolveForRow(db, agent, machineId) : { id: agentId, handle: "agent" };
}

/** The live agents working on `leadId`'s computer, for the lead's own context (archived ones are not told). */
export async function membersOf(db: Database, orgId: string, leadId: string) {
  return db
    .select({ id: agents.id, handle: agents.handle, name: agents.name })
    .from(agents)
    .where(
      and(
        eq(agents.orgId, orgId),
        eq(agents.worksOnAgentId, leadId),
        isNull(agents.archivedAt),
        isNull(agents.deletedAt),
      ),
    )
    .orderBy(agents.name);
}

/**
 * `assertCanWork` for a request's scope: a held lead refuses its members' work, and says whose hold it is (the member
 * itself is held by its own id in the executor and gateway).
 */
export async function assertCanWorkFor(db: Database, orgId: string, scope: AgentScope | undefined) {
  try {
    await assertCanWork(db, orgId, scope?.id);
  } catch (error) {
    if (error instanceof AgentHeldError && scope?.member) {
      const lead = await getAgentCached(db, orgId, scope.id).catch(() => null);
      // Same class, so a job still fails at once and a stream still closes as held; only the words name the lead.
      const named = new AgentHeldError();
      named.message = `${lead?.name ?? "The agent whose computer this is"} is paused, so ${scope.name ?? "this agent"} can't work on its computer now.`;
      throw named;
    }
    throw error;
  }
  // The member's own hold: it is held by its own id, which the scope no longer carries.
  if (scope?.member) await assertCanWork(db, orgId, scope.member);
}

/**
 * Sets (or with null clears) the agent `agentId` works on. Who owns or manages both agents sets it, and, to move the member
 * onto the lead's computer, may put it there as `setAgentComputerTarget` asks; clearing needs only the member. Same
 * non-null owner, one level (a lead works on no one, an agent with members, archived ones too, is no member), never the
 * right hand, never an archived or deleted agent, and the lead has a computer. Linking moves the member onto the lead's
 * computer (its sign-in there is its own to choose: it starts with none, like any move), all or nothing.
 */
export async function setWorksOn(
  deps: { db: Database; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
  leadId: string | null,
): Promise<{ worksOnAgentId: string | null }> {
  const { db } = deps;
  const membership = await requirePermission(db, actorId, orgId, "read");
  const member = await getAgent(db, orgId, agentId);
  if (!member || member.archivedAt) throw new NotFoundError("Agent not found");
  const lead = leadId ? await getAgent(db, orgId, leadId) : null;
  if (leadId && !lead) throw new NotFoundError("Agent not found");
  if (!managesAgent(member, actorId, membership)) throw new ForbiddenError("Only who manages the agent changes it");
  if (lead && !managesAgent(lead, actorId, membership)) {
    throw new ForbiddenError("Only who manages both agents sets this", WORKS_ON_CODE);
  }
  const machines = await import("./machines");
  const changed = await db.transaction(async (tx) => {
    // One at a time per workspace: two people linking in opposite directions must not both pass the depth check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`works-on:${orgId}`}))`);
    const [fresh] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
    if (!fresh) throw new NotFoundError("Agent not found");
    if (!lead || !leadId) {
      if (!fresh.worksOnAgentId) return null;
      await tx.update(agents).set({ worksOnAgentId: null, updatedAt: new Date() }).where(eq(agents.id, agentId));
      return { moved: false, from: fresh.worksOnAgentId, to: null as string | null, machine: null as string | null };
    }
    const [theLead] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.id, leadId)))
      .for("update");
    if (!theLead) throw new NotFoundError("Agent not found");
    const bad = (message: string) => new ValidationError(message, WORKS_ON_CODE);
    if (leadId === agentId) throw bad(`${fresh.name} can't work on its own computer's behalf: choose another agent.`);
    if (isRightHand(fresh) || isRightHand(theLead)) {
      throw bad(
        "The right hand works with each person directly: it has no one working on its computer, and none on another's.",
      );
    }
    if (theLead.archivedAt || theLead.deletedAt) throw bad(`${theLead.name} is archived.`);
    if (!fresh.ownerUserId || fresh.ownerUserId !== theLead.ownerUserId) {
      throw bad(`${fresh.name} and ${theLead.name} need the same owner (and an owner) to share a computer.`);
    }
    if (theLead.worksOnAgentId) throw bad(`${theLead.name} already works on another agent's computer.`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.worksOnAgentId, agentId)));
    if (n > 0) throw bad(`${fresh.name} has agents working on its computer, so it can't work on ${theLead.name}'s.`);
    if (!theLead.machineId) throw bad(`${theLead.name} has no computer to share yet.`);
    if (fresh.worksOnAgentId === leadId && fresh.machineId === theLead.machineId) return null;
    const moved = fresh.machineId !== theLead.machineId;
    if (moved) {
      const machine = await machines.getMachine(tx as unknown as Database, orgId, theLead.machineId);
      if (!machine) throw new NotFoundError("Computer not found", "machine.not_found");
      machines.mayPutOnComputer(fresh, machine, actorId, membership);
    }
    await tx
      .update(agents)
      .set({
        worksOnAgentId: leadId,
        machineId: theLead.machineId,
        // An account is a folder on one computer (ADR 0041): another computer starts on its own sign-in.
        ...(moved ? { brainAccountId: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
    return {
      moved,
      from: fresh.worksOnAgentId,
      to: leadId as string | null,
      machine: theLead.machineId as string | null,
    };
  });
  if (!changed) return { worksOnAgentId: leadId };
  // Whatever it ran under its old scope ends now that the link has committed, through the scope it started with.
  await stopWorkOf(deps, orgId, [agentId]);
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.works_on_changed",
    target: { type: "agent", id: agentId },
    details: { from: changed.from, to: changed.to },
  });
  forgetAgentCaches(orgId, agentId);
  if (leadId) forgetAgentCaches(orgId, leadId);
  await publishAgentsChanged(deps.pubsub, orgId);
  if (changed.moved) {
    await publishOrgEvent(deps.pubsub, {
      type: "org.broadcast",
      orgId,
      event: { type: "agent.computer", agentId, target: await machines.computerTarget(db, orgId, agentId) },
    });
    await machines.publishMachineAgentsChanged(deps.pubsub, orgId);
    const { wakeAgentsBrainWaits } = await import("./usage-pause");
    await wakeAgentsBrainWaits(deps, orgId, [agentId], { delayMs: machines.TARGET_WAKE_DELAY_MS });
  } else {
    await machines.publishMachineAgentsChanged(deps.pubsub, orgId);
  }
  return { worksOnAgentId: leadId };
}

/** The machine hub of this process, set when it is made: every way a member's work is stopped goes through it. */
interface MembersHub {
  call: (machineId: string, request: never, options?: { timeoutMs?: number }) => Promise<unknown>;
}
let registeredHub: MembersHub | undefined;
export function registerMembersHub(hub: MembersHub) {
  registeredHub = hub;
}

/**
 * Ends the live work of `agentIds` on their computers and here: running and queued tasks and time holds. Each is
 * stopped under the scope it started with (`runnerScopeId`), so it reaches the right user whatever the link is now.
 * Call it once the change that made it necessary has committed, never inside a transaction.
 */
export async function stopWorkOf(deps: { db: Database; pubsub?: PubSub }, orgId: string, agentIds: string[]) {
  if (agentIds.length === 0) return;
  for (const id of agentIds) forgetAgentCaches(orgId, id);
  const hub = registeredHub;
  const call = hub
    ? (((machineId: string, request: never) => hub.call(machineId, request, { timeoutMs: 15_000 })) as never)
    : undefined;
  const { cancelOrgTasks } = await import("./machine-tasks");
  const { endHoldsOf } = await import("./machine-holds");
  for (const id of agentIds) {
    await cancelOrgTasks({ db: deps.db, pubsub: deps.pubsub, call }, orgId, "system", id);
    await endHoldsOf({ db: deps.db, pubsub: deps.pubsub, call }, orgId, id);
  }
}

/**
 * `stopWorkOf` for every agent whose work runs under `leadId`'s scope (ADR 0202): those with a live task or hold
 * stored under it, and those linked to it now (a queued task has no scope yet). The lead's own work is left alone.
 * Called after an archive, a deletion or a move of the lead has committed.
 */
export async function stopMembersWork(deps: { db: Database; pubsub?: PubSub }, orgId: string, leadId: string) {
  forgetAgentCaches(orgId, leadId);
  const { machineTasks, machineHolds } = schema;
  const [linked, tasks, holds] = await Promise.all([
    deps.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.worksOnAgentId, leadId))),
    deps.db
      .select({ id: machineTasks.agentId })
      .from(machineTasks)
      .where(
        and(
          eq(machineTasks.orgId, orgId),
          eq(machineTasks.runnerScopeId, leadId),
          ne(machineTasks.agentId, leadId),
          isNull(machineTasks.endedAt),
        ),
      ),
    deps.db
      .select({ id: machineHolds.agentId })
      .from(machineHolds)
      .where(
        and(
          eq(machineHolds.orgId, orgId),
          eq(machineHolds.runnerScopeId, leadId),
          ne(machineHolds.agentId, leadId),
          isNull(machineHolds.endedAt),
        ),
      ),
  ]);
  await stopWorkOf(deps, orgId, [...new Set([...linked, ...tasks, ...holds].map((r) => r.id))]);
}

/**
 * Who works on whose computer, as the apps show it, from one list of agents: for each, the agent it works on (`worksOn`)
 * and the agents working on its computer (`crew`), archived ones included and marked, so the apps never recompute
 * either from the live list (`membersOf` answers only the live ones, for the lead's context).
 */
export function worksOnViews(
  list: readonly Pick<Row, "id" | "name" | "handle" | "worksOnAgentId" | "archivedAt">[],
): Map<string, { worksOn: BriefAgent | null; crew: BriefAgent[] }> {
  const byId = new Map(list.map((a) => [a.id, a]));
  const brief = (a: Pick<Row, "id" | "name" | "handle" | "archivedAt">): BriefAgent => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    archived: a.archivedAt !== null,
  });
  return new Map(
    list.map((a) => {
      const lead = a.worksOnAgentId ? byId.get(a.worksOnAgentId) : undefined;
      return [
        a.id,
        { worksOn: lead ? brief(lead) : null, crew: list.filter((m) => m.worksOnAgentId === a.id).map(brief) },
      ];
    }),
  );
}

interface BriefAgent {
  id: string;
  name: string;
  handle: string;
  archived: boolean;
}

/** `worksOnViews` over every agent of the workspace that is not deleted, archived ones included (the list omits them). */
export async function worksOnViewsOf(db: Database, orgId: string) {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      handle: agents.handle,
      worksOnAgentId: agents.worksOnAgentId,
      archivedAt: agents.archivedAt,
    })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), isNull(agents.deletedAt)));
  return worksOnViews(rows);
}
