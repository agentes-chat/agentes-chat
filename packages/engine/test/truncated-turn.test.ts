import { describe, expect, test } from "bun:test";
import { advance, decideTurnEnd, TRUNCATED_NUDGE, type TurnEnd } from "../src/continuation";

/**
 * A turn cut at the model's output cap (`max_tokens`) is no answer: the run goes on once in smaller steps instead of
 * ending as done with a reply cut mid-sentence (seen with reasoning models on a workspace endpoint, whose calls get
 * 16K tokens and spent them all thinking).
 */
const turn = (over: Partial<TurnEnd> = {}): TurnEnd => ({
  state: { count: 0 },
  kind: "conversation",
  executed: 0,
  bound: null,
  quiet: false,
  decided: null,
  unanswered: false,
  unreached: "",
  judged: "O mapa das rotinas veio. Deixa eu confirmar",
  mission: false,
  wakesLater: async () => false,
  verdict: null,
  ...over,
});

describe("a turn cut at max_tokens", () => {
  test("goes on once, unposted, with the nudge, even with no judge", async () => {
    const d = await decideTurnEnd(turn({ truncated: true }));
    expect(d).toMatchObject({ outcome: "continue", rule: "truncated", nudge: TRUNCATED_NUDGE });
    const next = advance({ count: 0 }, d, 3);
    expect(next).toEqual({ count: 0, truncatedNudged: true });
  });

  test("a second cut ends as before, and so does a run past a bound", async () => {
    expect(await decideTurnEnd(turn({ truncated: true, state: { count: 0, truncatedNudged: true } }))).toMatchObject({
      outcome: "done",
      rule: "no_judge",
    });
    expect(await decideTurnEnd(turn({ truncated: true, bound: "stuck" }))).toMatchObject({
      outcome: "done",
      rule: "stuck",
    });
  });

  test("a whole reply is unchanged", async () => {
    expect(await decideTurnEnd(turn())).toMatchObject({ outcome: "done", rule: "no_judge" });
    expect(await decideTurnEnd(turn({ kind: "routine" }))).toMatchObject({ outcome: "done", rule: "no_judge" });
  });
});
