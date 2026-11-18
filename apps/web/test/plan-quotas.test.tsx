import { expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { OrgPlanUsage, PlanAccountUsage } from "@agenteschat/client";
import { cleanup, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, settle, showIn } from "./render";

/**
 * Uso › Cotas (ADR 0063 addendum 2026-11-17): every AI account by maker with all its windows open, an Antigravity
 * account's model groups under their own headings, and recent use where the provider reports no limits; Início's line
 * leads there.
 */

const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function acct(over: Partial<PlanAccountUsage>): PlanAccountUsage {
  return {
    key: `machine_1:${over.kind ?? "claude_code"}:${over.accountId ?? "a"}`,
    machineId: "machine_1",
    machineName: "MacBook",
    kind: "claude_code",
    accountId: "a",
    label: "Claude Max",
    plan: null,
    provider: null,
    ownerName: "Walter",
    mine: false,
    email: null,
    signedOut: false,
    usage: null,
    agents: [],
    monthTokens: 0,
    ...over,
  };
}

const claude = acct({
  accountId: "claude",
  plan: "max",
  usage: {
    windows: [
      { kind: "five_hour", usedPercent: 92, resetsAt: soon(2), agents: null },
      { kind: "seven_day", usedPercent: 40, resetsAt: soon(72), agents: null },
    ],
    source: "probe",
    at: new Date().toISOString(),
  },
});
const agy = acct({
  kind: "antigravity",
  accountId: "agy",
  label: "Gemini",
  usage: {
    windows: [
      { kind: "five_hour", usedPercent: 10, resetsAt: soon(3), agents: null },
      { kind: "seven_day", usedPercent: 30, resetsAt: soon(100), agents: null },
      { kind: "other", label: "Claude and GPT models · 5h", usedPercent: 60, resetsAt: soon(4), agents: null },
    ],
    source: "probe",
    at: new Date().toISOString(),
  },
});
const minimax = acct({
  accountId: "mm",
  label: "MiniMax",
  provider: "minimax",
  agents: [{ agentId: "x", name: "Dev", tokens: 10, now: true }],
  recent: {
    day: { tokens: 1_200, requests: 3 },
    week: { tokens: 50_000, requests: 40 },
    month: { tokens: 2_500_000, requests: 1_234 },
  },
});

function api() {
  const fake = createFakeApi(withRightHand(seedState()));
  fake.orgs.planUsage = async (): Promise<OrgPlanUsage> => ({
    month: new Date().toISOString().slice(0, 7),
    money: false,
    api: [],
    accounts: [minimax, agy, claude],
  });
  return fake;
}

test("Cotas: a card per maker, every window open, a model group under its heading, recent use without limits", async () => {
  const { services } = await renderApp(`/org/${ORG_ID}/settings/usage?view=quotas`, { api: api() });
  await settle(6);
  await showIn(services, "en");
  (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();
  const panel = document.querySelector(".quotas") as HTMLElement;
  expect(panel).toBeTruthy();
  const cards = [...panel.querySelectorAll(".ac-card h2")].map((h) => h.textContent);
  expect(cards).toEqual(["Claude Code", "Antigravity CLI", "MiniMax"]);
  const gemini = panel.querySelectorAll(".quotas__accounts")[1] as HTMLElement;
  expect(within(gemini).getByText("Only Claude and GPT")).toBeTruthy();
  expect(within(gemini).getAllByText(/^\d+%$/)).toHaveLength(3);
  const mm = panel.querySelectorAll(".quotas__accounts")[2] as HTMLElement;
  expect(within(mm).getByText("No quota reported by the provider.")).toBeTruthy();
  expect([...mm.querySelectorAll(".quotas__period dt")].map((d) => d.textContent)).toEqual([
    "Last 24 hours",
    "Last 7 days",
    "Last 30 days",
  ]);
  expect(mm.querySelector(".quotas__period dd")?.textContent).toBe("1,200 tokens · 3 calls");
  cleanup();
});

test("Início: where the accounts stand, the tightest first, and the way into Cotas", async () => {
  const { services } = await renderApp(`/org/${ORG_ID}/home`, { api: api() });
  await settle(6);
  await showIn(services, "en");
  const home = document.querySelector(".quotas-home") as HTMLElement;
  expect(home).toBeTruthy();
  expect(home.textContent).toContain("1 almost at the limit");
  const rows = [...home.querySelectorAll(".quotas-home__row")].map((r) => r.textContent ?? "");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("Claude Max");
  const link = within(home).getByRole("link", { name: "See quotas" });
  expect(link.getAttribute("href")).toBe(`/org/${ORG_ID}/settings/usage?view=quotas`);
  cleanup();
});

test("Início counts one seat signed in on two computers once", async () => {
  const full = (machineId: string) =>
    acct({
      key: `${machineId}:claude_code:a`,
      machineId,
      machineName: machineId,
      seat: "seat-1",
      usage: {
        windows: [{ kind: "five_hour", usedPercent: 100, resetsAt: soon(1), agents: null }],
        source: "probe",
        at: new Date().toISOString(),
      },
    });
  const fake = createFakeApi(withRightHand(seedState()));
  fake.orgs.planUsage = async (): Promise<OrgPlanUsage> => ({
    month: new Date().toISOString().slice(0, 7),
    money: false,
    api: [],
    accounts: [full("machine_1"), full("machine_2")],
  });
  const { services } = await renderApp(`/org/${ORG_ID}/home`, { api: fake });
  await settle(6);
  await showIn(services, "en");
  const home = document.querySelector(".quotas-home") as HTMLElement;
  expect(home.textContent).toContain("1 at the limit");
  expect(home.querySelectorAll(".quotas-home__row")).toHaveLength(1);
  cleanup();
});
