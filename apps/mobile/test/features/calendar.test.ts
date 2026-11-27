import { describe, expect, test } from "bun:test";
import type { CalendarProposal } from "@agenteschat/client";
import type { CalItem } from "@agenteschat/client/lib/calendar";
import {
  agendaDays,
  agendaSections,
  dayMarks,
  dayOfYmd,
  dayRows,
  isOver,
  nowLineAfter,
  sectionOfDay,
  stripWeeks,
  WEEKS_AHEAD,
  WEEKS_BACK,
  weekStartOf,
} from "../../src/features/calendar/logic";

// The phone's Calendar (agenda): pure rules, on a Friday with sample items.
const FRIDAY = new Date(2026, 10, 27);
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);

const item = (over: Partial<CalItem> & Pick<CalItem, "key" | "kind" | "start" | "end">): CalItem => ({
  source: "person",
  title: over.key,
  allDay: false,
  recurring: false,
  people: [],
  ...over,
});
const meeting = item({ key: "review", kind: "event", start: at(27, 14), end: at(27, 15) });
const standup = item({ key: "standup", kind: "event", start: at(27, 9, 30), end: at(27, 10) });
const due = item({
  key: "due-128",
  kind: "deadline",
  source: "deadline",
  start: at(27, 0),
  end: at(28, 0),
  allDay: true,
  owner: { type: "agent", id: "a-iris" },
});
const reminder = item({
  key: "remind",
  kind: "reminder",
  source: "reminder",
  start: at(27, 18),
  end: at(27, 18, 30),
  agentId: "a-iris",
});
const monday = item({ key: "planning", kind: "event", start: at(30, 10), end: at(30, 11) });
const proposal: CalendarProposal = {
  id: "p1",
  agentId: "a-theo",
  title: "Summer campaign",
  start: at(27, 16, 30).toISOString(),
  end: at(27, 17).toISOString(),
  participants: [],
  note: null,
  status: "pending",
};

describe("the week strip", () => {
  test("weeks start on Sunday, half a year back and a year ahead", () => {
    expect(weekStartOf(FRIDAY)).toEqual(new Date(2026, 10, 22));
    const weeks = stripWeeks(FRIDAY);
    expect(weeks).toHaveLength(WEEKS_BACK + 1 + WEEKS_AHEAD);
    expect(weeks[WEEKS_BACK]).toEqual(new Date(2026, 10, 22));
  });

  test("a link's day reads back to its local midnight, anything else to nothing", () => {
    expect(dayOfYmd("2026-11-27")).toEqual(FRIDAY);
    expect(dayOfYmd("27/11/2026")).toBeNull();
    expect(dayOfYmd(undefined)).toBeNull();
  });
});

describe("the agenda", () => {
  const days = agendaDays(weekStartOf(FRIDAY));
  const sections = agendaSections([meeting, standup, due, reminder, monday], [proposal], days, FRIDAY);

  test("days with something are blocks, quiet days in a row fold into one line, today always shows", () => {
    const kinds = sections.slice(0, 4).map((s) => (s.kind === "day" ? `day ${s.day.getDate()}` : "quiet"));
    // Sunday 22 to Thursday 26 have nothing: one line; Friday is today; Saturday and Sunday fold again; Monday has one.
    expect(kinds).toEqual(["quiet", "day 27", "quiet", "day 30"]);
    const empty = agendaSections([], [], days, FRIDAY);
    expect(empty.filter((s) => s.kind === "day").map((s) => s.key)).toEqual(["2026-11-27"]);
  });

  test("a day reads all day first, then by time, an agent's proposal among them at its time", () => {
    const today = sections.find((s) => s.kind === "day" && s.key === "2026-11-27");
    if (today?.kind !== "day") throw new Error("today's block");
    const order = dayRows(today.entries, today.proposals).map((r) =>
      r.kind === "entry" ? r.entry.key : `proposal ${r.proposal.id}`,
    );
    expect(order).toEqual(["due-128", "standup", "review", "proposal p1", "remind"]);
  });

  test("the now line falls after what already started", () => {
    const today = sections.find((s) => s.kind === "day" && s.key === "2026-11-27");
    if (today?.kind !== "day") throw new Error("today's block");
    const rows = dayRows(today.entries, today.proposals);
    expect(nowLineAfter(rows, at(27, 14, 27))).toBe(2);
    expect(nowLineAfter(rows, at(27, 7))).toBe(0);
  });

  test("a reminder is over once its time came, an event once it ended", () => {
    expect(isOver(reminder, at(27, 18))).toBe(true);
    expect(isOver(meeting, at(27, 14, 30))).toBe(false);
    expect(isOver(meeting, at(27, 15))).toBe(true);
  });

  test("the strip marks a day with each agent in it, then people's own events, three at most", () => {
    expect(dayMarks(sections, FRIDAY)).toEqual(["a-iris", "a-theo", "people"]);
    expect(dayMarks(sections, new Date(2026, 10, 30))).toEqual(["people"]);
    expect(dayMarks(sections, new Date(2026, 10, 24))).toEqual([]);
  });

  test("a tapped day finds its block, or the quiet line that holds it", () => {
    expect(sectionOfDay(sections, FRIDAY)).toBe("2026-11-27");
    expect(sectionOfDay(sections, new Date(2026, 10, 24))).toBe("q-2026-11-22");
  });
});
