import { type PubSub, type RateLimiter, retryInSeconds } from "@agenteschat/adapters";
import { and, asc, type Database, desc, eq, isNull, lt, or, schema } from "@agenteschat/db";
import { z } from "zod";
import { checkRoutine, type DraftPlace } from "./agent-proposals";
import { archiveAgent, freeHandle, HANDLE_PATTERN, takenHandles } from "./agents";
import { AGENT_LOOK, type AgentAppearance, validateAppearance } from "./appearance";
import { recordAudit } from "./audit";
import { CHANNEL_NAME_PATTERN } from "./channels";
import { CONNECTOR_CATALOG } from "./connectors/catalog";
import { CONNECTOR_BRANDS } from "./connectors/listing";
import { MCP_PRESETS } from "./connectors/presets";
import type { ContextDeps } from "./context/summaries";
import { openPersonAgentDm } from "./dms";
import { ConflictError, ForbiddenError, NotFoundError, TooManyError, ValidationError } from "./errors";
import { publishUserEvent } from "./events";
import { keepFirstDelivery, pendingFirstDelivery } from "./first-delivery";
import { handleFromName } from "./imports";
import { can, requireActiveMembership, updateOrganization } from "./organizations";
import { personLocale } from "./requester";
import { settleWelcome } from "./right-hand-welcome";
import { SETUP_APPS_MAX } from "./setup-checklist";
import { workRefusalBeforePlan } from "./standing";
import { channelPlaces, checkTeam, rightHandDm, type TeamDeps, type TeamProposalCard } from "./team-proposals";
import { createTeamNow } from "./team-templates";
import { isPersonalWorkspace } from "./workspace-mode";

const { agents, channelMembers, channels, connectorConnections, firstAgentProposals, organizations } = schema;

/**
 * A person's first agents, proposed by their own AI (ADR 0260): the onboarding asks Claude, ChatGPT or the AI they use
 * for the three repetitive tasks that take most of their time, each as an agent. The AI sends them through the MCP
 * tool `propose_first_agents` (ADR 0119 addendum of 2026-11-26), or the person pastes its answer. Nothing is created
 * until the person picks one: then one agent, through the same team card the templates make (`createTeamNow`), so its
 * routine, its AI, Undo, the plan-waiting emails and the team's hello work as they do there.
 */

/** The user event the onboarding waits for (it also reads the newest proposal every few seconds). */
export const FIRST_AGENTS_EVENT = "first_agents.received";

export const FIRST_AGENT_LIMITS = {
  options: 3,
  about: 600,
  name: 30,
  role: 40,
  why: 280,
  tasks: 4,
  task: 120,
  apps: 8,
  today: 3,
  instructions: 4000,
} as const;

/** Proposals per person and workspace: an AI retrying, or a person pasting again, not a flood. */
const SAVE_LIMIT = { limit: 10, windowMs: 3600_000 };
/** A pick that started this long ago without its agent (its process stopped) may start again. */
const PICK_STALE_MS = 2 * 60_000;

const line = (max: number) => z.string().trim().min(1).max(max);

const optionInput = z.object({
  name: line(FIRST_AGENT_LIMITS.name).describe("A short first name for the agent, as a person's: Caio"),
  handle: z.string().trim().max(32).nullish().describe("Its @handle; made from the name when left out"),
  role: line(FIRST_AGENT_LIMITS.role).describe("Its job title in one or two words, in the person's language"),
  why: line(FIRST_AGENT_LIMITS.why).describe("One sentence, from what you saw, on why this task"),
  tasks: z
    .array(line(FIRST_AGENT_LIMITS.task))
    .min(1)
    .max(FIRST_AGENT_LIMITS.tasks)
    .describe("Its responsibilities, as in a job description: what it does alone, when it runs, when it calls them"),
  apps: z
    .array(line(60))
    .max(FIRST_AGENT_LIMITS.apps)
    .nullish()
    .describe("The apps it needs, by name: Gmail, Stripe, Google Sheets"),
  routine: z
    .object({
      title: line(120).describe("What the routine does, short"),
      schedule: line(120).describe("When it runs, in the person's words: every Monday at 8:00"),
      prompt: line(FIRST_AGENT_LIMITS.instructions).describe("What the agent is told each time it runs"),
      cron: z
        .string()
        .trim()
        .max(100)
        .nullish()
        .describe("The same schedule as 5-field cron in the person's time zone: 0 8 * * 1"),
    })
    .nullish()
    .describe("Its routine: the recurring job, with a day and a time"),
  today: z
    .array(line(200))
    .max(FIRST_AGENT_LIMITS.today)
    .nullish()
    .describe("What it can deliver on its first day, up to 3 items"),
  instructions: z
    .string()
    .trim()
    .max(FIRST_AGENT_LIMITS.instructions)
    .nullish()
    .describe("Its standing instructions: how it works, what waits for a person"),
});

/**
 * What the MCP tool and the paste route take: 1 to 3 options, ordered by the time each task takes. What may be left out
 * may also be null, as an AI's JSON often writes it: the tool's own arguments are checked against this before
 * `saveFirstAgents` reads them.
 */
export const firstAgentsInput = z.object({
  about: z
    .string()
    .trim()
    .max(FIRST_AGENT_LIMITS.about)
    .nullish()
    .describe("Two or three sentences on what the workspace (or the person) does"),
  options: z
    .array(optionInput)
    .min(1)
    .max(FIRST_AGENT_LIMITS.options)
    .describe("1 to 3 agents, the task that takes the most time first"),
});
export type FirstAgentsInput = z.input<typeof firstAgentsInput>;

/** An app an option needs: `key` names its mark (a connector brand or a mailbox provider) when it is one we know. */
export interface FirstAgentApp {
  key: string | null;
  label: string;
}

export interface FirstAgentRoutine {
  title: string;
  /** As the AI wrote it ("toda segunda às 8:00"). */
  schedule: string;
  prompt: string;
  /** Read with the routines' own reader, in the person's time zone; null when it couldn't be read. */
  cron: string | null;
  timezone: string | null;
}

/** One option, as stored and as the apps draw it. */
export interface FirstAgentOption {
  name: string;
  /** Free in the workspace and among the options when proposed; a free one again when picked. */
  handle: string;
  role: string;
  why: string;
  tasks: string[];
  apps: FirstAgentApp[];
  routine: FirstAgentRoutine | null;
  today: string[];
  instructions: string;
  /** Picked here: a different color for each option. */
  appearance: AgentAppearance;
}

export interface FirstAgents {
  id: string;
  about: string | null;
  source: "mcp" | "paste";
  options: FirstAgentOption[];
  /** The option picked, from when the pick starts. */
  picked: number | null;
  agentId: string | null;
  createdAt: string;
}

export interface FirstAgentsDeps {
  db: Database;
  pubsub?: PubSub;
  rateLimiter?: RateLimiter;
  /** Reads a routine's schedule in words (the workspace's cheap model); a cron is read without it. */
  context?: ContextDeps;
}

export type FirstAgentsPickDeps = TeamDeps & { context?: ContextDeps };

const viewOf = (row: typeof firstAgentProposals.$inferSelect): FirstAgents => ({
  id: row.id,
  about: row.about,
  source: row.source,
  options: row.options as unknown as FirstAgentOption[],
  picked: row.picked,
  agentId: row.agentId,
  createdAt: row.createdAt.toISOString(),
});

// ── Apps by name ─────────────────────────────────────────────────────────────

/** Lower case, no accents, words split by one space: how app names are compared. */
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Mailboxes, which the apps draw by their provider's mark. */
const MAIL_APPS = [
  { key: "gmail", label: "Gmail" },
  { key: "outlook", label: "Outlook" },
  { key: "icloud", label: "iCloud" },
];

/** Names AIs give apps besides the catalog's own label, by the catalog's id. */
const APP_ALIASES: Record<string, string[]> = {
  drive: ["gdrive", "google drive"],
  "google-sheets": ["sheets", "planilhas google", "google planilhas"],
  "google-docs": ["docs", "documentos google"],
  "google-calendar": ["gcal", "google agenda", "agenda google", "calendar"],
  "microsoft-teams": ["teams"],
  atlassian: ["jira", "confluence"],
  x: ["twitter"],
  "meta-ads": ["facebook ads", "instagram ads", "meta business"],
  gmail: ["google mail", "email gmail"],
  outlook: ["hotmail", "microsoft outlook", "office 365 mail"],
};

/** Every app the catalog knows, by its id (a connector or a one-click server), and the mailboxes. */
const catalogApps = () => [
  ...Object.values(CONNECTOR_CATALOG).map((c) => ({ id: c.id, label: c.label, soon: false })),
  ...MCP_PRESETS.map((p) => ({ id: p.id, label: p.label, soon: p.soon === true })),
];

/** A catalog id's mark: its brand (`cloudflare-bindings` is Cloudflare's), a mailbox's provider, or none. */
const markOf = (id: string) => {
  if (CONNECTOR_BRANDS[id] || MAIL_APPS.some((m) => m.key === id)) return id;
  const brand = id.split("-")[0] ?? "";
  return CONNECTOR_BRANDS[brand] ? brand : null;
};

let appIndex: Map<string, { id: string; label: string; key: string | null; soon: boolean }> | null = null;

/** Plain name → the app it names, built once. Earlier entries win: a catalog label before an alias. */
function knownApps() {
  if (appIndex) return appIndex;
  const index = new Map<string, { id: string; label: string; key: string | null; soon: boolean }>();
  const add = (name: string, app: { id: string; label: string; key: string | null; soon: boolean }) => {
    const k = plain(name);
    if (k && !index.has(k)) index.set(k, app);
  };
  const all = [...catalogApps(), ...MAIL_APPS.map((m) => ({ id: m.key, label: m.label, soon: false }))];
  for (const a of all) {
    const app = { ...a, label: a.label.replace(/\s*\(.*\)$/, ""), key: markOf(a.id) };
    add(a.label, app);
    add(app.label, app);
    add(a.id, app);
  }
  for (const [id, names] of Object.entries(APP_ALIASES)) {
    const app = index.get(plain(id)) ?? [...index.values()].find((a) => a.id === id);
    if (app) for (const name of names) add(name, app);
  }
  // A brand the catalog has no entry of its own for ("Meta"): its mark, under the name the AI wrote.
  for (const key of Object.keys(CONNECTOR_BRANDS)) add(key, { id: key, label: "", key, soon: false });
  appIndex = index;
  return index;
}

/** An app as the AI named it: its mark and the catalog's own name when we know it, else its name as written. */
export function firstAgentApp(name: string): FirstAgentApp {
  const known = knownApps().get(plain(name));
  return known ? { key: known.key, label: known.label || name.trim() } : { key: null, label: name.trim() };
}

/** The catalog id ("Ask to connect" on its agent's checklist) of an app an option needs, or null. */
function catalogIdOf(app: FirstAgentApp) {
  const named = knownApps().get(plain(app.label));
  const found = named ?? (app.key ? knownApps().get(plain(app.key)) : undefined);
  if (!found || found.soon) return null;
  return catalogApps().some((c) => c.id === found.id) ? found.id : null;
}

// ── Saving ───────────────────────────────────────────────────────────────────

const hashOf = (text: string) => [...text].reduce((h, c) => (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0, 7);

/** A look for each option: a different color each, one no agent here wears when there is one, eyes and an accessory. */
function looksFor(names: string[], worn: Set<string>): AgentAppearance[] {
  const colors = AGENT_LOOK.colors.filter((c) => c !== "graphite");
  const accessories = AGENT_LOOK.accessories.filter((a) => a !== "none");
  const used = new Set<string>();
  return names.map((name) => {
    const h = hashOf(name);
    const free = colors.filter((c) => !used.has(c));
    const fresh = free.filter((c) => !worn.has(c));
    const pool = fresh.length > 0 ? fresh : free.length > 0 ? free : colors;
    const color = pool[h % pool.length] ?? "sky";
    used.add(color);
    return {
      color,
      eyes: AGENT_LOOK.eyes[(h >>> 3) % AGENT_LOOK.eyes.length] ?? "round",
      accessory: accessories[(h >>> 6) % accessories.length] ?? "none",
    };
  });
}

/**
 * A routine's schedule read as the routines read it, in the person's time zone: its cron first, else its words (which
 * need the workspace's own model). Null when neither reads, or it runs more often than a routine may.
 */
async function readSchedule(
  deps: { db: Database; context?: ContextDeps },
  at: DraftPlace,
  r: { title: string; schedule: string; prompt: string; cron?: string | null },
) {
  for (const phrase of [r.cron, r.schedule]) {
    if (!phrase?.trim()) continue;
    try {
      const read = await checkRoutine(deps, at, { schedule: phrase, prompt: r.prompt, title: r.title });
      return { phrase, cron: read.cron || null, timezone: read.timezone };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return null;
}

/** An AI's JSON often writes null for what it leaves out: read as left out (a pasted one, or the tool's arguments). */
const withoutNulls = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutNulls)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).flatMap(([k, v]): [string, unknown][] => (v === null ? [] : [[k, withoutNulls(v)]])),
        )
      : value;

const issueText = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`)
    .join("; ");

/**
 * Keeps a proposal for the person (the MCP tool's, `mcp`, or one they pasted, `paste`): each option with a handle free
 * here and among the options, its apps by the catalog's names, its routine's schedule read and a look of its own. Taken
 * on a workspace that only waits for its first plan (its onboarding runs before Checkout); refused on any other hold.
 * The person's apps hear `first_agents.received`.
 */
export async function saveFirstAgents(
  deps: FirstAgentsDeps,
  who: { orgId: string; userId: string; grantId: string | null; source: "mcp" | "paste"; app?: string },
  input: unknown,
): Promise<FirstAgents> {
  const { db } = deps;
  const { orgId, userId } = who;
  const parsed = firstAgentsInput.safeParse(withoutNulls(input));
  if (!parsed.success) throw new ValidationError(issueText(parsed.error), "first_agents.invalid");
  const membership = await requireActiveMembership(db, userId, orgId);
  const refusal = workRefusalBeforePlan(membership.standing);
  if (refusal) throw refusal;
  if (deps.rateLimiter) {
    const r = await deps.rateLimiter.consume(`first-agents:${orgId}:${userId}`, SAVE_LIMIT);
    if (!r.allowed)
      throw new TooManyError("Too many proposals for now.", "first_agents.rate_limited", {
        retryAfter: retryInSeconds(r.resetAt),
      });
  }
  const [taken, looks] = await Promise.all([
    takenHandles(db, orgId),
    db
      .select({ appearance: agents.appearance })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt))),
  ]);
  const worn = new Set(looks.flatMap((a) => (a.appearance?.color ? [a.appearance.color] : [])));
  const { about, options: raw } = parsed.data;
  const appearances = looksFor(
    raw.map((o) => o.name),
    worn,
  );
  const seen = new Set(taken);
  const place: DraftPlace = { orgId, channelId: "", personId: userId };
  const options: FirstAgentOption[] = [];
  for (const [i, o] of raw.entries()) {
    const wanted = (o.handle ?? "").replace(/^@/, "").toLowerCase();
    let handle = HANDLE_PATTERN.test(wanted) ? wanted : handleFromName(o.name, o.role, o.instructions ?? "");
    if (!HANDLE_PATTERN.test(handle)) handle = `agent-${i + 1}`;
    if (seen.has(handle)) handle = freeHandle(handle, seen);
    seen.add(handle);
    const apps: FirstAgentApp[] = [];
    for (const app of (o.apps ?? []).map(firstAgentApp))
      if (!apps.some((a) => plain(a.label) === plain(app.label))) apps.push(app);
    const read = o.routine ? await readSchedule(deps, place, o.routine) : null;
    options.push({
      name: o.name,
      handle,
      role: o.role,
      why: o.why,
      tasks: o.tasks,
      apps,
      routine: o.routine
        ? {
            title: o.routine.title,
            schedule: o.routine.schedule,
            prompt: o.routine.prompt,
            cron: read?.cron ?? null,
            timezone: read?.timezone ?? null,
          }
        : null,
      today: o.today ?? [],
      instructions: o.instructions ?? "",
      appearance: appearances[i] as AgentAppearance,
    });
  }
  const [row] = await db
    .insert(firstAgentProposals)
    .values({
      orgId,
      userId,
      grantId: who.grantId,
      source: who.source,
      about: about || null,
      options: options as unknown as Record<string, unknown>[],
    })
    .returning();
  if (!row) throw new Error("first agent proposal not stored");
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "first_agents.proposed",
    target: { type: "first_agent_proposal", id: row.id },
    details: {
      source: who.source,
      count: options.length,
      ...(who.grantId ? { grantId: who.grantId } : {}),
      ...(who.app ? { client: who.app } : {}),
    },
  });
  await publishUserEvent(deps.pubsub, orgId, userId, { type: FIRST_AGENTS_EVENT, id: row.id });
  return viewOf(row);
}

/** The person's newest proposal here, or null. */
export async function latestFirstAgents(db: Database, orgId: string, userId: string): Promise<FirstAgents | null> {
  await requireActiveMembership(db, userId, orgId);
  const [row] = await db
    .select()
    .from(firstAgentProposals)
    .where(and(eq(firstAgentProposals.orgId, orgId), eq(firstAgentProposals.userId, userId)))
    .orderBy(desc(firstAgentProposals.createdAt))
    .limit(1);
  return row ? viewOf(row) : null;
}

// ── Picking ──────────────────────────────────────────────────────────────────

/** A channel's name from a role ("Cobrança" → `cobranca`); empty when nothing of it is a name. */
const channelSlug = (text: string) => plain(text).replace(/ /g, "-").slice(0, 60).replace(/-+$/, "");

/**
 * Where the agent lives in a team's workspace: a channel named after its role (`#cobranca`), or after its handle, the
 * first such name this person may use (one that exists and they see is joined; a private or archived one of someone
 * else's gets `-2`).
 */
async function channelFor(db: Database, orgId: string, userId: string, role: string, handle: string) {
  const slug = channelSlug(role);
  const base = CHANNEL_NAME_PATTERN.test(slug) && !slug.startsWith("dm-") && slug !== "general" ? slug : handle;
  const names = [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`)];
  const { blocked } = await channelPlaces(db, orgId, userId, names);
  return names.find((n) => !blocked.includes(n)) ?? `${handle}-${Date.now().toString(36)}`;
}

/**
 * The catalog apps (by id) an agent's job needs that this workspace hasn't connected: its checklist asks for them. An id
 * the catalog doesn't know, or one still to come, is left out.
 */
async function appsToConnect(db: Database, orgId: string, wanted: readonly string[]) {
  const known = new Set(catalogApps().flatMap((c) => (c.soon ? [] : [c.id])));
  const ids = [...new Set(wanted)].filter((id) => known.has(id));
  if (ids.length === 0) return [];
  const connected = new Set(
    (
      await db
        .select({ connector: connectorConnections.connector })
        .from(connectorConnections)
        .where(and(eq(connectorConnections.orgId, orgId), isNull(connectorConnections.revokedAt)))
    ).map((c) => c.connector),
  );
  return ids.filter((id) => !connected.has(id)).slice(0, SETUP_APPS_MAX);
}

/** Where the onboarding opens a created agent: its channel in a team's workspace, else the person's DM with it. */
async function homeOf(db: Database, orgId: string, userId: string, agentId: string) {
  const [agent] = await db
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
  if (!agent) throw new NotFoundError("Agent not found");
  const [home] = await db
    .select({ id: channels.id })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.orgId, orgId),
        eq(channelMembers.agentId, agentId),
        eq(channels.kind, "channel"),
        isNull(channels.dmKey),
        isNull(channels.archivedAt),
      ),
    )
    .orderBy(asc(channelMembers.createdAt))
    .limit(1);
  const channelId = home?.id ?? (await openPersonAgentDm(db, orgId, userId, agentId)).id;
  return { agentId: agent.id, handle: agent.handle, channelId };
}

/** A failed team card's error as the error the route answers with. */
function pickFailure(error: TeamProposalCard["error"]) {
  const reason = error?.reason ?? "The agent wasn't created";
  const code = error?.code ?? "first_agents.failed";
  if (error?.status === 403) return new ForbiddenError(reason, code, error.params);
  if (error?.status === 404) return new NotFoundError(reason, code, error.params);
  if (error?.status === 409) return new ConflictError(reason, code, error.params);
  if (error?.status === 400) return new ValidationError(reason, code, error.params);
  return new Error(reason);
}

/** One first agent as the onboarding asks for it: from an option its AI proposed, or from an area of its own. */
interface FirstAgentPlan {
  name: string;
  handle: string;
  role: string;
  /** What it does, in one line on the card. */
  line: string;
  /** The card's first line. */
  lead: string;
  instructions: string;
  appearance: AgentAppearance;
  /** Its routine, as an AI proposed it; none from an area (connecting an app brings that one, ADR 0242). */
  routine: { title: string; schedule: string; prompt: string; cron?: string | null } | null;
  /** What the receipt's "Abrir com a tarefa" types in its DM. */
  firstTask: string;
  /** Catalog ids of the apps its job needs: its checklist asks for those not connected yet. */
  apps: string[];
}

/**
 * One first agent, made through the team card a template makes (`checkTeam`, then `createTeamNow`): its id, or the
 * card's failure. Its own channel in a team's workspace (a personal one's lives in its DM), the apps every agent has
 * for an admin's, the AI suggested for the person, a checklist row for each app still to connect, and the right hand's
 * weekly check with a team's first agent.
 */
async function makeFirstAgent(deps: FirstAgentsPickDeps, orgId: string, userId: string, plan: FirstAgentPlan) {
  const { db } = deps;
  const personal = await isPersonalWorkspace(db, orgId);
  const [taken, at, locale, team, later] = await Promise.all([
    takenHandles(db, orgId),
    rightHandDm(db, orgId, userId),
    personLocale(db, userId),
    // Any agent of the team ever made, archived ones included: picking another work archives the earlier pick, and
    // the right hand's weekly check made with that one stays (one weekly check, however many picks).
    db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), isNull(agents.builtin)))
      .limit(1),
    appsToConnect(db, orgId, plan.apps),
  ]);
  const handle = taken.has(plan.handle) ? freeHandle(plan.handle, taken) : plan.handle;
  const place: DraftPlace = { orgId, channelId: at.dm.id, personId: userId };
  const read = plan.routine ? await readSchedule(deps, place, plan.routine) : null;
  const params = await checkTeam(
    deps,
    place,
    {
      lead: plan.lead,
      agents: [
        {
          name: plan.name,
          handle,
          role: plan.role,
          line: plan.line,
          instructions: plan.instructions,
          look: plan.appearance,
          channel: personal ? "" : await channelFor(db, orgId, userId, plan.role, handle),
          routines:
            plan.routine && read
              ? [{ schedule: read.phrase, prompt: plan.routine.prompt, title: plan.routine.title }]
              : [],
          first_task: plan.firstTask,
        },
      ],
      // The right hand's weekly check comes with a team's first agent, as with a template's team.
      weekly_check: !personal && team.length === 0,
    },
    locale,
  );
  const made = await createTeamNow(deps, userId, orgId, at, {
    ...params,
    agents: params.agents.map((a) => (later.length > 0 ? { ...a, later } : a)),
  });
  const created = made.card.state === "created" ? made.card.created?.agentIds[0] : undefined;
  if (!created) throw pickFailure(made.card.error);
  return created;
}

/** An option the person's AI proposed, as the plan of its agent. */
const optionPlan = (option: FirstAgentOption): FirstAgentPlan => ({
  name: option.name,
  handle: option.handle,
  role: option.role,
  line: option.tasks[0] ?? option.role,
  lead: option.why,
  instructions: option.instructions || option.tasks.map((t) => `- ${t}`).join("\n"),
  appearance: option.appearance,
  routine: option.routine,
  firstTask: option.today[0] ?? "",
  apps: option.apps.flatMap((a) => catalogIdOf(a) ?? []),
});

/** Only who may create agents makes a first one (`create_agents_required` without it). */
async function requireAgentMaker(db: Database, userId: string, orgId: string) {
  const membership = await requireActiveMembership(db, userId, orgId);
  if (!can(membership, "create_agents"))
    throw new ForbiddenError("Creating agents in this workspace needs an admin", "create_agents_required");
  return membership;
}

/**
 * "Criar o <agente>": the option picked becomes one agent, as the person (`create_agents`; without it,
 * `create_agents_required`), through the team card a template makes, in their DM with the right hand: its routine,
 * its instructions, the apps the workspace has (an admin's agent) and a checklist row for each app to connect, the AI
 * suggested for them, its own channel in a team's workspace (a personal one's agent lives in its DM). Picking again
 * answers with the same agent. With no context yet, the workspace's becomes what the AI said of it, from someone who
 * may configure it.
 */
export async function pickFirstAgent(
  deps: FirstAgentsPickDeps,
  who: { orgId: string; userId: string },
  id: string,
  index: number,
  /** The person's first agent made a moment ago on the onboarding, whose place this one takes (archived). */
  replace?: string | null,
): Promise<{ agentId: string; handle: string; channelId: string }> {
  const { db } = deps;
  const { orgId, userId } = who;
  const membership = await requireAgentMaker(db, userId, orgId);
  const mine = and(
    eq(firstAgentProposals.id, id),
    eq(firstAgentProposals.orgId, orgId),
    eq(firstAgentProposals.userId, userId),
  );
  const [row] = await db.select().from(firstAgentProposals).where(mine);
  if (!row) throw new NotFoundError("Proposal not found", "first_agents.not_found");
  if (row.agentId) return homeOf(db, orgId, userId, row.agentId);
  const option = viewOf(row).options[index];
  if (!option)
    throw new ValidationError(`Pick an option from 0 to ${row.options.length - 1}.`, "first_agents.no_option");
  // Held while it is made: two clicks make one agent.
  const [claimed] = await db
    .update(firstAgentProposals)
    .set({ picked: index, pickedAt: new Date() })
    .where(
      and(
        mine,
        isNull(firstAgentProposals.agentId),
        or(
          isNull(firstAgentProposals.pickedAt),
          lt(firstAgentProposals.pickedAt, new Date(Date.now() - PICK_STALE_MS)),
        ),
      ),
    )
    .returning({ id: firstAgentProposals.id });
  if (!claimed) {
    const [now] = await db.select({ agentId: firstAgentProposals.agentId }).from(firstAgentProposals).where(mine);
    if (now?.agentId) return homeOf(db, orgId, userId, now.agentId);
    throw new ConflictError("This agent is being created", "first_agents.picking");
  }
  const release = () =>
    db
      .update(firstAgentProposals)
      .set({ picked: null, pickedAt: null })
      .where(and(mine, isNull(firstAgentProposals.agentId)));
  // Asked of the person's AI again, or after an area's agent: one first agent, never several side by side.
  if (replace) await replaceFirstAgent(deps, orgId, userId, replace);
  const agentId = await makeFirstAgent(deps, orgId, userId, optionPlan(option)).catch(async (error: unknown) => {
    await release();
    throw error;
  });
  await db.update(firstAgentProposals).set({ agentId }).where(mine);
  // Its first delivery, armed when the person leaves the agent's step and fired once it can work: its routine, else
  // what the AI said it delivers on its first day.
  await keepFirstDelivery(db, { orgId, userId, agentId, area: "ask", task: option.today[0] ?? option.tasks[0] ?? "" });
  // What the AI said of the workspace (or of the person, in a personal one) is its context while it has none.
  if (row.about && can(membership, "configure")) {
    const [org] = await db
      .select({ context: organizations.context })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (org && !org.context.trim()) await updateOrganization(db, userId, orgId, { context: row.about });
  }
  // A member's greeting from the right hand went out as they joined and asks for a first agent: it stops asking.
  if (membership.role !== "owner") await settleWelcome(db, orgId, userId).catch(() => undefined);
  return homeOf(db, orgId, userId, agentId);
}

// ── From an area of the onboarding ───────────────────────────────────────────

/** The area and the task as the first delivery keeps them (`FIRST_DELIVERY_AREA_MAX`, `FIRST_DELIVERY_TASK_MAX`). */
export const FIRST_AGENT_START_LIMITS = {
  area: 40,
  name: 60,
  role: 80,
  instructions: 4000,
  task: 500,
  apps: 8,
} as const;

/** What the onboarding sends for an agent of one of its areas (or of "Outro", the person's own). */
export const firstAgentStartInput = z.object({
  area: line(FIRST_AGENT_START_LIMITS.area),
  name: line(FIRST_AGENT_START_LIMITS.name),
  role: z.string().trim().max(FIRST_AGENT_START_LIMITS.role).default(""),
  instructions: z.string().trim().max(FIRST_AGENT_START_LIMITS.instructions).default(""),
  appearance: z
    .object({ color: z.string().max(32), eyes: z.string().max(32), accessory: z.string().max(32) })
    .nullish(),
  task: z.string().trim().max(FIRST_AGENT_START_LIMITS.task).default(""),
  /** Catalog ids of the apps its job needs ("Apps to connect" on its checklist). */
  apps: z.array(z.string().trim().min(1).max(64)).max(FIRST_AGENT_START_LIMITS.apps).default([]),
  /** The agent this one takes the place of: the person's own first agent whose delivery hasn't fired. */
  replace: z.uuid().nullish(),
});
export type FirstAgentStartInput = z.input<typeof firstAgentStartInput>;

/**
 * The person's first agent from an area of the onboarding (ADR 0260 addendum), as the person (`create_agents`;
 * without it, `create_agents_required`), made the way a picked option is (`makeFirstAgent`) but with no routine:
 * connecting an app brings its routine (ADR 0242), which the onboarding makes. Its first delivery is kept (`area`,
 * `task`), disarmed until the person leaves the agent's step (`armFirstDelivery`), then fires once the agent can work.
 * `replace`: going back and picking another area archives the agent made a
 * moment ago, when it is this person's own and its delivery hasn't fired, so two first agents never wait side by side.
 */
export async function startFirstAgent(
  deps: FirstAgentsPickDeps,
  who: { orgId: string; userId: string },
  raw: unknown,
): Promise<{ agentId: string; handle: string; channelId: string }> {
  const { db } = deps;
  const { orgId, userId } = who;
  const parsed = firstAgentStartInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issueText(parsed.error), "first_agents.invalid");
  const input = parsed.data;
  const membership = await requireAgentMaker(db, userId, orgId);
  if (input.replace) await replaceFirstAgent(deps, orgId, userId, input.replace);
  const [taken, looks] = await Promise.all([
    takenHandles(db, orgId),
    db
      .select({ appearance: agents.appearance })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt))),
  ]);
  let handle = handleFromName(input.name, input.role, input.instructions);
  if (!HANDLE_PATTERN.test(handle)) handle = "agent";
  if (taken.has(handle)) handle = freeHandle(handle, taken);
  const worn = new Set(looks.flatMap((a) => (a.appearance?.color ? [a.appearance.color] : [])));
  const appearance = input.appearance
    ? validateAppearance(input.appearance)
    : (looksFor([input.name], worn)[0] as AgentAppearance);
  const role = input.role || input.name;
  const agentId = await makeFirstAgent(deps, orgId, userId, {
    name: input.name,
    handle,
    role: input.role,
    line: role,
    lead: role,
    instructions: input.instructions || [input.role, input.task].filter(Boolean).join(": "),
    appearance,
    routine: null,
    firstTask: input.task,
    apps: input.apps,
  });
  await keepFirstDelivery(db, { orgId, userId, agentId, area: input.area, task: input.task });
  // A member's greeting from the right hand went out as they joined and asks for a first agent: it stops asking.
  if (membership.role !== "owner") await settleWelcome(db, orgId, userId).catch(() => undefined);
  return homeOf(db, orgId, userId, agentId);
}

/** Archives the first agent `agentId` takes the place of, only while it is this person's and its delivery waits. */
async function replaceFirstAgent(deps: FirstAgentsPickDeps, orgId: string, userId: string, agentId: string) {
  const pending = await pendingFirstDelivery(deps.db, orgId, userId);
  // An agent brought from another app (no area) is never archived from here.
  if (!pending || pending.agentId !== agentId || pending.area === null) return;
  const [agent] = await deps.db
    .select({ owner: agents.ownerUserId, archivedAt: agents.archivedAt })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
  if (!agent || agent.archivedAt || agent.owner !== userId) return;
  // The person made it on this onboarding a moment ago, as with the right hand's Undo of what it made for them.
  await archiveAgent(deps.db, userId, orgId, agentId, deps.pubsub, true);
}
