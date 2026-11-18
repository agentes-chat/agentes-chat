import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { PlanAccountUsage, PlanUsage } from "../src/api/types";
import { formatUsd } from "../src/lib/format";
import { groupUsageAccounts } from "../src/lib/plan-usage";
import {
  limitsReported,
  noQuotaText,
  quotaSections,
  quotaStanding,
  quotaSummary,
  quotaSummaryText,
  recentLines,
  tightestAccounts,
} from "../src/lib/quotas";

/** Cotas (ADR 0063 addendum 2026-11-17): accounts by maker, where each stands, and recent use where none is reported. */

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const IN_2H = "2026-11-17T14:00:00.000Z";
const t = ((key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key)) as TFunction;

const usage = (windows: PlanUsage["windows"], limited?: boolean): NonNullable<PlanAccountUsage["usage"]> => ({
  windows: windows.map((w) => ({ ...w, agents: null })),
  ...(limited ? { limited } : {}),
  source: "probe",
  at: "2026-11-17T11:55:00.000Z",
});

const account = (key: string, over: Partial<PlanAccountUsage> = {}): PlanAccountUsage => ({
  key,
  machineId: "m1",
  machineName: "MacBook",
  kind: "claude_code",
  accountId: key,
  label: key,
  plan: null,
  provider: null,
  ownerName: "Ana",
  mine: true,
  email: null,
  signedOut: false,
  usage: null,
  agents: [],
  monthTokens: 0,
  ...over,
});

describe("where an account stands", () => {
  test("at a limit, near one, with room, or nothing known", () => {
    expect(quotaStanding(account("a", { usage: usage([{ kind: "five_hour", usedPercent: 100 }]) }), NOW)).toBe(
      "limited",
    );
    expect(quotaStanding(account("a", { usage: usage([{ kind: "seven_day", usedPercent: 85 }]) }), NOW)).toBe("almost");
    expect(quotaStanding(account("a", { usage: usage([{ kind: "monthly", usedPercent: 10 }]) }), NOW)).toBe("ok");
    expect(quotaStanding(account("a"), NOW)).toBe("none");
    // A refusal with no window known is still the limit.
    expect(quotaStanding(account("a", { usage: usage([], true) }), NOW)).toBe("limited");
    // A model group's own quota full never puts the account at its limit.
    expect(
      quotaStanding(
        account("a", {
          kind: "antigravity",
          usage: usage([
            { kind: "five_hour", usedPercent: 20, resetsAt: IN_2H },
            { kind: "other", label: "Claude and GPT models · 5h", usedPercent: 100, resetsAt: IN_2H },
          ]),
        }),
        NOW,
      ),
    ).toBe("ok");
  });

  test("the providers that never report limits here", () => {
    expect(limitsReported({ kind: "claude_code", provider: null, accountId: "a" })).toBe(true);
    expect(limitsReported({ kind: "codex", provider: null, accountId: null })).toBe(true);
    expect(limitsReported({ kind: "claude_code", provider: "opencode", accountId: "a" })).toBe(true);
    expect(limitsReported({ kind: "claude_code", provider: "zai", accountId: "a" })).toBe(true);
    expect(limitsReported({ kind: "claude_code", provider: "minimax", accountId: "a" })).toBe(false);
    expect(limitsReported({ kind: "cursor", provider: null, accountId: "a" })).toBe(false);
    expect(limitsReported({ kind: "grok", provider: null, accountId: "a" })).toBe(false);
    expect(limitsReported({ kind: "opencode", provider: null, accountId: "a" })).toBe(false);
    expect(limitsReported({ kind: "antigravity", provider: null, accountId: "a" })).toBe(true);
    expect(limitsReported({ kind: "antigravity", provider: null, accountId: null })).toBe(false);
    expect(noQuotaText(t, account("m", { provider: "minimax", agents: [] }))).toBe("quotas.notReported");
    expect(noQuotaText(t, account("c", { agents: [{ agentId: "x", name: "Dev", tokens: 1, now: true }] }))).toBe(
      "usageViews.noWindows",
    );
    expect(noQuotaText(t, account("c"))).toBe("usageViews.unused");
  });
});

describe("the list by maker", () => {
  const claudeOk = account("claude-ok", { usage: usage([{ kind: "five_hour", usedPercent: 30 }]) });
  const claudeFull = account("claude-full", { usage: usage([{ kind: "seven_day", usedPercent: 100 }]) });
  const claudeNone = account("claude-none");
  const minimax = account("mm", { provider: "minimax" });
  const agy = account("agy", { kind: "antigravity", usage: usage([{ kind: "five_hour", usedPercent: 85 }]) });
  const codex = account("cx", { kind: "codex", usage: usage([{ kind: "five_hour", usedPercent: 50 }]) });
  const accounts = [minimax, claudeOk, agy, claudeNone, codex, claudeFull];

  test("makers in a fixed order, and within one the closest to a limit first, nothing known last", () => {
    const sections = quotaSections(accounts, NOW);
    expect(sections.map((s) => [s.maker, s.name])).toEqual([
      ["claude_code", "Claude Code"],
      ["codex", "Codex"],
      ["antigravity", "Antigravity CLI"],
      ["minimax", "MiniMax"],
    ]);
    expect(sections[0]?.accounts.map((a) => a.key)).toEqual(["claude-full", "claude-ok", "claude-none"]);
  });

  test("Início's few and its line", () => {
    expect(tightestAccounts(accounts, 3, NOW).map((a) => a.key)).toEqual(["claude-full", "agy", "cx"]);
    const summary = quotaSummary(accounts, NOW);
    expect(summary).toEqual({ limited: 1, almost: 1, known: 4, total: 6 });
    expect(quotaSummaryText(t, summary)).toBe('quotas.summary.limited {"count":1} · quotas.summary.almost {"count":1}');
    expect(quotaSummaryText(t, quotaSummary([claudeOk], NOW))).toBe("quotas.summary.ok");
    expect(quotaSummaryText(t, quotaSummary([minimax], NOW))).toBe('quotas.summary.accounts {"count":1}');
  });
});

describe("recent use", () => {
  const recent = {
    day: { tokens: 1_200, requests: 3 },
    week: { tokens: 50_000, requests: 40, equivalentUsd: 0 },
    month: { tokens: 2_500_000, requests: 1_234, equivalentUsd: 3.1 },
  };
  const words = ((key: string, o?: Record<string, unknown>) =>
    key === "format.tokensMillions"
      ? `${o?.value} mi`
      : key === "format.tokensThousands"
        ? `${o?.value} mil`
        : o
          ? `${key}(${Object.values(o).join(",")})`
          : key) as TFunction;

  test("one line per period, money only where sent and above zero", () => {
    expect(recentLines(words, "pt-BR", recent)).toEqual([
      { period: "day", label: "quotas.recent.day", value: "usageViews.tokens(1.200) · quotas.recent.requests(3,3)" },
      {
        period: "week",
        label: "quotas.recent.week",
        value: "usageViews.tokens(50 mil) · quotas.recent.requests(40,40)",
      },
      {
        period: "month",
        label: "quotas.recent.month",
        value: `usageViews.tokens(2,5 mi) · quotas.recent.requests(1234,1.234) · usageViews.equivalent(${formatUsd("pt-BR", 3.1)})`,
      },
    ]);
  });

  test("nothing for an older server or no use in 30 days", () => {
    expect(recentLines(words, "en", undefined)).toEqual([]);
    const none = { tokens: 0, requests: 0 };
    expect(recentLines(words, "en", { day: none, week: none, month: none })).toEqual([]);
  });
});

describe("one seat on two computers", () => {
  const seat = (machineId: string, over: Partial<PlanAccountUsage>) =>
    account(`${machineId}:cursor:${machineId}`, {
      machineId,
      kind: "cursor",
      accountId: machineId,
      seat: "s1",
      ...over,
    });

  test("its recent use is both logins' summed, money where either has it", () => {
    const [row, ...rest] = groupUsageAccounts(
      [
        seat("m1", {
          recent: {
            day: { tokens: 10, requests: 1 },
            week: { tokens: 100, requests: 2, equivalentUsd: 1 },
            month: { tokens: 1_000, requests: 3, equivalentUsd: 2 },
          },
        }),
        seat("m2", {
          recent: {
            day: { tokens: 5, requests: 1 },
            week: { tokens: 50, requests: 1 },
            month: { tokens: 500, requests: 4, equivalentUsd: 0.5 },
          },
        }),
      ],
      undefined,
    );
    expect(rest).toEqual([]);
    expect(row?.recent).toEqual({
      day: { tokens: 15, requests: 2 },
      week: { tokens: 150, requests: 3, equivalentUsd: 1 },
      month: { tokens: 1_500, requests: 7, equivalentUsd: 2.5 },
    });
  });

  test("counts once on Início's line and in its few", () => {
    const full = usage([{ kind: "five_hour", usedPercent: 100 }]);
    const grouped = groupUsageAccounts([seat("m1", { usage: full }), seat("m2", { usage: full })], undefined);
    expect(quotaSummary(grouped, NOW)).toEqual({ limited: 1, almost: 0, known: 1, total: 1 });
    expect(tightestAccounts(grouped, 3, NOW)).toHaveLength(1);
  });
});
