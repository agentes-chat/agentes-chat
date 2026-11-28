import type { ComputerSummary, EndedTask, ManagedTask, TaskSteps } from "@agenteschat/client";
import { activityVerb } from "@agenteschat/client/lib/activity";
import { capitalize } from "@agenteschat/client/lib/format";
import {
  type AgentTasks,
  endedState,
  linePlace,
  taskProgram,
  taskState,
  tasksOf,
  taskWaitWords,
  taskWhere,
  waitsFor,
  waitsOnPerson,
} from "@agenteschat/client/lib/task-manager";
import { type ToolLine, toolItemsSaved, workFromSteps } from "@agenteschat/client/lib/work";
import type { TFunction } from "i18next";
import { type AppHref, chatHref } from "../links/logic";

/**
 * What the phone's task manager says (ADR 0128): its list, a task's screen, an agent's tasks screen and the count in
 * its DM's header, from the shared model (`@agenteschat/client/lib/task-manager`).
 */

/** A conversation: a channel's (or a DM's) main timeline, or one of its threads. */
export interface Place {
  channelId: string;
  threadId: string | null;
}

/** A task asked in this conversation: its main timeline, or this thread. */
export const isHere = (task: Pick<ManagedTask, "channelId" | "threadId">, place: Place) =>
  task.channelId === place.channelId && (task.threadId ?? null) === place.threadId;

/** `held`: it waits on no person but on its computer (full or away), its plan's limit or the budget (`held`). */
export type RowState = "working" | "ok" | "answer" | "queued" | "stopping" | HeldState;
export type HeldState = "computerBusy" | "computerOffline" | "plan" | "budget";

const HELD: Record<NonNullable<ManagedTask["held"]>, HeldState> = {
  computer_busy: "computerBusy",
  computer_offline: "computerOffline",
  plan: "plan",
  budget: "budget",
};

/** A task's state on its row: one asked to stop here says so until it leaves the list. */
export function rowState(
  task: Pick<ManagedTask, "runId" | "status" | "held">,
  stopping: ReadonlySet<string>,
): RowState {
  if (stopping.has(task.runId)) return "stopping";
  const state = taskState(task);
  if (state !== "waiting") return state;
  const wait = waitsFor(task);
  if (wait === "ok" || wait === "answer" || wait === null) return wait ?? "answer";
  return HELD[wait];
}

/** It waits on no person (a computer, a plan, a budget): grey, not "espera você". */
export const isHeld = (state: RowState): state is HeldState =>
  state === "computerBusy" || state === "computerOffline" || state === "plan" || state === "budget";

/**
 * A task's state on its row: a wait says what holds it and what comes next ("Pausada: plano a 99% da semana", "Volta
 * sáb às 18:00"; "Na fila · 2º", "começa em ~3 min").
 */
export function taskStateWords(
  t: TFunction,
  locale: string,
  task: Pick<ManagedTask, "status" | "held" | "line" | "wait">,
  state: RowState,
  now: number,
): { state: string; next: string | null } {
  if (state === "working") return { state: t("taskManager.state.working"), next: null };
  if (state === "queued") return { state: t("taskManager.state.queued"), next: null };
  if (state === "stopping") return { state: t("taskManager.state.stopping"), next: null };
  return taskWaitWords(t, locale, task, now) ?? { state: t("taskManager.state.answer"), next: null };
}

/**
 * An agent's row: "1 trabalhando · 1 espera você"; with nothing of that, `held`, what holds its tasks ("Pausada: plano
 * a 95% da semana"), or "Na fila" while they only wait their turn.
 */
export function groupLine(t: TFunction, group: Pick<AgentTasks, "working" | "waiting">, held?: string | null) {
  const parts = [
    group.working > 0 ? t("taskManager.working", { count: group.working }) : null,
    group.waiting > 0 ? t("taskManager.waiting", { count: group.waiting }) : null,
  ].filter((p): p is string => Boolean(p));
  const mark: "working" | "waiting" | "queued" =
    group.working > 0 ? "working" : group.waiting > 0 ? "waiting" : "queued";
  return { mark, text: parts.length > 0 ? parts.join(" · ") : (held ?? t("taskManager.state.queued")) };
}

/** One agent's tasks now: its DM header's count and its tasks screen (ADR 0128). */
export interface AgentTaskView {
  /** People's first, then its routines', oldest first; `here`: asked in the conversation it was opened from. */
  rows: { task: ManagedTask; here: boolean }[];
  /** How many work now. */
  working: number;
  /** How many wait on a person. */
  waiting: number;
  /** "Parar todas": every task one may stop that isn't stopping yet. */
  stoppable: string[];
}

/** An agent's tasks, or null while it has none; `here` tags the ones asked in that conversation. */
export function agentTasksOf(
  tasks: readonly ManagedTask[],
  agentId: string,
  here: Place | null,
  stopping: ReadonlySet<string>,
): AgentTaskView | null {
  const mine = tasksOf([...tasks], agentId);
  if (mine.length === 0) return null;
  return {
    rows: mine.map((task) => ({ task, here: here !== null && isHere(task, here) })),
    working: mine.filter((task) => taskState(task) === "working").length,
    waiting: mine.filter((task) => waitsOnPerson(task)).length,
    stoppable: mine.filter((task) => task.canStop && !stopping.has(task.runId)).map((task) => task.runId),
  };
}

/** "Feitas hoje" on an agent's tasks screen: what it finished today (stopped and failed ones aren't done). */
export const doneTodayOf = (ended: readonly EndedTask[], agentId: string) =>
  ended.filter((e) => e.agentId === agentId && endedState(e) === "done").length;

/** An agent's tasks screen, opened from a conversation (its tasks there are tagged "aqui"). */
export function agentTasksHref(agentId: string, from: Place | null) {
  if (!from) return `/agent-tasks/${agentId}` as const;
  const thread = from.threadId ? `&thread=${from.threadId}` : "";
  return `/agent-tasks/${agentId}?channel=${from.channelId}${thread}` as const;
}

/**
 * Where a task's request row opens: work another agent handed it, where it was handed off, at the reply that handed it
 * (ADR 0084 addendum), as on the web; else its own conversation. Null: a routine's room or a conversation only agents
 * are in, which nobody opens.
 */
export function taskHref(
  task: Pick<ManagedTask, "channelId" | "threadId" | "background" | "betweenAgents"> & {
    delegation?: ManagedTask["delegation"];
  },
): AppHref | null {
  const from = task.delegation?.from;
  if (from) return chatHref(from.channelId, from.threadId, from.messageId);
  return task.background || task.betweenAgents ? null : chatHref(task.channelId, task.threadId);
}

/**
 * What an agent's DM header shows of its tasks: how many there are, and how many wait on you when some also work; its
 * mark is the orbit while some work, else the waiting mark (or queued). `room` is its width in the bar's buttons (44
 * points each), which the conversation's title gives up.
 */
export function tasksBadge(view: Pick<AgentTaskView, "rows" | "working" | "waiting">) {
  const both = view.working > 0 && view.waiting > 0;
  const mark: RowState = view.working > 0 ? "working" : view.waiting > 0 ? "ok" : "queued";
  return { count: view.rows.length, mark, waiting: both ? view.waiting : null, room: both ? 1.9 : 1.3 };
}

// ── Sections by state (the task manager and an agent's tasks) ───────────────────────────────────────────────────────

/**
 * Where a task stands for the reader: waiting on them (`you`), at work (`working`), or later (in line, held by its
 * computer, its plan or its budget, or waiting on someone else). The server's own word for it (`work`, ADR 0084
 * addendum) when it sends one: null there is a wait on a plan or a budget; an older server's task goes by its status.
 */
export type TaskSection = "you" | "working" | "later";

export function taskSection(task: Pick<ManagedTask, "status" | "held" | "work">): TaskSection {
  if (task.work !== undefined) {
    const state = task.work?.state;
    return state === "you" ? "you" : state === "working" ? "working" : "later";
  }
  if (waitsOnPerson(task)) return "you";
  return taskState(task) === "working" ? "working" : "later";
}

/** The sections' tasks. */
export interface TasksByState {
  you: ManagedTask[];
  working: ManagedTask[];
  later: ManagedTask[];
}

/** Since when a task stands as it does: its state's own time when the server sends it. */
const standsSince = (task: Pick<ManagedTask, "work" | "startedAt" | "createdAt">) =>
  Date.parse(task.work?.since ?? task.startedAt ?? task.createdAt);

/** The tasks in their sections, each section's longest standing first (what has waited or worked longest leads). */
export function tasksByState(tasks: readonly ManagedTask[]): TasksByState {
  const by: TasksByState = { you: [], working: [], later: [] };
  for (const task of [...tasks].sort((a, b) => standsSince(a) - standsSince(b))) by[taskSection(task)].push(task);
  return by;
}

/** The computers whose line holds some of these tasks: "Mais tarde" says once that each is busy. */
export function busyComputers(tasks: readonly ManagedTask[], computers: readonly ComputerSummary[]) {
  const held = new Set(tasks.flatMap((task) => linePlace(task)?.machineId ?? []));
  return computers.filter((m) => held.has(m.id));
}

/** What it does now, in a few words ("consultando o GitHub"); "trabalhando" before its first step. */
export function taskDoing(t: TFunction, task: Pick<ManagedTask, "brain" | "now" | "status">): string {
  const program = taskProgram(task);
  const inner = program.kind === "brain" ? program.inner : program;
  return inner && inner.kind !== "none" && inner.kind !== "brain"
    ? activityVerb(t, inner.activity)
    : t("chat.activity.thinking");
}

/** What it does now, whole, for a task's screen: the words and what they are about ("Usando o navegador · loja.com"). */
export function taskNowWords(t: TFunction, locale: string, task: Pick<ManagedTask, "brain" | "now" | "status">) {
  const program = taskProgram(task);
  const inner = program.kind === "brain" ? program.inner : program;
  const detail = inner && inner.kind !== "none" ? inner.detail : null;
  return [capitalize(taskDoing(t, task), locale), detail].filter(Boolean).join(" · ");
}

/** Who asked, when it wasn't the reader: "Theo pediu", "Ana pediu", "Rotina"; null for the reader's own. */
export function askedBy(
  t: TFunction,
  task: Pick<ManagedTask, "background" | "requester" | "delegation">,
  meId: string | null,
  agentName: (id: string) => string | undefined,
): string | null {
  if (task.background) return t("mobile.taskManager.routine");
  const agent = task.delegation ? agentName(task.delegation.agentId) : undefined;
  if (agent) return t("taskManager.askedBy", { name: agent });
  if (task.requester && task.requester.userId !== meId) return t("taskManager.askedBy", { name: task.requester.name });
  return null;
}

/** How a task's second line reads: amber while it waits on the reader, the agent's at work, faint later. */
export type LineTone = "you" | "working" | "later" | "stopping";

/**
 * A task's second line, how it stands: "Quer seu ok · Enviar um e-mail" (`okWhat`: the request's words, once loaded) or
 * "Fez uma pergunta para você"; at work, who asked when it wasn't the reader and what it does now ("Theo pediu ·
 * desenhando a capa", "Rotina · escrevendo o resumo"); later, what holds it and what comes next ("Na fila").
 */
export function taskLine(
  t: TFunction,
  locale: string,
  task: ManagedTask,
  state: RowState,
  opts: {
    meId: string | null;
    agentName: (id: string) => string | undefined;
    now: number;
    okWhat?: string | null;
  },
): { text: string; tone: LineTone } {
  if (state === "stopping") return { text: t("taskManager.state.stopping"), tone: "stopping" };
  const section = taskSection(task);
  if (section === "you") {
    if (task.status === "waiting_input") return { text: t("mobile.taskManager.asked"), tone: "you" };
    return { text: [t("mobile.taskManager.wantsOk"), opts.okWhat].filter(Boolean).join(" · "), tone: "you" };
  }
  if (section === "working") {
    const who = askedBy(t, task, opts.meId, opts.agentName);
    const doing = taskDoing(t, task);
    return { text: who ? `${who} · ${doing}` : capitalize(doing, locale), tone: "working" };
  }
  // Someone else's ok or answer: never "Esperando você".
  const theirs = task.work?.state;
  const other = theirs === "approval" || theirs === "answer" ? theirs : null;
  // The work line's own sentence-start words ("Esperando aprovação"), as each language writes them.
  if (other)
    return { text: t(other === "approval" ? "work.status.wait.approval" : "work.status.wait.answer"), tone: "later" };
  const words = taskStateWords(t, locale, task, state, opts.now);
  return { text: [words.state, words.next].filter(Boolean).join(" · "), tone: "later" };
}

/**
 * A task's steps as its screen lists them, oldest first: each call's line and when it was made (null where the run's
 * record has no time for it). While the task works its last call is the one running.
 */
export function taskStepLines(data: TaskSteps, live: boolean): { line: ToolLine; at: string | null }[] {
  const made = new Map<string, string>();
  for (const s of data.steps)
    if (s.kind === "tool_call")
      made.set(typeof s.data.toolUseId === "string" ? s.data.toolUseId : `${s.seq}`, s.createdAt);
  const lines = toolItemsSaved(workFromSteps(data.steps, data.run)).flatMap((i) => (i.kind === "call" ? [i.line] : []));
  const last = lines.length - 1;
  return lines.map((line, i) => ({
    line: live && i === last && line.state === "stop" ? { ...line, state: "run" as const } : line,
    at: made.get(line.key) ?? null,
  }));
}

/**
 * A task's "Pedido" row: who asked ("Você pediu", "Bruno Lima pediu", "Theo pediu") and where ("#vendas"); work nobody
 * asked by name (a routine's, an event's) is said by its place alone.
 */
export function requestWords(
  t: TFunction,
  task: Pick<ManagedTask, "routine" | "channelKind" | "channelName" | "betweenAgents" | "background"> & {
    requester?: ManagedTask["requester"];
    delegation?: ManagedTask["delegation"];
  },
  meId: string | null,
  agentName: (id: string) => string | undefined,
): { who: string; where: string | null } {
  const where = taskWhere(t, task);
  const agent = task.delegation ? agentName(task.delegation.agentId) : undefined;
  const who = agent
    ? t("taskManager.askedBy", { name: agent })
    : task.requester
      ? task.requester.userId === meId
        ? t("taskManager.askedByYou")
        : t("taskManager.askedBy", { name: task.requester.name })
      : null;
  return who ? { who, where } : { who: where, where: null };
}
