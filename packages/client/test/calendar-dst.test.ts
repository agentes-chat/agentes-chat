import { expect, test } from "bun:test";
import { type CalItem, layoutBars } from "../src/lib/calendar";

const event = (start: Date, end: Date): CalItem => ({
  key: "meeting",
  kind: "event",
  source: "person",
  title: "Meeting",
  start,
  end,
  allDay: false,
  recurring: false,
  people: [],
});

test("calendar bars follow local midnights on both DST transition days", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const spring = new Date(2026, 2, 8);
    const springNext = new Date(2026, 2, 9);
    const springMeeting = event(new Date(2026, 2, 8, 23), new Date(2026, 2, 9, 0, 30));
    expect(layoutBars([springMeeting], [spring, springNext])).toMatchObject([{ from: 0, span: 2 }]);

    const autumn = new Date(2026, 10, 1);
    const autumnNext = new Date(2026, 10, 2);
    const autumnMeeting = event(new Date(2026, 10, 1, 22), new Date(2026, 10, 1, 23, 30));
    expect(layoutBars([autumnMeeting], [autumn, autumnNext])).toEqual([]);

    expect(layoutBars([event(new Date(2026, 2, 8, 23), springNext)], [spring, springNext])).toEqual([]);
    expect(layoutBars([{ ...autumnMeeting, allDay: true }], [autumn])).toHaveLength(1);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
