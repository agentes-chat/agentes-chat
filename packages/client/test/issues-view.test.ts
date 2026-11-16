import { expect, test } from "bun:test";
import {
  DONE_RECENT_DAYS,
  ISSUES_VIEW_DEFAULT,
  isDefaultIssuesView,
  issueInView,
  sortIssues,
  withIssuesView,
} from "../src/lib/issues-view";

const DAY = 86_400_000;
const NOW = Date.parse("2026-03-20T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const task = (
  over: Partial<{ status: string; priority: "high" | "normal" | "low"; labels: string[]; updatedAt: string }>,
) => ({
  status: "todo",
  priority: "normal" as const,
  labels: [] as string[],
  updatedAt: ago(0),
  ...over,
});
const shown = (t: ReturnType<typeof task>, change: Parameters<typeof withIssuesView>[1], who = "none") =>
  issueInView(t, who, withIssuesView(ISSUES_VIEW_DEFAULT, change), NOW);

test("finished tasks: every one, the ones changed in the last days, or none; open ones always", () => {
  const fresh = task({ status: "done", updatedAt: ago(DONE_RECENT_DAYS - 1) });
  const old = task({ status: "done", updatedAt: ago(DONE_RECENT_DAYS + 1) });
  expect([fresh, old].map((t) => shown(t, {}))).toEqual([true, true]);
  expect([fresh, old].map((t) => shown(t, { done: "recent" }))).toEqual([true, false]);
  expect([fresh, old].map((t) => shown(t, { done: "hidden" }))).toEqual([false, false]);
  // An open task untouched for a year is still there to do.
  expect(shown(task({ updatedAt: ago(365) }), { done: "hidden" })).toBe(true);
  // Canceled ones go by their own switch.
  expect(shown(task({ status: "canceled" }), {})).toBe(false);
  expect(shown(task({ status: "canceled" }), { showCanceled: true, done: "hidden" })).toBe(true);
});

test("the filters: one of the assignees, one of the priorities, one of the labels", () => {
  const t = task({ priority: "high", labels: ["bug", "produto"] });
  expect(shown(t, { labels: ["produto", "ops"] })).toBe(true);
  expect(shown(t, { labels: ["ops"] })).toBe(false);
  expect(shown(task({}), { labels: ["ops"] })).toBe(false);
  expect(shown(t, { priorities: ["low"] })).toBe(false);
  expect(shown(t, { assignees: ["agent:a1"] }, "agent:a1")).toBe(true);
  expect(shown(t, { assignees: ["agent:a1"] }, "none")).toBe(false);
});

test("by last change: the newest first", () => {
  const list = [
    { id: "a", priority: "normal" as const, dueDate: null, updatedAt: ago(3) },
    { id: "b", priority: "normal" as const, dueDate: null, updatedAt: ago(1) },
    { id: "c", priority: "normal" as const, dueDate: null, updatedAt: ago(2) },
  ];
  expect(sortIssues(list, "updated").map((i) => i.id)).toEqual(["b", "c", "a"]);
  expect(sortIssues(list, "manual")).toBe(list);
});

test("a view from a server of before a part is whole; any new part makes it not the default", () => {
  const { labels: _labels, done: _done, hideEmpty: _hideEmpty, collapsed: _collapsed, ...before } = ISSUES_VIEW_DEFAULT;
  expect(withIssuesView(before, {})).toEqual(ISSUES_VIEW_DEFAULT);
  expect(isDefaultIssuesView(ISSUES_VIEW_DEFAULT)).toBe(true);
  for (const change of [{ labels: ["bug"] }, { done: "recent" as const }, { hideEmpty: true }, { collapsed: ["high"] }])
    expect(isDefaultIssuesView(withIssuesView(ISSUES_VIEW_DEFAULT, change))).toBe(false);
});
