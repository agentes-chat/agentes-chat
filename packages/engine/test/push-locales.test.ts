import { expect, test } from "bun:test";
import { LOCALE_CODES } from "@agenteschat/i18n/locale";
import { PUSH } from "../src/push/messages";
import { strings as ru } from "../src/push/messages/ru";
import { PUSH_BODY_MAX, PUSH_TITLE_MAX, pushStrings, renderPush } from "../src/push-messages";

const KINDS = [
  "approval",
  "agent_question",
  "mention",
  "dm",
  "agent_reply",
  "mission_stopped",
  "routine_failed",
  "run_failed",
  "routine_paused",
  "agent_unreached",
  "routine_stalled",
  "routine_waiting_plan",
  "plan_reset_unknown",
  "machine_connected",
  "computer_ready",
  "computer_down",
  "computer_back",
  "browser_handoff",
  "secret_request",
  "join_request",
  "device.join_request",
  "device.folder_request",
  "widget_alert",
  "widget_failed",
  "dashboard_proposal",
  "something_new",
];

test("every push kind in every language: words, within the phone's limits (ADR 0122)", () => {
  for (const locale of LOCALE_CODES)
    for (const kind of KINDS)
      for (const variant of [
        { actorName: "Ana", actorType: "user" as const, text: "olha", title: "Deploy", label: "geral" },
        { actorType: "agent" as const, highRisk: true, reminder: true, screen: "desktop", suggestedBy: "Bia" },
        // A personal workspace's words (ADR 0159), with no words of the agent's own to stand in for them.
        { actorName: "Ana", actorType: "user" as const, title: "Deploy", reason: "creator_left", personal: true },
        { actorType: "agent" as const, suggestedBy: "Bia", personal: true },
        // A computer back after a long outage (ADR 0241): its name and how long, in the language's own units.
        { title: "Workspace computer", awayMs: 26 * 3600_000 + 59 * 60_000 },
      ]) {
        const { title, body } = renderPush(locale, { kind, waiting: true, ...variant });
        expect({ locale, kind, title: title.length > 0 }).toEqual({ locale, kind, title: true });
        expect(`${title}${body}`).not.toMatch(/undefined|null|\{\{/);
        expect(title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
        expect(body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
      }
});

test("a personal workspace's pushes speak of one person and their agents, never a team (ADR 0159)", () => {
  const push = (kind: string, more: object = {}) =>
    renderPush("en", { kind, waiting: true, actorName: "Ana", label: "Personal", personal: true, ...more });
  expect(push("join_request", { title: "Bia" }).title).toBe("Bia asks to join your workspace");
  expect(push("join_request", { title: "Bia", suggestedBy: "Caio" }).title).toBe("Caio suggested inviting Bia");
  expect(push("computer_ready").title).toBe("Your agents' computer is ready");
  expect(push("machine_connected").title).toBe("A new computer was connected");
  expect(push("widget_failed", { label: null, reason: "creator_left" }).body).toBe(
    "Whoever set it up is no longer in your workspace.",
  );
  // A reason a personal workspace reads as a team does: the team's words.
  expect(push("widget_failed", { label: null, reason: "timeout" }).body).toBe("The update took too long.");
  // Only the words change: a team's read as before.
  expect(push("join_request", { title: "Bia", personal: false }).title).toBe("Bia asks to join Personal");
  // Every language has them, so none falls back to English.
  const keys = Object.keys(PUSH.en).filter((k) => k.endsWith("Personal"));
  expect(keys.length).toBe(7);
  for (const locale of LOCALE_CODES)
    expect({ locale, missing: keys.filter((k) => !(k in PUSH[locale])) }).toEqual({ locale, missing: [] });
});

test("a computer that isn't answering, and back with how long it was away (ADR 0241)", () => {
  const push = (locale: "en" | "pt-BR" | "ja", kind: string, awayMs?: number) =>
    renderPush(locale, { kind, waiting: false, title: "Workspace computer", awayMs });
  expect(push("en", "computer_down")).toEqual({
    title: "Workspace computer isn't answering",
    body: "Your agents' work on it is waiting. Tap to see what to do.",
  });
  expect(push("en", "computer_back", 42 * 60_000).body).toBe(
    "It was away for 42 min. The work that waited goes on now.",
  );
  expect(push("pt-BR", "computer_back", 125 * 60_000)).toEqual({
    title: "Workspace computer voltou",
    body: "Ficou fora por 2 h 5 min. O trabalho que esperava continua agora.",
  });
  // ICU's data spaces Japanese units differently by platform: the units are what matter.
  expect(push("ja", "computer_back", 125 * 60_000).body).toMatch(/^2 ?時間 5 ?分/);
});

test("a language without a word says it in English", () => {
  PUSH.ru = {};
  try {
    expect(pushStrings("ru").questionBody).toBe(pushStrings("en").questionBody);
  } finally {
    PUSH.ru = ru;
  }
  expect(pushStrings("ru").questionBody).not.toBe(pushStrings("en").questionBody);
  expect(pushStrings("pt-BR").questionBody).not.toBe(pushStrings("en").questionBody);
});
