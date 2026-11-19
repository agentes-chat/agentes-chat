import { afterEach, expect, setSystemTime, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  askAgentToImplement,
  createAgent,
  createArtifact,
  createIssue,
  createRoutine,
  deleteIssue,
  drainOutbox,
  executeRoutineRun,
  getIssue,
  NEW_AGENT_DEFAULTS,
  setIssueAudience,
  setRoutineActive,
  updateArtifact,
  updateIssue,
} from "../src";
import { routineBriefOfRun } from "../src/background";
import { deliverRoutineReport } from "../src/hand-off";
import {
  addIssueDependency,
  dispatchIssueReady,
  issueDependencyBrief,
  listIssueDependencies,
  removeIssueDependency,
} from "../src/issue-dependencies";
import { queueIsolatedEventRun } from "../src/routine-events";
import { closeRoutineRun } from "../src/routine-ledger";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});
const person = (userId: string) => ({ type: "person" as const, userId });
const deps = () => ({ db: f.db, pubsub: f.pubsub });
const make = (title: string) => createIssue(deps(), person(f.owner.id), f.org.id, { title });
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture data to exist");
  return value;
}

test("dependencies prevent premature starts and a cycle, without changing ordinary tasks", async () => {
  f = await setup();
  const a = await make("Review inputs");
  const b = await make("Prepare report");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await expect(addIssueDependency(deps(), person(f.owner.id), f.org.id, a.id, b.id)).rejects.toMatchObject({
    code: "issue.dependency_cycle",
  });
  await expect(addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, b.id)).rejects.toMatchObject({
    code: "issue.dependency_cycle",
  });
  await expect(askAgentToImplement(deps(), f.owner.id, f.org.id, b.id, f.agent.id)).rejects.toMatchObject({
    code: "issue.dependencies_pending",
  });
  expect((await f.db.select().from(schema.agentRuns)).length).toBe(0);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  expect((await listIssueDependencies(f.db, person(f.owner.id), f.org.id, b.id)).waiting).toBe(0);
  await askAgentToImplement(deps(), f.owner.id, f.org.id, b.id, f.agent.id);
  expect((await f.db.select().from(schema.agentRuns)).filter((r) => r.issueId === b.id)).toHaveLength(1);
});

test("two concurrent edges cannot form a cycle", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  const outcomes = await Promise.allSettled([
    addIssueDependency(deps(), person(f.owner.id), f.org.id, a.id, b.id),
    addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
});

test("a deleted dependency stays an unresolved relation until explicitly removed", async () => {
  f = await setup();
  const a = await make("Input");
  const b = await make("Delivery");
  const added = await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await deleteIssue(deps(), f.owner.id, f.org.id, a.id);
  const view = await listIssueDependencies(f.db, person(f.owner.id), f.org.id, b.id);
  expect(view.waiting).toBe(1);
  expect(view.dependencies[0]?.task).toBeNull();
  await removeIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, required(added.dependencies[0]).id);
  expect((await listIssueDependencies(f.db, person(f.owner.id), f.org.id, b.id)).dependencies).toHaveLength(0);
});

test("a reader of a successor cannot learn the title of a restricted prerequisite", async () => {
  f = await setup();
  const member = await addMember(f.db, f.org.id, "member", "reader");
  const a = await createIssue(deps(), person(f.owner.id), f.org.id, {
    title: "Private payroll",
    audience: { mode: "people", userIds: [f.owner.id] },
  });
  const b = await make("Public delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  const view = await listIssueDependencies(f.db, person(member.id), f.org.id, b.id);
  expect(view.dependencies[0]?.task).toBeNull();
  expect(JSON.stringify(view)).not.toContain("payroll");
  await expect(addIssueDependency(deps(), person(member.id), f.org.id, b.id, a.id)).rejects.toMatchObject({
    code: "not_found",
  });
});

test("two matching routines reserve a ready task once and preserve their own authority", async () => {
  f = await setup({ reply: () => ({ chunks: ["Done"] }) });
  const a = await make("Inputs");
  const b = await make("Delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  for (const name of ["First", "Second"])
    await createRoutine(deps(), f.owner.id, f.org.id, {
      name,
      agentId: f.agent.id,
      prompt: "Complete the ready task.",
      target: { type: "dm" },
      trigger: { type: "event", event: "issue.ready", issueId: b.id },
    });
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, b.id));
  expect(runs).toHaveLength(1);
  expect(runs[0]?.background).toBe(true);
});

async function readyRoutine(issueId?: string) {
  return createRoutine(deps(), f.owner.id, f.org.id, {
    name: "Ready tasks",
    agentId: f.agent.id,
    prompt: "Complete the ready task.",
    target: { type: "dm" },
    trigger: { type: "event", event: "issue.ready", ...(issueId ? { issueId } : {}) },
  });
}

test("all prerequisites must be completed and an input changed after start remains visible", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  const c = await make("C");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, c.id, a.id);
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, c.id, b.id);
  await readyRoutine(c.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
  await updateIssue(deps(), person(f.owner.id), f.org.id, b.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, c.id))).toHaveLength(1);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "todo" });
  expect((await listIssueDependencies(f.db, person(f.owner.id), f.org.id, c.id)).inputsChanged).toBe(true);
});

test("reopening an input invalidates its queued generation, and completion may release it again", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await readyRoutine();
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  const [state] = await f.db
    .select()
    .from(schema.issueDependencyReadiness)
    .where(eq(schema.issueDependencyReadiness.issueId, b.id));
  await dispatchIssueReady(deps(), f.org.id, { issueId: b.id, generation: required(state).generation });
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "todo" });
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, b.id))).toHaveLength(1);
});

test("editing dependencies or enabling a routine does not retroactively start completed inputs", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await readyRoutine();
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
  const view = await listIssueDependencies(f.db, person(f.owner.id), f.org.id, b.id);
  await removeIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, required(view.dependencies[0]).id);
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
});

test("a routine created after generation cannot consume an older pending signal", async () => {
  f = await setup();
  const input = await make("Input");
  const delivery = await make("Delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, input.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, input.id, { status: "done" });
  await readyRoutine(delivery.id);
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
});

test("a routine resumed after generation cannot consume an older pending signal", async () => {
  f = await setup();
  const input = await make("Input");
  const delivery = await make("Delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, input.id);
  const routine = await readyRoutine(delivery.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, input.id, { status: "done" });
  await setRoutineActive(deps(), f.owner.id, f.org.id, routine.id, false);
  await setRoutineActive(deps(), f.owner.id, f.org.id, routine.id, true);
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(0);
});

test("manual start and a routine cannot start the same dependency task concurrently", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await readyRoutine(b.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  const [state] = await f.db
    .select()
    .from(schema.issueDependencyReadiness)
    .where(eq(schema.issueDependencyReadiness.issueId, b.id));
  await dispatchIssueReady(deps(), f.org.id, { issueId: b.id, generation: required(state).generation });
  const [run] = await f.db.select().from(schema.routineRuns);
  await Promise.allSettled([
    askAgentToImplement(deps(), f.owner.id, f.org.id, b.id, f.agent.id),
    executeRoutineRun(deps(), required(run).id),
  ]);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, b.id))).toHaveLength(1);
});

test("the losing agent in concurrent manual starts cannot replace the running task's assignee", async () => {
  f = await setup();
  const input = await make("Input");
  const delivery = await make("Delivery");
  const other = await createAgent(f.db, f.owner.id, f.org.id, { name: "QA", handle: "qa" }, NEW_AGENT_DEFAULTS);
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, input.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, input.id, { status: "done" });
  await Promise.allSettled([
    askAgentToImplement(deps(), f.owner.id, f.org.id, delivery.id, f.agent.id),
    askAgentToImplement(deps(), f.owner.id, f.org.id, delivery.id, other.id),
  ]);
  const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, delivery.id));
  expect(runs).toHaveLength(1);
  const task = await getIssue(f.db, person(f.owner.id), f.org.id, { id: delivery.id });
  expect(task.assignees.filter((a) => a.type === "agent")).toEqual([{ type: "agent", id: required(runs[0]).agentId }]);
});

test("a saturated routine time slot is recoverable instead of silently dropping readiness", async () => {
  f = await setup();
  const routine = await readyRoutine();
  const at = new Date("2027-03-02T10:00:00Z");
  for (let n = 0; n < 5; n++)
    await f.db.insert(schema.routineRuns).values({
      orgId: f.org.id,
      routineId: routine.id,
      at: new Date(at.getTime() + n),
      trigger: "manual",
      status: "silent",
      finishedAt: at,
    });
  setSystemTime(at);
  try {
    await expect(
      queueIsolatedEventRun(
        deps(),
        { id: routine.id, orgId: f.org.id },
        {
          type: "issue.ready",
          summary: "A task is ready",
          issueId: "not-used",
          generation: "not-used",
        },
        "clock-collision",
      ),
    ).rejects.toThrow();
  } finally {
    setSystemTime();
  }
});

async function startReadyForChannel(restrict = true, report: "always" | "when_new" = "when_new") {
  const input = await make("Input");
  const delivery = await make("Delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, input.id);
  await createRoutine(deps(), f.owner.id, f.org.id, {
    name: "Public progress",
    agentId: f.agent.id,
    prompt: "Work on the ready task.",
    target: { type: "channel", channelId: f.general.id },
    report,
    trigger: { type: "event", event: "issue.ready", issueId: delivery.id },
  });
  await updateIssue(deps(), person(f.owner.id), f.org.id, input.id, { status: "done" });
  const [state] = await f.db
    .select()
    .from(schema.issueDependencyReadiness)
    .where(eq(schema.issueDependencyReadiness.issueId, delivery.id));
  await dispatchIssueReady(deps(), f.org.id, { issueId: delivery.id, generation: required(state).generation });
  const [rr] = await f.db.select().from(schema.routineRuns);
  await executeRoutineRun(deps(), required(rr).id);
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, delivery.id));
  if (!run) throw new Error("Expected a running task");
  const brief = await routineBriefOfRun(f.db, run);
  if (!brief) throw new Error("Expected a routine brief");
  if (restrict)
    await setIssueAudience(deps(), person(f.owner.id), f.org.id, delivery.id, {
      mode: "people",
      userIds: [f.owner.id],
    });
  return { run, brief, delivery };
}

test("a task restricted during execution cannot report its result to the earlier public destination", async () => {
  f = await setup();
  const { run, brief } = await startReadyForChannel();
  const result = await f.db.transaction((tx) => deliverRoutineReport(tx, { run, brief, text: "Private finding" }));
  expect(result).toBeNull();
  const messages = await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.general.id));
  expect(messages.some((m) => m.body.includes("Private finding"))).toBe(false);
});

test("a task restricted during execution cannot create a file in its earlier public destination", async () => {
  f = await setup();
  const { run } = await startReadyForChannel();
  await expect(
    createArtifact(
      f.artifactDeps,
      { type: "agent", agentId: run.agentId, channelId: run.channelId, runId: run.id },
      f.org.id,
      {
        title: "Restricted findings",
        content: { kind: "document", markdown: "Private content" },
      },
    ),
  ).rejects.toMatchObject({ code: "issue.task_destination_private" });
  expect(await f.db.select().from(schema.artifacts)).toHaveLength(0);
});

for (const report of ["always", "when_new"] as const)
  test(`a restricted task's ${report} final record cannot leak into a public routine history`, async () => {
    f = await setup();
    const { run, brief } = await startReadyForChannel(true, report);
    await closeRoutineRun(deps(), run, { status: "done", text: "Private final finding" });
    const [record] = await f.db.select().from(schema.routineRuns).where(eq(schema.routineRuns.id, brief.routineRunId));
    expect(record?.summary).not.toContain("Private final finding");
  });

test("a task restricted during execution cannot append private content to a previously public file", async () => {
  f = await setup();
  const { run, delivery } = await startReadyForChannel(false);
  const actor = { type: "agent" as const, agentId: run.agentId, channelId: run.channelId, runId: run.id };
  const file = await createArtifact(f.artifactDeps, actor, f.org.id, {
    title: "Earlier public draft",
    content: { kind: "table", columns: ["Text"], rows: [["Public draft"]] },
  });
  await setIssueAudience(deps(), person(f.owner.id), f.org.id, delivery.id, { mode: "people", userIds: [f.owner.id] });
  await expect(
    updateArtifact(f.artifactDeps, actor, f.org.id, file.id, {
      baseVersion: 1,
      content: { kind: "table", columns: ["Text"], rows: [["Private revision"]] },
    }),
  ).rejects.toMatchObject({ code: "issue.task_destination_private" });
  const [saved] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, file.id));
  expect(saved?.currentVersion).toBe(1);
});

test("the working prompt names authorized prerequisites but never private input titles or ids in a public destination", async () => {
  let prompt = "";
  f = await setup({
    reply: (request) => {
      prompt = JSON.stringify(request);
      return { chunks: ["Completed"] };
    },
  });
  const hidden = await createIssue(deps(), person(f.owner.id), f.org.id, {
    title: "Private source unique title",
    audience: { mode: "people", userIds: [f.owner.id] },
  });
  const visible = await make("Allowed source unique title");
  const delivery = await make("Public delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, hidden.id);
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, visible.id);
  await createRoutine(deps(), f.owner.id, f.org.id, {
    name: "Publish",
    agentId: f.agent.id,
    prompt: "Use the task references.",
    target: { type: "channel", channelId: f.general.id },
    trigger: { type: "event", event: "issue.ready", issueId: delivery.id },
  });
  await updateIssue(deps(), person(f.owner.id), f.org.id, hidden.id, { status: "done" });
  await updateIssue(deps(), person(f.owner.id), f.org.id, visible.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  expect(prompt).toContain("Task prerequisites");
  expect(prompt).toContain(visible.title);
  expect(prompt).toContain("Unavailable prerequisite");
  expect(prompt).not.toContain(hidden.title);
  expect(prompt).not.toContain(hidden.id);
});

test("a destination that permits a prerequisite does not grant the agent access to that prerequisite", async () => {
  f = await setup();
  const hidden = await createIssue(deps(), person(f.owner.id), f.org.id, {
    title: "Private source",
    audience: { mode: "people", userIds: [f.owner.id] },
  });
  const delivery = await make("Public delivery");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, delivery.id, hidden.id);
  const brief = await issueDependencyBrief(
    f.db,
    { type: "agent", agentId: f.agent.id, channelId: f.general.id },
    f.org.id,
    delivery.id,
    f.general.id,
  );
  expect(brief).toContain("Unavailable prerequisite");
  expect(brief).not.toContain(hidden.title);
  expect(brief).not.toContain(hidden.id);
});

test("a ready-task filter leaves other tasks available for manual work", async () => {
  f = await setup();
  const a = await make("A");
  const b = await make("B");
  const c = await make("C");
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, b.id, a.id);
  await addIssueDependency(deps(), person(f.owner.id), f.org.id, c.id, a.id);
  await readyRoutine(b.id);
  await updateIssue(deps(), person(f.owner.id), f.org.id, a.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, b.id))).toHaveLength(1);
  expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.issueId, c.id))).toHaveLength(0);
});

test("more than twenty simultaneous releases remain durable instead of being truncated by event batching", async () => {
  f = await setup();
  const input = await make("Shared prerequisite");
  const tasks = [];
  for (let n = 0; n < 23; n++) {
    const task = await make(`Delivery ${n}`);
    await addIssueDependency(deps(), person(f.owner.id), f.org.id, task.id, input.id);
    tasks.push(task);
  }
  await readyRoutine();
  await updateIssue(deps(), person(f.owner.id), f.org.id, input.id, { status: "done" });
  await drainOutbox(f.db, f.handlers);
  const runs = await f.db.select().from(schema.agentRuns);
  expect(new Set(runs.map((r) => r.issueId))).toEqual(new Set(tasks.map((t) => t.id)));
  expect(runs).toHaveLength(23);
}, 60_000);
