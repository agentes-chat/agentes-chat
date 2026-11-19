import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, eq, inArray, schema } from "@agenteschat/db";
import { getAgentCached } from "./agents";
import { runBrainOf } from "./brains/select";
import { cancelRun, interruptRun } from "./cancel";
import { frontOfLine } from "./computer-queue";
import { publishChannelEvent } from "./events";
import { type Judge, type SteerHandling, steerHandling } from "./judge";
import { deliverLive } from "./live-steer";
import type { Message } from "./messages";
import { enqueue } from "./outbox";
import { holdsMessages } from "./run-hold";
import { handOnMessages, queueAfterRun } from "./run-inbox";
import { type AgentRun, computerWaitOf, replyThreadOf } from "./runs";
import type { Talker } from "./talker";
import { onMessageWhileWaiting, type WaitMessageOutcome } from "./waits";

const { agentRuns, messages } = schema;

/**
 * What happens to a person's message that went into an agent's task in
 * progress (one active run per agent and conversation). The message is
 * already queued on the run (`pending_message_ids`); this decides how soon and
 * how it is read, in order:
 *
 * 1. "Parar e mandar" (`now`): the model call stops and the loop reads it.
 * 2. The triage (the judge, `steerHandling`, ADR 0112 addendum), after the send: a plain "stop" cancels the task; a
 *    correction that makes going on a waste cuts the model call for it (a computer brain gets it live and urgent, or
 *    is stopped and started again from it); a separate request waits for the task's end (`queueAfterRun`) and gets a
 *    run of its own; a quick question gets the fast reply at once; anything else, or a judge that isn't sure, is read
 *    at the next pause.
 * 3. Live delivery (`live-steer.ts`): a computer brain mid-turn gets it at its
 *    next tool boundary instead of at the end of the turn (with a judge, once the triage said how).
 * 4. A run waiting (`waits.ts`): browser help, another agent's answer. The
 *    message may end the wait ("pronto, loguei") or wake the run (the wait
 *    stays open; its result comes later as a notice). Parked waiting for its
 *    computer: look again now. Waiting on something the message can't move
 *    (a secret, a mission's decision, a question for someone else;
 *    `holdsMessages`): the message leaves it for a run of its own; an approval
 *    never takes it at all.
 * 5. The fast reply (`talker.ts`): when the run can't answer soon (waiting, or
 *    deep in a long turn), or the triage says a quick question or a separate request, the agent's conversation layer
 *    may answer in a second or two, or pass.
 *
 * Nothing here ever grants anything.
 */
export interface SteeringDeps {
  db: Database;
  pubsub: PubSub;
  /** Tells a plain "stop" from a correction (none = never a stop). */
  judge?: Judge;
  /** The conversation layer (none = no fast replies). */
  talker?: Talker;
}

export interface SteeredInput {
  orgId: string;
  userId: string;
  channelId: string;
  message: Message;
  /** The runs it was queued on. */
  runIds: string[];
  /** "Parar e mandar". */
  now: boolean;
}

export async function afterSteered(deps: SteeringDeps, input: SteeredInput) {
  const { orgId, userId, channelId, message, now } = input;
  const runs = await deps.db.select().from(agentRuns).where(inArray(agentRuns.id, input.runIds));
  for (const runId of input.runIds) {
    const active = runs.find((r) => r.id === runId);
    if (!active) continue;
    const threadId = replyThreadOf(active);
    /** Parked waiting for its computer brain, its plan or its budget (`waitingForBrain`). */
    const parked =
      active.status === "waiting_input"
        ? ((active.transcript as { waitingForBrain?: { waitId?: string; code?: string; source?: string } } | null)
            ?.waitingForBrain ?? null)
        : null;
    // Long work paused near a limit is no wait a message moves (`holdsMessages`): it isn't woken for it.
    const brainWait = parked?.code === "usage_pause" ? null : parked;
    // A conversation's catch-up on its plan or budget takes the message and stays in its place in line: a look now
    // would only ask the plan again, early and out of order.
    const usageWait = brainWait?.code === "plan_limit" || brainWait?.code === "budget";
    const computerWait = computerWaitOf(active);
    // Gone from its inbox already, the app heard where it went (`agent.run.read`, `agent.run.redispatched`):
    // a late "steered" would move the receipt back onto this run.
    if (active.pendingMessageIds.includes(message.id)) {
      await publishChannelEvent(deps.pubsub, {
        type: "agent.run.steered",
        channelId,
        threadId,
        runId,
        agentId: active.agentId,
        messageId: message.id,
        ...(now ? { now: true as const } : {}),
        // Into a run waiting for its computer: the message shows that wait, as a reload would.
        ...(computerWait
          ? { computer: computerWait }
          : active.status === "waiting_input" && brainWait?.code === "work_queue"
            ? { computer: "line" as const }
            : {}),
        // On its plan or budget (long work paused near one too, by its `source`), as a reload says (`usageWaitSql`).
        ...(parked?.code === "plan_limit" || parked?.code === "budget" || parked?.code === "usage_pause"
          ? { usage: parked.code === "budget" || parked.source === "budget" ? ("budget" as const) : ("plan" as const) }
          : {}),
      });
    }
    let live = false;
    // Its model call stops and the loop reads the message at once (a running tool finishes first).
    // A computer brain (Claude Code, Codex) can't drop its turn halfway: one whose turn takes messages
    // gets it live and urgent (Claude Code reads it now or at its next tool boundary; Codex's app-server
    // stops the turn and starts the next one with it: `live-steer.ts`); else
    // the task stops for real, and stopping it starts it again from this message
    // (`restartAfterStopAndSend`). Who may not stop it just leaves the message for its next step.
    // The brain this run thinks with (its own, which may differ from the agent's current one). A model-brain run
    // reads its inbox at every step: asking it live would only hold the send while its executor is still starting.
    const computer =
      active.status === "running" &&
      (await getAgentCached(deps.db, orgId, active.agentId).then((a) => !!a && runBrainOf(active, a) !== "model"));
    // The task stops for the message to be read. A plain "stop" sent this way is a stop, not a message to start again
    // from, so with a judge the task is stopped only once it has said which (`judgeSteer`).
    // The judge may take a moment, and the run moves on meanwhile. One that read the message (its next step, or its
    // turn took it) has nothing to stop for, and one that paused or parked would lose a wait nobody asked to cancel.
    const stopToSend = async () => {
      const [fresh] = await deps.db
        .select({ status: agentRuns.status, pending: agentRuns.pendingMessageIds })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId));
      if (fresh?.status !== "running" || !fresh.pending.includes(message.id)) return;
      await cancelRun(deps, userId, orgId, runId, { sendMessageId: message.id }).catch(() => undefined);
    };
    let toSend: (() => Promise<unknown>) | undefined;
    // With a judge, a computer brain mid-turn gets the message once the triage said how (`judgeSteer`), a moment
    // after the send: urgent for a correction, never a separate request left for after the task.
    const handAfterTriage = Boolean(deps.judge) && !now && computer;
    if (now && active.status === "running") {
      if (computer) {
        live = await deliverLive(deps, active, { messageId: message.id, urgent: true }).catch(() => false);
        if (!live && deps.judge) toSend = stopToSend;
        else if (!live) await stopToSend();
      } else await interruptRun(deps.pubsub, runId, message.id);
    } else if (computer) {
      if (!handAfterTriage)
        live = await deliverLive(deps, active, { messageId: message.id, urgent: false }).catch(() => false);
    }
    // Parked waiting for its computer: look again now. Back (or never really away): the run resumes and reads this
    // message with the rest; still away: it parks again quietly (one answer later).
    else if (active.status === "waiting_input" && (active.waitingMachineId || brainWait) && !usageWait) {
      const wait = brainWait?.waitId;
      if (brainWait?.code === "busy") await frontOfLine(deps.db, active, message.id).catch(() => undefined);
      else
        await enqueue(deps.db, {
          orgId,
          kind: "agent_run.execute",
          payload: { runId, ...(wait ? { wait } : {}) },
          dedupeKey: `agent_run.execute:${runId}:steer:${message.id}`,
          maxAttempts: 4,
        }).catch(() => undefined);
    }
    // What it does to a wait, then the fast reply: after the response (the judge may take a moment), in order.
    const waiting =
      !active.waitingMachineId &&
      !brainWait &&
      (active.status === "waiting_input" || active.status === "waiting_approval");
    // Waiting on something the message can't move (a secret, a mission's decision, a question for someone else; an
    // approval never takes it): the agent doesn't keep it waiting behind that, it answers in a run of its own. Gone from the
    // inbox already (the run handed it on as it paused, or read it first): the run that has it answers, so
    // nothing here speaks for this one either.
    const holds = waiting && (await holdsMessages(deps.db, active, userId));
    if (holds) await handOnMessages(deps.db, deps.pubsub, active, [message.id]).catch(() => null);
    const talks = !holds && (waiting || (deps.talker && !now));
    const followUp = async (handling: SteerHandling | null) => {
      let waited: WaitMessageOutcome | null = null;
      if (waiting) {
        waited = await onMessageWhileWaiting(deps, active, message).catch(() => null);
        if (waited) {
          await publishChannelEvent(deps.pubsub, {
            type: "agent.run.wait_message",
            channelId,
            threadId,
            runId,
            agentId: active.agentId,
            messageId: message.id,
            waitKind: waited.waitKind,
            outcome: waited.outcome,
          });
        }
      }
      if (deps.talker && !now) await deps.talker.consider({ run: active, message, live, waited, handling });
    };
    const judge = deps.judge;
    if (!judge) {
      if (talks) trackStopCheck(followUp(null));
      continue;
    }
    // How the agent takes it, never in the way of the send: judged after the response (the app hears a stop then),
    // then what that does to the task, then its wait and the fast reply.
    trackStopCheck(
      (async () => {
        const handling = await judgeSteer(deps, judge, input, active, threadId);
        if (handling === "stop") return;
        if (now) await toSend?.();
        else if (active.status === "running") {
          // A separate request: out of what the task reads, a run of its own once it ends.
          const queued = handling === "queue" && (await queueAfterRun(deps.db, runId, message.id).catch(() => false));
          if (handAfterTriage && !queued) {
            const urgent = handling === "interrupt";
            live = await deliverLive(deps, active, { messageId: message.id, urgent }).catch(() => false);
            // A correction its turn can't take now: the task stops and starts again from it, as "Parar e mandar" does.
            if (urgent && !live) await stopToSend();
          } else if (!computer && handling === "interrupt") await interruptRun(deps.pubsub, runId, message.id);
        }
        if (talks) await followUp(handling);
      })(),
    );
  }
}

/**
 * How the agent takes the message (`steerHandling`), judged after the send: a plain "stop", in any language, cancels
 * the task here; every other way is the caller's to act on. A judge that fails or isn't sure says `add`: the message is
 * read at the next pause, as before.
 */
async function judgeSteer(
  deps: SteeringDeps,
  judge: Judge,
  input: SteeredInput,
  run: AgentRun,
  threadId: string | null,
): Promise<SteerHandling> {
  const agentName = (await getAgentCached(deps.db, input.orgId, run.agentId))?.name ?? "the agent";
  const handling = await steerHandling(judge, {
    orgId: input.orgId,
    text: input.message.body,
    agentName,
    task: await taskOf(deps.db, run).catch(() => null),
    agentId: run.agentId,
    runId: run.id,
  }).catch((): SteerHandling => "add");
  if (handling !== "stop") return handling;
  await publishChannelEvent(deps.pubsub, {
    type: "agent.run.steered",
    channelId: input.channelId,
    threadId,
    runId: run.id,
    agentId: run.agentId,
    messageId: input.message.id,
    stop: true,
  });
  // The "stop" itself is not handed on to a new run when the task's unread messages are.
  await cancelRun(deps, input.userId, input.orgId, run.id, { stopMessageId: input.message.id });
  return "stop";
}

/** What the run works on, as its judges read it: its request, grown with what the person added, else its trigger. */
async function taskOf(db: Database, run: AgentRun): Promise<string | null> {
  const request = (run.transcript as { request?: unknown } | null)?.request;
  if (typeof request === "string" && request.trim()) return request;
  const [trigger] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.orgId, run.orgId), eq(messages.id, run.triggerMessageId)))
    .limit(1);
  return trigger?.body.trim() || null;
}

/** Checks still running after the post returned (stop judge, fast replies). */
const pendingChecks = new Set<Promise<unknown>>();

function trackStopCheck(check: Promise<unknown>) {
  const tracked = check.catch(() => undefined).finally(() => pendingChecks.delete(tracked));
  pendingChecks.add(tracked);
}

/** Resolves once every check started so far is done (and its cancel or reply): for tests and shutdown. */
export async function stopChecksSettled() {
  while (pendingChecks.size > 0) await Promise.all([...pendingChecks]);
}
