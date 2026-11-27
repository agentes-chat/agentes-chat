import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featureKeysEn } from "../../src/features/i18n/keys.en";
import { featureKeysPtBR } from "../../src/features/i18n/keys.pt-BR";

const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

/** The source from `from` on, `length` characters of it (a handler's body). */
function after(text: string, from: string, length = 900): string {
  const at = text.indexOf(from);
  expect([from, at >= 0]).toEqual([from, true]);
  return text.slice(at, at + length);
}

// Every press that stops work or takes something away asks first, in the system's alert (`confirmAction` or
// `Alert.alert`), so a stray tap never does it.
describe("what stops or takes away asks first", () => {
  test("stopping a task's work from its menu, and cancelling the task", () => {
    const issue = src("features/issues/IssueScreen.tsx");
    const stop = after(issue, 'label: t("issues.work.stop"),');
    expect(stop).toContain('title: t("mobile.taskManager.stopTitle", { title: i.title }),');
    expect(stop.indexOf("confirmAction({")).toBeLessThan(stop.indexOf("stop.mutate(runId"));
    const cancel = after(issue, 'label: t("mobile.issues.actions.cancel"),');
    expect(cancel).toContain('title: t("mobile.issues.actions.cancelTitle", { number: i.number }),');
    expect(cancel.indexOf("confirmAction({")).toBeLessThan(cancel.indexOf('patch: { status: "canceled" }'));
  });

  test("stopping a routine's run, and a run in a computer's line", () => {
    const routine = after(src("features/routines/RoutineScreen.tsx"), "label={t(stopWordsKey(r))}");
    expect(routine).toContain("onConfirm: controls.stop,");
    const queue = after(src("features/queue/QueueSheet.tsx"), "stop: (runId) => {", 500);
    expect(queue).toContain("askToStop(t, { runId },");
  });

  test("not running a request that waits for a limit", () => {
    const card = after(src("features/ai/UsagePauseCard.tsx"), "function useDontRun(", 1200);
    expect(card).toContain('title: t("mobile.ai.dontRunTitle"),');
    expect(card).toContain("onConfirm: () => void cancel(),");
  });

  test("cancelling an agent's return and withdrawing an action approved ahead", () => {
    const returns = after(src("features/chat/Returns.tsx"), 'label: t("followUps.cancelOf", {', 1400);
    expect(returns).toContain('title: t("mobile.chat.followUpCancelTitle", {');
    expect(returns.indexOf("confirmAction({")).toBeLessThan(returns.indexOf("cancel.mutate("));
    const ahead = after(src("features/approvals/parts.tsx"), "export function useCancelAhead()", 1100);
    expect(ahead).toContain(
      'Alert.alert(t("mobile.approval.cancelAheadTitle"), t("mobile.approval.cancelAheadText"), [',
    );
    expect(ahead.indexOf("Alert.alert(")).toBeLessThan(ahead.indexOf("cancel.mutate(id"));
  });

  test("taking someone out of a code session, or leaving it", () => {
    const people = after(src("features/coding/PeopleScreen.tsx"), "remove: {", 900);
    expect(people).toContain('title: self ? t("mobile.coding.leaveTitle") : t("mobile.coding.removeTitle", { name }),');
    expect(people).toContain("onConfirm: () => remove.mutate(p),");
  });

  test("stopping who uses a phone, from its page and from the inbox", () => {
    const page = after(src("features/devices/PhoneScreen.tsx"), 'label={t("mobile.devices.page.stop", {', 900);
    expect(page.indexOf("confirmAction({")).toBeLessThan(page.indexOf("stop.mutate(p.id"));
    const notice = after(src("features/devices/notices.tsx"), 'label={t("mobile.devices.notice.stop")}', 700);
    expect(notice).toContain('title: t("mobile.devices.notice.stopTitle", { device: d.device }),');
    expect(notice.indexOf("confirmAction({")).toBeLessThan(notice.indexOf("stop.mutate(phoneId"));
  });

  test("forgetting a memory from its fix sheet", () => {
    const fix = after(src("features/agents/AgentProfileScreen.tsx"), "export function MemoryFix(", 3200);
    const forget = after(fix, "const forget = () =>", 900);
    expect(forget).toContain('t("mobile.intentAgents.knows.forgetTitle"),');
    expect(forget.indexOf("Alert.alert(")).toBeLessThan(forget.indexOf('type: "archive"'));
  });

  test("the alerts' words in both languages", () => {
    for (const keys of [featureKeysEn, featureKeysPtBR] as unknown as Record<string, unknown>[]) {
      const at = (path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], keys);
      for (const path of [
        "issues.actions.cancelTitle",
        "issues.actions.cancelText",
        "ai.dontRunTitle",
        "ai.dontRunText",
        "chat.followUpCancelTitle",
        "approval.cancelAheadTitle",
        "approval.cancelAheadText",
        "coding.removeTitle",
        "coding.removeText",
        "coding.removeConfirm",
        "coding.leaveTitle",
        "coding.leaveText",
        "devices.page.stopTitle",
        "devices.page.stopText",
        "devices.notice.stopTitle",
      ])
        expect([path, typeof at(path)]).toEqual([path, "string"]);
    }
  });
});
