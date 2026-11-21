import { expect, test } from "bun:test";
import { nextCronTime } from "../src/cron";

test("a stepped day wildcard still respects the requested weekdays", () => {
  const after = new Date("2026-11-13T09:01:00Z");
  expect(nextCronTime("0 9 */1 * 1-5", "UTC", after)?.toISOString()).toBe("2026-11-16T09:00:00.000Z");
  expect(nextCronTime("0 9 */2 * 1", "UTC", after)?.toISOString()).toBe("2026-11-23T09:00:00.000Z");
});

test("a stepped weekday wildcard still respects the requested month days", () => {
  const after = new Date("2026-11-13T09:01:00Z");
  expect(nextCronTime("0 9 15 * */1", "UTC", after)?.toISOString()).toBe("2026-11-15T09:00:00.000Z");
});

test("two explicit day restrictions keep their either-day behavior", () => {
  const after = new Date("2026-11-13T09:01:00Z");
  expect(nextCronTime("0 9 15 * 1", "UTC", after)?.toISOString()).toBe("2026-11-15T09:00:00.000Z");
  expect(nextCronTime("0 9 1-31 * 1", "UTC", after)?.toISOString()).toBe("2026-11-14T09:00:00.000Z");
});
