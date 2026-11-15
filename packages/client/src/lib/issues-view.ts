import type { IssueCardField, IssuePriority, IssuesView } from "../api/types";

/** What a card can show besides its number and title, in the order the screen offers them. */
export const ISSUE_CARD_FIELDS: readonly IssueCardField[] = [
  "project",
  "assignee",
  "priority",
  "due",
  "criteria",
  "pullRequest",
  "label",
];

/** The groups a board or list can be split into, and the orders inside each group. */
export const ISSUES_GROUPS: readonly IssuesView["group"][] = ["stage", "assignee", "priority"];
export const ISSUES_SORTS: readonly IssuesView["sort"][] = ["manual", "priority", "due", "updated"];
/** Which finished tasks show, and how many days back "recent" goes. */
export const ISSUES_DONE: readonly IssuesView["done"][] = ["all", "recent", "hidden"];
export const DONE_RECENT_DAYS = 7;

/** Priorities from the most to the least urgent: the priority groups and the priority order. */
export const PRIORITY_ORDER: readonly IssuePriority[] = ["high", "normal", "low"];

/**
 * What someone who never changed Tarefas sees: the board by stage, every field, no filter (mirrors
 * `ISSUES_VIEW_DEFAULT`, packages/engine/src/issues-view.ts).
 */
export const ISSUES_VIEW_DEFAULT: IssuesView = {
  layout: "board",
  group: "stage",
  sort: "manual",
  fields: { project: true, assignee: true, priority: true, due: true, criteria: true, pullRequest: true, label: true },
  assignees: [],
  priorities: [],
  labels: [],
  done: "all",
  showCanceled: false,
  hideEmpty: false,
  collapsed: [],
};

/** A change to a view: any of its parts, the fields one by one. */
export type IssuesViewChange = Partial<Omit<IssuesView, "fields">> & { fields?: Partial<IssuesView["fields"]> };

/** `view` with `change` applied; what a server of before a part doesn't send is at its default. */
export const withIssuesView = (view: Partial<IssuesView>, change: IssuesViewChange): IssuesView => ({
  ...ISSUES_VIEW_DEFAULT,
  ...view,
  ...change,
  fields: { ...ISSUES_VIEW_DEFAULT.fields, ...view.fields, ...change.fields },
});

/** Whether the view is the one everybody starts with ("Voltar ao padrão" only shows when it isn't). */
export function isDefaultIssuesView(view: IssuesView) {
  const d = ISSUES_VIEW_DEFAULT;
  return (
    view.layout === d.layout &&
    view.group === d.group &&
    view.sort === d.sort &&
    view.showCanceled === d.showCanceled &&
    view.done === d.done &&
    view.hideEmpty === d.hideEmpty &&
    view.assignees.length === 0 &&
    view.priorities.length === 0 &&
    view.labels.length === 0 &&
    view.collapsed.length === 0 &&
    ISSUE_CARD_FIELDS.every((f) => view.fields[f] === d.fields[f])
  );
}

const PRIORITY_RANK: Record<IssuePriority, number> = { high: 0, normal: 1, low: 2 };
/** Without a due date: after every dated one. */
const NO_DUE = "9999-12-31";

/**
 * A group's cards in the view's order: as they are (`manual`, the board's own order), most urgent first, soonest
 * due first, or last changed first. Ties keep the order they came in.
 */
export function sortIssues<T extends { priority: IssuePriority; dueDate: string | null; updatedAt: string }>(
  list: T[],
  sort: IssuesView["sort"],
): T[] {
  if (sort === "updated") return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "priority") return [...list].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  if (sort === "due") return [...list].sort((a, b) => (a.dueDate ?? NO_DUE).localeCompare(b.dueDate ?? NO_DUE));
  return list;
}

/**
 * Whether the view shows this task, by its filters and by what it hides: an assignee, a priority or a label filter
 * it doesn't match, a canceled task unless asked, a finished one hidden or (`recent`) last changed more than
 * `DONE_RECENT_DAYS` days ago. `assigneeKey`: the task's assignee as the filter names it.
 */
export function issueInView(
  issue: { status: string; priority: IssuePriority; labels: string[]; updatedAt: string },
  assigneeKey: string,
  view: IssuesView,
  now = Date.now(),
) {
  if (view.assignees.length > 0 && !view.assignees.includes(assigneeKey)) return false;
  if (view.priorities.length > 0 && !view.priorities.includes(issue.priority)) return false;
  if (view.labels.length > 0 && !issue.labels.some((l) => view.labels.includes(l))) return false;
  if (issue.status === "canceled") return view.showCanceled;
  if (issue.status !== "done" || view.done === "all") return true;
  if (view.done === "hidden") return false;
  return now - Date.parse(issue.updatedAt) <= DONE_RECENT_DAYS * 86_400_000;
}
