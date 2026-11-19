import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { PlanAccountUsage, PlanUsage } from "../src/api/types";
import { formatUsd } from "../src/lib/format";
import { openTarget, targetPath } from "../src/lib/notifications";
import { groupUsageAccounts } from "../src/lib/plan-usage";
import {
  limitsReported,
  noQuotaText,
  planLimitNotice,
  quotaLevel,
  quotaOverview,
  quotaRingLabel,
  quotaRoom,
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

describe("the ring's circles", () => {
  const at = (key: string, usedPercent: number, over: Partial<PlanAccountUsage> = {}) =>
    account(key, { usage: usage([{ kind: "five_hour", usedPercent, resetsAt: IN_2H }]), ...over });

  test("the three accounts closest to a limit that concern the viewer, the tightest outermost", () => {
    const { rings, tightest } = quotaOverview(
      [at("a", 10), at("b", 61), at("c", 85), at("d", 30), at("e", 99, { mine: false, forMe: false })],
      NOW,
    );
    expect(rings.map((r) => [r.account.key, r.used, r.level])).toEqual([
      ["c", 85, "almost"],
      ["b", 61, "ok"],
      ["d", 30, "ok"],
    ]);
    expect(rings.map((r) => r.radius)).toEqual([16, 12.7, 9.4]);
    expect(new Set(rings.map((r) => r.hue)).size).toBe(3);
    expect(tightest?.account.key).toBe("c");
    expect(rings[0]?.window?.kind).toBe("five_hour");
  });

  test("each plan its maker's color, the viewer's choice over it; none known, none drawn", () => {
    const gemini = at("g", 20, { kind: "antigravity" });
    const code = at("o", 10, { kind: "opencode", provider: "zen" });
    expect(quotaOverview([at("c", 30), gemini, code], NOW).rings.map((r) => r.hue)).toEqual(["amber", "sky", "violet"]);
    // A second account of a maker takes another color, and a color chosen is nobody else's.
    expect(quotaOverview([at("c", 30), at("d", 20)], NOW).rings.map((r) => r.hue)).toEqual(["amber", "sky"]);
    expect(quotaOverview([at("c", 30), gemini], NOW, { c: "sky" }).rings.map((r) => r.hue)).toEqual(["sky", "indigo"]);
    expect(quotaOverview([account("x")], NOW).rings).toEqual([]);
  });
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

describe("the limits ring", () => {
  const PAST = "2026-11-17T11:00:00.000Z";

  test("the tightest account across windows that haven't reset, closest first, no limits last", () => {
    const low = account("low", { usage: usage([{ kind: "five_hour", usedPercent: 20, resetsAt: IN_2H }]) });
    const high = account("high", {
      usage: usage([
        { kind: "five_hour", usedPercent: 99, resetsAt: PAST },
        { kind: "seven_day", usedPercent: 83, resetsAt: IN_2H },
      ]),
    });
    const none = account("none", { kind: "cursor", recent: undefined });
    const o = quotaOverview([none, low, high], NOW);
    expect(o.tightest).toMatchObject({ used: 83, standing: "almost", account: { key: "high" } });
    expect(o.lines.map((l) => l.account.key)).toEqual(["high", "low", "none"]);
    expect(o.lines[2]?.room).toBeNull();
    // A window that already reset reads empty, with no reset to wait for.
    expect(o.lines[0]?.windows).toEqual([
      { key: "seven_day:", kind: "seven_day", used: 83, resetsAt: IN_2H },
      { key: "five_hour:", kind: "five_hour", used: 0, resetsAt: null },
    ]);
  });

  test("nothing to show a percent for: no accounts, or none reporting limits", () => {
    expect(quotaOverview([], NOW)).toEqual({ tightest: null, rings: [], lines: [] });
    const o = quotaOverview([account("a"), account("b", { usage: usage([]) })], NOW);
    expect(o.tightest).toBeNull();
    expect(o.lines).toHaveLength(2);
    expect(quotaRingLabel(t, o, (a) => a.key)).toBe("quotas.ring.none");
    expect(quotaLevel(null)).toBe("ok");
  });

  test("at a limit: a full window, or a refusal with none full", () => {
    const full = account("full", { usage: usage([{ kind: "five_hour", usedPercent: 100, resetsAt: IN_2H }]) });
    expect(quotaRoom(full, NOW)).toEqual({ used: 100, standing: "limited" });
    const refused = account("r", { usage: usage([{ kind: "seven_day", usedPercent: 40 }], true) });
    expect(quotaRoom(refused, NOW)).toEqual({ used: 100, standing: "limited" });
    expect(quotaLevel(quotaRoom(refused, NOW))).toBe("limited");
    expect(quotaRoom(account("n", { usage: usage([], true) }), NOW)).toEqual({ used: 100, standing: "limited" });
  });

  test("a model's own week or extra usage never leads while the plan has windows of its own", () => {
    const a = account("a", {
      usage: usage([
        { kind: "five_hour", usedPercent: 30, resetsAt: IN_2H },
        { kind: "other", label: "Fable", usedPercent: 100, resetsAt: IN_2H },
        { kind: "other", label: "Extra usage", usedPercent: 100 },
      ]),
    });
    expect(quotaRoom(a, NOW)).toEqual({ used: 30, standing: "ok" });
    // Still listed, every window.
    expect(quotaOverview([a], NOW).lines[0]?.windows).toHaveLength(3);
  });

  test("an account with only model groups' quotas is read from them", () => {
    const agy = account("agy", {
      kind: "antigravity",
      usage: usage([
        { kind: "other", label: "Claude and GPT models · 5h", usedPercent: 91, resetsAt: IN_2H },
        { kind: "other", label: "Extra usage", usedPercent: 100 },
      ]),
    });
    expect(quotaRoom(agy, NOW)).toEqual({ used: 91, standing: "almost" });
    expect(quotaLevel(quotaRoom(agy, NOW))).toBe("critical");
  });

  test("a single model's week never leads while the plan reports its own windows", () => {
    const a = account("a", {
      usage: usage([
        { kind: "five_hour", usedPercent: 20, resetsAt: IN_2H },
        { kind: "seven_day_opus", usedPercent: 100, resetsAt: IN_2H },
        { kind: "seven_day_sonnet", usedPercent: 97, resetsAt: IN_2H },
      ]),
    });
    expect(quotaRoom(a, NOW)).toEqual({ used: 20, standing: "ok" });
  });

  test("a reading with no reset counts no longer than its window lasts", () => {
    const old = (hours: number) => ({
      ...usage([{ kind: "five_hour", usedPercent: 95 }]),
      at: new Date(NOW - hours * 3_600_000).toISOString(),
    });
    expect(quotaRoom(account("a", { usage: old(4) }), NOW)).toEqual({ used: 95, standing: "almost" });
    const stale = account("b", { usage: old(6) });
    expect(quotaRoom(stale, NOW)).toBeNull();
    expect(quotaOverview([stale], NOW).lines[0]?.windows[0]?.used).toBe(0);
  });

  test("only accounts that concern the viewer color the ring; the others stay listed", () => {
    const theirs = account("theirs", {
      mine: false,
      usage: usage([{ kind: "five_hour", usedPercent: 100, resetsAt: IN_2H }]),
    });
    const mine = account("mine", { usage: usage([{ kind: "five_hour", usedPercent: 10, resetsAt: IN_2H }]) });
    const o = quotaOverview([theirs, mine], NOW);
    expect(o.tightest).toMatchObject({ used: 10, standing: "ok", account: { key: "mine" } });
    expect(o.lines.map((l) => l.account.key)).toEqual(["theirs", "mine"]);
    expect(quotaOverview([theirs], NOW).tightest).toBeNull();
    expect(quotaOverview([{ ...theirs, forMe: true }, mine], NOW).tightest?.account.key).toBe("theirs");
  });

  test("a signed-out account stays listed but never leads", () => {
    const out = account("out", {
      signedOut: true,
      usage: usage([{ kind: "five_hour", usedPercent: 100, resetsAt: IN_2H }]),
    });
    const on = account("on", { usage: usage([{ kind: "five_hour", usedPercent: 10, resetsAt: IN_2H }]) });
    const o = quotaOverview([out, on], NOW);
    expect(o.tightest?.account.key).toBe("on");
    expect(o.lines.map((l) => l.account.key)).toEqual(["on", "out"]);
  });

  test("the ring's name says the percent and the account", () => {
    const a = account("Work", { usage: usage([{ kind: "five_hour", usedPercent: 92, resetsAt: IN_2H }]) });
    expect(quotaRingLabel(t, quotaOverview([a], NOW), (x) => x.key)).toBe(
      'quotas.ring.almost {"percent":92,"account":"Work"}',
    );
  });
});

describe("the alert at 90%", () => {
  const n = {
    kind: "plan_limit_near",
    source: { label: "Trabalho" },
    latest: { percent: 91.4, window: { kind: "five_hour" }, resetsAt: IN_2H },
    actors: [],
  } as unknown as Parameters<typeof openTarget>[0];

  test("says the account, the percent, the window and the reset while it is ahead", () => {
    const now = new Date(NOW);
    expect(planLimitNotice(t, "en", n, now)).toMatchObject({ account: "Trabalho", percent: 91 });
    expect(planLimitNotice(t, "en", n, now).resets).toContain("aiAccounts.usage.resetsAt");
    expect(planLimitNotice(t, "en", n, new Date(Date.parse(IN_2H) + 1)).resets).toBeNull();
  });

  test("opens Cotas", () => {
    const target = openTarget(n);
    expect(target && targetPath("o1", target)).toBe("/org/o1/settings/usage?view=quotas");
  });
});
