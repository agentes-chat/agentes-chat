import type { CentralAgent, CentralState, CentralTask, CentralView } from "@agenteschat/client";

export const STILL_ON: ReadonlySet<CentralState> = new Set([
  "queued",
  "working",
  "quiet",
  "stalled",
  "waiting_you",
  "waiting_other",
]);

/** What says an agent is at work: what the sidebar lights up for. A quiet task is still its work. */
export const AT_WORK: ReadonlySet<CentralState> = new Set(["working", "quiet", "stalled"]);

/** Most urgent first: an agent shows the state of the task that most needs a person. */
const URGENCY: CentralState[] = ["waiting_you", "stalled", "quiet", "working", "waiting_other", "queued"];

export const leadTask = (tasks: CentralTask[]) =>
  URGENCY.flatMap((state) => tasks.filter((t) => t.state === state))[0] ?? null;

export const columnOf = (state: CentralState) =>
  state === "queued"
    ? "queue"
    : state === "working" || state === "quiet"
      ? "doing"
      : state === "waiting_other"
        ? "waiting"
        : state === "waiting_you" || state === "stalled" || state === "failed"
          ? "attention"
          : "ended";

export const COLUMNS = ["attention", "doing", "waiting", "queue", "ended"] as const;

export const TONE: Record<CentralState, "ok" | "warn" | "danger" | "muted" | "live"> = {
  queued: "muted",
  working: "live",
  quiet: "warn",
  stalled: "danger",
  waiting_you: "warn",
  waiting_other: "muted",
  done: "ok",
  failed: "danger",
  stopped: "muted",
};

export function workingAgents(view: CentralView | undefined): ReadonlySet<string> {
  return new Set((view?.tasks ?? []).filter((t) => AT_WORK.has(t.state)).map((t) => t.agentId));
}

export const tasksOfAgent = (view: CentralView, agent: Pick<CentralAgent, "id">) =>
  view.tasks.filter((t) => t.agentId === agent.id);

/** "agora", "3 min", "2 h", "4 d". */
export function shortAgo(at: string | null, nowMs: number, nowWord: string): string {
  if (!at) return "";
  const min = Math.floor((nowMs - Date.parse(at)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return nowWord;
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / (24 * 60))} d`;
}
