import { describe, expect, test } from "bun:test";
import { parseMachineLoad } from "@agenteschat/adapters/machine-protocol";
import { memoryByAgent, parsePs } from "../../runner/agent-memory";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("each agent's memory", () => {
  test("its CLI and everything it started, a process counted once", () => {
    const rows = parsePs(
      "  10     1  204800\n  11    10  102400\n  12    11   51200\n  20     1   10240\n  99     1  999999\n",
    );
    expect(
      memoryByAgent(
        rows,
        new Map([
          [A, [10]],
          [B, [20, 404]],
        ]),
      ),
    ).toEqual({
      [A]: { rssMb: 350, processes: 3 },
      [B]: { rssMb: 10, processes: 1 },
    });
  });
  test("travels with the load; what isn't an agent id or a sane number stays out", () => {
    const load = parseMachineLoad({
      loadAvg: 0.1,
      loadPeak: 0.2,
      memoryAvg: 0.3,
      memoryPeak: 0.4,
      hours: 1,
      agents: { [A]: { rssMb: 300, processes: 2 }, nope: { rssMb: 1, processes: 1 }, [B]: { rssMb: -1, processes: 1 } },
    });
    expect(load?.agents).toEqual({ [A]: { rssMb: 300, processes: 2 } });
  });
});
