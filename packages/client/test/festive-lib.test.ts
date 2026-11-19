import { describe, expect, test } from "bun:test";
import { easterSunday, FESTIVE_DAYS, FESTIVE_VARIATIONS, festiveDayOf, festiveMoodOf } from "../src/lib/festive";

/** A local calendar day at an hour (months 1–12). */
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("festive moods", () => {
  test("Easter Sunday by the Gregorian computus", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2038)).toEqual({ month: 4, day: 25 });
  });

  test("Carnival: Saturday to Ash Wednesday, from Easter", () => {
    // 2026: Feb 14 (Sat) to Feb 18 (Ash Wednesday).
    expect(festiveDayOf(day(2026, 2, 13))).toBeNull();
    expect(festiveDayOf(day(2026, 2, 14))).toBe("carnival");
    expect(festiveDayOf(day(2026, 2, 17))).toBe("carnival");
    expect(festiveDayOf(day(2026, 2, 18))).toBe("carnival");
    expect(festiveDayOf(day(2026, 2, 19))).toBeNull();
    // 2027: Feb 6 to Feb 10.
    expect(festiveDayOf(day(2027, 2, 5))).toBeNull();
    expect(festiveDayOf(day(2027, 2, 6))).toBe("carnival");
    expect(festiveDayOf(day(2027, 2, 10))).toBe("carnival");
    expect(festiveDayOf(day(2027, 2, 11))).toBeNull();
  });

  test("Easter: Good Friday to Sunday", () => {
    expect(festiveDayOf(day(2026, 4, 2))).toBeNull();
    expect(festiveDayOf(day(2026, 4, 3))).toBe("easter");
    expect(festiveDayOf(day(2026, 4, 5))).toBe("easter");
    expect(festiveDayOf(day(2026, 4, 6))).toBeNull();
    expect(festiveDayOf(day(2027, 3, 26))).toBe("easter");
    expect(festiveDayOf(day(2027, 3, 28))).toBe("easter");
    expect(festiveDayOf(day(2027, 3, 29))).toBeNull();
  });

  test("the fixed dates and their days around, in both years", () => {
    for (const y of [2026, 2027]) {
      expect(festiveDayOf(day(y, 12, 19))).toBeNull();
      expect(festiveDayOf(day(y, 12, 20, 0))).toBe("christmas");
      expect(festiveDayOf(day(y, 12, 26, 23))).toBe("christmas");
      expect(festiveDayOf(day(y, 12, 27))).toBeNull();
      expect(festiveDayOf(day(y, 12, 29))).toBeNull();
      expect(festiveDayOf(day(y, 12, 30))).toBe("newYear");
      expect(festiveDayOf(day(y, 12, 31))).toBe("newYear");
      expect(festiveDayOf(day(y, 1, 1))).toBe("newYear");
      expect(festiveDayOf(day(y, 1, 2))).toBeNull();
      expect(festiveDayOf(day(y, 6, 12))).toBe("valentines");
      expect(festiveDayOf(day(y, 6, 13))).toBeNull();
      expect(festiveDayOf(day(y, 6, 19))).toBeNull();
      expect(festiveDayOf(day(y, 6, 20))).toBe("saoJoao");
      expect(festiveDayOf(day(y, 6, 24))).toBe("saoJoao");
      expect(festiveDayOf(day(y, 6, 29))).toBe("saoJoao");
      expect(festiveDayOf(day(y, 6, 30))).toBeNull();
      expect(festiveDayOf(day(y, 10, 12))).toBe("childrensDay");
      expect(festiveDayOf(day(y, 10, 31))).toBe("halloween");
      expect(festiveDayOf(day(y, 11, 1))).toBeNull();
    }
    expect(festiveDayOf(day(2026, 11, 19))).toBeNull();
    expect(festiveMoodOf(day(2026, 11, 19))).toBeNull();
  });

  test("a day's variation is the same all day and changes across the date's days", () => {
    const morning = festiveMoodOf(day(2026, 12, 22, 0));
    expect(festiveMoodOf(day(2026, 12, 22, 23))).toEqual(morning);
    expect(morning?.day).toBe("christmas");
    const week = [20, 21, 22, 23, 24, 25, 26].map((d) => JSON.stringify(festiveMoodOf(day(2026, 12, d))));
    expect(new Set(week).size).toBe(FESTIVE_VARIATIONS.christmas.length);
    // Next to each other, two days of one date never look the same.
    for (let i = 1; i < week.length; i++) expect(week[i]).not.toBe(week[i - 1]);
  });

  test("every date has a few variations, each a known accessory, particles and tones", () => {
    for (const d of FESTIVE_DAYS) {
      const list = FESTIVE_VARIATIONS[d];
      expect(list.length).toBeGreaterThanOrEqual(2);
      for (const v of list) {
        expect(v.tint).toMatch(/^#[0-9a-f]{6}$/);
        for (const c of v.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
        expect(v.tintAmount).toBeGreaterThan(0);
        expect(v.tintAmount).toBeLessThanOrEqual(0.25);
      }
    }
  });
});
