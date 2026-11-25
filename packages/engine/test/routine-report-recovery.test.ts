import { expect, test } from "bun:test";
import { advance, decideTurnEnd, type TurnEnd } from "../src/continuation";

const turn = (over: Partial<TurnEnd> = {}): TurnEnd => ({
  state: { count: 0 },
  kind: "routine",
  executed: 0,
  bound: null,
  quiet: true,
  reportOwed: true,
  decided: null,
  unanswered: false,
  unreached: "",
  judged: "",
  mission: false,
  wakesLater: async () => false,
  verdict: null,
  ...over,
});

test("a missing mandatory report gets one extra turn before quiet, even without a judge or tools", async () => {
  const d = await decideTurnEnd(turn());
  expect(d).toMatchObject({ outcome: "continue", rule: "report" });
  const state = advance({ count: 0 }, d, 0);
  expect(state.count).toBe(1);
  expect(await decideTurnEnd(turn({ state }))).toEqual({ outcome: "done", rule: "quiet" });
});

test("conditional routines, existing reports and hard bounds keep their endings", async () => {
  expect(await decideTurnEnd(turn({ reportOwed: false }))).toEqual({ outcome: "done", rule: "quiet" });
  for (const bound of ["reported", "turn_cap", "stuck"])
    expect(await decideTurnEnd(turn({ bound }))).toEqual({ outcome: "done", rule: bound });
  expect(await decideTurnEnd(turn({ kind: "conversation" }))).toEqual({ outcome: "done", rule: "quiet" });
  expect(await decideTurnEnd(turn({ state: { count: 1 } }))).toEqual({ outcome: "done", rule: "quiet" });
});
