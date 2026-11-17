import { describe, expect, test } from "bun:test";
import {
  availabilityOf,
  LOCK_AFTER_CHOICES,
  LOCK_GRACE_MS,
  lockAfterOf,
  locksOnReturn,
} from "../../src/features/lock/logic";

describe("app lock (ADR 0195)", () => {
  test("the grace is one minute", () => {
    expect(LOCK_GRACE_MS).toBe(60_000);
  });

  test("never left the front: no lock", () => {
    expect(locksOnReturn(null, 1_000_000)).toBe(false);
  });

  test("back within the grace opens as it was; at or past it, locks", () => {
    const left = 1_000_000;
    expect(locksOnReturn(left, left)).toBe(false);
    expect(locksOnReturn(left, left + LOCK_GRACE_MS - 1)).toBe(false);
    expect(locksOnReturn(left, left + LOCK_GRACE_MS)).toBe(true);
    expect(locksOnReturn(left, left + 10 * LOCK_GRACE_MS)).toBe(true);
  });

  test("a clock that went backwards locks", () => {
    expect(locksOnReturn(1_000_000, 999_999)).toBe(true);
  });

  test("another grace is honored", () => {
    expect(locksOnReturn(0, 4_999, 5_000)).toBe(false);
    expect(locksOnReturn(0, 5_000, 5_000)).toBe(true);
  });

  test("the enrolled level maps to what the phone can prove", () => {
    // expo-local-authentication's SecurityLevel: NONE 0, SECRET 1, BIOMETRIC_WEAK 2, BIOMETRIC_STRONG 3.
    expect(availabilityOf(0)).toBe("none");
    expect(availabilityOf(1)).toBe("credential");
    expect(availabilityOf(2)).toBe("biometrics");
    expect(availabilityOf(3)).toBe("biometrics");
    expect(availabilityOf(-1)).toBe("none");
  });

  test("the choices to ask again, and what a kept value reads as", () => {
    expect([...LOCK_AFTER_CHOICES]).toEqual([0, 60_000, 300_000, 1_800_000, 3_600_000]);
    expect(lockAfterOf("0")).toBe(0);
    expect(lockAfterOf("1800000")).toBe(1_800_000);
    expect(lockAfterOf(null)).toBe(LOCK_GRACE_MS);
    expect(lockAfterOf("")).toBe(LOCK_GRACE_MS);
    expect(lockAfterOf("42")).toBe(LOCK_GRACE_MS);
    expect(lockAfterOf("abc")).toBe(LOCK_GRACE_MS);
  });

  test("at once locks on any return from the background", () => {
    expect(locksOnReturn(1_000, 1_000, 0)).toBe(true);
  });
});
