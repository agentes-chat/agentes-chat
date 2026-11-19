import type { Agent, AgentRef, Machine } from "../api/types";

/**
 * What the "Works on the computer of" field shows for an agent (ADR 0202), one rule for web and phone: the agents it may
 * be put on (what the agents alone decide; who may do it is the server's answer), its locked state while it works on
 * one, an agent that has others working on its computer, and the bounded list of those.
 */
export interface WorksOnAgent {
  id: string;
  name: string;
  handle: string;
  ownerUserId: string | null;
  /** The computer the agent uses now, from the computers list. */
  machineId: string | null;
  builtin: string | null;
  worksOnAgentId: string | null;
  /** The API's own `worksOn` and `crew` (archived ones included): the apps never rebuild them from the live list. */
  worksOn: AgentRef | null;
  crew: readonly AgentRef[];
}

/** The one mapping of the agents and computers lists the field reads, for web and phone. */
export function worksOnAgents(agents: readonly Agent[], machines: readonly Machine[]): WorksOnAgent[] {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    ownerUserId: a.ownerUserId ?? null,
    machineId: machines.find((m) => m.agents.some((x) => x.id === a.id))?.id ?? null,
    builtin: a.builtin ?? null,
    worksOnAgentId: a.worksOnAgentId ?? null,
    worksOn: a.worksOn ?? null,
    crew: a.crew ?? [],
  }));
}

export type WorksOnField =
  /** The right hand: no field. */
  | { kind: "none" }
  /**
   * It works on another's computer. `lead` comes from the API's `worksOn` (null: it did not say); `available` is
   * false when that agent is archived or gone: the only choice is then to stop.
   */
  | { kind: "member"; lead: AgentRef | null; available: boolean }
  /** Others work on its computer: no picker. `crew` is the live ones; none left shows the empty state. */
  | { kind: "lead"; crew: AgentRef[] }
  | { kind: "pick"; options: WorksOnAgent[] }
  /** Nobody to choose: say so. */
  | { kind: "empty" };

export function worksOnField(agent: WorksOnAgent, agents: readonly WorksOnAgent[]): WorksOnField {
  if (agent.builtin) return { kind: "none" };
  if (agent.worksOnAgentId) {
    const lead = agent.worksOn;
    return {
      kind: "member",
      lead,
      available: !!lead && !lead.archived && agents.some((a) => a.id === lead.id),
    };
  }
  // An archived member still counts: back, it would make a chain; the list shows the live ones only.
  if (agent.crew.length > 0) return { kind: "lead", crew: agent.crew.filter((a) => !a.archived) };
  const options = agents.filter(
    (a) =>
      a.id !== agent.id &&
      !a.builtin &&
      !a.worksOnAgentId &&
      a.machineId !== null &&
      agent.ownerUserId !== null &&
      a.ownerUserId === agent.ownerUserId,
  );
  return options.length > 0 ? { kind: "pick", options } : { kind: "empty" };
}

/** The lead's list, `limit` names and how many more. */
export function worksOnCrewShown<T>(crew: readonly T[], limit: number) {
  return { shown: crew.slice(0, limit), more: Math.max(0, crew.length - limit) };
}
