import { isAccountKind } from "@agenteschat/adapters";
import { and, type Database, eq, inArray, isNull, lt, schema } from "@agenteschat/db";
import { isPlanId, planOf } from "@agenteschat/providers/plans";
import {
  limitWindows,
  PLAN_ALMOST,
  PLAN_CRITICAL,
  type PlanMeterUsage,
  windowLengthMs,
} from "@agenteschat/ui/plan-state";
import { BRAIN_PLAN_NAMES, isComputerBrain } from "./brains/types";
import { sha256 } from "./crypto";
import { isDefaultAccountLabel } from "./machine-accounts";
import {
  announceNotifications,
  type NotificationDeps,
  type WrittenNotification,
  writeNotifications,
} from "./notifications";
import { enqueuePush } from "./push";

const { agents, machineAccounts, machines, planLimitAlerts, rightHandBrains } = schema;

/**
 * A plan near its limit reaches the people it matters to (ADR 0063 addendum 2026-11-18): when a reading shows a window
 * at `PLAN_CRITICAL` or past it, once per limit period of each account's window, whichever computer reported it and
 * however often. `plan_limit_alerts` holds what was told, for good: a new period marks its row (`rearmed_at`) or takes it
 * over. The claim, the inbox rows and their push jobs commit together, so a crash or a failure tells nobody and the next
 * reading tries again.
 */

/** A reset this close to the one told of is the same reset, read again (some providers count it from the reading). */
const SAME_RESET_MS = 600_000;

export interface PlanAlertDeps extends NotificationDeps {
  /** A failed alert is logged here: it never reaches what stores usage or runs a turn. */
  log?: { warn(message: string, data?: Record<string, unknown>): void };
}

/** The windows of this reading at the alert's line, neither reset nor past their length. */
export const windowsNearLimit = (usage: Pick<PlanMeterUsage, "windows" | "at">, now = Date.now()) =>
  limitWindows(usage, now).filter((w) => w.used >= PLAN_CRITICAL);

type AccountRow = Pick<
  typeof machineAccounts.$inferSelect,
  "id" | "machineId" | "kind" | "label" | "email" | "provider" | "keyHint" | "providerOrgId" | "createdBy" | "usage"
>;

/**
 * What makes logins one account for the provider, so its limits are told once: its email (with Claude's organization),
 * or its owner's key by its last 4. Hashed: the table holds no address.
 */
function accountKeyOf(orgId: string, a: AccountRow): string {
  const who = a.provider
    ? a.keyHint && `key:${a.provider}:${a.createdBy ?? ""}:${a.keyHint}`
    : a.email && `email:${a.kind}:${a.email.toLowerCase()}:${a.providerOrgId ?? ""}`;
  return sha256(`${orgId}:${who || `id:${a.id}`}`).slice(0, 32);
}

/** The account as its own connector reads it in the apps (`accountName`): their name for it, else its email. */
function ownName(a: AccountRow): string {
  if (a.kind === "opencode" || isPlanId(a.provider) || !isAccountKind(a.kind)) return a.label;
  return isDefaultAccountLabel(a.kind, a.label, a.provider) ? (a.email ?? a.label) : a.label;
}

/**
 * The account's name on a lock screen and through the push services: the one its owner gave it, else its maker or plan.
 * Never an address.
 */
function pushNameOf(a: AccountRow): string {
  const maker = planOf(a.provider)?.label ?? (isAccountKind(a.kind) ? BRAIN_PLAN_NAMES[a.kind] : a.label);
  const named = isAccountKind(a.kind) && !isDefaultAccountLabel(a.kind, a.label, a.provider);
  return named && !a.label.includes("@") ? a.label : maker;
}

interface Alert {
  orgId: string;
  accountKey: string;
  /** Who hears it, each with the account's name as they read it in the inbox. */
  people: Map<string, string>;
  /** Its name in the push, for all of them. */
  pushName: string;
  accountId?: string;
  machineId: string;
  usage: PlanMeterUsage;
}

/** When a reading was taken, never ahead of now: it orders readings, so a late report of an older one counts for nothing. */
const readingTime = (usage: Pick<PlanMeterUsage, "at">, nowMs: number) =>
  Math.min(Date.parse(usage.at) || nowMs, nowMs);

/**
 * What a reading at the line does to a window already told of (times in ms; null: no reset said). One alert per limit
 * period. Marked as in a new period (`showsNewPeriod`), a reading after that mark tells, unless it still has the old
 * reset: a computer's old number.
 *
 * The reading's own reset decides. A reset brought earlier is a new period: nothing slides backwards. One that moved
 * later while the last is still ahead is the same period (a rolling window's reset runs ahead of every reading), so the
 * row follows it (`follow`): that way the kept reset of a window that keeps moving never comes to pass, and a kept reset
 * this reading has passed means a period really ended. With no reset either side, the window's length is the period.
 */
export function afterToldWindow(
  told: { readAt: number; resetsAt: number | null; rearmedAt?: number | null },
  reading: { readAt: number; resetsAt: number | null; lengthMs: number },
): "alert" | "follow" | "keep" {
  if (reading.readAt <= told.readAt) return "keep";
  if (told.rearmedAt != null) {
    if (reading.readAt <= told.rearmedAt) return "keep";
    const oldReset =
      reading.resetsAt !== null && told.resetsAt !== null && reading.resetsAt - told.resetsAt <= SAME_RESET_MS;
    return oldReset ? "keep" : "alert";
  }
  if (reading.resetsAt === null) {
    if (told.resetsAt !== null) return told.resetsAt <= reading.readAt ? "alert" : "keep";
    return reading.readAt >= told.readAt + reading.lengthMs ? "alert" : "keep";
  }
  if (told.resetsAt === null) return "alert";
  const moved = reading.resetsAt - told.resetsAt;
  if (Math.abs(moved) <= SAME_RESET_MS) return "keep";
  if (moved < 0) return "alert";
  return told.resetsAt <= reading.readAt ? "alert" : "follow";
}

/** Claims each window near its limit and tells `people` of those whose crossing nobody was told of. */
async function alertAccount(deps: PlanAlertDeps, a: Alert, now: Date) {
  const nowMs = now.getTime();
  const readMs = readingTime(a.usage, nowMs);
  const readAt = new Date(readMs);
  const named = new Map<string, string[]>();
  for (const [userId, name] of a.people) named.set(name, [...(named.get(name) ?? []), userId]);
  for (const w of windowsNearLimit(a.usage, nowMs)) {
    const windowKey = `${w.kind}:${w.label ?? ""}`;
    const resetsAt = w.resetsAt ? new Date(w.resetsAt) : null;
    const t = planLimitAlerts;
    const row = and(eq(t.orgId, a.orgId), eq(t.accountKey, a.accountKey), eq(t.windowKey, windowKey));
    const written = await deps.db.transaction(async (tx) => {
      // The insert or the row's lock, so two computers reporting one account at once tell it once.
      const [fresh] = await tx
        .insert(t)
        .values({ orgId: a.orgId, accountKey: a.accountKey, windowKey, resetsAt, alertedAt: readAt })
        .onConflictDoNothing()
        .returning({ orgId: t.orgId });
      if (!fresh) {
        const [told] = await tx.select().from(t).where(row).for("update");
        if (!told) return [];
        const step = afterToldWindow(
          {
            readAt: told.alertedAt.getTime(),
            resetsAt: told.resetsAt?.getTime() ?? null,
            rearmedAt: told.rearmedAt?.getTime() ?? null,
          },
          { readAt: readMs, resetsAt: resetsAt?.getTime() ?? null, lengthMs: windowLengthMs(w) },
        );
        if (step === "keep") return [];
        await tx.update(t).set({ resetsAt, alertedAt: readAt, rearmedAt: null }).where(row);
        if (step === "follow") return [];
      }
      const out: WrittenNotification[] = [];
      for (const [label, userIds] of named)
        out.push(
          ...(await writeNotifications(
            { db: tx, ...(deps.now ? { now: deps.now } : {}) },
            {
              orgId: a.orgId,
              userIds,
              kind: "plan_limit_near",
              // The reading that crossed: each period's alert is its own row.
              groupKey: `plan_limit_near:${a.accountKey}:${windowKey}:${readMs}`,
              source: { machineId: a.machineId, ...(a.accountId ? { accountId: a.accountId } : {}), label },
              latest: {
                title: a.pushName,
                percent: Math.round(w.used),
                window: { kind: w.kind, ...(w.label ? { label: w.label } : {}) },
                ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}),
              },
            },
          )),
        );
      for (const { row: written, prefs } of out) if (written.count === 1) await enqueuePush(tx, written, now, prefs);
      return out;
    });
    // Committed: telling open screens may fail without undoing it.
    await announceNotifications(deps, written, { push: false }).catch((error) =>
      deps.log?.warn("plan limit alert not announced", { orgId: a.orgId, error: String(error) }),
    );
  }
}

type ToldWindow = Pick<
  typeof planLimitAlerts.$inferSelect,
  "accountKey" | "windowKey" | "alertedAt" | "resetsAt" | "rearmedAt"
>;

/**
 * Whether a reading shows that a told window's limit period is over and there is room again: newer than what was told,
 * clearly under the line (`PLAN_ALMOST`, so a number going round 90% is one crossing) and with a reset of its own later
 * than the kept one. A computer's old number never passes: the runner keeps a window it didn't hear about under the
 * reading's new time, but with its old reset.
 */
export const showsNewPeriod = (
  told: { readAt: number; resetsAt: number | null },
  reading: { readAt: number; resetsAt: number | null; used: number },
) =>
  reading.used < PLAN_ALMOST &&
  reading.readAt > told.readAt &&
  told.resetsAt !== null &&
  reading.resetsAt !== null &&
  reading.resetsAt - told.resetsAt > SAME_RESET_MS;

/** Marks the windows this reading shows in a new period. The row stays: what it holds keeps ordering later reports. */
async function rearmWindows(
  deps: PlanAlertDeps,
  orgId: string,
  accountKey: string,
  usage: PlanMeterUsage,
  told: readonly ToldWindow[],
  nowMs: number,
) {
  const readMs = readingTime(usage, nowMs);
  const mine = told.filter((r) => r.accountKey === accountKey && !r.rearmedAt);
  if (mine.length === 0) return;
  for (const w of limitWindows(usage, nowMs)) {
    const windowKey = `${w.kind}:${w.label ?? ""}`;
    const row = mine.find((r) => r.windowKey === windowKey);
    if (!row) continue;
    const reading = { readAt: readMs, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : null, used: w.used };
    if (!showsNewPeriod({ readAt: row.alertedAt.getTime(), resetsAt: row.resetsAt?.getTime() ?? null }, reading))
      continue;
    await deps.db
      .update(planLimitAlerts)
      .set({ rearmedAt: new Date(readMs) })
      .where(
        and(
          eq(planLimitAlerts.orgId, orgId),
          eq(planLimitAlerts.accountKey, accountKey),
          eq(planLimitAlerts.windowKey, windowKey),
          isNull(planLimitAlerts.rearmedAt),
          lt(planLimitAlerts.alertedAt, new Date(readMs)),
        ),
      );
  }
}

/** Who hears an account near its limit, each with the name they know it by. */
async function peopleOf(
  db: Database,
  orgId: string,
  row: AccountRow,
  logins: AccountRow[],
  pairers: Map<string, string | null>,
) {
  const ids = logins.map((r) => r.id);
  const [thinking, ownAi] = await Promise.all([
    db
      .select({ userId: agents.ownerUserId })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), inArray(agents.brainAccountId, ids), isNull(agents.archivedAt))),
    db
      .select({ userId: rightHandBrains.userId })
      .from(rightHandBrains)
      .where(and(eq(rightHandBrains.orgId, orgId), inArray(rightHandBrains.brainAccountId, ids))),
  ]);
  const people = new Map<string, string>();
  for (const r of [...thinking, ...ownAi]) if (r.userId) people.set(r.userId, row.label);
  for (const l of logins) {
    // Nobody's login goes to who connected its own computer, who reads it by its name.
    const pairer = l.createdBy ? null : pairers.get(l.machineId);
    if (pairer && !people.has(pairer)) people.set(pairer, row.label);
  }
  for (const l of logins) if (l.createdBy) people.set(l.createdBy, ownName(l));
  return people;
}

/**
 * After a computer reported usage: its accounts and its own sign-ins near a limit are told. Who hears an account:
 * whoever connected it (on any computer it is signed in on), the people whose agents think with it and those who chose
 * it for their own right hand. It may serve the whole workspace, but the others have no stake in it until they use it.
 * An account of nobody goes to its computer's pairer. A computer's own sign-in thinks for its pairer's agents: its
 * pairer, unless it is signed out. Never throws: each account stands alone and a failure is logged.
 */
export async function alertPlanLimits(deps: PlanAlertDeps, orgId: string, machineId: string) {
  const failed = (error: unknown) =>
    deps.log?.warn("plan limit alert failed", { orgId, machineId, error: String(error) });
  try {
    const now = deps.now?.() ?? new Date();
    const computers = await deps.db
      .select({
        id: machines.id,
        name: machines.name,
        pairer: machines.pairedByUserId,
        executors: machines.executors,
      })
      .from(machines)
      .where(and(eq(machines.orgId, orgId), isNull(machines.deletedAt)));
    const machine = computers.find((m) => m.id === machineId);
    if (!machine) return;
    const pairers = new Map(computers.map((m) => [m.id, m.pairer]));
    const told: ToldWindow[] = await deps.db
      .select({
        accountKey: planLimitAlerts.accountKey,
        windowKey: planLimitAlerts.windowKey,
        alertedAt: planLimitAlerts.alertedAt,
        resetsAt: planLimitAlerts.resetsAt,
        rearmedAt: planLimitAlerts.rearmedAt,
      })
      .from(planLimitAlerts)
      .where(eq(planLimitAlerts.orgId, orgId));
    const rows: AccountRow[] = await deps.db
      .select({
        id: machineAccounts.id,
        machineId: machineAccounts.machineId,
        kind: machineAccounts.kind,
        label: machineAccounts.label,
        email: machineAccounts.email,
        provider: machineAccounts.provider,
        keyHint: machineAccounts.keyHint,
        providerOrgId: machineAccounts.providerOrgId,
        createdBy: machineAccounts.createdBy,
        usage: machineAccounts.usage,
      })
      .from(machineAccounts)
      .where(and(eq(machineAccounts.orgId, orgId), eq(machineAccounts.status, "active")));
    for (const row of rows) {
      if (row.machineId !== machineId || !row.usage) continue;
      try {
        const accountKey = accountKeyOf(orgId, row);
        await rearmWindows(deps, orgId, accountKey, row.usage, told, now.getTime());
        if (windowsNearLimit(row.usage, now.getTime()).length === 0) continue;
        const logins = rows.filter((r) => accountKeyOf(orgId, r) === accountKey);
        const people = await peopleOf(deps.db, orgId, row, logins, pairers);
        const pushName = pushNameOf(row);
        await alertAccount(
          deps,
          { orgId, accountKey, people, pushName, accountId: row.id, machineId, usage: row.usage },
          now,
        );
      } catch (error) {
        failed(error);
      }
    }
    for (const [kind, usage] of Object.entries(machine.executors?.ownUsage ?? {})) {
      if (!usage || !isComputerBrain(kind) || !machine.pairer) continue;
      // As the usage views read it (`plan-usage.ts`): only Claude's CLI says it is signed out.
      if (kind === "claude_code" && machine.executors?.claude?.loggedIn === false) continue;
      try {
        const accountKey = sha256(`${orgId}:own:${machineId}:${kind}`).slice(0, 32);
        await rearmWindows(deps, orgId, accountKey, usage, told, now.getTime());
        const name = `${BRAIN_PLAN_NAMES[kind]} · ${machine.name}`;
        await alertAccount(
          deps,
          {
            orgId,
            accountKey,
            people: new Map([[machine.pairer, name]]),
            pushName: name,
            machineId,
            usage,
          },
          now,
        );
      } catch (error) {
        failed(error);
      }
    }
  } catch (error) {
    failed(error);
  }
}

/**
 * What a computer's report asks of the alerts. Near a limit, they run. Below it, only a window told of can change, so
 * with nothing told of in the workspace (nearly always) this is one indexed read.
 */
export async function checkPlanLimits(
  deps: PlanAlertDeps,
  orgId: string,
  machineId: string,
  reported: readonly (Pick<PlanMeterUsage, "windows" | "at"> | null | undefined)[],
) {
  try {
    const now = (deps.now?.() ?? new Date()).getTime();
    const readings = reported.filter((u) => u != null);
    if (readings.length === 0) return;
    if (!readings.some((u) => windowsNearLimit(u, now).length > 0)) {
      const [told] = await deps.db
        .select({ orgId: planLimitAlerts.orgId })
        .from(planLimitAlerts)
        .where(eq(planLimitAlerts.orgId, orgId))
        .limit(1);
      if (!told) return;
    }
    await alertPlanLimits(deps, orgId, machineId);
  } catch (error) {
    deps.log?.warn("plan limit alert failed", { orgId, machineId, error: String(error) });
  }
}
