import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { readValueSync, readValueSyncOrUnknown, STORED, writeValue } from "@/lib/storage";
import { availabilityOf, type LockAfter, type LockAvailability, lockAfterOf, locksOnReturn } from "./logic";

/**
 * The app lock (ADR 0195), kept on this phone: off by default, on only after the person proved it once. While on, the
 * app opens locked and locks again when it comes back after the time the person picked (`lockAfter`, one minute
 * unless changed). Out of sight (the app
 * switcher, the background) the lock screen covers it without asking anything, so its picture shows no conversation.
 */
interface LockState {
  enabled: boolean;
  /** Proof is needed before anything of the app shows. */
  locked: boolean;
  /** Out of sight: covered, nothing asked on return within the grace. */
  covered: boolean;
  /** How long away before coming back asks again (`LOCK_AFTER_CHOICES`). */
  after: LockAfter;
}

let state: LockState = (() => {
  // Unreadable (the keystore failed) is taken as on: the phone's own proof opens it, and nobody is kept out.
  const saved = readValueSyncOrUnknown(STORED.appLock);
  const enabled = saved === "1" || saved === undefined;
  return { enabled, locked: enabled, covered: false, after: lockAfterOf(readValueSync(STORED.appLockAfter)) };
})();
let leftAt: number | null = null;
/** The system's prompt is up: the app leaving for it (Face ID, Android's PIN screen) is not the person leaving. */
let authenticating = false;
const listeners = new Set<() => void>();
/**
 * What waits for the lock to open, by kind: a tapped notification or a link (`OPEN`) keeps only the latest, so
 * opening the lock goes to one place.
 */
const waiting = new Map<string, () => void>();

/** A tapped notification's or a link's screen: the latest one wins. */
export const OPEN = "open";

/** Locked, or out of sight: what a tap or a link would open waits. */
const holds = () => state.locked || state.covered;

/** What runs as the lock engages (not as it only covers): the app's sheets close under it. */
const onLock = new Set<() => void>();

/** Hears the lock engage; the returned function stops hearing it. */
export function onAppLocked(cb: () => void): () => void {
  onLock.add(cb);
  return () => void onLock.delete(cb);
}

function set(next: Partial<LockState>) {
  const was = state.locked;
  state = { ...state, ...next };
  for (const cb of listeners) cb();
  if (state.locked && !was) for (const cb of [...onLock]) cb();
  if (holds()) return;
  const ready = [...waiting.values()];
  waiting.clear();
  for (const fn of ready) fn();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const current = () => state;

export const useAppLock = () => useSyncExternalStore(subscribe, current, current);

/** Whether the lock holds what the app would open now (locked, or out of sight with the lock on). */
export const appLockHolds = () => holds();

/**
 * Runs `fn` now, or once the lock opens and the app is in front again; true when it waits. A later `fn` of the same
 * `kind` replaces one still waiting.
 */
export function whenUnlocked(fn: () => void, kind: string = OPEN): boolean {
  if (!holds()) {
    fn();
    return false;
  }
  waiting.set(kind, fn);
  return true;
}

/** Follows the app in and out of the front (mounted once, at the root). */
export function watchAppLock(): () => void {
  const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
    if (!state.enabled || authenticating) return;
    if (s === "active") {
      const locked = state.locked || locksOnReturn(leftAt, Date.now(), state.after);
      leftAt = null;
      set({ locked, covered: false });
      return;
    }
    if (s === "background" && leftAt === null) leftAt = Date.now();
    if (!state.covered) set({ covered: true });
  });
  return () => sub.remove();
}

/** What this phone can prove its owner with now. */
export async function lockAvailability(): Promise<LockAvailability> {
  try {
    return availabilityOf(await LocalAuthentication.getEnrolledLevelAsync());
  } catch {
    return "none";
  }
}

/** Read again whenever the app comes back: the person may have set up a fingerprint or a PIN meanwhile. */
export function useLockAvailability(): LockAvailability | null {
  const [availability, setAvailability] = useState<LockAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void lockAvailability().then((a) => {
        if (alive) setAvailability(a);
      });
    read();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return availability;
}

/** The system's prompt: biometrics, with the phone's PIN, pattern or passcode always allowed in their place. */
async function authenticate(promptMessage: string): Promise<boolean> {
  authenticating = true;
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  } finally {
    authenticating = false;
  }
}

/**
 * Opens the lock with the system's proof. A phone that can no longer prove anything (its screen lock was removed)
 * turns the lock off instead of keeping the person out: no proof is left to ask for.
 */
export async function unlock(promptMessage: string): Promise<boolean> {
  if ((await lockAvailability()) === "none") {
    setAppLock(false);
    return true;
  }
  if (!(await authenticate(promptMessage))) return false;
  set({ locked: false, covered: false });
  return true;
}

/** Turning it on asks for the proof first; turning it off doesn't (the app is open already). */
export async function turnAppLock(on: boolean, promptMessage: string): Promise<boolean> {
  if (on && !(await authenticate(promptMessage))) return false;
  setAppLock(on);
  return true;
}

/** How long away before it asks again, kept on this phone. */
export function setLockAfter(after: LockAfter) {
  void writeValue(STORED.appLockAfter, String(after));
  set({ after });
}

function setAppLock(on: boolean) {
  leftAt = null;
  void writeValue(STORED.appLock, on ? "1" : null);
  set({ enabled: on, locked: false, covered: false });
}

/** The phone's remembered values were cleared (the last account signed out): the lock goes with them. */
export function forgetAppLock() {
  leftAt = null;
  set({ enabled: false, locked: false, covered: false, after: lockAfterOf(null) });
}
