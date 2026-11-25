import { expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next from "i18next";
import { paceTrail, TRAIL_PACE_MS, workTrail } from "../src/lib/trail";
import { applyChannelEvent, emptyStreams, type LiveWork } from "../src/realtime/streams";

const lang = (lng: string) => {
  const instance = i18next.createInstance();
  void instance.init({ lng, fallbackLng: "en", resources, initAsync: false });
  return instance.t;
};

const call = (id: string, tool: string, extra: Partial<Extract<LiveWork, { kind: "call" }>> = {}): LiveWork => ({
  kind: "call",
  id,
  tool,
  connector: null,
  detail: null,
  code: null,
  output: [],
  running: false,
  ...extra,
});

test("the trail: its words before a call quoted above it, calls of a kind folded, never what the line above says", () => {
  const t = lang("en");
  const work: LiveWork[] = [
    call("a", "search_context", { said: "Let me look at last month first" }),
    call("b", "read_file", { said: "Now the files" }),
    call("c", "read_file"),
    call("d", "read_file"),
    call("e", "run_code", { running: true, said: "Running the numbers" }),
  ];
  const lines = workTrail(t, { work, step: { said: "Running the numbers" } }, "en");
  expect(lines.map((l) => l.said)).toEqual([true, false, true, false]);
  expect(lines[0]?.text).toBe("“Let me look at last month first”");
  expect(lines[2]?.text).toBe("“Now the files”");
  // Three reads in a row are one line, counted; the call running now isn't in the trail.
  expect(lines[3]?.text).toEndWith("×3");
  expect(lines.some((l) => l.key === "e" || l.key === "e:said")).toBe(false);
  // Its words stay as it wrote them, whatever the reader's language.
  expect(workTrail(lang("pt-BR"), { work, step: undefined }, "pt-BR")[0]?.text).toBe(
    "“Let me look at last month first”",
  );
});

test("the trail keeps each call's words as the server told them", () => {
  const state = applyChannelEvent(emptyStreams, {
    type: "agent.tool",
    channelId: "c1",
    threadId: null,
    runId: "r1",
    agentId: "a1",
    toolUseId: "t1",
    tool: "read_file",
    said: "Checking the report first",
  } as never);
  const work = state.runs.r1?.work ?? [];
  expect(work[0]).toMatchObject({ kind: "call", id: "t1", said: "Checking the report first" });
});

test("paced: one new line every 3 s at most, lines gone are dropped, nothing waits once all are shown", () => {
  let pace = paceTrail({ shown: [], at: 0 }, ["a"], 10_000);
  expect(pace.shown).toEqual(["a"]);
  pace = paceTrail(pace, ["a", "b", "c"], 11_000);
  expect(pace.shown).toEqual(["a"]);
  expect(pace.due).toBe(10_000 + TRAIL_PACE_MS);
  pace = paceTrail(pace, ["a", "b", "c"], 10_000 + TRAIL_PACE_MS);
  expect(pace.shown).toEqual(["a", "b"]);
  pace = paceTrail(pace, ["b", "c"], 20_000);
  expect(pace.shown).toEqual(["b", "c"]);
  expect(pace.due).toBeNull();
});

test("opened mid-run: the lines it already has show at once, not one every 3 s", () => {
  const pace = paceTrail({ shown: [], at: 0 }, ["a", "b", "c", "d"], 10_000);
  expect(pace.shown).toEqual(["a", "b", "c", "d"]);
  expect(pace.due).toBeNull();
  // A new run after another's lines went: its lines show at once too.
  const next = paceTrail({ shown: ["x", "y"], at: 9_000 }, ["n1", "n2"], 10_000);
  expect(next.shown).toEqual(["n1", "n2"]);
});
