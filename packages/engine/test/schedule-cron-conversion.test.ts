import { expect, test } from "bun:test";
import { cronToRule } from "../src/rrule";
import { readSchedule } from "../src/schedule";

test("a cron with both day restrictions keeps its weekday runs inside the selected month", async () => {
  const cron = "0 9 15 11 1";
  expect(cronToRule(cron, "UTC")).toBeNull();
  expect(
    await readSchedule(null, { orgId: "org", phrase: cron, timezone: "UTC", now: new Date("2026-11-15T10:00:00Z") }),
  ).toMatchObject({ ok: true, type: "cron", cron, next: new Date("2026-11-16T09:00:00Z") });
});

test("an ordinary yearly date still becomes an editable rule", async () => {
  expect(
    await readSchedule(null, {
      orgId: "org",
      phrase: "0 9 15 11 *",
      timezone: "UTC",
      now: new Date("2026-11-13T10:00:00Z"),
    }),
  ).toMatchObject({ ok: true, type: "rule", next: new Date("2026-11-15T09:00:00Z") });
});
