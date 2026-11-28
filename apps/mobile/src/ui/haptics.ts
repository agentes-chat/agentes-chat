import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

type AndroidHaptic = `${Haptics.AndroidHaptics}`;

/**
 * Android constants newer than some phones we run on: the API level each came in, and the older one that plays the
 * same effect on stock Android (expo-haptics rejects a constant the phone doesn't have). The rest exist on every level.
 */
const ANDROID_SINCE: Partial<Record<AndroidHaptic, { api: number; older: AndroidHaptic }>> = {
  "segment-tick": { api: 34, older: "context-click" },
  confirm: { api: 30, older: "virtual-key" },
  reject: { api: 30, older: "long-press" },
};

const ANDROID = Platform.OS === "android";
const ANDROID_API = ANDROID && typeof Platform.Version === "number" ? Platform.Version : 0;

/**
 * Android plays the system's own touch feedback (`View.performHapticFeedback`): the same short clicks as its own
 * controls, and nothing when the person turned touch feedback off. expo-haptics' impact, selection and notification
 * run the vibration motor there instead, a longer buzz that ignores that setting.
 */
function android(haptic: AndroidHaptic) {
  const since = ANDROID_SINCE[haptic];
  const played = since && ANDROID_API < since.api ? since.older : haptic;
  Haptics.performAndroidHapticsAsync(played as Haptics.AndroidHaptics).catch(() => {});
}

/**
 * Light taps for presses (and sending), a firm one for stopping, a success for confirmed holds. Never throws
 * (some devices have no haptics).
 */
export const haptics = {
  light: () => {
    if (ANDROID) return android("context-click");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** A firm tap: stopping an agent. */
  firm: () => {
    if (ANDROID) return android("virtual-key");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
  },
  /** A hold that took. */
  medium: () => {
    if (ANDROID) return android("long-press");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  selection: () => {
    if (ANDROID) return android("segment-tick");
    Haptics.selectionAsync().catch(() => {});
  },
  success: () => {
    if (ANDROID) return android("confirm");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning: () => {
    if (ANDROID) return android("reject");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  /** Something didn't work (connecting a service failed). */
  error: () => {
    if (ANDROID) return android("reject");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
