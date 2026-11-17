import * as Notifications from "expo-notifications";
import type { TFunction } from "i18next";
import { createApi } from "@/lib/api";
import { placeAccounts, placeKey, signedInServers } from "@/lib/server";
import { pushPlace } from "@/lib/server-choice";
import { readValueSyncOrUnknown } from "@/lib/storage";
import {
  APP_LOCK_VALUE,
  APPROVAL_BUTTONS,
  APPROVAL_CATEGORY,
  approvalButtonsOn,
  approvalRefusal,
  opensApp,
  type PressedButton,
  pushAccountMatches,
  takenOnce,
} from "./push-actions";

const buttonsOn = () => approvalButtonsOn(readValueSyncOrUnknown(APP_LOCK_VALUE));

/**
 * Recusar and Aprovar on the notification of an approval that isn't high risk (ADR 0035 addendum). Recusar decides
 * without opening the app; Aprovar opens the app on the request's card (a tap's way: the phone unlocks, the whole
 * request shows, one more tap approves), so nothing is approved blind. Not while the app lock is on (ADR 0194): the
 * category is taken away, so such a push shows no buttons and a tap opens the app behind the lock. Registered again
 * whenever the app leaves the front, so turning the lock on or off reaches the next push. On an iPhone the phone
 * must be unlocked to run either.
 */
export function registerApprovalActions(t: TFunction) {
  const done = buttonsOn()
    ? Notifications.setNotificationCategoryAsync(
        APPROVAL_CATEGORY,
        APPROVAL_BUTTONS.map(([identifier, key]) => ({
          identifier,
          buttonTitle: t(key),
          options: {
            opensAppToForeground: opensApp(identifier),
            isDestructive: identifier === "refuse",
            isAuthenticationRequired: true,
          },
        })),
      )
    : Notifications.deleteNotificationCategoryAsync(APPROVAL_CATEGORY);
  return done.catch(() => undefined);
}

const taken = takenOnce();

/**
 * Refuses an approval from its notification's Recusar, only as the account the push is for (ADR 0183), and clears the
 * notification once the server took it. Null when the press isn't Recusar on an approval (Aprovar opens its card as a
 * tap does). Anything else (another account there, no network, decided elsewhere, expired) leaves the notification
 * where it is: a tap on it opens the request in the app.
 */
export function decideFromPush(pressed: PressedButton): Promise<void> | null {
  const refusal = approvalRefusal(pressed.data, pressed.action);
  if (!refusal) return null;
  if (!taken(pressed.identifier) || !buttonsOn()) return Promise.resolve();
  const place = pushPlace(pressed.data.server, placeKey(), signedInServers(), {
    user: pressed.data.user,
    accounts: placeAccounts(),
  });
  if (place.kind === "gone") return Promise.resolve();
  const target = place.kind === "switch" ? place.server : placeKey();
  if (!pushAccountMatches(placeAccounts(), target, pressed.data.user)) return Promise.resolve();
  return createApi(target)
    .approvals.refuse(refusal.orgId, refusal.approvalId)
    .then(
      () => Notifications.dismissNotificationAsync(pressed.identifier).catch(() => undefined),
      () => undefined,
    );
}
