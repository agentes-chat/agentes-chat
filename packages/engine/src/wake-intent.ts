import { and, eq, isNotNull, isNull, or, schema, sql } from "@agenteschat/db";
import type { EngineDeps } from "./executor";

const { agents, channelMembers, channels, machines } = schema;

/**
 * Waking the workspace's computer on a guess (ADR 0161, the addendum on guesses): what a person does in the app says a message to an agent comes
 * soon, so the computer its agents work on, asleep in standby, is asked back before the message is sent
 * (`wantMachine` with `intent`). Each sign weighs (`INTENT_WEIGHTS`); a conversation's signs add up over
 * `INTENT_WINDOW_MS`, with the app's opening counted in each, and at `INTENT_THRESHOLD` its agents' computers wake once.
 * Opening the app or a channel alone never wakes one; opening a DM with an agent, typing `@` and an agent, or
 * recording a voice message does at once; the rest takes two signs.
 */
export type IntentSignal = "app" | "open" | "focus" | "typing" | "mention" | "voice";

export const INTENT_WEIGHTS = {
  app: 1,
  channel: 2,
  thread: 3,
  dm: 4,
  focus: 3,
  typing: 3,
  mention: 4,
  voice: 4,
} as const;
export const INTENT_THRESHOLD = 4;
export const INTENT_WINDOW_MS = 3 * 60_000;

export type IntentWhere = {
  orgId: string;
  userId: string;
  channelId?: string | null;
  threadId?: string | null;
  /** `mention`: the agent named. */
  agentId?: string | null;
};

// ponytail: per process; a person's socket sits on one replica, so their signs reach one count.
const appOpenedAt = new Map<string, number>();
const scores = new Map<string, { since: number; score: number; fired: boolean }>();

/** Tests: forgets every sign. */
export const resetWakeIntents = () => {
  appOpenedAt.clear();
  scores.clear();
};

/** What opening this conversation weighs: a DM, a thread, or any other channel. */
async function openWeight(deps: Pick<EngineDeps, "db">, where: IntentWhere) {
  if (where.threadId) return INTENT_WEIGHTS.thread;
  const [row] = await deps.db
    .select({ kind: channels.kind })
    .from(channels)
    .where(and(eq(channels.orgId, where.orgId), eq(channels.id, where.channelId ?? "")));
  return row?.kind === "dm" ? INTENT_WEIGHTS.dm : INTENT_WEIGHTS.channel;
}

/**
 * The workspace's own computers in standby that its agents in the conversation (and the agent named) work on: agents
 * not archived nor held by the operator.
 */
async function standbyComputers(deps: Pick<EngineDeps, "db">, where: IntentWhere & { channelId: string }) {
  const member = sql`exists (select 1 from ${channelMembers} where ${channelMembers.orgId} = ${where.orgId}
    and ${channelMembers.channelId} = ${where.channelId} and ${channelMembers.agentId} = ${agents.id})`;
  const rows = await deps.db
    .selectDistinct({ id: machines.id })
    .from(agents)
    .innerJoin(machines, and(eq(machines.orgId, agents.orgId), eq(machines.id, agents.machineId)))
    .where(
      and(
        eq(agents.orgId, where.orgId),
        isNull(agents.archivedAt),
        isNull(agents.operatorHoldAt),
        eq(machines.kind, "managed"),
        isNull(machines.deletedAt),
        isNotNull(machines.standbyAt),
        where.agentId ? or(eq(agents.id, where.agentId), member) : member,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * A sign from a person's app (`app` on its socket, the rest in a conversation it reads): the computers woken for it, if
 * it took the conversation to `INTENT_THRESHOLD`. Each conversation wakes them at most once a window.
 */
export async function noteWakeIntent(
  deps: Pick<EngineDeps, "db" | "machines">,
  signal: IntentSignal,
  where: IntentWhere,
  now = Date.now(),
): Promise<string[]> {
  const person = `${where.orgId}:${where.userId}`;
  if (signal === "app" || !where.channelId) {
    if (appOpenedAt.size >= 50_000) appOpenedAt.clear();
    appOpenedAt.set(person, now);
    return [];
  }
  if (!deps.machines?.wake) return [];
  const key = `${person}:${where.channelId}:${where.threadId ?? ""}`;
  let entry = scores.get(key);
  if (!entry || now - entry.since >= INTENT_WINDOW_MS) {
    const app = appOpenedAt.get(person);
    entry = {
      since: now,
      score: app !== undefined && now - app < INTENT_WINDOW_MS ? INTENT_WEIGHTS.app : 0,
      fired: false,
    };
    if (scores.size >= 50_000) scores.clear();
    scores.set(key, entry);
  }
  if (entry.fired) return [];
  entry.score += signal === "open" ? await openWeight(deps, where) : INTENT_WEIGHTS[signal];
  if (entry.score < INTENT_THRESHOLD) return [];
  entry.fired = true;
  const ids = await standbyComputers(deps, { ...where, channelId: where.channelId });
  await Promise.all(ids.map((id) => deps.machines?.wake?.(id, "intent").catch(() => {})));
  return ids;
}
