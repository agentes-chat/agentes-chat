import { planState } from "@agenteschat/ui/plan-state";
import type { TFunction } from "i18next";
import type { PlanAccountUsage, RecentPeriod, RecentUse } from "../api/types";
import { formatInt, formatTokensShort, formatUsd } from "./format";
import { brandOf } from "./plan-usage";
import { planOf } from "./plans";

/**
 * Cotas (ADR 0063 addendum 2026-11-17), shared by the web and the phone: every AI account the viewer sees, by maker,
 * each with its limits as the provider reports them, or its recent use where the provider reports none. Pure, no React.
 */

/** Where an account stands: at a limit, near one (`PLAN_ALMOST`), with room, or no limits known (`none`). */
export type QuotaStanding = "limited" | "almost" | "ok" | "none";

/** The makers in the order Cotas lists them; any other after them, by name. */
const MAKER_ORDER = ["claude_code", "codex", "antigravity", "opencode", "zai", "kimi", "minimax", "grok", "cursor"];

/** The mark an account's maker goes by (`ProviderLogo`): a coding plan's maker, else its CLI. */
export const makerOf = (a: Pick<PlanAccountUsage, "kind" | "provider">) => a.provider ?? a.kind;

export function quotaStanding(a: Pick<PlanAccountUsage, "usage">, now = Date.now()): QuotaStanding {
  const usage = a.usage;
  if (!usage || (usage.windows.length === 0 && usage.limited !== true)) return "none";
  return planState(usage, now).state;
}

/**
 * Whether the provider ever reports this account's limits here: not Cursor's, Grok Build's or the OpenCode CLI's
 * (their CLIs say nothing of a plan), not Antigravity's on the computer's own sign-in (read only per account), and not
 * a coding plan's whose maker has no usage endpoint (`plans.ts` `usage`).
 */
export function limitsReported(a: Pick<PlanAccountUsage, "kind" | "provider" | "accountId">): boolean {
  const plan = planOf(a.provider);
  if (plan) return Boolean(plan.usage);
  if (a.kind === "cursor" || a.kind === "grok" || a.kind === "opencode") return false;
  return !(a.kind === "antigravity" && a.accountId === null);
}

const RANK: Record<QuotaStanding, number> = { limited: 0, almost: 1, ok: 2, none: 3 };

export interface QuotaSection {
  /** The maker's mark (`makerOf`). */
  maker: string;
  name: string;
  accounts: PlanAccountUsage[];
}

/**
 * The accounts by maker, in `MAKER_ORDER`: within one, those at a limit first, then near one, then by their tightest
 * window, those with no limits known last. Each keeps its own row.
 */
export function quotaSections(accounts: readonly PlanAccountUsage[], now = Date.now()): QuotaSection[] {
  const sections = new Map<string, QuotaSection>();
  for (const a of accounts) {
    const maker = makerOf(a);
    const section = sections.get(maker) ?? { maker, name: brandOf(a), accounts: [] };
    section.accounts.push(a);
    sections.set(maker, section);
  }
  const used = (a: PlanAccountUsage) => (a.usage ? planState(a.usage, now).used : -1);
  const place = (m: string) => {
    const i = MAKER_ORDER.indexOf(m);
    return i === -1 ? MAKER_ORDER.length : i;
  };
  return [...sections.values()]
    .map((s) => ({
      ...s,
      accounts: [...s.accounts].sort(
        (a, b) => RANK[quotaStanding(a, now)] - RANK[quotaStanding(b, now)] || used(b) - used(a),
      ),
    }))
    .sort((a, b) => place(a.maker) - place(b.maker) || a.name.localeCompare(b.name));
}

/** The accounts with limits known, the closest to one first (at a limit, near one, then the most used): Início's few. */
export function tightestAccounts(accounts: readonly PlanAccountUsage[], count: number, now = Date.now()) {
  return accounts
    .filter((a) => quotaStanding(a, now) !== "none")
    .map((a) => ({ a, rank: RANK[quotaStanding(a, now)], used: a.usage ? planState(a.usage, now).used : 0 }))
    .sort((x, y) => x.rank - y.rank || y.used - x.used)
    .slice(0, count)
    .map((x) => x.a);
}

/** How many accounts are at a limit and near one, of how many with limits known. */
export function quotaSummary(accounts: readonly Pick<PlanAccountUsage, "usage">[], now = Date.now()) {
  const standings = accounts.map((a) => quotaStanding(a, now));
  return {
    limited: standings.filter((s) => s === "limited").length,
    almost: standings.filter((s) => s === "almost").length,
    known: standings.filter((s) => s !== "none").length,
    total: accounts.length,
  };
}

/** The line of the way into Cotas: "1 no limite · 2 quase no limite", "Todas com folga", or how many accounts. */
export function quotaSummaryText(t: TFunction, summary: ReturnType<typeof quotaSummary>) {
  const parts = [
    summary.limited > 0 ? t("quotas.summary.limited", { count: summary.limited }) : null,
    summary.almost > 0 ? t("quotas.summary.almost", { count: summary.almost }) : null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return summary.known > 0 ? t("quotas.summary.ok") : t("quotas.summary.accounts", { count: summary.total });
}

const PERIODS: readonly RecentPeriod[] = ["day", "week", "month"];

/**
 * An account's recent use, one line per rolling period ("Últimas 24 h", "1,2 mi tokens · 34 chamadas · ≈ US$ 3,10"),
 * money only where the server sent it. Empty for an older server, or no use in 30 days.
 */
export function recentLines(
  t: TFunction,
  locale: string,
  recent: Record<RecentPeriod, RecentUse> | undefined,
): { period: RecentPeriod; label: string; value: string }[] {
  if (!recent || recent.month.requests === 0) return [];
  return PERIODS.map((period) => {
    const r = recent[period];
    const value = [
      t("usageViews.tokens", { tokens: formatTokensShort(t, locale, r.tokens) }),
      t("quotas.recent.requests", { count: r.requests, value: formatInt(locale, r.requests) }),
      typeof r.equivalentUsd === "number" && r.equivalentUsd > 0
        ? t("usageViews.equivalent", { amount: formatUsd(locale, r.equivalentUsd) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { period, label: t(`quotas.recent.${period}`), value };
  });
}

/**
 * Why an account shows no meters: its provider never reports limits here (`limitsReported`), or not yet (`noWindows`),
 * or nobody uses it.
 */
export function noQuotaText(
  t: TFunction,
  a: Pick<PlanAccountUsage, "kind" | "provider" | "accountId" | "agents">,
): string {
  if (!limitsReported(a)) return t("quotas.notReported");
  return a.agents.length > 0 ? t("usageViews.noWindows") : t("usageViews.unused");
}
