import { describe, expect, test } from "bun:test";
import {
  APPROVAL_BUTTONS,
  approvalButtonsOn,
  approvalRefusal,
  opensApp,
  pressedButton,
  pushAccountMatches,
  takenOnce,
} from "../../src/features/approvals/push-actions";

const push = { kind: "approval", orgId: "o1", approvalId: "a1", server: "https://x.test", user: "u1" };

describe("approval buttons on a push", () => {
  test("offered only while the app lock is surely off", () => {
    expect(approvalButtonsOn(null)).toBe(true);
    expect(approvalButtonsOn("1")).toBe(false);
    // Unreadable is taken as on: deciding then needs the app opened behind the lock.
    expect(approvalButtonsOn(undefined)).toBe(false);
  });

  test("the buttons are Aprovar and Recusar, worded like the approval card; only Aprovar opens the app", () => {
    expect(APPROVAL_BUTTONS.map(([id]) => id)).toEqual(["approve", "refuse"]);
    expect(opensApp("approve")).toBe(true);
    expect(opensApp("refuse")).toBe(false);
  });

  test("only Recusar decides from the notification, and only an approval's push with its ids", () => {
    expect(approvalRefusal(push, "refuse")).toEqual({ orgId: "o1", approvalId: "a1" });
    // Aprovar never decides blind: it opens the card, as a tap does.
    expect(approvalRefusal(push, "approve")).toBeNull();
    expect(approvalRefusal(push, "expo.modules.notifications.actions.DEFAULT")).toBeNull();
    expect(approvalRefusal(push, "no")).toBeNull();
    expect(approvalRefusal({ ...push, kind: "device.access_request" }, "refuse")).toBeNull();
    expect(approvalRefusal({ kind: "approval", orgId: "o1" }, "refuse")).toBeNull();
  });

  test("refused only as the account the push is for", () => {
    const accounts = { "https://x.test#u1": { id: "u1" }, "https://x.test#u2": { id: "u2" } };
    expect(pushAccountMatches(accounts, "https://x.test#u1", "u1")).toBe(true);
    expect(pushAccountMatches(accounts, "https://x.test#u2", "u1")).toBe(false);
    expect(pushAccountMatches(accounts, "https://y.test", "u1")).toBe(false);
    expect(pushAccountMatches(accounts, "https://x.test#u1", undefined)).toBe(false);
  });

  test("a response reads the same from the listener and from Android's background task", () => {
    const listener = {
      actionIdentifier: "refuse",
      notification: { request: { identifier: "n1", content: { data: push } } },
    };
    const task = {
      actionIdentifier: "refuse",
      notification: { request: { identifier: "n1", content: { dataString: JSON.stringify(push) } } },
    };
    const expected = { identifier: "n1", action: "refuse", data: push };
    expect(pressedButton(listener)).toEqual(expected);
    expect(pressedButton(task)).toEqual(expected);
  });

  test("a received push, junk or unknown fields read as nothing or are dropped", () => {
    expect(pressedButton({ notification: { request: { identifier: "n1", content: {} } } })).toBeNull();
    expect(pressedButton(null)).toBeNull();
    expect(pressedButton("x")).toBeNull();
    const bad = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { dataString: "{not json", data: null } } },
    };
    expect(pressedButton(bad)).toEqual({ identifier: "n1", action: "approve", data: {} });
    const extra = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { data: { ...push, label: "x", approvalId: 3 } } } },
    };
    expect(pressedButton(extra)?.data).toEqual({ kind: "approval", orgId: "o1", server: "https://x.test", user: "u1" });
  });

  test("the task and the listener both hearing one press decide it once", () => {
    const take = takenOnce(2);
    expect(take("n1")).toBe(true);
    expect(take("n1")).toBe(false);
    expect(take("n2")).toBe(true);
    expect(take("n3")).toBe(true);
    // The oldest is forgotten past the limit.
    expect(take("n1")).toBe(true);
  });
});
