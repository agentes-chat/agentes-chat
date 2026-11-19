import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import {
  activeRunsIn,
  type Judge,
  type JudgeAnswer,
  type JudgeRequest,
  postPersonMessage,
  STEER_SURE,
  type SteerHandling,
  steerHandling,
  stopChecksSettled,
  type TalkerInput,
  talkerPolicy,
} from "../src";
import { RUN_INTERRUPT_TOPIC } from "../src/cancel";
import { releaseInbox, stoppedToSend, takeInbox } from "../src/run-inbox";
import type { AgentRun } from "../src/runs";
import { answerSteering, type Fixture, setup } from "./fixtures";

/**
 * The triage of a message a person sends an agent while it works for them (ADR 0112 addendum): one judgment says how
 * the agent takes it, and the engine does that: a stop, a correction now, a separate request after the task, a quick
 * reply at once, or the next pause as before.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

/** A judge that answers the triage with `answer` and records what it was asked. */
function asking(answer: JudgeAnswer | undefined) {
  const seen: JudgeRequest[] = [];
  const judge: Judge = {
    name: "fake",
    ask: async (request): Promise<Record<string, JudgeAnswer>> => {
      seen.push(request);
      return answer ? { handling: answer } : {};
    },
  };
  return { judge, seen };
}

describe("steerHandling", () => {
  const input = { orgId: "o", text: "não é outubro, é setembro", agentName: "Dev", task: "Relatório de outubro" };

  test("the way the judge is sure of, with what the agent works on", async () => {
    const sure = asking({ choice: "interrupt", probabilities: { interrupt: 0.82, add: 0.18 } });
    expect(await steerHandling(sure.judge, input)).toBe("interrupt");
    expect(sure.seen[0]).toMatchObject({
      kind: "steer_triage",
      state: { agent: "Dev", task_in_progress: "Relatório de outubro", message: "não é outubro, é setembro" },
    });
    const question = sure.seen[0]?.questions.handling as { type: string; criteria: Record<string, string> };
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria)).toEqual(["stop", "interrupt", "add", "answer", "queue"]);
  });

  test("anything it isn't sure of, or doesn't say, is read at the next pause, as before", async () => {
    const unsure = asking({ choice: "queue", probabilities: { queue: STEER_SURE - 0.01, add: 0.41 } });
    expect(await steerHandling(unsure.judge, input)).toBe("add");
    expect(await steerHandling(asking(undefined).judge, input)).toBe("add");
    expect(await steerHandling(asking({ choice: "dance", probabilities: { dance: 1 } }).judge, input)).toBe("add");
  });

  test("without the task it says the agent is at work; nothing written asks nothing", async () => {
    const bare = asking({ choice: "stop", probabilities: { stop: 0.9 } });
    expect(await steerHandling(bare.judge, { ...input, text: "para", task: null })).toBe("stop");
    expect(bare.seen[0]?.state).toEqual({ agent: "Dev", agent_is_working_on_a_task: true, message: "para" });
    const none = asking({ choice: "stop", probabilities: { stop: 1 } });
    expect(await steerHandling(none.judge, { ...input, text: "  " })).toBe("add");
    expect(none.seen).toHaveLength(0);
  });
});

test("the fast reply answers a quick question or a separate request at once, even from a task that reads soon", () => {
  const at = new Date("2026-11-18T12:00:00Z");
  const base = {
    run: { status: "running" as const, background: false, startedAt: new Date(at.getTime() - 5_000) },
    brain: "model",
    message: { body: "tá funcionando?", createdAt: at },
    waited: null,
    lastActivityAt: new Date(at.getTime() - 2_000),
    lastReplyAt: null,
    now: at,
  };
  expect(talkerPolicy(base)).toBe("reads_soon");
  expect(talkerPolicy({ ...base, handling: "add" })).toBe("reads_soon");
  expect(talkerPolicy({ ...base, handling: "answer" })).toBeNull();
  expect(talkerPolicy({ ...base, handling: "queue" })).toBeNull();
  // Still one fast reply per run in its window, and never for background work.
  expect(talkerPolicy({ ...base, handling: "answer", lastReplyAt: new Date(at.getTime() - 5_000) })).toBe(
    "rate_limited",
  );
  expect(talkerPolicy({ ...base, run: { ...base.run, background: true }, handling: "answer" })).toBe("background");
});

describe("a message sent while the agent works", () => {
  const deps = () => ({ db: f.db, pubsub: f.pubsub });
  const runs = () => f.db.select().from(schema.agentRuns);
  const runById = async (id: string) => (await runs()).find((r) => r.id === id);

  /** The triage as the judge says it, by the message's words (anything else: nothing said). */
  const triage = (by: Record<string, SteerHandling>): Judge => ({
    name: "fake",
    ask: async (request): Promise<Record<string, JudgeAnswer>> => {
      const way = request.kind === "steer_triage" ? by[String(request.state.message)] : undefined;
      return way ? { handling: { choice: way, probabilities: { [way]: 0.9 } } } : {};
    },
  });

  /** The agent at work on a person's request (`brain`: what it thinks with); its thread takes what they send next. */
  async function working(brain: "model" | "claude_code" = "model") {
    f = await setup();
    const question = await postPersonMessage(deps(), f.owner.id, f.org.id, f.general.id, {
      body: "@dev monta o relatório de outubro",
    });
    const [run] = await runs();
    if (!run) throw new Error("no run");
    await f.db
      .update(schema.agentRuns)
      .set({ status: "running", ...(brain === "model" ? {} : { brain }) })
      .where(eq(schema.agentRuns.id, run.id));
    return { run, threadId: question.id };
  }

  /** Sends `body` into the agent's thread with this judge (and a talker that records what it is handed). */
  async function send(threadId: string, body: string, judge: Judge) {
    const talked: TalkerInput[] = [];
    const sent = await postPersonMessage(
      { ...deps(), judge, talker: { consider: async (input) => void talked.push(input) } },
      f.owner.id,
      f.org.id,
      f.general.id,
      { body, threadId },
    );
    await stopChecksSettled();
    return { sent, talked };
  }

  test('"para" stops the task', async () => {
    const { run, threadId } = await working();
    await send(threadId, "para", triage({ para: "stop" }));
    expect((await runById(run.id))?.status).toBe("canceled");
  });

  test("a correction cuts the model call for it", async () => {
    const { run, threadId } = await working();
    const cut: unknown[] = [];
    f.pubsub.subscribe(RUN_INTERRUPT_TOPIC, (event) => void cut.push(event));
    const { sent } = await send(
      threadId,
      "não é outubro, é setembro",
      triage({ "não é outubro, é setembro": "interrupt" }),
    );
    expect(cut).toEqual([{ type: "run.interrupt", runId: run.id, messageId: sent.id }]);
    expect((await runById(run.id))?.pendingMessageIds).toContain(sent.id);
  });

  test("a quick question gets the fast reply at once; the task still reads it at its next pause", async () => {
    const { run, threadId } = await working();
    const { sent, talked } = await send(threadId, "tá funcionando?", triage({ "tá funcionando?": "answer" }));
    expect(talked.map((t) => [t.message.id, t.handling])).toEqual([[sent.id, "answer"]]);
    expect((await runById(run.id))?.pendingMessageIds).toContain(sent.id);
  });

  test("a separate request waits for the task's end, then gets a run of its own", async () => {
    const { run, threadId } = await working();
    const body = "depois vê por que o deploy de ontem falhou";
    const { sent, talked } = await send(threadId, body, triage({ [body]: "queue" }));
    const held = (await runById(run.id)) as AgentRun;
    expect(held.pendingMessageIds).not.toContain(sent.id);
    expect(held.afterMessageIds).toEqual([sent.id]);
    // What the apps read on load still counts it unread: a reload never says the agent read it.
    const listed = (await activeRunsIn(f.db, f.org.id, f.general.id)).find((r) => r.runId === run.id);
    expect(listed?.pendingMessageIds).toContain(sent.id);
    // The task's next step never reads it; the fast reply hears it comes after the task.
    expect(await takeInbox(f.db, run.id)).toEqual([]);
    expect(talked.map((t) => t.handling)).toEqual(["queue"]);
    // The task ends: the request goes on to a run of its own.
    await f.db
      .update(schema.agentRuns)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(schema.agentRuns.id, run.id));
    const handed = await releaseInbox(f.db, f.pubsub, held, { reason: "done" });
    expect(handed?.messageIds).toEqual([sent.id]);
    expect(handed?.runId).not.toBe(run.id);
    expect((await runById(run.id))?.afterMessageIds).toEqual([]);
  });

  test("anything else is read at the next pause, as before", async () => {
    const { run, threadId } = await working();
    const { sent, talked } = await send(threadId, "inclui o gráfico por região", triage({}));
    expect((await runById(run.id))?.pendingMessageIds).toContain(sent.id);
    expect((await runById(run.id))?.afterMessageIds).toEqual([]);
    expect(talked.map((t) => t.handling)).toEqual(["add"]);
  });

  test("a computer brain never gets a separate request in its turn: it waits for the task's end", async () => {
    const { run, threadId } = await working("claude_code");
    const live = answerSteering(f, (await runById(run.id)) as AgentRun);
    try {
      const body = "quando terminar, traduz pra inglês";
      const { sent } = await send(threadId, body, triage({ [body]: "queue" }));
      expect((await runById(run.id))?.afterMessageIds).toEqual([sent.id]);
    } finally {
      live.close();
    }
  });

  test("a correction to a computer brain whose turn can't take it now stops the task to start again from it", async () => {
    const { run, threadId } = await working("claude_code");
    const live = answerSteering(f, (await runById(run.id)) as AgentRun);
    try {
      const body = "espera, é a branch main";
      const { sent } = await send(threadId, body, triage({ [body]: "interrupt" }));
      const stopped = (await runById(run.id)) as AgentRun;
      expect(stopped.status).toBe("canceled");
      expect((await stoppedToSend(f.db, stopped))?.id).toBe(sent.id);
    } finally {
      live.close();
    }
  });
});
