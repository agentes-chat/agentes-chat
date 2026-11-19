import { expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { OrgPlanUsage, PlanAccountUsage } from "@agenteschat/client";
import { trackInput } from "@agenteschat/ui";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, settle, showIn } from "./render";

/** The plan limits ring beside the bell (ADR 0063 addendum 2026-11-18): the tightest percent, and every account. */

const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function acct(over: Partial<PlanAccountUsage>): PlanAccountUsage {
  return {
    key: `machine_1:${over.kind ?? "claude_code"}:${over.accountId ?? "a"}`,
    machineId: "machine_1",
    machineName: "MacBook",
    kind: "claude_code",
    accountId: "a",
    label: "Trabalho",
    named: true,
    plan: null,
    provider: null,
    ownerName: "Walter",
    mine: true,
    email: null,
    signedOut: false,
    usage: null,
    agents: [],
    monthTokens: 0,
    ...over,
  };
}

const metered = (usedPercent: number, over: Partial<PlanAccountUsage> = {}) =>
  acct({
    usage: {
      windows: [
        { kind: "five_hour", usedPercent, resetsAt: soon(2), agents: null },
        { kind: "seven_day", usedPercent: 10, resetsAt: soon(90), agents: null },
      ],
      source: "probe",
      at: new Date().toISOString(),
    },
    ...over,
  });

const noLimits = acct({
  kind: "cursor",
  accountId: "c",
  label: "Cursor Pro",
  recent: {
    day: { tokens: 10, requests: 1 },
    week: { tokens: 20, requests: 2 },
    month: { tokens: 1_200, requests: 3 },
  },
});

function api(accounts: PlanAccountUsage[]) {
  const fake = createFakeApi(withRightHand(seedState()));
  fake.orgs.planUsage = async (): Promise<OrgPlanUsage> => ({
    month: new Date().toISOString().slice(0, 7),
    money: false,
    api: [],
    accounts,
  });
  return fake;
}

async function ring(accounts: PlanAccountUsage[]) {
  const { services } = await renderApp(`/org/${ORG_ID}/home`, { api: api(accounts) });
  await settle(6);
  await showIn(services, "en");
  return document.querySelector<HTMLButtonElement>(".sidebar .quota-ring");
}

test("the tightest percent is written in the ring, named for a screen reader and toned by its level", async () => {
  const el = await ring([metered(92), noLimits]);
  expect(el?.textContent).toBe("92");
  expect(el?.dataset.level).toBe("critical");
  expect(el?.getAttribute("aria-label")).toBe("Plan limits: Trabalho almost at the limit, 92% used");
  cleanup();
});

test("with room it stays neutral, and at a limit it says so", async () => {
  let el = await ring([metered(30)]);
  expect(el?.dataset.level).toBe("ok");
  cleanup();
  el = await ring([metered(100)]);
  expect(el?.dataset.level).toBe("limited");
  expect(el?.getAttribute("aria-label")).toBe("Plan limits: Trabalho at the limit");
  cleanup();
});

test("a press opens every account with its windows, recent use where none is reported, and the way to Cotas", async () => {
  const el = await ring([noLimits, metered(85)]);
  expect(el).toBeTruthy();
  fireEvent.click(el as HTMLButtonElement);
  const pop = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".quota-pop");
    if (!found) throw new Error("not open");
    return found;
  });
  const accounts = [...pop.querySelectorAll(".quota-pop__name")].map((n) => n.textContent);
  expect(accounts).toEqual(["Trabalho", "Cursor Pro"]);
  expect([...pop.querySelectorAll(".quota-pop__pct")].map((n) => n.textContent)).toEqual(["85%", "10%"]);
  expect(pop.querySelectorAll(".quota-pop__reset")).toHaveLength(2);
  expect(pop.querySelector(".quota-pop__none")?.textContent).toBe("Last 30 days: 1,200 tokens · 3 calls");
  const link = within(pop).getByRole("link", { name: "See quotas" });
  expect(link.getAttribute("href")).toBe(`/org/${ORG_ID}/settings/usage?view=quotas`);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(document.querySelector(".quota-pop")).toBeNull());
  cleanup();
});

test("a dash while no account reports limits; nothing with no account at all", async () => {
  const el = await ring([noLimits]);
  expect(el?.textContent).toBe("–");
  expect(el?.getAttribute("aria-label")).toBe("Plan limits: none of your accounts reports limits");
  cleanup();
  expect(await ring([])).toBeNull();
  cleanup();
});

const popover = () => document.querySelector<HTMLElement>(".quota-pop");
const opened = () =>
  waitFor(
    () => {
      const found = popover();
      if (!found) throw new Error("not open");
      return found;
    },
    { timeout: 1500 },
  );
const closed = () => waitFor(() => expect(popover()).toBeNull());
const pressEscape = () =>
  act(async () => void fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));
const tabTo = async (el: HTMLElement) => {
  trackInput();
  fireEvent.pointerDown(document.body, { pointerType: "mouse" });
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    el.focus();
    fireEvent.keyUp(document.body, { key: "Tab" });
  });
};

test("resting the pointer on it opens the list", async () => {
  const el = (await ring([metered(85)])) as HTMLButtonElement;
  await act(async () => void fireEvent.pointerEnter(el, { pointerType: "mouse" }));
  expect((await opened()).textContent).toContain("Trabalho");
  await act(async () => void fireEvent.pointerDown(document.body));
  cleanup();
});

test("by keyboard: focus shows it, Enter moves in, Esc closes it and the focus is back on the ring", async () => {
  const el = (await ring([metered(85)])) as HTMLButtonElement;
  await tabTo(el);
  await opened();
  expect(document.activeElement).toBe(el);
  await act(async () => void fireEvent.click(el));
  await waitFor(() => expect(popover()?.contains(document.activeElement)).toBe(true));
  await pressEscape();
  await closed();
  expect(document.activeElement).toBe(el);
  await settle(2);
  expect(popover()).toBeNull();
  cleanup();
});

test("Esc, Enter, Esc: closed stays closed", async () => {
  const el = (await ring([metered(85)])) as HTMLButtonElement;
  await tabTo(el);
  await opened();
  await pressEscape();
  await closed();
  await act(async () => void fireEvent.click(el));
  await opened();
  await waitFor(() => expect(popover()?.contains(document.activeElement)).toBe(true));
  await pressEscape();
  await closed();
  await settle(2);
  expect(popover()).toBeNull();
  expect(document.activeElement).toBe(el);
  cleanup();
});

test("another member's plan near its limit doesn't turn the ring red, and stays in the list", async () => {
  const theirs = metered(100, { accountId: "b", key: "machine_1:claude_code:b", label: "De Ana", mine: false });
  const el = (await ring([theirs, metered(20)])) as HTMLButtonElement;
  expect(el.textContent).toBe("20");
  expect(el.dataset.level).toBe("ok");
  fireEvent.click(el);
  expect((await opened()).textContent).toContain("De Ana");
  cleanup();
});

test("on a narrow screen the ring is in the top bar", async () => {
  const real = window.matchMedia.bind(window);
  const media = spyOn(window, "matchMedia").mockImplementation((query: string) =>
    query === "(max-width: 760px)"
      ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
      : real(query),
  );
  await ring([metered(85)]);
  expect(document.querySelector(".shell__bar .quota-ring")?.textContent).toBe("85");
  media.mockRestore();
  cleanup();
});
