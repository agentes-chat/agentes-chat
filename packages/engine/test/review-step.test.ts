import { afterEach, describe, expect, test } from "bun:test";
import {
  applyPullRequestEvent,
  createIssue,
  getIssue,
  listIssueActivity,
  reviewStep,
  setCriterion,
  taskRefsOf,
  updateIssue,
} from "../src";
import { type Fixture, setup } from "./fixtures";

// VPS Zen: a task in review names what it waits on, and GitHub's pull request events move it.

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

const person = (userId: string) => ({ type: "person" as const, userId });
const pr = (n: number) => `https://github.com/acme/app/pull/${n}`;
const event = (action: string, n: number, extra: Record<string, unknown> = {}) => ({
  action,
  pull_request: { number: n, html_url: pr(n), title: `PR ${n}`, body: "", head: { ref: "feat" }, ...extra },
});

describe("reviewStep", () => {
  const base = {
    status: "in_review",
    pullRequests: [],
    criteria: [],
    assignee: { type: "agent" as const, id: "agent-1" },
    createdBy: { type: "person" as const, id: "owner" },
  };
  const open = { number: 1, url: pr(1), openedBy: null };

  test("only in review", () => {
    expect(reviewStep({ ...base, status: "in_progress" })).toBeNull();
  });

  test("an open PR waits on a merge, decided by who asked for the task", () => {
    expect(reviewStep({ ...base, pullRequests: [open] })).toMatchObject({
      kind: "merge",
      prs: [{ number: 1 }],
      decider: { type: "person", id: "owner" },
    });
  });

  test("every PR closed without a merge goes back to whoever works on it", () => {
    expect(reviewStep({ ...base, pullRequests: [{ ...open, state: "closed" }] })).toMatchObject({
      kind: "reopen",
      decider: { type: "agent", id: "agent-1" },
    });
  });

  test("merged with a criterion left: the criterion, and a person checks one asking for an OK", () => {
    const merged = [{ ...open, state: "merged" as const }];
    expect(
      reviewStep({ ...base, pullRequests: merged, criteria: [{ text: "Testes passam", done: false }] }),
    ).toMatchObject({ kind: "criterion", criterion: "Testes passam", decider: { type: "agent" } });
    expect(
      reviewStep({ ...base, pullRequests: merged, criteria: [{ text: "Nada em produção sem o OK", done: false }] }),
    ).toMatchObject({ kind: "criterion", decider: { type: "person", id: "owner" } });
  });

  test("nothing to merge or check: a person decides; all merged and checked: ready", () => {
    expect(reviewStep(base)).toMatchObject({ kind: "decide", decider: { type: "person" } });
    expect(reviewStep({ ...base, pullRequests: [{ ...open, state: "merged" }] })?.kind).toBe("ready");
  });

  test("a task created by an agent has no named reviewer", () => {
    expect(reviewStep({ ...base, createdBy: { type: "agent", id: "a" } })?.decider).toEqual({
      type: "person",
      id: null,
    });
  });
});

test("taskRefsOf reads task and tarefa, never a bare GitHub number", () => {
  expect(taskRefsOf("Fixes #12", "Task: #45 and tarefa 46", "task-47-sidebar")).toEqual([45, 46, 47]);
  expect(taskRefsOf("closes #3")).toEqual([]);
});

describe("applyPullRequestEvent", () => {
  test("a merge with every criterion checked moves the task to done", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const issue = await createIssue(deps, person(f.owner.id), f.org.id, { title: "Sidebar", criteria: ["Build ok"] });
    await updateIssue(deps, person(f.owner.id), f.org.id, issue.id, {
      addPullRequest: { number: 7, url: pr(7) },
    });
    let view = await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id });
    expect(view.review).toMatchObject({ kind: "merge", prs: [{ number: 7 }] });

    // Merged with a criterion left: it stays in review, waiting on that criterion.
    expect(await applyPullRequestEvent(deps, f.org.id, event("closed", 7, { merged: true }))).toBe(1);
    view = await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id });
    expect(view.status).toBe("in_review");
    expect(view.pullRequests[0]?.state).toBe("merged");
    expect(view.review).toMatchObject({ kind: "criterion", criterion: "Build ok" });

    // The same delivery again changes nothing.
    expect(await applyPullRequestEvent(deps, f.org.id, event("closed", 7, { merged: true }))).toBe(0);

    // A second PR, opened naming the task, merged once the criterion is checked: done.
    const named = { ...event("opened", 8), pull_request: { ...event("opened", 8).pull_request, body: "task #1" } };
    expect(await applyPullRequestEvent(deps, f.org.id, named)).toBe(1);
    const criterion = view.criteria[0];
    if (!criterion) throw new Error("no criterion");
    await setCriterion(deps, person(f.owner.id), f.org.id, issue.id, criterion.id, true);
    expect((await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id })).review).toMatchObject({
      kind: "merge",
      prs: [{ number: 8 }],
    });
    await applyPullRequestEvent(deps, f.org.id, event("closed", 8, { merged: true }));
    view = await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id });
    expect(view.status).toBe("done");
    expect(view.review).toBeNull();
    const events = (await listIssueActivity(f.db, person(f.owner.id), f.org.id, issue.id)).map((a) => a.event);
    expect(events).toEqual(expect.arrayContaining(["pr_merged", "pr_linked", "status_changed"]));
  });

  test("a PR closed without a merge says so; one naming a task links it and moves it to review", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const issue = await createIssue(deps, person(f.owner.id), f.org.id, { title: "Motor" });
    const opened = event("opened", 9, { title: "Motor de workflows (tarefa 1)" });
    await applyPullRequestEvent(deps, f.org.id, opened);
    let view = await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id });
    expect(view.status).toBe("in_review");
    expect(view.pullRequests).toMatchObject([{ number: 9, state: "open" }]);
    await applyPullRequestEvent(deps, f.org.id, event("closed", 9, { merged: false }));
    view = await getIssue(f.db, person(f.owner.id), f.org.id, { id: issue.id });
    expect(view.status).toBe("in_review");
    expect(view.review?.kind).toBe("reopen");
    const last = (await listIssueActivity(f.db, person(f.owner.id), f.org.id, issue.id)).at(-1);
    expect(last).toMatchObject({ event: "pr_closed", textCode: "pr_closed", textParams: { number: "9" } });
  });
});
