import { describe, expect, test } from "bun:test";
import type { CalendarProposal } from "@agenteschat/client";
import type { CalItem } from "@agenteschat/client/lib/calendar";
import {
  busyDays,
  dayOfYmd,
  isOn,
  isOver,
  MONTHS_AHEAD,
  MONTHS_BACK,
  markOf,
  monthTitle,
  monthWeeks,
  nextAfter,
  nowLineAfter,
  pagerMonths,
  readRange,
  rowsOn,
  shortDate,
  stripWeeks,
  WEEKS_AHEAD,
  WEEKS_BACK,
  weekStartOf,
} from "../../src/features/calendar/logic";

// The phone's Calendar (the month and the day): pure rules, on a Friday with sample items.
const FRIDAY = new Date(2026, 10, 27);
const at = (day: number, h: number, m = 0, month = 10) => new Date(2026, month, day, h, m);

const item = (over: Partial<CalItem> & Pick<CalItem, "key" | "kind" | "start" | "end">): CalItem => ({
  source: "person",
  title: over.key,
  allDay: false,
  recurring: false,
  people: [],
  ...over,
});
const meeting = item({ key: "review", kind: "event", start: at(27, 14), end: at(27, 15), location: "Room 2" });
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
// An all-day event over three days of the next month.
const trip = item({
  key: "trip",
  kind: "event",
  start: at(2, 0, 0, 11),
  end: at(5, 0, 0, 11),
  allDay: true,
});
const items = [meeting, standup, due, reminder, monday, trip];
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
const dismissed: CalendarProposal = {
  ...proposal,
  id: "p2",
  start: at(29, 10).toISOString(),
  end: at(29, 11).toISOString(),
  status: "dismissed",
};
const proposals = [proposal, dismissed];
const keysOf = (rows: ReturnType<typeof rowsOn>) =>
  rows.map((r) => (r.kind === "entry" ? r.entry.key : `proposal ${r.proposal.id}`));

describe("the month", () => {
  test("a month's grid: its weeks from Sunday, the days outside it blank, four to six weeks", () => {
    // November 2026 starts on a Sunday: five weeks, the last with the 29th and the 30th.
    const november = monthWeeks(new Date(2026, 10, 1));
    expect(november).toHaveLength(5);
    expect(november[0]?.[0]).toEqual(new Date(2026, 10, 1));
    expect(november[4]?.map((d) => d?.getDate() ?? null)).toEqual([29, 30, null, null, null, null, null]);
    // February 2026: 28 days from a Sunday, four weeks; August 2026: 31 days from a Saturday, six.
    expect(monthWeeks(new Date(2026, 1, 1))).toHaveLength(4);
    const august = monthWeeks(new Date(2026, 7, 1));
    expect(august).toHaveLength(6);
    expect(august[0]?.filter(Boolean)).toHaveLength(1);
  });

  test("the pager holds a year back and two ahead, this month in its place", () => {
    const months = pagerMonths(FRIDAY);
    expect(months).toHaveLength(MONTHS_BACK + 1 + MONTHS_AHEAD);
    expect(months[MONTHS_BACK]).toEqual(new Date(2026, 10, 1));
    expect(months[0]).toEqual(new Date(2025, 10, 1));
  });

  test("the title is the month, with its year only when it isn't this year's", () => {
    expect(monthTitle("pt-BR", new Date(2026, 10, 1), FRIDAY)).toBe("Novembro");
    expect(monthTitle("pt-BR", new Date(2027, 0, 1), FRIDAY)).toBe("Janeiro de 2027");
  });

  test("a short date drops the abbreviations' dots", () => {
    const words = shortDate("pt-BR", FRIDAY);
    expect(words).toContain("27");
    expect(words).not.toContain(".");
  });

  test("one read covers the month, the chosen day's week and a month after it", () => {
    expect(readRange(new Date(2026, 10, 1), FRIDAY)).toEqual({
      from: new Date(2026, 10, 1).toISOString(),
      to: new Date(2026, 11, 28).toISOString(),
    });
    // The 1st of December is a Tuesday: its week starts in November.
    expect(readRange(new Date(2026, 11, 1), new Date(2026, 11, 1)).from).toBe(new Date(2026, 10, 29).toISOString());
  });

  test("a day with something gets one dot, every day of one that spans several; a dismissed proposal none", () => {
    const busy = busyDays(items, proposals, new Date(2026, 10, 1), new Date(2026, 11, 28));
    expect([...busy].sort()).toEqual(["2026-11-27", "2026-11-30", "2026-12-02", "2026-12-03", "2026-12-04"]);
  });
});

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

describe("the chosen day", () => {
  const rows = rowsOn(items, proposals, FRIDAY);

  test("a day reads all day first, then by time, an agent's proposal among them at its time", () => {
    expect(keysOf(rows)).toEqual(["due-128", "standup", "review", "proposal p1", "remind"]);
  });

  test("each row's kind is a mark: a task's, an event's dot, an agent's face", () => {
    expect(rows.map(markOf)).toEqual([
      { kind: "task" },
      { kind: "event" },
      { kind: "event" },
      { kind: "agent", agentId: "a-theo" },
      { kind: "agent", agentId: "a-iris" },
    ]);
  });

  test("the now line falls after what already started", () => {
    expect(nowLineAfter(rows, at(27, 14, 27))).toBe(2);
    expect(nowLineAfter(rows, at(27, 7))).toBe(0);
  });

  test("a reminder is over once its time came, an event once it ended; only an event is on", () => {
    expect(isOver(reminder, at(27, 18))).toBe(true);
    expect(isOver(meeting, at(27, 14, 30))).toBe(false);
    expect(isOver(meeting, at(27, 15))).toBe(true);
    expect(isOn(meeting, at(27, 14, 30))).toBe(true);
    expect(isOn(meeting, at(27, 15))).toBe(false);
    expect(isOn(reminder, at(27, 18, 10))).toBe(false);
  });

  test("an empty day shows the next day with something, within the range read", () => {
    const to = new Date(2026, 11, 28);
    const next = nextAfter(items, proposals, new Date(2026, 10, 28), to);
    expect(next?.day).toEqual(new Date(2026, 10, 30));
    expect(next && keysOf([next.row])).toEqual(["planning"]);
    expect(nextAfter(items, proposals, new Date(2026, 11, 5), to)).toBeNull();
    expect(rowsOn(items, proposals, new Date(2026, 10, 29))).toEqual([]);
  });
});
