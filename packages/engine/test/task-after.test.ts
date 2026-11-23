import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  askAgentToImplement,
  createIssue,
  getIssue,
  listIssueActivity,
  queueAfterMerged,
  startWaitingTasks,
  TASK_AFTER_JOB,
  updateIssue,
  type WorkActor,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const person = (userId: string) => ({ type: "person" as const, userId });
const a = (id: string): WorkActor => ({ type: "agent", id });
const deps = () => ({ db: f.db, pubsub: f.pubsub });
const afterJobs = (issueId: string) =>
  f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.kind, TASK_AFTER_JOB), eq(schema.outbox.orgId, f.org.id)))
    .then((rows) => rows.filter((r) => (r.payload as { issueId?: string }).issueId === issueId));
const runsOf = (issueId: string) => f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, issueId));

describe('"Depois de": a task that waits on another', () => {
  test("the order shows on the task and in its history; a task can't wait on itself or on one that waits on it", async () => {
    f = await setup();
    const owner = person(f.owner.id);
    const first = await createIssue(deps(), owner, f.org.id, { title: "Migrate the table" });
    const second = await createIssue(deps(), owner, f.org.id, { title: "Use the new table" });
    const set = await updateIssue(deps(), owner, f.org.id, second.id, { afterIssueId: first.id });
    expect(set.after).toEqual({ id: first.id, number: first.number, title: "Migrate the table", status: "todo" });
    const history = await listIssueActivity(f.db, owner, f.org.id, second.id);
    expect(history.find((e) => e.event === "after_set")).toMatchObject({
      textCode: "after_set",
      textParams: { number: String(first.number) },
    });

    await expect(updateIssue(deps(), owner, f.org.id, second.id, { afterIssueId: second.id })).rejects.toThrow(
      "can't wait on itself",
    );
    await expect(updateIssue(deps(), owner, f.org.id, first.id, { afterIssueId: second.id })).rejects.toThrow(
      "can't wait on itself",
    );

    const cleared = await updateIssue(deps(), owner, f.org.id, second.id, { afterIssueId: null });
    expect(cleared.after).toBeNull();
    const events = (await listIssueActivity(f.db, owner, f.org.id, second.id)).map((e) => e.event);
    expect(events).toContain("after_cleared");
  });

  test("when the first is done, the next one's agent starts on it by itself, in the name of who set the order", async () => {
    f = await setup();
    const owner = person(f.owner.id);
    const first = await createIssue(deps(), owner, f.org.id, { title: "Part 1" });
    const second = await createIssue(deps(), owner, f.org.id, {
      title: "Part 2",
      assignees: [a(f.agent.id)],
      afterIssueId: first.id,
    });
    expect(second.after?.number).toBe(first.number);
    expect(await runsOf(second.id)).toHaveLength(0);

    // Not done yet: nothing waits to start.
    await updateIssue(deps(), owner, f.org.id, first.id, { status: "in_progress" });
    expect(await afterJobs(first.id)).toHaveLength(0);

    await updateIssue(deps(), owner, f.org.id, first.id, { status: "done" });
    expect(await afterJobs(first.id)).toHaveLength(1);
    expect(await startWaitingTasks(deps(), f.org.id, first.id)).toBe(1);

    const started = await getIssue(f.db, owner, f.org.id, { id: second.id });
    expect(started.status).toBe("in_progress");
    expect((await runsOf(second.id)).map((r) => r.agentId)).toEqual([f.agent.id]);
    const asked = (await listIssueActivity(f.db, owner, f.org.id, second.id)).find((e) => e.event === "agent_asked");
    expect(asked).toMatchObject({ author: { type: "person", id: f.owner.id }, auto: true });

    // The job again (a retry): it doesn't start a second time.
    expect(await startWaitingTasks(deps(), f.org.id, first.id)).toBe(0);
    expect(await runsOf(second.id)).toHaveLength(1);
  });

  test("one already started with Começar agora, or with no agent, is left as it is", async () => {
    f = await setup();
    const owner = person(f.owner.id);
    const first = await createIssue(deps(), owner, f.org.id, { title: "Part 1" });
    const early = await createIssue(deps(), owner, f.org.id, {
      title: "Started early",
      assignees: [a(f.agent.id)],
      afterIssueId: first.id,
    });
    const people = await createIssue(deps(), owner, f.org.id, { title: "For people", afterIssueId: first.id });
    await askAgentToImplement(deps(), f.owner.id, f.org.id, early.id, f.agent.id);
    await updateIssue(deps(), owner, f.org.id, first.id, { status: "done" });
    expect(await startWaitingTasks(deps(), f.org.id, first.id)).toBe(0);
    expect(await runsOf(early.id)).toHaveLength(1);
    expect(await runsOf(people.id)).toHaveLength(0);
  });

  test("a merged pull request linked to the first starts the next one", async () => {
    f = await setup();
    const owner = person(f.owner.id);
    const url = "https://github.com/example/app/pull/7";
    const first = await createIssue(deps(), owner, f.org.id, { title: "Part 1" });
    await updateIssue(deps(), owner, f.org.id, first.id, { addPullRequest: { number: 7, url } });
    await queueAfterMerged(f.db, f.org.id, url);
    expect(await afterJobs(first.id)).toHaveLength(1);
    await queueAfterMerged(f.db, f.org.id, "https://github.com/example/app/pull/8");
    expect(await afterJobs(first.id)).toHaveLength(1);
  });

  test("a private task waited on shows its number and state, never its title, on a task everyone sees", async () => {
    f = await setup();
    const owner = person(f.owner.id);
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const secret = await createIssue(deps(), owner, f.org.id, {
      title: "Salary review",
      audience: { mode: "people", userIds: [f.owner.id] },
    });
    const open = await createIssue(deps(), owner, f.org.id, { title: "Announce", afterIssueId: secret.id });
    expect(open.after).toMatchObject({ number: secret.number, title: null, status: "todo" });
    // Bia can't see the private one, so she can't make a task wait on it.
    const mine = await createIssue(deps(), person(bia.id), f.org.id, { title: "Mine" });
    await expect(updateIssue(deps(), person(bia.id), f.org.id, mine.id, { afterIssueId: secret.id })).rejects.toThrow(
      "does not exist",
    );
  });
});
