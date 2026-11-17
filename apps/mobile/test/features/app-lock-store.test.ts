import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";

// The phone's storage, the system's app state and its biometric prompt, all held here (ADR 0195).
const kept = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  getItemAsync: async (key: string) => kept.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void kept.set(key, value),
  deleteItemAsync: async (key: string) => void kept.delete(key),
}));
mock.module("expo-constants", () => ({ default: {} }));
const appState: { listeners: Set<(s: string) => void> } = { listeners: new Set() };
const goTo = (s: string) => {
  for (const cb of [...appState.listeners]) cb(s);
};
mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_: string, cb: (s: string) => void) => {
      appState.listeners.add(cb);
      return { remove: () => appState.listeners.delete(cb) };
    },
  },
}));
const auth = { level: 3, answer: true, during: null as null | (() => void) };
mock.module("expo-local-authentication", () => ({
  getEnrolledLevelAsync: async () => auth.level,
  authenticateAsync: async () => {
    auth.during?.();
    return auth.answer ? { success: true } : { success: false, error: "user_cancel" };
  },
}));

const { OPEN, appLockHolds, onAppLocked, setLockAfter, turnAppLock, unlock, watchAppLock, whenUnlocked } = await import(
  "../../src/features/lock/store"
);

const T0 = new Date("2026-11-17T12:00:00Z").getTime();
let stop: () => void = () => {};
beforeAll(() => {
  setSystemTime(T0);
  stop = watchAppLock();
});
afterAll(() => {
  stop();
  setSystemTime();
});

describe("the app lock's state (ADR 0195)", () => {
  test("off: nothing waits, leaving and coming back change nothing", () => {
    let ran = 0;
    expect(whenUnlocked(() => ran++)).toBe(false);
    goTo("background");
    expect(appLockHolds()).toBe(false);
    goTo("active");
    expect(ran).toBe(1);
  });

  test("turning it on needs the proof; a refused prompt leaves it off", async () => {
    auth.answer = false;
    expect(await turnAppLock(true, "x")).toBe(false);
    expect(kept.size).toBe(0);
    auth.answer = true;
    expect(await turnAppLock(true, "x")).toBe(true);
    expect([...kept.values()]).toEqual(["1"]);
    expect(appLockHolds()).toBe(false);
  });

  test("a notification's action that arrives before the app is in front waits, and runs back within the grace", () => {
    const done: string[] = [];
    goTo("inactive");
    goTo("background");
    // The answer reaches the app before it is active again (iOS's didReceive, Android's onNewIntent).
    expect(whenUnlocked(() => done.push("stop"))).toBe(true);
    expect(done).toEqual([]);
    setSystemTime(T0 + 30_000);
    goTo("active");
    expect(done).toEqual(["stop"]);
  });

  test("past the grace the same action waits for the proof, and a refused prompt keeps it waiting", async () => {
    const done: string[] = [];
    setSystemTime(T0 + 100_000);
    goTo("background");
    expect(whenUnlocked(() => done.push("allow"))).toBe(true);
    setSystemTime(T0 + 100_000 + 60_000);
    goTo("active");
    expect(appLockHolds()).toBe(true);
    expect(done).toEqual([]);
    auth.answer = false;
    expect(await unlock("x")).toBe(false);
    expect(done).toEqual([]);
    auth.answer = true;
    expect(await unlock("x")).toBe(true);
    expect(done).toEqual(["allow"]);
  });

  test("the sheets close as the lock engages, never as it only covers", async () => {
    let closed = 0;
    const stopHearing = onAppLocked(() => closed++);
    setSystemTime(T0 + 200_000);
    goTo("inactive");
    goTo("background");
    expect(closed).toBe(0);
    setSystemTime(T0 + 210_000);
    goTo("active");
    expect(closed).toBe(0);
    goTo("background");
    setSystemTime(T0 + 280_000);
    goTo("active");
    expect(closed).toBe(1);
    goTo("background");
    goTo("active");
    expect(closed).toBe(1);
    await unlock("x");
    stopHearing();
  });

  test("links and shares while locked: only the latest opens, once the lock opens", async () => {
    const opened: string[] = [];
    setSystemTime(T0 + 300_000);
    goTo("background");
    setSystemTime(T0 + 400_000);
    goTo("active");
    expect(whenUnlocked(() => opened.push("/approval/a"), OPEN)).toBe(true);
    expect(whenUnlocked(() => opened.push("/share-to"), OPEN)).toBe(true);
    expect(opened).toEqual([]);
    await unlock("x");
    expect(opened).toEqual(["/share-to"]);
  });

  test("the system's own prompt taking the app out of the front is not leaving", async () => {
    setSystemTime(T0 + 500_000);
    goTo("background");
    setSystemTime(T0 + 600_000);
    goTo("active");
    expect(appLockHolds()).toBe(true);
    // Android's PIN screen is an activity of its own: the app goes to the background and back while it is up.
    auth.during = () => {
      goTo("background");
      setSystemTime(T0 + 700_000);
      goTo("active");
    };
    expect(await unlock("x")).toBe(true);
    auth.during = null;
    goTo("active");
    expect(appLockHolds()).toBe(false);
  });

  test("a phone that can no longer prove anything turns the lock off instead of keeping the person out", async () => {
    setSystemTime(T0 + 800_000);
    goTo("background");
    setSystemTime(T0 + 900_000);
    goTo("active");
    expect(appLockHolds()).toBe(true);
    auth.level = 0;
    auth.answer = false;
    expect(await unlock("x")).toBe(true);
    expect(appLockHolds()).toBe(false);
    expect(kept.size).toBe(0);
  });

  test("the time picked to ask again is kept and honored: at once, or an hour", async () => {
    auth.level = 3;
    auth.answer = true;
    expect(await turnAppLock(true, "x")).toBe(true);
    setLockAfter(0);
    await Bun.sleep(0);
    expect([...kept.entries()].some(([k, v]) => k.includes("app-lock-after") && v === "0")).toBe(true);
    setSystemTime(T0 + 1_000_000);
    goTo("background");
    goTo("active");
    expect(appLockHolds()).toBe(true);
    await unlock("x");
    setLockAfter(3_600_000);
    goTo("background");
    setSystemTime(T0 + 1_000_000 + 30 * 60_000);
    goTo("active");
    expect(appLockHolds()).toBe(false);
    goTo("background");
    setSystemTime(T0 + 1_000_000 + 30 * 60_000 + 60 * 60_000);
    goTo("active");
    expect(appLockHolds()).toBe(true);
  });
});
