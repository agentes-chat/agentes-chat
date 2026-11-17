import { type PushData, readPushData } from "@/lib/push-payload";

/**
 * Recusar and Aprovar on an approval's notification (ADR 0035 addendum): the pure part. The server gives the push this
 * category only for an approval that isn't high risk (`pushCategory` in packages/engine/src/push.ts); a high-risk one
 * has no buttons and opens the app. Recusar decides without opening the app; Aprovar never decides blind: it opens
 * the request's card, behind the phone's unlock, where one more tap approves.
 */
export const APPROVAL_CATEGORY = "approval";

/** The buttons, by the action id the notification hands back, with their words (the approval card's). */
export const APPROVAL_BUTTONS = [
  ["approve", "mobile.approval.approve"],
  ["refuse", "mobile.approval.refuse"],
] as const;

/** Whether a button opens the app: Aprovar does (to the card), Recusar decides where it is. */
export const opensApp = (button: (typeof APPROVAL_BUTTONS)[number][0]): boolean => button === "approve";

/** The background task Android runs a button pressed with the app closed in (expo-task-manager). */
export const APPROVAL_TASK = "approval-push-buttons";

/**
 * The app lock's switch as stored on this phone (ADR 0194, features/lock: "1" while on, absent while off). Read only
 * here, through `approvalButtonsOn`.
 */
export const APP_LOCK_VALUE = "app-lock";

/**
 * Whether the buttons are offered, from the app lock's switch (`APP_LOCK_VALUE`; `undefined` unreadable). Only when it
 * is surely off: with the lock on, deciding needs the app opened behind it.
 */
export const approvalButtonsOn = (lock: string | null | undefined): boolean => lock === null;

export interface ApprovalRefusal {
  orgId: string;
  approvalId: string;
}

/**
 * What a pressed button refuses without opening the app, or null: Aprovar (it opens the card, as a tap does), any
 * other button, or a push without its ids.
 */
export function approvalRefusal(data: PushData, action: string): ApprovalRefusal | null {
  if (data.kind !== "approval" || !data.orgId || !data.approvalId || action !== "refuse") return null;
  return { orgId: data.orgId, approvalId: data.approvalId };
}

/**
 * Whether the place a push goes to is signed in as the person it is for (ADR 0183): only then is it refused from the
 * notification. A push that names nobody, or an account this phone doesn't know there, decides nothing.
 */
export const pushAccountMatches = (
  accounts: Readonly<Record<string, { id: string } | undefined>>,
  place: string,
  user: string | undefined,
): boolean => Boolean(user) && accounts[place]?.id === user;

/** A pressed notification as both paths hand it over: the notification's id, the button and the push's data. */
export interface PressedButton {
  identifier: string;
  action: string;
  data: PushData;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Reads a notification response: the listener's (`content.data`, already an object) or the background task's on
 * Android (`content.dataString`, the push's data as JSON). Anything else, a received push included, is null.
 */
export function pressedButton(response: unknown): PressedButton | null {
  const r = record(response);
  const request = record(record(r?.notification)?.request);
  const content = record(request?.content);
  if (typeof r?.actionIdentifier !== "string" || typeof request?.identifier !== "string" || !content) return null;
  let data: unknown = content.data;
  if (!record(data) && typeof content.dataString === "string") {
    try {
      data = JSON.parse(content.dataString);
    } catch {
      data = null;
    }
  }
  return { identifier: request.identifier, action: r.actionIdentifier, data: readPushData(data) };
}

/**
 * Remembers what was taken: true the first time for an id. On Android Recusar pressed with the app in the background
 * reaches both the background task and the listener, in the same JavaScript; only the first decides.
 */
export function takenOnce(limit = 50) {
  const taken: string[] = [];
  return (id: string): boolean => {
    if (taken.includes(id)) return false;
    taken.push(id);
    if (taken.length > limit) taken.shift();
    return true;
  };
}
