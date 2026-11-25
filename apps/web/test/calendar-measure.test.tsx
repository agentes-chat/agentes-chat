import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { toYmd } from "@agenteschat/client/lib/format";
import { cleanup } from "@testing-library/react";
import { pinFileClock } from "./clock";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle } from "./render";

pinFileClock();

afterEach(() => cleanup());

const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

/**
 * The week of a workspace with daily `routines` (name and time) and today's `events`, each element as tall as `drawn`
 * says (0: not measured): today's column once it settled, or null when the page broke.
 */
async function todaysColumn(
  drawn: (el: HTMLElement) => number,
  routines: (readonly [name: string, time: string])[],
  events: { title: string; start: Date; end: Date }[] = [],
) {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return drawn(this);
    },
  });
  try {
    const state = seedState();
    const api = createFakeApi(state);
    const agentId = state.agents[0]?.id ?? "";
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const [name, time] of routines)
      await api.routines.create(ORG_ID, {
        name,
        agentId,
        prompt: "Faça algo.",
        target: { type: "dm" },
        trigger: { type: "schedule", rule: { freq: "daily", times: [time], timezone } },
      });
    for (const { title, start, end } of events)
      await api.calendar.create(ORG_ID, {
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        recurrence: "none",
        participants: [],
      });
    await renderApp(`/org/${ORG_ID}/calendar`, { api });
    await settle(8);
    return document.querySelector<HTMLElement>(`.cal-week__col[data-day="${toYmd(new Date())}"]`);
  } finally {
    if (own) Object.defineProperty(HTMLElement.prototype, "offsetHeight", own);
    else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  }
}

/**
 * A stack of runs drawn shorter when it holds more: alone a run's name wraps (44px) and the stack takes in the run 40
 * minutes later (29px under it); holding both it shows two short rows (24px), which lets that run go again. Measured
 * as drawn on every render, the week flipped between one stack and two until React stopped it as an endless loop.
 */
test("the week's measured layout settles when what a stack holds changes how tall it is drawn", async () => {
  const col = await todaysColumn(
    (el) =>
      !el.classList.contains("cal-week__runs") ? 0 : el.querySelectorAll(".cal-chip--run").length === 1 ? 44 : 24,
    [
      ["Bom dia", "07:00"],
      ["Resumo", "07:40"],
    ],
  );
  expect(col).not.toBeNull();
  // One stack holds both runs, as the taller measure (the run alone, wrapping) said.
  const runs = (stack: Element) =>
    [...stack.querySelectorAll(".cal-chip--run")].map((chip) => chip.getAttribute("aria-label"));
  const stacks = [...(col?.querySelectorAll(".cal-week__runs") ?? [])].map(runs);
  expect(stacks.filter((names) => names.some((n) => /Bom dia|Resumo/.test(n ?? "")))).toEqual([
    ["Rotina Bom dia, 07:00", "Rotina Resumo, 07:40"],
  ]);
});

/**
 * A run beside a meeting is drawn thin, its owner's face alone on one short line (24px); wide, its name wraps (44px)
 * and reaches the meeting 40 minutes later, which then goes beside it. Measured as drawn on every render, the run went
 * thin and short, the meeting back under it, the run wide and tall, and so on: no element moved or mounted, only the
 * measure set the week's state again on every commit.
 */
test("the week's measured layout settles when a run beside a meeting is drawn shorter than alone", async () => {
  const col = await todaysColumn(
    (el) => (!el.classList.contains("cal-week__runs") ? 0 : el.hasAttribute("data-thin") ? 24 : 44),
    [["Bom dia", "07:00"]],
    [{ title: "Café com o time", start: today(7, 40), end: today(8, 10) }],
  );
  expect(col).not.toBeNull();
  // Thin beside the meeting, as the taller measure (the run wide, wrapping) said.
  const run = col?.querySelector('[aria-label="Rotina Bom dia, 07:00"]');
  expect(run?.closest(".cal-week__runs")?.hasAttribute("data-thin")).toBe(true);
});
