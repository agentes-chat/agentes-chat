/**
 * VPS Zen: the Central, everything the agents are doing in one answer. The task manager (ADR 0128) already knows each
 * task; this adds what a person needs to trust it: when the task last showed a sign of life, a state in plain terms
 * (never a guess at a percentage: `progress` is the work's own plan or nothing), who asked whom, and each agent's
 * setup. What agents said to each other and their pull requests only go to who manages them.
 */
import type { PubSub } from "@agenteschat/adapters";
import { type Database, inArray, rowsOf, schema, sql } from "@agenteschat/db";
import { listAgents } from "./agents";
import { continueRun } from "./continue-run";
import { can, requireActiveMembership } from "./organizations";
import { type EndedTask, type ManagedTask, taskManager } from "./task-manager";

const { agentRuns, agentRunSteps, agentWorks } = schema;

/** No step for this long: "sem sinal". A long command can be this quiet, so it is only said, nothing is done. */
export const CENTRAL_QUIET_MS = 5 * 60_000;
/** No step for this long: it reads as stopped, and the person is offered to stop or look at it. */
export const CENTRAL_STALLED_MS = 15 * 60_000;
/** How far back the list of finished tasks and of agents' conversations goes. */
export const CENTRAL_LOOKBACK_MS = 7 * 24 * 3600_000;
const TALKS_MAX = 40;
const PULL_REQUESTS_MAX = 40;
const TALK_TEXT_MAX = 600;
const TITLE_MAX = 90;

export type CentralState =
  | "queued"
  | "working"
  | "quiet"
  | "stalled"
  | "waiting_you"
  | "waiting_other"
  | "done"
  | "failed"
  | "stopped";

export interface CentralTask {
  runId: string;
  agentId: string;
  channelId: string;
  channelKind: "channel" | "dm";
  channelName: string | null;
  betweenAgents: boolean;
  threadId: string | null;
  title: string | null;
  state: CentralState;
  /** Why it waits, in the task manager's terms (`held`, or what its line says); null when it doesn't. */
  waitsOn: string | null;
  startedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Its last step (or its start): what "sem sinal" counts from. */
  lastSignalAt: string;
  /** The work's own plan; null when it has none. A percentage is never made up. */
  progress: { done: number; total: number; percent: number } | null;
  /** The work's latest update, in its own words. */
  latestUpdate: string | null;
  requester:
    | { kind: "person"; id: string; name: string }
    | { kind: "agent"; id: string }
    | { kind: "routine"; name: string }
    | null;
  /** What started a chain of agents, when another agent asked. */
  origin: string | null;
  now: { tool: string; detail: string | null } | null;
  steps: number;
  helpers: number;
  error: string | null;
  canStop: boolean;
  /** Ended at its step limit and not picked up yet: "Continuar" works. */
  canContinue: boolean;
}

export interface CentralAgent {
  id: string;
  name: string;
  handle: string;
  role: string;
  brain: string;
  model: string | null;
  effort: string | null;
  approvals: string;
  hasInstructions: boolean;
  machine: { id: string; name: string; online: boolean } | null;
  /** Tool calls per minute over the last hour, oldest first. */
  activity: number[];
  doneThisWeek: number;
  failedThisWeek: number;
  /** Who it answers to on the org chart; null: its owner or its setor's lead. */
  reportsToAgentId: string | null;
  /** Its CLI's process tree now, from its computer's last report; null: nothing running, or an older runner. */
  memory: { rssMb: number; processes: number; at: string } | null;
}

/** Who asked whom over the last week: an agent orchestrating another, or a person asking an agent. */
export interface CentralLink {
  from: { kind: "agent"; id: string } | { kind: "person"; id: string; name: string };
  toAgentId: string;
  asks: number;
  tasks: number;
  lastAt: string;
}

export interface CentralTalk {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  kind: string;
  status: string;
  createdAt: string;
  answeredAt: string | null;
  /** Null: the viewer doesn't manage either agent, so only who and when. */
  question: string | null;
  answer: string | null;
}

export interface CentralPullRequest {
  repo: string;
  number: number;
  agentId: string;
  authored: boolean;
  channelId: string;
  threadId: string | null;
  updatedAt: string;
  url: string;
}

export interface CentralComputer {
  id: string;
  name: string;
  online: boolean;
  version: string | null;
  cpus: number | null;
  memoryGb: number | null;
  /** Average and peak share of memory in use over the last reading (0 to 1). */
  memoryAvg: number | null;
  memoryPeak: number | null;
  diskFreeGb: number | null;
  working: number;
  inLine: number;
}

export interface CentralView {
  at: string;
  agents: CentralAgent[];
  tasks: CentralTask[];
  talks: CentralTalk[];
  pullRequests: CentralPullRequest[];
  computers: CentralComputer[];
  links: CentralLink[];
  /** Tasks still on that the viewer may not see: only how many. */
  hiddenTasks: number;
}

/** How a task still on stands. Exported for its test: this is the rule the whole screen reads by. */
export function centralState(
  task: Pick<ManagedTask, "status" | "held" | "work">,
  lastSignalAt: string,
  now: number,
): CentralState {
  if (task.status === "queued" || task.work?.state === "queued") return "queued";
  if (task.status === "running") {
    const quiet = now - Date.parse(lastSignalAt);
    return quiet >= CENTRAL_STALLED_MS ? "stalled" : quiet >= CENTRAL_QUIET_MS ? "quiet" : "working";
  }
  return task.work?.state === "you" ? "waiting_you" : "waiting_other";
}

const percentOf = (plan: { done: number; total: number } | null) =>
  plan && plan.total > 0 ? { ...plan, percent: Math.min(100, Math.round((plan.done / plan.total) * 100)) } : null;

const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const cut = (v: string | null) => (v && v.length > TALK_TEXT_MAX ? `${v.slice(0, TALK_TEXT_MAX)}…` : v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function requesterOf(task: ManagedTask): CentralTask["requester"] {
  if (task.delegation) return { kind: "agent", id: task.delegation.agentId };
  if (task.requester) return { kind: "person", id: task.requester.userId, name: task.requester.name };
  if (task.routine) return { kind: "routine", name: task.routine.name };
  return null;
}

interface AskedFacts {
  askedText: string | null;
  askedByAgent: string | null;
  askedByUser: string | null;
  askedByName: string | null;
}

/** Who wrote the message that started the run. */
function askedBy(fact: AskedFacts | undefined): CentralTask["requester"] {
  if (fact?.askedByUser) return { kind: "person", id: fact.askedByUser, name: fact.askedByName ?? "" };
  if (fact?.askedByAgent) return { kind: "agent", id: fact.askedByAgent };
  return null;
}

/**
 * A task with no title goes by what was asked, one line. The list only holds conversations the viewer is in; one only
 * agents are in keeps its words to itself.
 */
function askedLine(task: { betweenAgents: boolean }, fact: AskedFacts | undefined): string | null {
  const line = fact?.askedText?.replace(/\s+/g, " ").trim();
  if (!line || task.betweenAgents) return null;
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line;
}

function originOf(task: ManagedTask): string | null {
  const origin = task.delegation?.origin;
  return origin && (origin.kind === "person" || origin.kind === "routine") ? origin.name : null;
}

/** Everything the Central shows, as this person may see it. */
export async function centralView(
  db: Database,
  userId: string,
  orgId: string,
  options: { now?: Date } = {},
): Promise<CentralView> {
  const membership = await requireActiveMembership(db, userId, orgId);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - CENTRAL_LOOKBACK_MS);
  const [manager, agents] = await Promise.all([
    taskManager(db, userId, orgId, { since, now }),
    listAgents(db, userId, orgId),
  ]);
  const admin = can(membership, "manage_agents");
  const managed = new Set(agents.filter((a) => admin || a.ownerUserId === userId).map((a) => a.id));
  const runIds = [...manager.tasks.map((t) => t.runId), ...manager.ended.map((t) => t.runId)];

  const [facts, signals, machines, week, talks, pulls, agentLinks, personLinks] = await Promise.all([
    runIds.length
      ? db
          .select({
            id: agentRuns.id,
            error: agentRuns.error,
            title: agentWorks.title,
            update: agentWorks.lastUpdateText,
            askedText: schema.messages.body,
            askedByAgent: schema.messages.authorAgentId,
            askedByUser: schema.messages.authorUserId,
            askedByName: schema.users.name,
            replyMeta: sql<Record<string, unknown> | null>`(
              select m.meta from messages m where m.id = ${agentRuns.replyMessageId} and m.org_id = ${agentRuns.orgId})`,
          })
          .from(agentRuns)
          .leftJoin(agentWorks, sql`${agentWorks.id} = ${agentRuns.workId}`)
          .leftJoin(
            schema.messages,
            sql`${schema.messages.id} = ${agentRuns.triggerMessageId} and ${schema.messages.orgId} = ${agentRuns.orgId}`,
          )
          .leftJoin(schema.users, sql`${schema.users.id} = ${schema.messages.authorUserId}`)
          .where(inArray(agentRuns.id, runIds))
      : [],
    manager.tasks.length
      ? db
          .select({ runId: agentRunSteps.runId, at: sql<string>`max(${agentRunSteps.createdAt})` })
          .from(agentRunSteps)
          .where(
            inArray(
              agentRunSteps.runId,
              manager.tasks.map((t) => t.runId),
            ),
          )
          .groupBy(agentRunSteps.runId)
      : [],
    db.execute(sql`select id, name, online, runner_version, size, load, paired_by_user_id from machines
      where org_id = ${orgId}::uuid and deleted_at is null order by name`),
    db.execute(sql`select agent_id, count(*) filter (where status = 'done')::int done,
        count(*) filter (where status = 'failed')::int failed
      from agent_runs where org_id = ${orgId}::uuid and finished_at >= ${since.toISOString()}::timestamptz
      group by agent_id`),
    db.execute(sql`select id, asker_agent_id, target_agent_id, kind, status, question, answer, created_at, answered_at,
        for_user_id from agent_consultations
      where org_id = ${orgId}::uuid and created_at >= ${since.toISOString()}::timestamptz
      order by created_at desc limit ${TALKS_MAX}`),
    db.execute(sql`select repo, number, agent_id, authored, channel_id, thread_id, updated_at from github_items
      where org_id = ${orgId}::uuid order by updated_at desc limit ${PULL_REQUESTS_MAX}`),
    db.execute(sql`select asker_agent_id, target_agent_id,
        count(*) filter (where kind = 'question')::int asks, count(*) filter (where kind <> 'question')::int tasks,
        max(created_at) last_at
      from agent_consultations where org_id = ${orgId}::uuid and created_at >= ${since.toISOString()}::timestamptz
      group by 1, 2`),
    // People's requests: how many runs a person's message started for each agent. Counts only, never words, and only
    // for who manages that agent or the person themselves (filtered below).
    db.execute(sql`select m.author_user_id, u.name, r.agent_id, count(*)::int n, max(r.created_at) last_at
      from agent_runs r
      join messages m on m.id = r.trigger_message_id and m.org_id = r.org_id
      join users u on u.id = m.author_user_id
      where r.org_id = ${orgId}::uuid and r.created_at >= ${since.toISOString()}::timestamptz and r.hop = 1
      group by 1, 2, 3`),
  ]);

  const factOf = new Map(facts.map((f) => [f.id, f]));
  const signalOf = new Map(signals.map((s) => [s.runId, iso(s.at) as string]));
  const live: CentralTask[] = manager.tasks.map((t) => {
    const fact = factOf.get(t.runId);
    const lastSignalAt = signalOf.get(t.runId) ?? t.startedAt ?? t.createdAt;
    return {
      ...placeOf(t),
      title: t.label ?? fact?.title ?? t.subject ?? askedLine(t, fact),
      state: centralState(t, lastSignalAt, now.getTime()),
      waitsOn: t.held ?? (t.status === "running" ? null : (t.work?.state ?? null)),
      startedAt: t.startedAt,
      createdAt: t.createdAt,
      finishedAt: null,
      lastSignalAt,
      progress: percentOf(t.plan),
      latestUpdate: fact?.update ?? null,
      requester: requesterOf(t) ?? askedBy(fact),
      origin: originOf(t),
      now: t.now ? { tool: t.now.tool, detail: t.now.detail } : null,
      steps: t.steps,
      helpers: t.helpers,
      error: null,
      canStop: t.canStop,
      canContinue: false,
    };
  });
  const ended: CentralTask[] = manager.ended.map((t: EndedTask) => {
    const fact = factOf.get(t.runId);
    const limit = fact?.replyMeta?.stepLimit as { continuedRunId?: string } | undefined;
    return {
      ...placeOf(t),
      title: t.label ?? fact?.title ?? askedLine(t, fact),
      state: t.status === "done" ? "done" : t.status === "failed" ? "failed" : "stopped",
      waitsOn: null,
      startedAt: t.startedAt,
      createdAt: t.startedAt ?? t.finishedAt,
      finishedAt: t.finishedAt,
      lastSignalAt: t.finishedAt,
      progress: null,
      latestUpdate: fact?.update ?? null,
      requester: t.routine ? { kind: "routine", name: t.routine.name } : askedBy(fact),
      origin: null,
      now: null,
      steps: 0,
      helpers: 0,
      error: t.status === "failed" ? (fact?.error ?? null) : null,
      canStop: false,
      canContinue: Boolean(limit && !limit.continuedRunId),
    };
  });

  const machineRows = rowsOf<{
    id: string;
    name: string;
    online: boolean;
    runner_version: string | null;
    size: Record<string, unknown> | null;
    load: Record<string, unknown> | null;
    paired_by_user_id: string | null;
  }>(machines);
  const weekOf = new Map(rowsOf<{ agent_id: string; done: number; failed: number }>(week).map((r) => [r.agent_id, r]));
  const line = new Map(manager.computers.map((c) => [c.id, c]));
  const machineOf = new Map(machineRows.map((m) => [m.id, m]));

  return {
    at: now.toISOString(),
    agents: agents.map((a) => {
      const machine = a.machineId ? machineOf.get(a.machineId) : undefined;
      return {
        id: a.id,
        name: a.name,
        handle: a.handle,
        role: a.role,
        brain: a.brain,
        model: a.brainModel,
        effort: a.brainEffort,
        approvals: a.approvalsLevel,
        hasInstructions: a.instructions.trim().length > 0,
        machine: machine ? { id: machine.id, name: machine.name, online: machine.online } : null,
        activity: manager.activity[a.id] ?? [],
        doneThisWeek: weekOf.get(a.id)?.done ?? 0,
        failedThisWeek: weekOf.get(a.id)?.failed ?? 0,
        reportsToAgentId: a.reportsToAgentId ?? null,
        memory: memoryOf(machine, a.id),
      };
    }),
    tasks: [...live, ...ended],
    talks: rowsOf<{
      id: string;
      asker_agent_id: string;
      target_agent_id: string;
      kind: string;
      status: string;
      question: string;
      answer: string | null;
      created_at: string | Date;
      answered_at: string | Date | null;
      for_user_id: string | null;
    }>(talks).map((r) => {
      const reads = managed.has(r.asker_agent_id) || managed.has(r.target_agent_id) || r.for_user_id === userId;
      return {
        id: r.id,
        fromAgentId: r.asker_agent_id,
        toAgentId: r.target_agent_id,
        kind: r.kind,
        status: r.status,
        createdAt: iso(r.created_at) as string,
        answeredAt: iso(r.answered_at),
        question: reads ? cut(r.question) : null,
        answer: reads ? cut(r.answer) : null,
      };
    }),
    pullRequests: rowsOf<{
      repo: string;
      number: number;
      agent_id: string;
      authored: boolean;
      channel_id: string;
      thread_id: string | null;
      updated_at: string | Date;
    }>(pulls)
      .filter((r) => managed.has(r.agent_id))
      .map((r) => ({
        repo: r.repo,
        number: r.number,
        agentId: r.agent_id,
        authored: r.authored,
        channelId: r.channel_id,
        threadId: r.thread_id,
        updatedAt: iso(r.updated_at) as string,
        // GitHub sends an issue's address on to the pull request of that number.
        url: `https://github.com/${r.repo}/issues/${r.number}`,
      })),
    computers: machineRows
      .filter((m) => admin || m.paired_by_user_id === userId)
      .map((m) => ({
        id: m.id,
        name: m.name,
        online: m.online,
        version: m.runner_version,
        cpus: num(m.size?.cpus),
        memoryGb: num(m.size?.memoryGb),
        memoryAvg: num(m.load?.memoryAvg),
        memoryPeak: num(m.load?.memoryPeak),
        diskFreeGb: num(m.load?.diskFreeGb),
        working: line.get(m.id)?.working ?? 0,
        inLine: line.get(m.id)?.inLine ?? 0,
      })),
    links: [
      ...rowsOf<{
        asker_agent_id: string;
        target_agent_id: string;
        asks: number;
        tasks: number;
        last_at: string | Date;
      }>(agentLinks).map(
        (r): CentralLink => ({
          from: { kind: "agent", id: r.asker_agent_id },
          toAgentId: r.target_agent_id,
          asks: r.asks,
          tasks: r.tasks,
          lastAt: iso(r.last_at) as string,
        }),
      ),
      ...rowsOf<{ author_user_id: string; name: string; agent_id: string; n: number; last_at: string | Date }>(
        personLinks,
      )
        .filter((r) => managed.has(r.agent_id) || r.author_user_id === userId)
        .map(
          (r): CentralLink => ({
            from: { kind: "person", id: r.author_user_id, name: r.name },
            toAgentId: r.agent_id,
            asks: 0,
            tasks: r.n,
            lastAt: iso(r.last_at) as string,
          }),
        ),
    ].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    hiddenTasks: manager.hidden.total,
  };
}

/** A report older than this says nothing about now. */
const MEMORY_FRESH_MS = 3 * 60_000;

function memoryOf(
  machine: { load: Record<string, unknown> | null } | undefined,
  agentId: string,
): CentralAgent["memory"] {
  const load = machine?.load;
  const at = typeof load?.at === "string" ? load.at : null;
  const mine = (load?.agents as Record<string, { rssMb?: unknown; processes?: unknown }> | undefined)?.[agentId];
  if (!at || !mine || Date.now() - Date.parse(at) > MEMORY_FRESH_MS) return null;
  const rssMb = num(mine.rssMb);
  const processes = num(mine.processes);
  return rssMb === null || processes === null ? null : { rssMb, processes, at };
}

function placeOf(t: ManagedTask | EndedTask) {
  return {
    runId: t.runId,
    agentId: t.agentId,
    channelId: t.channelId,
    channelKind: t.channelKind,
    channelName: t.channelName,
    betweenAgents: t.betweenAgents,
    threadId: t.threadId,
  };
}

/** How long after a run ends at its step limit it may still be picked up by itself. */
export const AUTO_CONTINUE_WITHIN_MS = 30 * 60_000;

/**
 * Work must not sit forever because it ran out of steps: a conversation run that ended at its step limit goes on by
 * itself, once. A run found stuck is left to a person (going on would repeat it), and so is one that was already a
 * continuation, which is what keeps this from looping. It acts as the agent's owner, who may press Continuar.
 */
export async function continueWorkAtStepLimit(
  deps: { db: Database; pubsub?: PubSub },
  options: { now?: Date; onError?: (runId: string, error: unknown) => void } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const after = new Date(now.getTime() - AUTO_CONTINUE_WITHIN_MS).toISOString();
  const rows = rowsOf<{ id: string; org_id: string; owner_user_id: string }>(
    await deps.db.execute(sql`select r.id, r.org_id, a.owner_user_id
      from agent_runs r
      join agents a on a.id = r.agent_id and a.org_id = r.org_id and a.archived_at is null
      join messages m on m.id = r.reply_message_id and m.org_id = r.org_id
      left join messages asked on asked.id = r.trigger_message_id and asked.org_id = r.org_id
      where r.status = 'done' and not r.background and r.finished_at >= ${after}::timestamptz
        and a.owner_user_id is not null and m.deleted_at is null
        and m.meta ? 'stepLimit'
        and m.meta->'stepLimit'->>'continuedRunId' is null
        and coalesce(m.meta->'stepLimit'->>'stuck', 'false') <> 'true'
        and not coalesce(asked.meta ? 'stepLimit', false)
      order by r.finished_at limit 20`),
  );
  const continued: string[] = [];
  for (const r of rows) {
    try {
      const out = await continueRun(deps, r.owner_user_id, r.org_id, r.id, { automatic: true });
      continued.push(out.runId);
    } catch (error) {
      // Busy in that conversation or no longer theirs to continue: the reply's Continuar stays.
      options.onError?.(r.id, error);
    }
  }
  return continued;
}
