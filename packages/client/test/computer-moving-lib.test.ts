import { expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import type { ComputerQueue, ManagedTask, TaskWait } from "../src/api/types";
import { type AgentComputerFacts, entryLine, entryPortrait, entryState } from "../src/lib/agent-computer";
import { queueStatusText, queueView } from "../src/lib/computer-queue";
import { statusLook, statusPill, statusSentence } from "../src/lib/devices";
import { waitCardState } from "../src/lib/machine-outages";
import { taskWaitWords } from "../src/lib/task-manager";

/** The workspace's own computer away while it moves to another server: every place says so, never "offline". */

const i18n = i18next.createInstance();
void i18n.init({ lng: "en", fallbackLng: "en", resources, initAsync: false, interpolation: { escapeValue: false } });
const t = i18n.t as TFunction;
const MOVING = "Moving to a new server… back in a few minutes";

const away = { name: "Acme's computer", online: false, lastSeenAt: "2026-11-24T06:28:00.000Z", paused: null };
const facts = (moving: boolean): AgentComputerFacts => ({
  edition: "cloud",
  held: false,
  setup: null,
  machine: { ...away, moving },
  desktop: null,
  browser: false,
  browserGranted: true,
  handoff: null,
  userId: "me",
  working: false,
});
const words = { edition: "cloud", locale: "en", computer: away.name, lastSeenAt: away.lastSeenAt } as const;
const line = (moving: boolean) =>
  entryLine(t, entryState(facts(moving)), { ...words, person: () => "", step: null, emailPromised: false });

test("the agent's computer entry: moving, dimmed, where it would say it isn't answering", () => {
  expect(entryState(facts(true))).toEqual({ kind: "moving" });
  expect(line(true)).toBe(MOVING);
  expect(entryPortrait(entryState(facts(true)), null)).toBe("paused");
  expect(entryState(facts(false))).toEqual({ kind: "offline" });
  expect(line(false)).not.toBe(MOVING);
});

test("the device's pill and line", () => {
  const s = { kind: "moving", since: "2026-11-24T06:28:00.000Z" } as const;
  expect(statusPill(t, s)).toBe("Moving servers");
  expect(statusSentence(t, "en", s)).toBe(MOVING);
  expect(statusLook(s)).toBe("preparing");
});

test("a task waiting for it says it moves, back by itself", () => {
  const wait: TaskWait = {
    code: "machine_offline",
    key: null,
    plan: null,
    model: null,
    scope: null,
    percent: null,
    window: null,
    resetsAt: null,
    canContinue: false,
  };
  const task = (w: TaskWait) =>
    ({ runId: "r1", status: "waiting_input", held: "computer_offline", line: null, wait: w }) as ManagedTask;
  expect(taskWaitWords(t, "en", task({ ...wait, moving: true }))?.next).toBe(MOVING);
  expect(taskWaitWords(t, "en", task(wait))?.next).not.toBe(MOVING);
});

test("the chat's waiting card and the computer's line know it moves", () => {
  const outage = {
    machineId: "m1",
    name: away.name,
    platform: "other",
    offlineSince: away.lastSeenAt,
    moving: true,
    agents: [{ agentId: "a1", name: "Ada", brain: "claude_code" as const, waiting: { routines: 0, conversations: 1 } }],
    waitingRuns: 1,
  };
  expect(waitCardState({ machineId: "m1", agentId: "a1" }, [outage], "a1")).toMatchObject({
    kind: "waiting",
    moving: true,
  });
  const queue: ComputerQueue = { machineId: "m1", name: away.name, moving: true, working: [], waiting: [] };
  expect(queueStatusText(t, queueView(queue, "me"), queue)).toBe(MOVING);
  expect(queueStatusText(t, queueView({ ...queue, moving: false }, "me"), { moving: false })).not.toBe(MOVING);
});
