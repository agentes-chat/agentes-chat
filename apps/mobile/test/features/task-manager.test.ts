import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EndedTask, ManagedTask } from "@agenteschat/client";
import {
  causeWords,
  computerRoomText,
  computersBesides,
  endedText,
  returnCanceledText,
  returnPlace,
  shownCauses,
  taskWaitGroups,
  taskWaitGroupText,
} from "@agenteschat/client/lib/task-manager";
import {
  agentTasksHref,
  agentTasksOf,
  busyComputers,
  doneTodayOf,
  groupLine,
  isHere,
  requestWords,
  rowState,
  taskHref,
  taskLine,
  taskSection,
  taskStateWords,
  taskStepLines,
  tasksBadge,
  tasksByState,
} from "../../src/features/task-manager/logic";
import { pushedByDefault } from "../main-stack";
import { translator } from "./fixtures";

const task = (over: Partial<ManagedTask> & { runId: string }): ManagedTask => ({
  agentId: "dev",
  channelId: "dm1",
  channelKind: "dm",
  channelName: null,
  threadId: null,
  status: "running",
  startedAt: null,
  createdAt: "2026-11-02T14:00:00.000Z",
  label: null,
  background: false,
  routine: null,
  plan: null,
  requester: null,
  brain: "model",
  machine: null,
  now: null,
  steps: 0,
  pendingMessageIds: [],
  canStop: true,
  ...over,
});

const ended = (over: Partial<EndedTask> & { runId: string }): EndedTask => ({
  agentId: "dev",
  channelId: "c1",
  channelKind: "channel",
  channelName: "produto",
  threadId: null,
  status: "done",
  label: "Revisar o PR #231",
  background: false,
  routine: null,
  startedAt: "2026-11-02T13:00:00.000Z",
  finishedAt: "2026-11-02T13:20:00.000Z",
  stoppedBy: null,
  ...over,
});

const NONE: ReadonlySet<string> = new Set();

describe("a task's row (ADR 0128)", () => {
  test("its state: working, waiting on an ok or an answer, queued, and stopping once asked here", async () => {
    const t = await translator("pt-BR");
    const said = (over: Partial<ManagedTask>, stopping = NONE) =>
      taskStateWords(t, "pt-BR", task({ runId: "r1", ...over }), rowState(task({ runId: "r1", ...over }), stopping), 0)
        .state;
    expect(said({ status: "running" })).toBe("Trabalhando");
    expect(said({ status: "waiting_approval" })).toBe("Esperando você");
    expect(said({ status: "waiting_input" })).toBe("Espera resposta");
    expect(said({ status: "queued" })).toBe("Na fila");
    expect(said({ status: "waiting_approval" }, new Set(["r1"]))).toBe("Parando…");
  });

  test("an agent's row: how its tasks stand, or queued when they only wait their turn", async () => {
    const t = await translator("pt-BR");
    expect(groupLine(t, { working: 1, waiting: 1 })).toEqual({
      mark: "working",
      text: "1 trabalhando · 1 espera você",
    });
    expect(groupLine(t, { working: 0, waiting: 2 })).toEqual({ mark: "waiting", text: "2 esperam você" });
    expect(groupLine(t, { working: 0, waiting: 0 })).toEqual({ mark: "queued", text: "Na fila" });
    expect(groupLine(t, { working: 0, waiting: 0 }, "Pausada: plano a 95% da semana").text).toBe(
      "Pausada: plano a 95% da semana",
    );
  });
});

describe("by how each stands (direction A)", () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, "../../src/features/task-manager", f), "utf8");
  const work = (state: NonNullable<ManagedTask["work"]>["state"], since = "2026-11-02T14:00:00.000Z") => ({
    state,
    since,
    card: null,
  });

  test("sections: waiting on you, at work, later; the server's word first, an older server's by status", () => {
    const by = tasksByState([
      task({ runId: "ok", status: "waiting_approval", work: work("you", "2026-11-02T13:42:00.000Z") }),
      task({ runId: "ask", status: "waiting_input", work: work("you", "2026-11-02T13:57:00.000Z") }),
      task({ runId: "run", work: work("working", "2026-11-02T13:50:00.000Z") }),
      task({ runId: "routine", background: true, work: work("working", "2026-11-02T13:58:00.000Z") }),
      task({ runId: "line", status: "queued", work: work("queued") }),
      // Someone else's ok: later, never "Esperando você".
      task({ runId: "theirs", status: "waiting_approval", work: work("approval") }),
      // Held by its plan: the server sends no work.
      task({ runId: "plan", status: "waiting_input", held: "plan", work: null }),
      // An older server: by its status.
      task({ runId: "old", status: "waiting_approval" }),
    ]);
    // Each section's longest standing first.
    expect(by.you.map((x) => x.runId)).toEqual(["ok", "ask", "old"]);
    expect(by.working.map((x) => x.runId)).toEqual(["run", "routine"]);
    expect(by.later.map((x) => x.runId).sort()).toEqual(["line", "plan", "theirs"]);
    expect(taskSection(task({ runId: "o2", status: "running" }))).toBe("working");
    expect(taskSection(task({ runId: "o3", status: "queued" }))).toBe("later");
  });

  test("the second line: what it asks of you, who asked and what it does, or what holds it", async () => {
    const t = await translator("pt-BR");
    const line = (x: ManagedTask, okWhat: string | null = null, stopping = NONE) =>
      taskLine(t, "pt-BR", x, rowState(x, stopping), {
        meId: "me",
        agentName: (id) => (id === "a1" ? "Theo" : undefined),
        now: Date.parse("2026-11-02T14:10:00.000Z"),
        okWhat,
      });
    const ok = task({ runId: "ok", status: "waiting_approval", work: work("you") });
    expect(line(ok)).toEqual({ text: "Quer seu ok", tone: "you" });
    expect(line(ok, "Enviar um e-mail").text).toBe("Quer seu ok · Enviar um e-mail");
    expect(line(task({ runId: "q", status: "waiting_input", work: work("you") }))).toEqual({
      text: "Fez uma pergunta para você",
      tone: "you",
    });
    // At work: the reader's own says only what it does; anyone else's says who asked first.
    expect(line(task({ runId: "w1", requester: { userId: "me", name: "Bia" } }))).toEqual({
      text: "Trabalhando",
      tone: "working",
    });
    expect(line(task({ runId: "w2", requester: { userId: "u2", name: "Bruno Lima" } })).text).toBe(
      "Bruno Lima pediu · trabalhando",
    );
    const handed = task({ runId: "w3", delegation: { agentId: "a1", origin: { kind: "agent" } } });
    expect(line(handed).text).toBe("Theo pediu · trabalhando");
    expect(line(task({ runId: "w4", background: true })).text).toBe("Rotina · trabalhando");
    // Later: faint, in its wait's words; someone else's ok in neutral words.
    expect(line(task({ runId: "l1", status: "queued", work: work("queued") }))).toEqual({
      text: "Na fila",
      tone: "later",
    });
    // The work line's own sentence-start words, never a translation with its first letter changed (ADR 0122).
    expect(line(task({ runId: "l2", status: "waiting_approval", work: work("approval") })).text).toBe(
      "Aguardando aprovação",
    );
    expect(line(ok, null, new Set(["ok"]))).toEqual({ text: "Parando…", tone: "stopping" });
  });

  test("a busy computer is said once over what it holds; the request row says who asked and where", async () => {
    const t = await translator("pt-BR");
    const line = { machineId: "m1", position: 1, of: 2, people: false, estimatedStartAt: null };
    const held = task({ runId: "h", status: "waiting_input", held: "computer_busy", line });
    const computers = [
      { id: "m1", name: "Computador da equipe", working: 1, inLine: 1 },
      { id: "m2", name: "Servidor", working: 0, inLine: 3 },
    ];
    expect(busyComputers([held, task({ runId: "x", status: "queued" })], computers).map((m) => m.id)).toEqual(["m1"]);
    expect(busyComputers([], computers)).toEqual([]);
    const names = (id: string) => (id === "a1" ? "Theo" : undefined);
    const asked = task({ runId: "r", channelKind: "channel", channelName: "vendas" });
    expect(requestWords(t, { ...asked, requester: { userId: "me", name: "Bia" } }, "me", names)).toEqual({
      who: "Você pediu",
      where: "#vendas",
    });
    expect(requestWords(t, { ...asked, requester: { userId: "u2", name: "Bruno Lima" } }, "me", names).who).toBe(
      "Bruno Lima pediu",
    );
    expect(
      requestWords(t, { ...asked, delegation: { agentId: "a1", origin: { kind: "agent" } } }, "me", names).who,
    ).toBe("Theo pediu");
    // Nobody asked by name: its place alone.
    const routine = task({ runId: "rt", background: true, routine: { id: "rt1", name: "Resumo do dia" } });
    expect(requestWords(t, routine, "me", names)).toEqual({ who: "Rotina «Resumo do dia»", where: null });
  });

  test("its steps: each call when it was made, the last one running while it works", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 14, 20, s)).toISOString();
    const data = {
      run: { createdAt: at(0), finishedAt: null },
      steps: [
        { seq: 1, kind: "tool_call", data: { toolUseId: "t1", name: "create_issue", input: {} }, createdAt: at(1) },
        { seq: 2, kind: "tool_result", data: { toolUseId: "t1", content: "ok" }, createdAt: at(2) },
        { seq: 3, kind: "tool_call", data: { toolUseId: "t2", name: "list_issues", input: {} }, createdAt: at(3) },
      ],
    };
    expect(taskStepLines(data, true).map((s) => [s.line.key, s.line.state, s.at])).toEqual([
      ["t1", "done", at(1)],
      ["t2", "run", at(3)],
    ]);
    // Not working (it waits on you, or it ended): the held call stays held.
    expect(taskStepLines(data, false).map((s) => s.line.state)).toEqual(["done", "stop"]);
  });

  test("the list: its large title, the sections, no summary line, no agent groups, no causes block", () => {
    const screen = read("TaskManagerScreen.tsx");
    expect(screen).toContain('title={t("mobile.taskManager.title")}');
    expect(screen).toContain("<TaskSections");
    for (const gone of ["AgentGroup", "taskManager.capacity.label", "shownCauses", "mobile.taskManager.quiet"])
      expect(screen).not.toContain(gone);
    // Agentes' row says the same.
    const agents = readFileSync(join(import.meta.dir, "../../src/features/agents/AgentsScreen.tsx"), "utf8");
    expect(agents).toContain('title={t("mobile.taskManager.title")}');
    const rows = read("rows.tsx");
    for (const key of ["sections.you", "sections.working", "sections.later"])
      expect(rows).toContain(`t("mobile.taskManager.${key}")`);
    // Why "Mais tarde" waits, said once at its top: a busy computer opens its line.
    expect(rows).toContain("onPress={() => openQueue(computer.id)}");
    expect(rows).toContain("<WaitLines tasks={by.later} now={minuteNow} />");
    // "Terminadas hoje" folds by default, remembered on this phone.
    expect(rows).toContain("STORED.taskManagerOpened");
    expect(rows).toContain("collapsed={!endedOpen}");
  });

  test("a row, two lines: the face (its rings at work), the title with its time and a chevron, how it stands", () => {
    const rows = read("rows.tsx");
    expect(rows).toContain(
      '<AgentFace agentId={agentId} size={FACE} mode={working ? "run" : "idle"} live={live} orbit={working} />',
    );
    expect(rows).toMatch(/<Text variant="body" numberOfLines=\{1\} style=\{styles\.grow\}>\s*\{title\}/);
    expect(rows).toContain('<Text variant="small" tone="faint" style={styles.num}>');
    expect(rows).toContain("{chevron ? <Disclosure /> : null}");
    // Hairlines from the words' column: 16 + 40 + 12.
    expect(rows).toContain("faceDivider: { left: 16 + FACE + 12 }");
    expect(rows).toContain("const FACE = 40;");
    // An agent's tasks go without faces (the agent is the title).
    expect(read("AgentTasksScreen.tsx")).toContain("faces={false}");
  });

  test("a task's screen: the title whole, the agent's group, what it asks with Aprovar and Recusar, its steps", () => {
    const page = read("TaskScreen.tsx");
    expect(page).toContain('<Text variant="display2" style={styles.title}>');
    expect(page).toContain('<PushedHeader title="" solid={false} grouped />');
    expect(page).toContain('<AgentFace agentId={agentId} size={36} mode={working ? "run" : "idle"} orbit={working} />');
    expect(page).toContain('<GroupedField label={t("taskManager.now")} stacked>');
    // What it asks: the server's own request and its actions, no new endpoint.
    expect(page).toContain("useApproveNow(a)");
    expect(page).toContain("useRefuseApproval(a)");
    expect(page).toContain('t("mobile.taskManager.approveNote", agentGrammar(name))');
    // Steps as rows of a group, the last few and the rest in place.
    expect(page).toContain("taskStepLines(run.data, live)");
    expect(page).toContain('t("mobile.taskManager.allSteps", { count: lines.length })');
    // "Parar tarefa": a centred red row alone in its group, asked first, its note under it.
    expect(page).toContain("const ask = () => askToStop(t, task, title, name, stop);");
    expect(page).toContain('<GroupedRow label={t("taskManager.actions.stopTask")} danger centered onPress={stop} />');
    expect(page).toContain("{stopNote ? <GroupedFooter>{stopNote}</GroupedFooter> : null}");
    // Its computer's line opens from here.
    expect(page).toContain("onPress={() => openQueue(line)}");
  });

  test("stopping several asks once, in the system's alert: how many and whose, never a card opened in place", () => {
    const list = read("AgentTasksScreen.tsx");
    expect(list).toContain("Alert.alert(");
    expect(list).toContain('text: t("taskManager.confirm.stop", { count: stoppable.length }),');
    expect(list).toContain('t("mobile.taskManager.stopAll", { count: stoppable.length })');
    // The in-place confirmation card it replaced is gone.
    expect(read("parts.tsx")).not.toContain("StopConfirm");
    // A task's time is its clock at work, how long it has waited otherwise: never "82:07:59".
    expect(read("rows.tsx")).toContain("taskTime(t, task, now)");
    expect(read("parts.tsx")).not.toContain("taskClock");
    for (const other of ["TaskManagerScreen.tsx", "TaskScreen.tsx", "AgentTasksScreen.tsx", "AgentTasksButton.tsx"])
      expect(read(other)).not.toContain("doneToday: true");
    expect(read("hooks.ts")).toContain("doneToday: options.doneToday ?? false,");
  });

  test("a list that didn't load says so and offers to try again; a task's screen loads in its rows' shape", () => {
    expect(read("TaskManagerScreen.tsx")).toContain("<LoadFailed onRetry={() => void tasks.refetch()} />");
    expect(read("AgentTasksScreen.tsx")).toContain("<LoadFailed onRetry={() => void query.refetch()} />");
    const page = read("TaskScreen.tsx");
    expect(page).toContain("<SkeletonList rows={3} />");
    expect(page).not.toContain("ActivityIndicator");
  });
});

describe("what ended today", () => {
  test("how each ended, and who stopped it", async () => {
    const t = await translator("pt-BR");
    expect(endedText(t, ended({ runId: "a" }), "me")).toBe("Terminou");
    expect(endedText(t, ended({ runId: "b", status: "failed" }), "me")).toBe("Não conseguiu");
    const byMe = ended({ runId: "c", status: "canceled", stoppedBy: { userId: "me", name: "Bia" } });
    expect(endedText(t, byMe, "me")).toBe("Você parou");
    const byAna = ended({ runId: "d", status: "canceled", stoppedBy: { userId: "ana", name: "Ana" } });
    expect(endedText(t, byAna, "me")).toBe("Ana parou");
    expect(endedText(t, ended({ runId: "e", status: "canceled" }), "me")).toBe("Parada");
    // The right hand stopped it at my word: its name, never "Você parou".
    const byLodi = ended({ runId: "f", status: "canceled", stoppedBy: { userId: "me", name: "Bia", agentId: "lodi" } });
    expect(endedText(t, byLodi, "me", (id) => (id === "lodi" ? "Lodi" : undefined))).toBe("Lodi parou");
  });
});

describe("an agent's tasks, from its DM's header", () => {
  const here = task({ runId: "here", createdAt: "2026-11-02T14:00:00.000Z" });
  const review = task({
    runId: "review",
    channelId: "c1",
    channelKind: "channel",
    channelName: "produto",
    status: "waiting_approval",
    createdAt: "2026-11-02T13:50:00.000Z",
  });
  const routine = task({
    runId: "routine",
    channelId: "room",
    background: true,
    routine: { id: "rt1", name: "Atualizar as dependências" },
    createdAt: "2026-11-02T13:00:00.000Z",
  });
  const other = task({ runId: "other", agentId: "infra", channelId: "c2" });
  const place = { channelId: "dm1", threadId: null };

  test("people's tasks first, then the routines', the ones asked here tagged; how many work, wait, can stop", () => {
    const view = agentTasksOf([here, review, routine, other], "dev", place, NONE);
    expect(view?.rows.map((r) => [r.task.runId, r.here])).toEqual([
      ["review", false],
      ["here", true],
      ["routine", false],
    ]);
    expect(view?.working).toBe(2);
    expect(view?.waiting).toBe(1);
    expect(view?.stoppable).toEqual(["review", "here", "routine"]);
  });

  test("one asked to stop, or one they may not stop, isn't stopped again by 'Parar todas'", () => {
    const view = agentTasksOf([here, { ...review, canStop: false }, routine], "dev", place, new Set(["here"]));
    expect(view?.stoppable).toEqual(["routine"]);
  });

  test("nothing while the agent has no tasks; nothing tagged when opened from nowhere", () => {
    expect(agentTasksOf([other], "dev", place, NONE)).toBeNull();
    expect(agentTasksOf([here], "dev", null, NONE)?.rows.map((r) => r.here)).toEqual([false]);
  });

  test("in a thread, here is that thread; the DM's main timeline is elsewhere", () => {
    const inThread = task({ runId: "thread", threadId: "t1" });
    expect(isHere(inThread, { channelId: "dm1", threadId: "t1" })).toBe(true);
    expect(isHere(here, { channelId: "dm1", threadId: "t1" })).toBe(false);
    const view = agentTasksOf([here, inThread], "dev", { channelId: "dm1", threadId: "t1" }, NONE);
    expect(view?.rows.filter((r) => r.here).map((r) => r.task.runId)).toEqual(["thread"]);
  });

  test("the header's count: the orbit while some work, the waiting mark otherwise, and who waits when both", () => {
    const both = agentTasksOf([here, review], "dev", place, NONE);
    expect(both && tasksBadge(both)).toEqual({ count: 2, mark: "working", waiting: 1, room: 1.9 });
    const waits = agentTasksOf([review], "dev", place, NONE);
    expect(waits && tasksBadge(waits)).toEqual({ count: 1, mark: "ok", waiting: null, room: 1.3 });
    const queued = agentTasksOf([{ ...here, status: "queued" }], "dev", place, NONE);
    expect(queued && tasksBadge(queued).mark).toBe("queued");
  });

  test("'Feitas hoje' counts what the agent finished, not what was stopped or failed", () => {
    const list = [
      ended({ runId: "a" }),
      ended({ runId: "b", status: "canceled" }),
      ended({ runId: "c", status: "failed" }),
      ended({ runId: "d", agentId: "infra" }),
    ];
    expect(doneTodayOf(list, "dev")).toBe(1);
  });

  test("its request opens where it was asked; work another agent handed it, where that was handed off", () => {
    expect(taskHref(task({ runId: "r1", channelId: "c1", threadId: "t1" }))).toBe("/chat/c1?thread=t1");
    // Its own conversation is two agents' DM, which nobody opens; a routine's room neither.
    expect(taskHref(task({ runId: "r2", channelId: "dm-ag", betweenAgents: true }))).toBeNull();
    expect(taskHref(task({ runId: "r3", background: true }))).toBeNull();
    const from = {
      channelId: "c-vendas",
      channelKind: "channel" as const,
      channelName: "vendas",
      threadId: "t9",
      messageId: "m9",
      label: null,
    };
    expect(
      taskHref(
        task({
          runId: "r4",
          channelId: "dm-ag",
          betweenAgents: true,
          delegation: { agentId: "ada", origin: { kind: "agent" }, from },
        }),
      ),
    ).toBe("/chat/c-vendas?thread=t9&m=m9");
  });

  test("its screen knows the conversation it came from", () => {
    expect(agentTasksHref("dev", { channelId: "dm1", threadId: null })).toBe("/agent-tasks/dev?channel=dm1");
    expect(agentTasksHref("dev", { channelId: "dm1", threadId: "t1" })).toBe("/agent-tasks/dev?channel=dm1&thread=t1");
    expect(agentTasksHref("dev", null)).toBe("/agent-tasks/dev");
  });
});

describe("a computer's line (ADR 0128)", () => {
  const now = Date.parse("2026-11-02T14:00:00.000Z");
  const full = { machineId: "m1", position: 2, of: 3, people: false, estimatedStartAt: null };

  test("a task waiting its turn says one line, whatever holds it, its place or its estimate", async () => {
    const t = await translator("pt-BR");
    const inLine = task({ runId: "r1", status: "waiting_input", held: "computer_busy", line: full });
    const words = (x: ManagedTask) => taskStateWords(t, "pt-BR", x, rowState(x, NONE), now);
    const one = { state: "Na fila · começa em seguida", next: null };
    expect(words(inLine)).toEqual(one);
    expect(words({ ...inLine, line: null })).toEqual(one);
    expect(words({ ...inLine, line: { ...full, position: 1, estimatedStartAt: "2026-11-02T14:03:00.000Z" } })).toEqual(
      one,
    );
    expect(words(task({ runId: "r2" })).state).toBe("Trabalhando");
  });

  test("a computer on the task manager: how many wait, or room, and how many run", async () => {
    const t = await translator("pt-BR");
    expect(computerRoomText(t, { working: 3, inLine: 2 })).toBe("2 na fila · 3 trabalhando");
    expect(computerRoomText(t, { working: 1, inLine: 0 })).toBe("Tem espaço · 1 trabalhando");
    expect(computerRoomText(t, { working: 0, inLine: 0 })).toBe("Tem espaço");
  });

  test("what holds the work, in the rows' words: a plan by its wait's return; a turn in line is no cause", async () => {
    const t = await translator("pt-BR");
    const onPlan = (runId: string) =>
      task({
        runId,
        status: "waiting_input",
        held: "plan",
        brain: "claude_code",
        wait: {
          code: "plan_limit",
          key: "plan:m1:claude_code:a1",
          plan: "Claude",
          model: null,
          scope: null,
          percent: null,
          window: null,
          resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
          canContinue: false,
        },
      });
    const inLine = (runId: string) =>
      task({ runId, status: "waiting_input", held: "computer_busy", line: { ...full, machineId: "m1" } });
    const computers = [
      { id: "m1", name: "Computador da equipe", working: 2, inLine: 4 },
      { id: "m2", name: "Servidor", working: 1, inLine: 0 },
    ];
    const causes = shownCauses([onPlan("a"), onPlan("b"), inLine("c")]);
    const [plan, ...rest] = causes.map((c) => causeWords(t, "pt-BR", c, computers));
    expect(plan?.name).toBe("Plano do Claude no limite");
    expect(plan?.fact).toMatch(/^Volta (às|amanhã|\S+ às) .+ · 2 tarefas$/);
    expect(rest).toEqual([]);
    expect(computersBesides(computers, causes).map((c) => c.id)).toEqual(["m1", "m2"]);
  });
});

describe("why a task waits", () => {
  const now = new Date(2026, 10, 5, 10, 0).getTime();
  const resetsAt = new Date(2026, 10, 7, 18, 0).toISOString();
  const wait = {
    code: "usage_pause",
    key: "plan:m1:claude_code:a1",
    plan: "Claude",
    model: null,
    scope: null,
    percent: 95,
    window: "seven_day",
    resetsAt,
    canContinue: true,
  };
  const routine = (runId: string, canContinue: boolean) =>
    task({
      runId,
      status: "waiting_input",
      held: "plan",
      background: true,
      wait: { ...wait, canContinue },
    });

  test("the row says the same as the web's: what holds it, when it's back", async () => {
    const t = await translator("pt-BR");
    const paused = routine("r1", true);
    expect(taskStateWords(t, "pt-BR", paused, rowState(paused, NONE), now)).toEqual({
      state: "Pausada: plano a 95% da semana",
      next: "Volta sáb às 18:00",
    });
  });

  test("the line over rows on the same limit, and who may continue", async () => {
    const t = await translator("pt-BR");
    const [group] = taskWaitGroups([routine("r1", true), routine("r2", false)]);
    if (!group) throw new Error("no group");
    expect(taskWaitGroupText(t, "pt-BR", group, now)).toBe(
      "2 rotinas pausadas: o plano do Claude está em 95% da semana e volta sáb às 18:00. O restante fica para as conversas.",
    );
    expect(group.continuable).toEqual(["r1"]);
  });
});

describe("navigation", () => {
  test("the task manager, a task and an agent's tasks are pushed screens, in the stack", () => {
    for (const route of ["task-manager/index", "task-manager/[runId]", "agent-tasks/[agentId]"])
      expect({ route, pushed: pushedByDefault(route) }).toEqual({ route, pushed: true });
  });
});

describe("returns agents set (Retornos, ADR 0037 addendum)", () => {
  test("where one lands, and how a canceled one ended: by its time, by you, by someone, by the agent", async () => {
    const t = await translator("pt-BR");
    expect(returnPlace(t, { channelKind: "channel", channelName: "vendas" })).toBe("#vendas");
    expect(returnPlace(t, { channelKind: "dm", channelName: null })).toBe("Conversa direta");
    expect(returnPlace(t, { channelKind: "task", channelName: null })).toBeNull();
    expect(returnCanceledText(t, { canceledBy: null }, "u1", "Ada")).toBe("Retorno cancelado");
    expect(returnCanceledText(t, { canceledBy: { kind: "person", userId: "u1", name: "Ana" } }, "u1", "Ada")).toBe(
      "Você cancelou o retorno",
    );
    expect(returnCanceledText(t, { canceledBy: { kind: "person", userId: "u2", name: "Ana" } }, "u1", "Ada")).toBe(
      "Retorno cancelado por Ana",
    );
    expect(returnCanceledText(t, { canceledBy: { kind: "agent", agentId: "a1" } }, "u1", "Ada")).toBe(
      "Retorno cancelado por Ada",
    );
  });

  test("the screen lists them under Mais tarde after its tasks; a tap or a long press opens their whole words", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/features/task-manager/rows.tsx"), "utf8");
    const at = (s: string) => src.indexOf(s);
    const fn = (name: string) => src.slice(at(`function ${name}(`), src.indexOf("\n}\n", at(`function ${name}(`)));
    expect(at("<ReturnRow item={r}")).toBeGreaterThan(at("{rows(by.later)}"));
    // A return's words are cut at the end of its row; a tap shows them whole where a return has no screen of its own
    // (a canceled one shows nowhere else: the conversation has no line for it).
    for (const row of ["ReturnRow", "CanceledReturnRow"]) {
      const code = fn(row);
      expect(code).toContain("title={item.about}");
      expect(code).toContain("chevron={false}");
      expect(code).toContain("onPress={open}");
      expect(code).toContain("<ReturnSheet");
      expect(code).not.toContain("router.push(chatHref(item.channelId, item.threadId)}");
    }
    // A row that opens no screen of its own takes the long press too.
    expect(src).toContain("{...(chevron ? {} : { onLongPress: onPress })}");
    // The same sheet on iOS and Android: her words whole, whose and where, when or how it ended, then its actions.
    expect(src).not.toContain("ActionSheetIOS");
    const sheet = fn("ReturnSheet");
    expect(sheet).toContain("title={item.about}");
    expect(sheet).toMatch(/subtitle=\{`\$\{line\}\\n\$\{when\}`\}/);
    expect(sheet).toContain('label: t("taskManager.actions.open")');
    expect(sheet).toMatch(/"canCancel" in item && item\.canCancel[\s\S]*label: t\("followUps\.cancel"\)/);
    // While it cancels: its spinner, and nothing else to press; done, the sheet closes.
    expect(sheet).toContain("trailing: <ActivityIndicator");
    expect(sheet).toContain("disabled: going");
    expect(sheet).toContain("onSuccess: () => sheet.close()");
  });
});
