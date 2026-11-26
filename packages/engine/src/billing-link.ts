import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { and, asc, type Database, eq, isNull, rowsOf, type SQL, schema, sql } from "@agenteschat/db";
import { appLocale } from "@agenteschat/i18n/locale";
import { normalizeAppearance } from "@agenteschat/tokens/look";
import { zonedParts, zonedTimeForward } from "./cron";
import { cutText } from "./format";
import { isValidTimeZone } from "./management";
import { MEDIA_AFTER_KEY } from "./media";
import { operatorOrg } from "./operator";
import { requirePermission, type UserLocale } from "./organizations";
import { SYSTEM_LINE_META } from "./router";

const { organizations, organizationSettings, agents, channels, messages, artifacts, wikiPages, issues, routines } =
  schema;

/** Where in the app a billing link was opened from: the billing service opens on what it came for (ADR 0079). */
export const BILLING_FROM = [
  "settings",
  "hold",
  "onboarding",
  "new_workspace",
  "invite_full",
  "upload_full",
  "storage",
] as const;
export type BillingFrom = (typeof BILLING_FROM)[number];

export interface BillingLinkClaims {
  aud: "agentes-billing";
  /** Single use on the billing service's side. */
  jti: string;
  /** Seconds. */
  iat: number;
  exp: number;
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin";
  locale: UserLocale;
  from: BillingFrom;
  /** The plan the person picked in the app (the billing service's own key, `PLAN_CLAIM`), to open its Checkout. */
  plan?: string;
  /** The path on this server the billing service sends the person back to. */
  return: string;
  /**
   * What the workspace holds (`totalsOf`), counts but for `team`. `storageBytes` null: the workspace keeps its files on
   * its own bucket.
   */
  usage: {
    members: number;
    agents: number;
    storageBytes: number | null;
    messages: number;
    channels: number;
    files: number;
    wikiPages: number;
    issues: number;
    /** When the workspace was created, in seconds. */
    since: number;
    /** Its first `TEAM_SHOWN` agents, oldest first, its right hand left out (`teamOf`). */
    team: BillingTeamAgent[];
    /** Its routines that are on (`ROUTINES_ON`). */
    routines: number;
    /** This calendar month so far, in the workspace's time zone (`monthOf`). */
    month: BillingMonth;
  };
}

/** One of the agents the billing service's pages name and draw (ADR 0079, amendment of 2026-11-26). */
export interface BillingTeamAgent {
  /** At most `TEAM_TEXT_MAX` characters, like `role`. */
  name: string;
  /** Null: it has none. */
  role: string | null;
  /** Its look as the agent engine names it (`AGENT_COLORS`, `AGENT_EYES`, `AGENT_ACCESSORIES`); null: no accessory. */
  look: { color: string; eyes: string; accessory: string | null };
}

/** The workspace's month so far (ADR 0079, amendment of 2026-11-26): counts only, the same ones `usage` keeps. */
export interface BillingMonth {
  /** Its 1st at 00:00 in the workspace's time zone, in seconds. */
  start: number;
  /** Messages per day, from the 1st to today: one item per day, today last. */
  days: number[];
  messages: number;
  /** The messages agents wrote themselves: a line the server wrote for them (`SERVER_LINE_META`) left out. */
  agentActions: number;
  /** Drive files added, wiki pages and tasks created this month, as `usage` counts them. */
  files: number;
  wikiPages: number;
  issues: number;
}

/** How many agents a link names: the billing service's pages draw no more. */
export const TEAM_SHOWN = 5;

/** The most characters of an agent's name or role a link carries: the billing service takes no more. */
export const TEAM_TEXT_MAX = 80;

/** A plan's key as the billing service names it: this server passes it on and never reads it. */
export const PLAN_CLAIM = /^[a-z][a-z0-9_]{0,31}$/;

/** How long a link opens the billing service: minted on click, it only has to reach the next page. */
export const BILLING_LINK_SECONDS = 300;

/** The key a link's claims are sealed with: HKDF-SHA256 of the secret this server shares with the outside service. */
export const linkKey = (secret: string) =>
  Buffer.from(hkdfSync("sha256", secret, "agentes.chat", "agentes.chat/link-token/v2", 32));

/**
 * `v2.<nonce>.<ciphertext>.<tag>`, base64url: the claims' JSON sealed with AES-256-GCM under `linkKey` (a fresh 12-byte
 * nonce per link, the associated data `v2`), the token of every link to an outside service (the billing service, the
 * referral service). Sealed, not only signed: a link's address ends up in history, synced devices and screenshots, and
 * shows nothing of who it is for. `nonce` is only for test vectors.
 */
export function sealLinkToken<T extends object>(secret: string, claims: T, nonce = randomBytes(12)): string {
  const cipher = createCipheriv("aes-256-gcm", linkKey(secret), nonce);
  cipher.setAAD(Buffer.from("v2"));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims)), cipher.final()]);
  return ["v2", ...[nonce, body, cipher.getAuthTag()].map((part) => part.toString("base64url"))].join(".");
}

/** A link's claims as the outside service reads them (`sealLinkToken`'s inverse); throws on any other token. */
export function openLinkToken(secret: string, token: string): unknown {
  const [version, nonce = "", body = "", tag = "", ...rest] = token.split(".");
  if (version !== "v2" || rest.length > 0) throw new Error("not a v2 link token");
  const decipher = createDecipheriv("aes-256-gcm", linkKey(secret), Buffer.from(nonce, "base64url"), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from("v2"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString());
}

/**
 * The only `return` an outside service accepts: `/org/<uuid>` plus lowercase path segments, no search, no hash (the
 * billing service adds `?paid=1` itself). Null for any other shape.
 */
export function linkReturnPath(returnTo: string | undefined): string | null {
  const path = returnTo?.split(/[?#]/)[0];
  return path && /^\/org\/[0-9a-f-]{36}(\/[a-z0-9/-]*)?$/.test(path) ? path : null;
}

/** `<base>/link?t=<token>`, keeping any path in the base, with no doubled slash. */
export function linkUrl(baseUrl: string, token: string) {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end--;
  return `${baseUrl.slice(0, end)}/link?t=${token}`;
}

/** Where under the workspace each entry point sends people back (the onboarding's opens it again at its AI step). */
const RETURN_TO: Partial<Record<BillingFrom, string>> = {
  settings: "/settings/billing",
  storage: "/settings/storage",
  invite_full: "/members",
  onboarding: "/onboarding",
};

/**
 * The page the person opened the link from (`returnTo`), when it is one of this workspace's: they land back there,
 * not on the entry point's default. Never another workspace or host. The billing service refuses the whole link
 * over any other `return` (`linkReturnPath`), so the page's search and hash are dropped and any other shape falls
 * back to the default.
 */
const placeIn = (orgId: string, returnTo: string | undefined) => {
  const path = linkReturnPath(returnTo);
  return path?.startsWith(`/org/${orgId}/`) ? path : null;
};

/** A conversation a person can read, as `c`: an agent-only room has no `u:` in its key, as `isAgentOnlyDm` reads it. */
const READABLE = sql`(c.kind <> 'dm' or c.dm_key like '%u:%')`;

/**
 * A workspace's messages, those of every conversation a person can read (`READABLE`), counted per conversation on each
 * month's `(channel_id, created_at)` index without reading a row: no index of `messages` starts with `org_id` (ADR 0009).
 */
export const orgMessageCount = (orgId: string) =>
  sql<number>`(select coalesce(sum(per.n), 0) from ${channels} c,
      lateral (select count(*) as n from ${messages} m where m.channel_id = c.id) per
    where c.org_id = ${orgId} and ${READABLE})`.mapWith(Number);

/** A stretch of time, `[from, to)`. */
interface Range {
  from: Date;
  to: Date;
}

const within = (column: unknown, range: Range | undefined): SQL =>
  range
    ? sql` and ${column} >= ${range.from.toISOString()}::timestamptz and ${column} < ${range.to.toISOString()}::timestamptz`
    : sql``;

/**
 * Drive's files (the trash left out), wiki pages (deleted ones left out) and tasks (canceled ones left out), each on an
 * index that starts with `org_id`; with `range`, only those created in it.
 */
const keptOf = (orgId: string, range?: Range) => ({
  files: sql<number>`(select count(*) from ${artifacts} where ${artifacts.orgId} = ${orgId}
    and ${artifacts.deletedAt} is null${within(artifacts.createdAt, range)})`.mapWith(Number),
  wikiPages: sql<number>`(select count(*) from ${wikiPages} where ${wikiPages.orgId} = ${orgId}
    and ${wikiPages.deletedAt} is null${within(wikiPages.createdAt, range)})`.mapWith(Number),
  issues: sql<number>`(select count(*) from ${issues} where ${issues.orgId} = ${orgId}
    and ${issues.status} <> 'canceled'${within(issues.createdAt, range)})`.mapWith(Number),
});

/**
 * The routines that are on, as an agent's cap counts them (`checkRoutineCap`): repeating ones that start runs, neither a
 * one-off, a reminder nor a widget's. An archived agent's are paused, so none of them counts.
 */
const ROUTINES_ON = sql`${routines.active} and ${routines.deletedAt} is null and ${routines.triggerType} <> 'once'
  and coalesce(${routines.target}->>'reminder', 'false') <> 'true' and coalesce(${routines.target}->>'type', '') <> 'widget'`;

/**
 * What a workspace holds, for the billing service's pages (ADR 0079 §3): workspace-wide counts, never a word of content
 * or a figure per channel or person; and its time zone, for its month (`monthOf`).
 */
const totalsOf = (orgId: string) => ({
  messages: orgMessageCount(orgId),
  channels: sql<number>`(select count(*) from ${channels} where ${channels.orgId} = ${orgId}
    and ${channels.kind} = 'channel' and ${channels.archivedAt} is null)`.mapWith(Number),
  ...keptOf(orgId),
  routines: sql<number>`(select count(*) from ${routines} where ${routines.orgId} = ${orgId}
    and ${ROUTINES_ON})`.mapWith(Number),
  zone: sql<string | null>`(select ${organizationSettings.timezone} from ${organizationSettings}
    where ${organizationSettings.orgId} = ${orgId})`,
});

/** The app's default look, for an agent that never picked one (`appearance` null). */
const DEFAULT_LOOK = { color: "sky", eyes: "round" } as const;

/**
 * The workspace's first `TEAM_SHOWN` agents, oldest first, as the billing service's price page names and draws them
 * ("Caio is ready…"): the team's own, not its right hand (ADR 0137), which every workspace has. A look the app no
 * longer draws reads as its default, as the app shows it (`normalizeAppearance`).
 */
async function teamOf(db: Database, orgId: string): Promise<BillingTeamAgent[]> {
  const rows = await db
    .select({ name: agents.name, role: agents.role, appearance: agents.appearance })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt), isNull(agents.builtin)))
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .limit(TEAM_SHOWN);
  return rows.map(({ name, role, appearance }) => {
    const look = normalizeAppearance(appearance);
    return {
      name: cutText(name.trim(), TEAM_TEXT_MAX),
      role: cutText(role.trim(), TEAM_TEXT_MAX) || null,
      look: {
        color: look.color ?? DEFAULT_LOOK.color,
        eyes: look.eyes ?? DEFAULT_LOOK.eyes,
        accessory: look.accessory && look.accessory !== "none" ? look.accessory : null,
      },
    };
  });
}

/**
 * Meta of an agent's message the server wrote, not the agent: the router's list (cards, notices, lines from a code, a
 * stopped run's line) and the lines the server posts as an agent with no model call that the router has no reason to
 * skip. `agentActions` leaves them all out, so a workspace where no agent worked shows none (ADR 0079, amendment of
 * 2026-11-26). `SYSTEM_LINE_META` itself stays as the router reads it.
 */
const SERVER_LINE_META = [
  ...SYSTEM_LINE_META,
  // The team's hello in #general once it can work (ADR 0162): one per agent in every team workspace's first paid month.
  "greeting",
  // A reminder's line at its time ("@ana Reminder: …"), with no run: a person sets one from a message too.
  "reminder",
  // The card a run waits on while a computer or phone is away: its words are the server's, as an approval card's.
  "deviceWait",
  // The hidden first message of a task's or a file's conversation, under the agent that made the task or the file.
  "taskConversation",
  "fileConversation",
  // The sticker or GIF the server adds after an agent's reply (ADR 0091 §4): the reply itself counts.
  MEDIA_AFTER_KEY,
] as const;

/** 00:00 of a day in `timeZone` (moved forward where a DST change skips it), its UTC midnight if none is left. */
const midnight = (year: number, month: number, day: number, timeZone: string) =>
  zonedTimeForward(year, month, day, 0, 0, timeZone) ?? new Date(Date.UTC(year, month - 1, day));

/**
 * This calendar month so far in the workspace's time zone (UTC when it has none, or one this runtime doesn't know):
 * messages per day and in all, those agents wrote themselves, and the Drive files, wiki pages and tasks created in it.
 * Messages are counted where `usage` counts them (`READABLE`), per conversation on each month's `(channel_id,
 * created_at)` index, the days told apart by their local midnights (`width_bucket`), in one statement; the rest in
 * another, on indexes that start with `org_id`.
 */
async function monthOf(db: Database, orgId: string, zone: string | null, now: Date): Promise<BillingMonth> {
  const timeZone = zone && isValidTimeZone(zone) ? zone : "UTC";
  const today = zonedParts(now, timeZone);
  const starts = Array.from({ length: today.day }, (_, i) => midnight(today.year, today.month, i + 1, timeZone));
  const from = starts[0] ?? now;
  const to =
    today.month === 12 ? midnight(today.year + 1, 1, 1, timeZone) : midnight(today.year, today.month + 1, 1, timeZone);
  const bounds = `{${starts.map((at) => at.toISOString()).join(",")}}`;
  const serverLines = `{${SERVER_LINE_META.join(",")}}`;
  const [perDay, [kept]] = await Promise.all([
    db.execute(sql`select per.day, sum(per.n) as n, sum(per.said) as said
      from ${channels} c,
        lateral (select width_bucket(m.created_at, ${bounds}::timestamptz[]) as day, count(*) as n,
            count(*) filter (where m.author_type = 'agent' and not (m.meta ?| ${serverLines}::text[])) as said
          from ${messages} m
          where m.channel_id = c.id and m.created_at >= ${from.toISOString()}::timestamptz
            and m.created_at < ${to.toISOString()}::timestamptz
          group by 1) per
      where c.org_id = ${orgId} and ${READABLE}
      group by per.day`),
    db.select(keptOf(orgId, { from, to })).from(organizations).where(eq(organizations.id, orgId)),
  ]);
  const days = starts.map(() => 0);
  let agentActions = 0;
  for (const row of rowsOf<{ day: number | string; n: number | string; said: number | string }>(perDay)) {
    const at = Number(row.day) - 1;
    if (at >= 0 && at < days.length) days[at] = Number(row.n);
    agentActions += Number(row.said);
  }
  return {
    start: Math.floor(from.getTime() / 1000),
    days,
    messages: days.reduce((sum, n) => sum + n, 0),
    agentActions,
    files: kept?.files ?? 0,
    wikiPages: kept?.wikiPages ?? 0,
    issues: kept?.issues ?? 0,
  };
}

/**
 * A sealed link to the workspace's plan and billing on the billing service, for its owners and admins. A
 * suspended workspace refuses it (`org.suspended`); a held one doesn't, since paying is how a billing hold ends, nor
 * one being deleted, whose payer still reaches its invoices and card.
 */
export async function mintBillingLink(
  db: Database,
  input: {
    secret: string;
    baseUrl: string;
    userId: string;
    orgId: string;
    from: BillingFrom;
    /** The page it was opened from, to come back to (`placeIn`). */
    returnTo?: string;
    /** The plan picked in the app (`PLAN_CLAIM`); anything else is left out. */
    plan?: string;
    now?: Date;
  },
): Promise<{ url: string; expiresAt: Date }> {
  const { userId, orgId, from } = input;
  const membership = await requirePermission(db, userId, orgId, "manage_billing");
  const now = input.now ?? new Date();
  const [org, [user], [totals], team] = await Promise.all([
    operatorOrg(db, orgId),
    db
      .select({ email: schema.users.email, name: schema.users.name, locale: schema.users.locale })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    db.select(totalsOf(orgId)).from(organizations).where(eq(organizations.id, orgId)),
    teamOf(db, orgId),
  ]);
  if (!org || !user || !totals) throw new Error("billing link: the workspace or the account is gone");
  const { zone, routines: routinesOn, ...counts } = totals;
  const month = await monthOf(db, orgId, zone, now);
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + BILLING_LINK_SECONDS;
  const token = sealLinkToken<BillingLinkClaims>(input.secret, {
    aud: "agentes-billing",
    jti: randomUUID(),
    iat,
    exp,
    orgId,
    orgName: org.name,
    userId,
    email: user.email,
    name: user.name,
    role: membership.role === "owner" ? "owner" : "admin",
    locale: appLocale([user.locale], true) ?? "en",
    from,
    ...(input.plan && PLAN_CLAIM.test(input.plan) ? { plan: input.plan } : {}),
    return: placeIn(orgId, input.returnTo) ?? `/org/${orgId}${RETURN_TO[from] ?? ""}`,
    usage: {
      members: org.counts.members,
      agents: org.counts.agents,
      storageBytes: org.meters.ownStorage ? null : org.meters.storageBytes,
      ...counts,
      since: Math.floor(org.createdAt.getTime() / 1000),
      team,
      routines: routinesOn,
      month,
    },
  });
  return { url: linkUrl(input.baseUrl, token), expiresAt: new Date(exp * 1000) };
}
