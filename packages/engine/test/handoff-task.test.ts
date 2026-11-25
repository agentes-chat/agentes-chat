import { afterEach, describe, expect, test } from "bun:test";
import { asc, eq, schema } from "@agenteschat/db";
import {
  type AgentRun,
  consultationsIn,
  createAgent,
  createIssue,
  endWork,
  getIssue,
  insertMessage,
  onConsultedRunFinished,
  openDm,
  postWorkUpdate,
  type ToolContext,
  workView,
} from "../src";
import { handOffTitle } from "../src/works";
import { addMember, type Fixture, setup } from "./fixtures";

/**
 * A hand-off about an existing task (`tell_agent`'s `task`): it shows that task where the person asked and makes no
 * second card, its work never moves or writes on the task, and a task the people there can't see is refused. Work
 * with a card of its own is named by a short action, never by the note's first line with its links.
 */

let f: Fixture;
afterEach(async () => {
  await f?.machineHub?.stop();
  await f?.close();
  f = undefined as unknown as Fixture;
});

const addAgent = (name: string) =>
  createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    { name, handle: name.toLowerCase(), role: "Engineering", credentialId: f.credential.id },
    { model: "claude-sonnet-5-5" },
  );

const person = (userId: string) => ({ type: "person" as const, userId });

/** A run of @dev (the coordinator) on `userId`'s message in their private DM with it. */
async function dmRun(userId: string, body: string) {
  const dm = await openDm(f.db, userId, f.org.id, { agentId: f.agent.id });
  const trigger = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: dm.id,
    author: { type: "person", userId },
    body,
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: dm.id,
      threadRootId: trigger.id,
      triggerMessageId: trigger.id,
      trigger: "dm",
      hop: 1,
      stretchId: trigger.id,
    })
    .returning();
  if (!run) throw new Error("no run");
  return run;
}

const ctxOf = (run: AgentRun): ToolContext => ({
  db: f.db,
  orgId: run.orgId,
  agentId: run.agentId,
  runId: run.id,
  channelId: run.channelId,
  threadRootId: run.threadRootId,
  triggerMessageId: run.triggerMessageId,
});

const tell = (run: AgentRun, agent: string, message: string, more: Record<string, unknown> = {}) => {
  if (!f.tools) throw new Error("no tools");
  return f.tools.invoke(ctxOf(run), {
    toolUseId: `tu_${crypto.randomUUID()}`,
    name: "tell_agent",
    input: { agent, message, ...more },
  });
};

/** What the tool answered (never an approval here). */
const outputOf = (out: Awaited<ReturnType<typeof tell>>) => {
  if (!("output" in out)) throw new Error("expected the tool's output");
  return out.output;
};

const allIssues = () => f.db.select().from(schema.issues).orderBy(asc(schema.issues.number));
const consultations = () => f.db.select().from(schema.agentConsultations);
const works = () => f.db.select().from(schema.agentWorks);
const runOf = async (id: string | null | undefined) => {
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, id ?? ""));
  if (!run) throw new Error("no run");
  return run;
};

/** The handed run ends with `body` as its report, then its hooks run (as the executor does). */
async function reports(run: AgentRun, body: string) {
  const said = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: run.channelId,
    author: { type: "agent", agentId: run.agentId, runId: run.id, hop: run.hop },
    body,
    meta: { workEnd: { id: run.workId, status: "done" } },
  });
  await f.db
    .update(schema.agentRuns)
    .set({ status: "done", replyMessageId: said.id })
    .where(eq(schema.agentRuns.id, run.id));
  const ended = await runOf(run.id);
  await endWork({ db: f.db, pubsub: f.pubsub }, ended, "done");
  await onConsultedRunFinished({ db: f.db, pubsub: f.pubsub, judge: f.context.judge }, ended, "done");
}

const NOTE =
  "Add a closing note to task #1 (https://app.example.com/acme/tasks/1?tab=activity) and close it if the criteria are met.\nCriteria: https://docs.example.com/discovery#criteria";

describe("a hand-off about an existing task", () => {
  test("from a private DM: the task shows on the hand-off, no second card, and the work never moves it", async () => {
    f = await setup({ askAgent: true });
    const atlas = await addAgent("Atlas");
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    const task = await createIssue({ db: f.db }, person(f.owner.id), f.org.id, { title: "Discovery" });
    const dev = await dmRun(bia.id, "@dev have atlas add the closing note to #1 and close it if it's done");

    const out = await tell(dev, "@atlas", NOTE, { task: task.number });
    expect(outputOf(out).isError).toBeUndefined();
    expect(outputOf(out).content).toContain(`task #${task.number}`);

    const [c] = await consultations();
    expect(c?.issueId).toBe(task.id);
    const [w] = await works();
    // One task on the board: the one it is about.
    expect((await allIssues()).map((i) => i.id)).toEqual([task.id]);
    expect(w).toMatchObject({ how: "handed", channelId: dev.channelId, issueId: null });
    // The person's DM shows the work with that task, and the hand-off's row names it.
    expect((await workView(f.db, f.org.id, w?.id ?? ""))?.issue).toEqual({ id: task.id, number: task.number });
    const [listed] = await consultationsIn(f.db, f.org.id, dev.channelId);
    expect(listed?.task).toEqual({ id: task.id, number: task.number, title: "Discovery" });

    // Progress and the result stay in the DM: nothing of the hand-off lands on the task, and its status is the
    // task's own (the handed agent closes it with the task's tools, not by ending its work).
    const run = await runOf(c?.targetRunId);
    await postWorkUpdate({ db: f.db, pubsub: f.pubsub }, run.id, { text: "Drafting the closing note from the DM." });
    await reports(run, "Added the closing note to #1.");
    const after = await getIssue(f.db, person(f.owner.id), f.org.id, { id: task.id });
    expect(after.status).toBe("todo");
    expect(after.backgroundWork ?? null).toBeNull();
    const activity = await f.db
      .select({ text: schema.issueActivity.text })
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, task.id));
    expect(activity.map((a) => a.text).join("\n")).not.toContain("Drafting the closing note");
    expect((await allIssues()).length).toBe(1);
    expect(atlas.id).toBe(run.agentId);
  });

  test("a task the requester can't see is refused, the same as one that doesn't exist", async () => {
    f = await setup({ askAgent: true });
    await addAgent("Atlas");
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    // Limited to the owner: Bia doesn't see it.
    const hidden = await createIssue({ db: f.db }, person(f.owner.id), f.org.id, {
      title: "Acquisition shortlist",
      audience: { mode: "people", userIds: [f.owner.id] },
    });
    const dev = await dmRun(bia.id, "@dev have atlas close #1");

    const refused = await tell(dev, "@atlas", "Close task #1.", { task: hidden.number });
    const missing = await tell(dev, "@atlas", "Close task #99.", { task: 99 });
    expect(outputOf(refused).isError).toBe(true);
    expect(outputOf(refused).content).toContain(`no task #${hidden.number}`);
    // Neither its title nor whether it exists reaches the hand-off.
    expect(outputOf(refused).content).not.toContain("Acquisition");
    expect(outputOf(missing).content).toBe(outputOf(refused).content.replace(`#${hidden.number}`, "#99"));
    expect(await consultations()).toHaveLength(0);
    expect(await works()).toHaveLength(0);
    expect((await allIssues()).map((i) => i.id)).toEqual([hidden.id]);
  });
});

describe("a hand-off with a card of its own", () => {
  test("is named by a short action, and keeps the whole request and its links on the card", async () => {
    f = await setup({ askAgent: true });
    await addAgent("Atlas");
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    const dev = await dmRun(bia.id, "@dev have atlas write up the discovery");
    const note =
      "Add the discovery closing note to the wiki (https://wiki.example.com/q3/discovery?id=7) and link the research.\nSources: https://docs.example.com/research";

    await tell(dev, "@atlas", note);
    const [w] = await works();
    expect(w?.title).toBe("Add the discovery closing note to the wiki and link the research");
    expect(w?.title).not.toContain("http");
    const card = await getIssue(f.db, person(bia.id), f.org.id, { id: w?.issueId ?? "" });
    expect(card.title).toBe(w?.title ?? "");
    expect(card.description).toContain("https://wiki.example.com/q3/discovery?id=7");
    expect(card.description).toContain("https://docs.example.com/research");
  });

  test("takes the sender's title when it gives one", async () => {
    f = await setup({ askAgent: true });
    await addAgent("Atlas");
    const dev = await dmRun(f.owner.id, "@dev have atlas do it");
    await tell(dev, "@atlas", NOTE.replace("task #1", "the discovery page"), {
      title: "Add the discovery closing note",
    });
    const [w] = await works();
    expect(w?.title).toBe("Add the discovery closing note");
    const [listed] = await consultationsIn(f.db, f.org.id, dev.channelId);
    expect(listed).toMatchObject({ title: "Add the discovery closing note", task: null });
  });

  test("handOffTitle drops links and markup and stops at the first sentence", () => {
    expect(handOffTitle(NOTE)).toBe("Add a closing note to task #1 and close it if the criteria are met");
    expect(handOffTitle("## Deploy\n- Roll out [the new build](https://ci.example.com/b/9) to staging")).toBe("Deploy");
    expect(handOffTitle("https://example.com/only-a-link")).toBe("");
    const long = handOffTitle(`Investigate ${"why the nightly export keeps timing out ".repeat(4)}`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
