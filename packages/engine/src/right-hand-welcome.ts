import { and, type Database, type Executor, eq, gt, inArray, isNotNull, ne, schema, sql } from "@agenteschat/db";
import { serverText } from "@agenteschat/i18n";
import { en } from "@agenteschat/i18n/en";
import { ownsAgentSql } from "./audience";
import { personAgentDmKey } from "./dms";
import type { JobDeps } from "./jobs";
import { enqueue } from "./outbox";
import { personLocale } from "./requester";
import { defineLodiLane, type LodiPromptContext } from "./right-hand-lane";
import { lodiFor, lodiSwitches, postFromLodi } from "./right-hand-proactive";
import { orgStanding, workRefusal } from "./standing";
import type { ReplyChips } from "./team-proposals";

/**
 * "Dar boas-vindas a quem entra": one message from the right hand to each person who joins a workspace, once, and
 * what it keeps in mind while they are new. The greeting calls no model.
 *
 * The contract with the rest of the server is `welcomeLane` below: the server reads the job, the prompt block and the
 * switch from it, so nothing else is wired by hand.
 * - `WELCOME_JOB` is queued where a person becomes a member (`queueWelcome`), in that transaction, with
 *   `payload.userId` and one dedupe key per workspace and person, so nobody is greeted twice, a rejoin included.
 * - `postWelcome` is that job. It posts nothing when the workspace turned it off (`lodiSwitches(...).welcomePeople`)
 *   or `lodiFor` says no, and may run twice (`postFromLodi` with `posted`). A job that ends without posting spent
 *   its key: nobody is greeted late.
 * - `newcomerBlock` is a block of the right hand's prompt in its DM with `ctx.personId`, or "". It is read on every
 *   turn there: one statement.
 * - `live` shows the "Dar boas-vindas a quem entra" switch on the right hand's page and adds it to
 *   `update_workspace`. False keeps it off both.
 */

const {
  agents,
  channels,
  firstAgentProposals,
  firstDeliveries,
  messages,
  organizationMembers,
  organizationSettings,
  organizations,
  users,
} = schema;

export const WELCOME_JOB = "right_hand.welcome";

/** The greeting's `meta.bodyCode`: the apps word it with `chat.body.welcome_member`. */
export const WELCOME_BODY = "welcome_member";

/**
 * The greeting of someone who already picked their first agent on their own onboarding (ADR 0264): hello and the agent
 * on the team, with nothing to build (`chat.body.welcome_member_agent`).
 */
export const WELCOME_AGENT_BODY = "welcome_member_agent";

/**
 * Whether this person made their first agent on their own onboarding here (ADR 0264): one picked from what their own
 * AI proposed (`first_agent_proposals`), or any first agent the onboarding keeps for them (`first_deliveries`: an
 * area's, "Other", one brought from another app).
 */
async function pickedFirstAgent(db: Database, orgId: string, userId: string) {
  const [[proposed], [kept]] = await Promise.all([
    db
      .select({ id: firstAgentProposals.id })
      .from(firstAgentProposals)
      .where(
        and(
          eq(firstAgentProposals.orgId, orgId),
          eq(firstAgentProposals.userId, userId),
          isNotNull(firstAgentProposals.agentId),
        ),
      )
      .limit(1),
    db
      .select({ id: firstDeliveries.id })
      .from(firstDeliveries)
      .where(and(eq(firstDeliveries.orgId, orgId), eq(firstDeliveries.userId, userId)))
      .limit(1),
  ]);
  return proposed !== undefined || kept !== undefined;
}

/**
 * Their first agent was picked after the greeting went out (it is posted as they join, while they are still on their
 * own onboarding): the greeting stops asking for an agent and its area chips go (ADR 0264). Nothing when there is no
 * such greeting.
 */
export async function settleWelcome(db: Database, orgId: string, userId: string): Promise<void> {
  const lodi = await lodiFor(db, orgId, userId);
  if (!lodi) return;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return;
  const locale = await personLocale(db, userId);
  const body = serverText(locale, `chat.body.${WELCOME_AGENT_BODY}`, { org: org.name });
  const dm = db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.orgId, orgId), eq(channels.dmKey, personAgentDmKey(userId, lodi.id))));
  await db
    .update(messages)
    .set({
      body,
      meta: sql`(${messages.meta} - 'replyChips') || jsonb_build_object('bodyCode', ${WELCOME_AGENT_BODY}::text)`,
    })
    .where(
      and(
        eq(messages.orgId, orgId),
        inArray(messages.channelId, dm),
        sql`${messages.meta}->>'bodyCode' = ${WELCOME_BODY}`,
      ),
    );
}

/** How long after joining a person with no agent of their own is still new to the right hand. */
export const NEWCOMER_DAYS = 30;

/**
 * The areas a person taps under the greeting: the onboarding's own, in its order (the client's `WORK_AREAS`, which
 * this package cannot import). "Something else" is left out, since typing is that answer and the words alone tell the
 * right hand nothing.
 */
const AREAS = Object.keys(en.onboarding.flow.area.options).filter((id) => id !== "other");

/** Their area as the onboarding saved it, when it names one: not skipped, not "something else". */
const areaOf = (workArea: string | null) => (workArea && AREAS.includes(workArea) ? workArea : null);

/** Queues the greeting of someone who just became a member, in the transaction that made them one. */
export const queueWelcome = (tx: Executor, orgId: string, userId: string) =>
  enqueue(tx, { orgId, kind: WELCOME_JOB, payload: { userId }, dedupeKey: `${WELCOME_JOB}:${orgId}:${userId}` });

export async function postWelcome(deps: JobDeps, orgId: string, payload: Record<string, unknown>): Promise<void> {
  const { db } = deps;
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  if (!userId) return;
  if (!(await lodiSwitches(db, orgId)).welcomePeople) return;
  // On a hold nothing answers here: the greeting would promise an agent the person's reply cannot get.
  if (workRefusal(await orgStanding(db, orgId))) return;
  // No row: they left before the job ran.
  const [person] = await db
    .select({ role: organizationMembers.role, workArea: users.workArea, org: organizations.name })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (!person) return;
  // An owner has the first-run checklist at the top of this DM, which holds the whole setup: one ask, not two.
  if (person.role === "owner") return;
  const lodi = await lodiFor(db, orgId, userId);
  if (!lodi) return;
  // Their first agent came from their own onboarding: the greeting says hello and asks nothing they already answered.
  const picked = await pickedFirstAgent(db, orgId, userId);
  const locale = await personLocale(db, userId);
  const chips: ReplyChips = {
    choices: AREAS.map((id) => serverText(locale, `onboarding.flow.area.options.${id}`)),
    multiple: false,
    step: 1,
    of: 1,
  };
  await postFromLodi(deps, orgId, userId, {
    bodyCode: picked ? WELCOME_AGENT_BODY : WELCOME_BODY,
    bodyParams: { org: person.org },
    // Someone whose area the onboarding already knows, or who picked their agent there, is not asked to tap it.
    ...(picked || areaOf(person.workArea) ? {} : { meta: { replyChips: chips } }),
    push: true,
    // Anything already in their conversation with it: they wrote first, or it was restored on a rejoin. Not the team
    // card their pick made there (ADR 0264): the hello still goes out after it. The card's kind is `TEAM_PROPOSAL_CARD`,
    // written out here since importing team-proposals from this module makes an import cycle.
    posted: async (tx, lodiId) =>
      (
        await tx
          .select({ id: messages.id })
          .from(messages)
          .innerJoin(channels, and(eq(channels.orgId, messages.orgId), eq(channels.id, messages.channelId)))
          .where(
            and(
              eq(messages.orgId, orgId),
              eq(channels.dmKey, personAgentDmKey(userId, lodiId)),
              picked ? sql`coalesce(${messages.meta}->'actionCard'->>'kind', '') <> 'team_proposal'` : undefined,
            ),
          )
          .limit(1)
      ).length > 0,
    lodi,
  });
}

/**
 * What the right hand keeps in mind with someone new: a member who is not an owner (an owner has the first-run
 * checklist), joined in the last `NEWCOMER_DAYS` days, has no agent of their own and made none on their onboarding
 * (ADR 0264: a pick from their own AI's proposal, or any first agent it kept for them). Only this person's own data. ""
 * with the workspace's switch off.
 */
export async function newcomerBlock(db: Database, ctx: LodiPromptContext): Promise<string> {
  const [person] = await db
    .select({ workArea: users.workArea })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(organizationSettings, eq(organizationSettings.orgId, organizationMembers.orgId))
    .where(
      and(
        eq(organizationMembers.orgId, ctx.orgId),
        eq(organizationMembers.userId, ctx.personId),
        ne(organizationMembers.role, "owner"),
        gt(organizationMembers.createdAt, sql`now() - make_interval(days => ${NEWCOMER_DAYS})`),
        sql`coalesce(${organizationSettings.welcomePeople}, true)`,
        // Their own: theirs by name or by a role they hold (ADR 0085, addendum of 2026-11-21).
        sql`not exists (select 1 from ${agents}
          where ${agents.orgId} = ${ctx.orgId} and ${ownsAgentSql("agents", sql`${ctx.personId}::text`)})`,
        // Their first agent picked on their onboarding, even one since given to someone else: it isn't offered again.
        sql`not exists (select 1 from ${firstAgentProposals}
          where ${firstAgentProposals.orgId} = ${ctx.orgId} and ${firstAgentProposals.userId} = ${ctx.personId}
          and ${firstAgentProposals.agentId} is not null)`,
        // Nor once the onboarding kept any first agent for them (an area's, "Other", one brought from another app).
        sql`not exists (select 1 from ${firstDeliveries}
          where ${firstDeliveries.orgId} = ${ctx.orgId} and ${firstDeliveries.userId} = ${ctx.personId})`,
      ),
    );
  if (!person) return "";
  const area = areaOf(person.workArea);
  return [
    "# Someone new",
    `This person joined the workspace in the last ${NEWCOMER_DAYS} days and has no agent of their own yet.${
      area ? ` They work in ${serverText("en", `onboarding.flow.area.options.${area}`)}.` : ""
    }`,
    "- When they say what they look after, propose ONE agent for it with propose_agent and a first_task to try it on. Never a team and never the interview for them, unless they ask for one.",
    "- At most one question first, and only when what they do is unclear. What they typed comes first.",
    "- Once their agent is made and it has no AI, offer the Connect AI card (offer_connect_ai), once.",
    "- If you already proposed an agent in this conversation, don't propose another unless they ask.",
  ].join("\n");
}

export const welcomeLane = defineLodiLane({
  switch: "welcomePeople",
  live: true,
  jobs: { [WELCOME_JOB]: postWelcome },
  promptBlock: newcomerBlock,
});
