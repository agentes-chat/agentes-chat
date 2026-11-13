/**
 * VPS Zen: a task in review says what it waits on and who moves it.
 *
 * "Em revisão" used to be a parking spot: a card sat there with no word on whether a pull request still had to be
 * merged, a criterion checked, or a person had to say yes. `reviewStep` reads that from what the task already holds
 * (its pull requests and their state on GitHub, its criteria, its blocked badge), so the board, the task page and the
 * agents all name the same single next step. The state of a pull request comes from the workspace's GitHub webhook
 * (`applyPullRequestEvent` in `issues.ts`); one we have heard nothing about counts as still open.
 */

export type PullRequestState = "open" | "merged" | "closed";

/** A task's pull request as stored (`issues.pull_requests`); `state` and `mergedAt` arrive with the webhook. */
export interface TaskPullRequest {
  number: number;
  url: string;
  openedBy: { type: "person" | "agent"; id: string } | null;
  state?: PullRequestState;
  mergedAt?: string;
}

/**
 * What a task in review waits on:
 * - `merge`: its pull requests still open (`prs`), for a person to merge;
 * - `reopen`: every pull request was closed without a merge, back to whoever works on it;
 * - `criterion`: everything merged, an unchecked criterion left (`criterion`, the first one);
 * - `decide`: nothing to merge and nothing left to check: a person approves it or sends it back;
 * - `ready`: merged and checked, only the move to done is left.
 */
export type ReviewStepKind = "merge" | "reopen" | "criterion" | "decide" | "ready";

export interface ReviewStep {
  kind: ReviewStepKind;
  /** The pull requests it waits on (`merge`, `reopen`). */
  prs: { number: number; url: string }[];
  /** The criterion it waits on (`criterion`). */
  criterion: string | null;
  /**
   * Who moves it: `person` with an id (who asked for the task), `person` with no id (whoever reviews: a person of the
   * workspace), or the agent it is assigned to.
   */
  decider: { type: "person" | "agent"; id: string | null };
}

interface ReviewInput {
  status: string;
  pullRequests: TaskPullRequest[];
  criteria: { text: string; done: boolean }[];
  assignee: { type: "person" | "agent"; id: string } | null;
  createdBy: { type: "person" | "agent"; id: string };
}

/**
 * A criterion only a person can check: it asks for someone's OK, approval, validation or decision ("nothing goes live
 * without the client's OK"). Any other one is checked by whoever does the work.
 */
const PERSON_CRITERION = /\b(ok|aprova\w*|approv\w*|valida\w*|validat\w*|decis\w*|decid\w*|sign[- ]?off|homolog\w*)\b/i;

export function stateOf(pr: TaskPullRequest): PullRequestState {
  return pr.state === "merged" || pr.state === "closed" ? pr.state : "open";
}

/** The next step of a task in review; null for a task in any other stage. */
export function reviewStep(task: ReviewInput): ReviewStep | null {
  if (task.status !== "in_review") return null;
  const reviewer = { type: "person" as const, id: task.createdBy.type === "person" ? task.createdBy.id : null };
  const worker = task.assignee ? { type: task.assignee.type, id: task.assignee.id } : reviewer;
  const link = (p: TaskPullRequest) => ({ number: p.number, url: p.url });
  const open = task.pullRequests.filter((p) => stateOf(p) === "open");
  if (open.length > 0) return { kind: "merge", prs: open.map(link), criterion: null, decider: reviewer };
  const merged = task.pullRequests.filter((p) => stateOf(p) === "merged");
  if (task.pullRequests.length > 0 && merged.length === 0) {
    return { kind: "reopen", prs: task.pullRequests.map(link), criterion: null, decider: worker };
  }
  const left = task.criteria.find((c) => !c.done);
  if (left) {
    return {
      kind: "criterion",
      prs: [],
      criterion: left.text,
      decider: PERSON_CRITERION.test(left.text) ? reviewer : worker,
    };
  }
  if (task.pullRequests.length === 0) return { kind: "decide", prs: [], criterion: null, decider: reviewer };
  return { kind: "ready", prs: [], criterion: null, decider: reviewer };
}

/** The step in one English line, for agents' prompts and tool answers. */
export function reviewStepLine(step: ReviewStep, nameOf: (actor: { type: string; id: string }) => string): string {
  const who = step.decider.id ? nameOf({ type: step.decider.type, id: step.decider.id }) : "a person who reviews";
  const prs = step.prs.map((p) => `#${p.number}`).join(", ");
  switch (step.kind) {
    case "merge":
      return `Waiting on: merge PR ${prs} (${who} decides)`;
    case "reopen":
      return `Waiting on: PR ${prs} closed without a merge; reopen it or move the task back (${who})`;
    case "criterion":
      return `Waiting on: the criterion "${step.criterion}" (${who} checks it)`;
    case "decide":
      return `Waiting on: approve it (done) or send it back (${who} decides)`;
    case "ready":
      return `Waiting on: nothing, everything is merged and checked; move it to done (${who})`;
  }
}

/**
 * Task numbers a pull request names in its title, body or branch: `task #45`, `tarefa 45`, `Task: #45`, a branch
 * `task-45-…`. A bare `#45` is a GitHub number, never a task.
 */
export function taskRefsOf(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(/\b(?:task|tarefa)s?[\s:_/-]*#?(\d{1,7})\b/gi)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) found.add(n);
    }
  }
  return [...found].slice(0, 20);
}

/** Every pull request of the task merged, and every criterion checked: it may go to done on its own. */
export function readyForDone(task: Pick<ReviewInput, "pullRequests" | "criteria">) {
  return (
    task.pullRequests.length > 0 &&
    task.pullRequests.every((p) => stateOf(p) === "merged") &&
    task.criteria.every((c) => c.done)
  );
}
