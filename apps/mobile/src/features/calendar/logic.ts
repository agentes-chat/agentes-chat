import type { Actor, CalendarEvent, CalendarProposal, CalendarRange, SeriesScope } from "@agenteschat/client";
import {
  addDays,
  type CalItem,
  type DayEntry,
  dayEntries,
  onDay,
  sameDay,
  startOfDay,
  toItems,
} from "@agenteschat/client/lib/calendar";
import { dateFormat, toYmd, upperFirst } from "@agenteschat/client/lib/format";
import type { TFunction } from "i18next";
import type { RulePreset } from "../routines/rule";

/**
 * Calendário on the phone (the month and the day, the approved direction): the month as the large title, its grid
 * with a dot under each day that has something, and the chosen day's items under it, one line each: events, reminders,
 * tasks due and the times agents propose (routines stay on their own page, ADR 0053's 2026-11-27 addendum). The grid
 * folds into the week strip. Everything here is pure (no React Native), so `bun test` runs it; the item model itself is
 * the web's (`@agenteschat/client/lib/calendar`: `toItems`, `dayEntries`).
 */

/** The days a week strip shows: Sunday first, as the system's calendar in the languages the app speaks. */
export const WEEK_DAYS = 7;
/** The strip's weeks around this one: half a year back, a year ahead. */
export const WEEKS_BACK = 26;
export const WEEKS_AHEAD = 52;
/** The month pager's months around this one: a year back, two ahead. */
export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 24;
/** How far past the chosen day the screen reads, so an empty day can say what comes next. */
export const NEXT_DAYS = 31;

/** The Sunday (local midnight) of the week `d` falls in. */
export const weekStartOf = (d: Date) => addDays(startOfDay(d), -d.getDay());

/** The first day (local midnight) of the month `d` falls in. */
export const monthStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** The first day of the month `n` months after `month`'s. */
export const addMonths = (month: Date, n: number) => new Date(month.getFullYear(), month.getMonth() + n, 1);

/** The strip's pages, oldest first: `WEEKS_BACK` before this week, this week, then `WEEKS_AHEAD`. */
export function stripWeeks(today: Date): Date[] {
  const here = weekStartOf(today);
  return Array.from({ length: WEEKS_BACK + 1 + WEEKS_AHEAD }, (_, i) => addDays(here, (i - WEEKS_BACK) * WEEK_DAYS));
}

/** The pager's months, oldest first: `MONTHS_BACK` before this month, this month, then `MONTHS_AHEAD`. */
export function pagerMonths(today: Date): Date[] {
  const here = monthStartOf(today);
  return Array.from({ length: MONTHS_BACK + 1 + MONTHS_AHEAD }, (_, i) => addMonths(here, i - MONTHS_BACK));
}

/** The seven days of a week, from its Sunday. */
export const weekDays = (start: Date) => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(start, i));

/**
 * A month's grid: its weeks, Sunday first, each seven cells; a cell outside the month is null (the grid leaves it
 * blank, as the system's calendar does). Four to six weeks, as the month needs.
 */
export function monthWeeks(month: Date): (Date | null)[][] {
  const first = monthStartOf(month);
  const next = addMonths(first, 1);
  const weeks: (Date | null)[][] = [];
  for (let start = weekStartOf(first); start < next; start = addDays(start, WEEK_DAYS))
    weeks.push(weekDays(start).map((d) => (d.getMonth() === first.getMonth() ? d : null)));
  return weeks;
}

/**
 * What the screen reads: the shown month (the grid's dots), the chosen day's week (the folded strip's), and a month past
 * the chosen day (what comes next after an empty day), as one range.
 */
export function readRange(month: Date, selected: Date): { from: string; to: string } {
  const monthFrom = monthStartOf(month);
  const weekFrom = weekStartOf(selected);
  const from = weekFrom < monthFrom ? weekFrom : monthFrom;
  const ends = [addMonths(monthFrom, 1), addDays(weekFrom, WEEK_DAYS), addDays(startOfDay(selected), NEXT_DAYS)];
  const to = ends.reduce((a, b) => (b > a ? b : a));
  return { from: from.toISOString(), to: to.toISOString() };
}

/** A `YYYY-MM-DD` back to its local midnight; null when it isn't one. */
export function dayOfYmd(ymd: unknown): Date | null {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
  return Number.isNaN(day.getTime()) ? null : day;
}

/** "sexta-feira": a day's name in the reader's language. */
export const weekdayName = (locale: string, d: Date) => dateFormat(locale, { weekday: "long" }).format(d);

/** "seg, 30": a short weekday and its date, for a day in a time's column ("Depois"). */
export const shortWeekday = (locale: string, d: Date) =>
  `${dateFormat(locale, { weekday: "short" }).format(d).replace(/\./g, "")}, ${d.getDate()}`;

/** "sex, 27 de nov": a day with its weekday and month, short (an event's Dia, the form's day chips). */
export const shortDate = (locale: string, d: Date) =>
  dateFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d).replace(/\./g, "");

/** How an event repeats, in the words the form offers ("Não repete", "Todo dia", …; a rule of its own "Do seu jeito"). */
export const repeatWord = (t: TFunction, preset: RulePreset) =>
  preset === "once"
    ? t("mobile.calendar.noRepeat")
    : preset === "daily"
      ? t("recurrence.s.daily", { count: 1 })
      : preset === "business"
        ? t("recurrence.s.businessDays")
        : preset === "weekly"
          ? t("recurrence.s.weekly", { count: 1 })
          : preset === "monthly"
            ? t("recurrence.s.monthly", { count: 1 })
            : t("mobile.routines.when.custom");

/** The large title: the month ("Novembro"), with its year when it isn't this year's ("Janeiro de 2028"). */
export const monthTitle = (locale: string, month: Date, today: Date) =>
  upperFirst(
    dateFormat(
      locale,
      month.getFullYear() === today.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" },
    ).format(month),
    locale,
  );

/** The items of a range: events, reminders and tasks due (the range's routine runs stay out, as on the web). */
export const calendarItems = (range: CalendarRange | undefined): CalItem[] => toItems(range);

/** A reminder (a moment) is over once its time came; anything else once it ended. */
export const isOver = (item: CalItem, now: Date) => (item.kind === "reminder" ? item.start <= now : item.end <= now);

/** On now: started and not ended yet (a reminder is a moment, never on). */
export const isOn = (item: CalItem, now: Date) => item.kind !== "reminder" && item.start <= now && item.end > now;

/** An all-day row of a day (a task due, an all-day event): first in its day, with no time of its own. */
export const isAllDayEntry = (e: DayEntry) => e.item.allDay;

/** The agents' proposals still waiting for an answer that fall on `day`, by their start. */
export const proposalsOn = (proposals: readonly CalendarProposal[], day: Date) =>
  proposals
    .filter((p) => p.status === "pending" && sameDay(new Date(p.start), day))
    .sort((a, b) => a.start.localeCompare(b.start));

/** One row of a day in the order it shows: an item, or an agent's proposed time placed at its start. */
export type DayRow = { kind: "entry"; entry: DayEntry } | { kind: "proposal"; proposal: CalendarProposal };

/** A day's rows with its proposals among them, by time (all day first). */
export function dayRows(entries: readonly DayEntry[], proposals: readonly CalendarProposal[]): DayRow[] {
  const rows: (DayRow & { at: number; allDay: boolean })[] = [
    ...entries.map((entry) => ({
      kind: "entry" as const,
      entry,
      at: entry.at.getTime(),
      allDay: isAllDayEntry(entry),
    })),
    ...proposals.map((proposal) => ({
      kind: "proposal" as const,
      proposal,
      at: new Date(proposal.start).getTime(),
      allDay: false,
    })),
  ];
  return rows
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at - b.at)
    .map(({ at: _at, allDay: _allDay, ...row }) => row as DayRow);
}

/** The rows of one day of a range. */
export const rowsOn = (items: CalItem[], proposals: readonly CalendarProposal[], day: Date) =>
  dayRows(dayEntries(items, day), proposalsOn(proposals, day));

/**
 * The days of a range that have something (an item that falls on them, all its days for one that spans several, or a
 * proposal waiting), by `YYYY-MM-DD`: one quiet dot each on the grid and the strip.
 */
export function busyDays(
  items: readonly CalItem[],
  proposals: readonly CalendarProposal[],
  from: Date,
  to: Date,
): Set<string> {
  const out = new Set<string>();
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) if (items.some((it) => onDay(it, d))) out.add(toYmd(d));
  for (const p of proposals) if (p.status === "pending") out.add(toYmd(new Date(p.start)));
  return out;
}

/** After an empty day: the next day with something within the range read, and its first row ("Depois"). */
export function nextAfter(
  items: CalItem[],
  proposals: readonly CalendarProposal[],
  day: Date,
  to: Date,
): { day: Date; row: DayRow } | null {
  for (let d = addDays(startOfDay(day), 1); d < to; d = addDays(d, 1)) {
    const row = rowsOn(items, proposals, d)[0];
    if (row) return { day: d, row };
  }
  return null;
}

/**
 * Where today's now line goes among its rows: after the last row that already started (all-day rows count as
 * started), so the line falls between what passed and what's next.
 */
export function nowLineAfter(rows: readonly DayRow[], now: Date): number {
  let after = -1;
  rows.forEach((row, i) => {
    const started =
      row.kind === "entry"
        ? isAllDayEntry(row.entry) || row.entry.at.getTime() <= now.getTime()
        : new Date(row.proposal.start).getTime() <= now.getTime();
    if (started) after = i;
  });
  return after;
}

/** The mark a row's kind takes: an agent's face (its reminder, an event it made), an event's dot, a task's mark. */
export type RowMark = { kind: "agent"; agentId: string } | { kind: "event" } | { kind: "task" };

export function markOf(row: DayRow): RowMark {
  if (row.kind === "proposal") return { kind: "agent", agentId: row.proposal.agentId };
  const it = row.entry.item;
  if (it.kind === "deadline") return { kind: "task" };
  if (it.agentId) return { kind: "agent", agentId: it.agentId };
  return { kind: "event" };
}

/** Range events by the key their items use (an occurrence: its series and its start), as the web keeps them. */
export function eventsByKey(range: CalendarRange | undefined): Map<string, CalendarEvent> {
  const map = new Map<string, CalendarEvent>();
  for (const e of range?.events ?? [])
    map.set(e.occurrenceStart ? `${e.seriesId ?? e.id}@${e.occurrenceStart}` : e.id, e);
  return map;
}

/** A recurring event: a change or a delete asks which occurrences. */
export const isSeries = (e: CalendarEvent | undefined) => Boolean(e?.rule && e.rule.freq !== "once");

/** What a change of one occurrence of a series says, given which ones it reaches. */
export const seriesOf = (e: CalendarEvent, scope: SeriesScope) => ({
  scope,
  occurrenceStart: e.occurrenceStart ?? e.start,
});

/** The people and agents of an event but the one reading it. */
export const othersIn = (people: readonly Actor[], meId: string | null) =>
  people.filter((p) => !(p.type === "person" && p.id === meId));
