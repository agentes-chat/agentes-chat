import { expect, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { PLAN_USAGE_EVERY_MS, refreshPlanUsage } from "../src/realtime/machines";

/** The plan usage read behind the limits ring: however many computers report, one read per interval per client. */
test("the first event reads at once, those right after it become one read at the interval's end", () => {
  const qc = new QueryClient();
  const reads = spyOn(qc, "invalidateQueries").mockResolvedValue();
  const timers: (() => void)[] = [];
  const later = spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void) => {
    timers.push(run);
    return {} as ReturnType<typeof setTimeout>;
  }) as never);
  const t = 1_000_000;
  refreshPlanUsage(qc, "o1", t);
  for (let i = 1; i <= 5; i++) refreshPlanUsage(qc, "o1", t + i * 100);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(timers).toHaveLength(1);
  timers[0]?.();
  expect(reads).toHaveBeenCalledTimes(2);
  // Another workspace keeps its own pace.
  refreshPlanUsage(qc, "o2", t + 200);
  expect(reads).toHaveBeenCalledTimes(3);
  later.mockRestore();
  expect(PLAN_USAGE_EVERY_MS).toBeGreaterThanOrEqual(30_000);
});
