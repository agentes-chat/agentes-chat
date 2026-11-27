import type { PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, eq, isNotNull, isNull, lt, schema, sql } from "@agenteschat/db";
import { getAgent } from "./agents";
import { type AiStatusDeps, agentAiState } from "./ai-status";
import { reachesAgent } from "./audience";
import { deliverNotice, publishDelivery } from "./delivery";
import { openPersonAgentDm } from "./dms";
import { ForbiddenError, NotFoundError } from "./errors";
import { firstName } from "./format";
import type { Notice } from "./notices";
import { getMembership, requireActiveMembership } from "./organizations";
import { enqueue, enqueueBatch } from "./outbox";
import { personLocale } from "./requester";
import { FIRST_DELIVERY_JOB, openOrg, STANDING_COLUMNS, workRefusal } from "./standing";

const { agents, firstDeliveries, organizations, routines, users } = schema;

/**
 * A person's first delivery (ADR 0260 addendum; the onboarding of ADR 0162, the routine an app brings of ADR 0242): the
 * first piece of work the agent they set up on the onboarding does for them, in their DM with it. It is kept from the
 * moment the agent is made, one per person and workspace, armed when the person leaves the agent's step (where they
 * connect its apps: `armFirstDelivery`), and fires once, as soon as it is armed and the agent can work: the workspace
 * has its plan (no hold) and the agent an AI that reads ready (a plan's sign-in only once its computer is). Whichever of
 * those comes last, Checkout returning, the AI connecting or the computer coming up, a look finds it: one queued when
 * it is armed and when a billing hold lifts (`setBillingHold`), and the workers' sweep (`enqueueFirstDeliveryChecks`)
 * for the rest, without a hook in every place an AI or a computer changes.
 *
 * Firing is a notice only the agent reads (`first_delivery`, agent-only) into the person's DM, hop 0, whose run acts
 * for that person (`authority.ts` roots it in `refs.personId`). Every reply that run posts carries
 * `meta.firstDelivery` with a one-line summary (`deliverySummary`), which the onboarding's last screens and the tour read.
 */

/** The onboarding's areas are a word ("support", "life"); `ask` is a pick from the person's own AI's proposal. */
export const FIRST_DELIVERY_AREA_MAX = 40;
/** What it does first, as the onboarding wrote it. */
export const FIRST_DELIVERY_TASK_MAX = 500;
/** A delivery that never could fire (no plan, no AI) stops waiting after this. */
export const FIRST_DELIVERY_KEPT_MS = 30 * 86_400_000;

/** A person's first delivery as the apps read it. */
export interface FirstDeliveryRow {
  agentId: string;
  area: string | null;
  task: string;
  /** When the person left the agent's step: it fires only once armed. */
  armedAt: string | null;
  /** When its notice went out; null while it waits to be armed, for the plan or the AI. */
  firedAt: string | null;
  /** The run its notice woke, once fired. */
  runId: string | null;
}

export interface FirstDeliveryDeps extends Partial<Pick<AiStatusDeps, "machines">> {
  db: Database;
  pubsub?: PubSub;
  gateway: AiStatusDeps["gateway"];
}

type Row = typeof firstDeliveries.$inferSelect;

const viewOf = (row: Row): FirstDeliveryRow => ({
  agentId: row.agentId,
  area: row.area,
  task: row.task,
  armedAt: row.armedAt?.toISOString() ?? null,
  firedAt: row.firedAt?.toISOString() ?? null,
  runId: row.runId,
});

/** A look at the workspace's waiting deliveries now (no key: the event that queued it is the reason). */
const checkNow = (db: Database, orgId: string) =>
  enqueue(db, { orgId, kind: FIRST_DELIVERY_JOB, payload: {}, maxAttempts: 3 });

/**
 * Keeps the person's first delivery for `agentId`: a new agent takes the place of one that hasn't fired (the person went
 * back and picked another area); one that fired stays as it is. Kept disarmed (the person is still on the agent's step)
 * unless `armed`; armed, a look at whether it can fire now is queued.
 */
export async function keepFirstDelivery(
  db: Database,
  input: { orgId: string; userId: string; agentId: string; area: string | null; task: string; armed?: boolean },
): Promise<FirstDeliveryRow> {
  const area = input.area?.trim().slice(0, FIRST_DELIVERY_AREA_MAX) || null;
  const task = input.task.trim().slice(0, FIRST_DELIVERY_TASK_MAX);
  const armedAt = input.armed ? new Date() : null;
  const [kept] = await db
    .insert(firstDeliveries)
    .values({ orgId: input.orgId, userId: input.userId, agentId: input.agentId, area, task, armedAt })
    .onConflictDoUpdate({
      target: [firstDeliveries.orgId, firstDeliveries.userId],
      set: { agentId: input.agentId, area, task, armedAt, createdAt: new Date(), runId: null },
      setWhere: isNull(firstDeliveries.firedAt),
    })
    .returning();
  const row =
    kept ??
    (
      await db
        .select()
        .from(firstDeliveries)
        .where(and(eq(firstDeliveries.orgId, input.orgId), eq(firstDeliveries.userId, input.userId)))
    )[0];
  if (!row) throw new Error("first delivery not kept");
  if (kept?.armedAt) await checkNow(db, input.orgId);
  return viewOf(row);
}

/** The person's first delivery here, or null (none, or its agent archived or gone). */
export async function readFirstDelivery(db: Database, orgId: string, userId: string): Promise<FirstDeliveryRow | null> {
  const [row] = await db
    .select({ row: firstDeliveries })
    .from(firstDeliveries)
    .innerJoin(agents, and(eq(agents.orgId, firstDeliveries.orgId), eq(agents.id, firstDeliveries.agentId)))
    .where(
      and(
        eq(firstDeliveries.orgId, orgId),
        eq(firstDeliveries.userId, userId),
        isNull(agents.archivedAt),
        isNull(agents.deletedAt),
      ),
    );
  return row ? viewOf(row.row) : null;
}

/** The person's pending first delivery (not fired yet), as stored: what `startFirstAgent`'s `replace` checks. */
export async function pendingFirstDelivery(db: Database, orgId: string, userId: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(firstDeliveries)
    .where(and(eq(firstDeliveries.orgId, orgId), eq(firstDeliveries.userId, userId), isNull(firstDeliveries.firedAt)));
  return row ?? null;
}

/**
 * Arms the person's first delivery as they leave the agent's step ("Continuar"), for `agentId`: an agent of this
 * workspace, not archived, that answers them. Their waiting delivery of that agent keeps its area and task; any other
 * agent (one brought from another app) takes its place with no area and no task, its brief then its routine of theirs,
 * else its role. One that fired stays as it is. A look at whether it can fire now is queued.
 */
export async function armFirstDelivery(
  db: Database,
  who: { orgId: string; userId: string },
  agentId: string,
): Promise<FirstDeliveryRow> {
  const { orgId, userId } = who;
  await requireActiveMembership(db, userId, orgId);
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found", "first_delivery.no_agent");
  if (!(await reachesAgent(db, orgId, agentId, userId)))
    throw new ForbiddenError("This agent doesn't answer you", "first_delivery.not_yours");
  const [armed] = await db
    .update(firstDeliveries)
    .set({ armedAt: new Date() })
    .where(
      and(
        eq(firstDeliveries.orgId, orgId),
        eq(firstDeliveries.userId, userId),
        eq(firstDeliveries.agentId, agentId),
        isNull(firstDeliveries.firedAt),
      ),
    )
    .returning();
  if (!armed) return keepFirstDelivery(db, { orgId, userId, agentId, area: null, task: "", armed: true });
  await checkNow(db, orgId);
  return viewOf(armed);
}

// ── The brief ────────────────────────────────────────────────────────────────

/** The routine the delivery runs first: the oldest of this agent's that this person made, still on. */
async function firstRoutineOf(db: Database, orgId: string, agentId: string, userId: string) {
  const [routine] = await db
    .select({
      id: routines.id,
      name: routines.name,
      prompt: routines.prompt,
      description: routines.description,
      phrase: routines.phrase,
      timezone: routines.timezone,
    })
    .from(routines)
    .where(
      and(
        eq(routines.orgId, orgId),
        eq(routines.agentId, agentId),
        eq(routines.createdByUserId, userId),
        isNull(routines.deletedAt),
        eq(routines.active, true),
      ),
    )
    .orderBy(asc(routines.createdAt))
    .limit(1);
  return routine ?? null;
}

/**
 * What the agent reads (English, for the model; it answers in the person's language): who waits, what to do now with
 * its tools (its routine's job, else the task the onboarding kept, else its role's first piece of work), and how to
 * report it in one message, with anything to send or change waiting on the person's approval. It never passes on it.
 */
export function firstDeliveryBrief(input: {
  person: string;
  locale: string;
  role: string;
  task: string;
  routine: { name: string; prompt: string; when: string | null } | null;
}): string {
  const { person, routine } = input;
  const job = routine
    ? `Run your routine «${routine.name}»${routine.when ? ` (${routine.when})` : ""} now, as it will run each time. Its instructions, written by ${person}:\n${routine.prompt}`
    : input.task
      ? `What ${person} asked you to do first:\n${input.task}`
      : `The first piece of work your role${input.role ? ` (${input.role})` : ""} brings, on what you can reach now (the apps and files you have).`;
  const again = routine
    ? `End with when you do it again (${routine.when ?? "your routine's schedule"}).`
    : "End with when you would do it again, and offer to do it on a schedule.";
  return [
    `${person} set you up a moment ago and is waiting, in this conversation, for the first thing you deliver for them. Do it now, with your tools.`,
    job,
    `Then report it in ONE message to ${person}, in their language (their app is in ${input.locale}): open with one short sentence of what you found, with the numbers when there are any; then what is ready. Anything to send, reply or change in a connected app waits on them: ask for it as an approval, never send it yourself.`,
    again,
    "Don't pass on this turn: they are waiting for it. If you can't reach what it needs (an app not connected yet), say so in that message and what you did with what you could reach.",
  ].join("\n\n");
}

// ── Firing ───────────────────────────────────────────────────────────────────

/**
 * Fires the workspace's first deliveries that can fire now (`FIRST_DELIVERY_JOB`): for each one armed and waiting, while
 * the workspace may work (active, no hold, not being deleted), the person is still a member who reaches the agent, the agent
 * is neither archived nor held, and its AI reads ready, claimed (once, whatever runs it twice) and delivered as a
 * `first_delivery` notice into the person's DM with the agent, in the same transaction, published after it. Returns how
 * many fired. One past `FIRST_DELIVERY_KEPT_MS` goes instead.
 */
export async function fireFirstDeliveries(deps: FirstDeliveryDeps, orgId: string, now = new Date()): Promise<number> {
  const { db } = deps;
  const waiting = await db
    .select()
    .from(firstDeliveries)
    .where(and(eq(firstDeliveries.orgId, orgId), isNull(firstDeliveries.firedAt), isNotNull(firstDeliveries.armedAt)))
    .orderBy(asc(firstDeliveries.createdAt));
  if (waiting.length === 0) return 0;
  // Read fresh, not from the 5-second cache: the hold that lifted a moment ago in another process is gone here too.
  const [standing] = await db.select(STANDING_COLUMNS).from(organizations).where(eq(organizations.id, orgId));
  if (!standing || workRefusal(standing)) return 0;
  let fired = 0;
  for (const row of waiting) {
    if (now.getTime() - row.createdAt.getTime() > FIRST_DELIVERY_KEPT_MS) {
      await db.delete(firstDeliveries).where(and(eq(firstDeliveries.id, row.id), isNull(firstDeliveries.firedAt)));
      continue;
    }
    if (await fireOne(deps, row)) fired++;
  }
  return fired;
}

async function fireOne(deps: FirstDeliveryDeps, row: Row): Promise<boolean> {
  const { db } = deps;
  const { orgId, userId, agentId } = row;
  if (!(await getMembership(db, userId, orgId))) return false;
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt || agent.operatorHoldAt) return false;
  if (!(await reachesAgent(db, orgId, agentId, userId))) return false;
  const ai = await agentAiState(
    { db, gateway: deps.gateway, machines: deps.machines ?? null },
    agent,
    undefined,
    userId,
  ).catch(() => null);
  if (ai?.state !== "ready") return false;
  const [routine, locale, person] = await Promise.all([
    firstRoutineOf(db, orgId, agentId, userId),
    personLocale(db, userId),
    db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .then((r) => r[0]?.name ?? ""),
  ]);
  const name = firstName(person) || "The person";
  const notice: Notice = {
    kind: "first_delivery",
    from: `${name} is waiting for your first delivery`,
    text: firstDeliveryBrief({
      person: name,
      locale,
      role: agent.role ?? "",
      task: row.task,
      routine: routine
        ? {
            name: routine.name,
            prompt: routine.prompt,
            when: routine.description || routine.phrase || null,
          }
        : null,
    }),
    refs: { personId: userId, ...(routine ? { routineId: routine.id } : {}) },
  };
  const delivered = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(firstDeliveries)
      .set({ firedAt: new Date() })
      .where(and(eq(firstDeliveries.id, row.id), isNull(firstDeliveries.firedAt)))
      .returning({ id: firstDeliveries.id });
    if (!claimed) return null;
    const dm = await openPersonAgentDm(tx, orgId, userId, agentId);
    const out = await deliverNotice(tx, {
      orgId,
      agentId,
      channelId: dm.id,
      threadId: null,
      hop: 0,
      stretchId: null,
      notice,
      trigger: "dm",
    });
    const runId = out.runs[0]?.id;
    if (runId) await tx.update(firstDeliveries).set({ runId }).where(eq(firstDeliveries.id, row.id));
    return out;
  });
  if (!delivered) return false;
  await publishDelivery(deps.pubsub, delivered).catch(() => {});
  return true;
}

// ── The sweep ────────────────────────────────────────────────────────────────

/**
 * How often the sweep looks at a delivery still waiting, by how long it has waited since it was armed: every 15 seconds
 * in its first hour (Checkout, the AI and the computer usually come then), every minute in its first day, every 10
 * minutes after.
 */
export function firstDeliveryWindowMs(waitedMs: number) {
  if (waitedMs < 3600_000) return 15_000;
  if (waitedMs < 86_400_000) return 60_000;
  return 10 * 60_000;
}

/**
 * The workers' sweep (`apps/server/src/workers.ts`, the process that sweeps): drops deliveries that waited past
 * `FIRST_DELIVERY_KEPT_MS`, then queues one look per workspace that may work and has one armed and waiting, keyed by its
 * window of time (`firstDeliveryWindowMs`, by the newest armed), so many processes and ticks queue it once. A workspace
 * on a hold gets none: lifting it queues its own. Returns how many it queued.
 */
export async function enqueueFirstDeliveryChecks(db: Database, now = new Date()): Promise<number> {
  await db
    .delete(firstDeliveries)
    .where(
      and(
        isNull(firstDeliveries.firedAt),
        lt(firstDeliveries.createdAt, new Date(now.getTime() - FIRST_DELIVERY_KEPT_MS)),
      ),
    );
  const orgs = await db
    .select({ orgId: firstDeliveries.orgId, newest: sql<string>`max(${firstDeliveries.armedAt})` })
    .from(firstDeliveries)
    .innerJoin(organizations, eq(organizations.id, firstDeliveries.orgId))
    .where(and(isNull(firstDeliveries.firedAt), isNotNull(firstDeliveries.armedAt), openOrg))
    .groupBy(firstDeliveries.orgId);
  if (orgs.length === 0) return 0;
  return enqueueBatch(
    db,
    orgs.map(({ orgId, newest }) => {
      const window = firstDeliveryWindowMs(now.getTime() - new Date(newest).getTime());
      return {
        orgId,
        kind: FIRST_DELIVERY_JOB,
        payload: {},
        dedupeKey: `${FIRST_DELIVERY_JOB}:${orgId}:${window}:${Math.floor(now.getTime() / window)}`,
        maxAttempts: 1,
      };
    }),
  );
}

// ── The delivery's line ──────────────────────────────────────────────────────

/** Markdown as plain text: code, headings, pictures, links, emphasis, quotes, lists and tables' bars gone. */
function plainText(text: string) {
  return (
    text
      .replace(/```[\s\S]*?(```|$)/g, "\n\n")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>\s][^>]*>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      // A heading is a label ("Resumo"), not the news.
      .replace(/^\s{0,3}#{1,6}\s.*$/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      // A table's rule line and a horizontal rule.
      .replace(/^[ \t|:-]*-{3,}[ \t|:-]*$/gm, "")
      .replace(/\|/g, " ")
      // Bold, italics and strikethrough; a single `_` is left alone (it joins words: `first_delivery`).
      .replace(/(\*\*|__|\*|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
  );
}

/** Hello words a reply opens with, in the languages the apps speak: "Oi, Ana." is a greeting, not the news. */
const GREETING =
  /^(oi|olá|ola|bom dia|boa tarde|boa noite|hi|hello|hey|good (morning|afternoon|evening)|hola|buenos días|buenas|bonjour|salut|ciao|buongiorno|hallo|guten (morgen|tag)|hej|hei|merhaba|привет|こんにちは|你好|안녕)(?![\p{L}\p{N}])/iu;
const SENTENCE = /^[\s\S]*?[.!?…](?=\s|$)/u;
const SUMMARY_MAX = 140;

/**
 * The one line a first delivery's reply is shown by (`meta.firstDelivery.summary`): plain text (no markdown), its first
 * paragraph, past an opening greeting of at most 4 words ("Oi, Ana."), its first sentence, cut at a word under 140
 * characters with "…". Null when nothing is left.
 */
export function deliverySummary(text: string): string | null {
  const paragraphs = plainText(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let line = paragraphs[0] ?? "";
  const opening = SENTENCE.exec(line)?.[0]?.trim();
  if (opening && greeting(opening)) {
    const rest = line.slice(line.indexOf(opening) + opening.length).trim();
    // A greeting alone ("Oi, Ana.\n\n12 e-mails…"): the news is the next paragraph.
    line = rest || paragraphs[1] || line;
  }
  const first = (SENTENCE.exec(line)?.[0] ?? line).trim();
  if (!first) return null;
  if (first.length <= SUMMARY_MAX) return first;
  const cut = first.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(" ");
  const atWord = space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut;
  return `${atWord.replace(/[\s,;:.!?…-]+$/u, "")}…`;
}

/** A greeting: at most 4 words, opening with a hello word, or with a comma or "!" and no number ("Tudo certo, Ana!"). */
function greeting(sentence: string) {
  if (sentence.split(/\s+/).length > 4) return false;
  return GREETING.test(sentence) || (/[,!]/.test(sentence) && !/\d/.test(sentence));
}
