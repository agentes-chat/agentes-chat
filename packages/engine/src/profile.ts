import type { BrainTurnTimings } from "@agenteschat/adapters";
import { currentQueryCount } from "@agenteschat/db";

export interface StageTiming {
  stage: string;
  ms: number;
  /** SQL statements issued during the stage (in this async context). */
  queries: number;
}

/** Splits a unit of work into timed stages with their query counts (per-run breakdown at debug level). */
export function createProfiler() {
  const stages: StageTiming[] = [];
  /** Each computer turn's own timings, as the runner said them. */
  const brain: BrainTurnTimings[] = [];
  const startedAt = Date.now();
  let at = performance.now();
  let queries = currentQueryCount();
  return {
    mark(stage: string) {
      const now = performance.now();
      const q = currentQueryCount();
      stages.push({ stage, ms: Math.round((now - at) * 10) / 10, queries: q - queries });
      at = now;
      queries = q;
    },
    /** A stage timed elsewhere that came before this unit of work (the router, a wait for room): listed first.
     * Never negative: it may have been timed against another server's clock. */
    before(stage: string, ms: number) {
      stages.unshift({ stage, ms: Math.max(0, Math.round(ms * 10) / 10), queries: 0 });
    },
    /** When this unit of work started (epoch ms). */
    startedAt,
    stages,
    brain,
    /** The run it profiles, once claimed: its profile is kept with it. */
    run: undefined as { id: string; orgId: string; agentId: string } | undefined,
    total: () => ({
      ms: Math.round(stages.reduce((n, s) => n + s.ms, 0) * 10) / 10,
      queries: stages.reduce((n, s) => n + s.queries, 0),
    }),
  };
}
