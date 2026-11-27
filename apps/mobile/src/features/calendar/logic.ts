import type { Actor, CalendarEvent, CalendarProposal, CalendarRange, SeriesScope } from "@agenteschat/client";
import {
  addDays,
  type CalItem,
  type DayEntry,
  dayEntries,
  sameDay,
  startOfDay,
  toItems,
} from "@agenteschat/client/lib/calendar";
import { dateFormat, toYmd } from "@agenteschat/client/lib/format";

/**
 * Calendário on the phone (agenda, the approved direction): the week as a strip and, under it, the days that have
 * something, as a list: events, reminders, tasks due and the times agents propose (routines stay on their own page,
 * ADR 0053's 2026-11-27 addendum). Everything here is pure (no React Native), so `bun test` runs it; the item model
 * itself is the web's (`@agenteschat/client/lib/calendar`: `toItems`, `dayEntries`).
 */

/** The days a week strip shows: Sunday first, as the system's calendar in the languages the app speaks. */
export const WEEK_DAYS = 7;
/** How far the list reads from the shown week's first day: about a month, as the web's agenda (its empty state says so). */
export const AGENDA_DAYS = 30;
/** The strip's weeks around this one: half a year back, a year ahead. */
export const WEEKS_BACK = 26;
export const WEEKS_AHEAD = 52;

/** The Sunday (local midnight) of the week `d` falls in. */
export const weekStartOf = (d: Date) => addDays(startOfDay(d), -d.getDay());

/** The strip's pages, oldest first: `WEEKS_BACK` before this week, this week, then `WEEKS_AHEAD`. */
export function stripWeeks(today: Date): Date[] {
  const here = weekStartOf(today);
  return Array.from({ length: WEEKS_BACK + 1 + WEEKS_AHEAD }, (_, i) => addDays(here, (i - WEEKS_BACK) * WEEK_DAYS));
}

/** The seven days of a week, from its Sunday. */
export const weekDays = (start: Date) => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(start, i));

/** What the list reads for a week: [its Sunday, `AGENDA_DAYS` later). */
export function agendaRange(weekStart: Date): { from: string; to: string } {
  return { from: weekStart.toISOString(), to: addDays(weekStart, AGENDA_DAYS).toISOString() };
}

/** The list's days for a week: `AGENDA_DAYS` from its Sunday. */
export const agendaDays = (weekStart: Date) => Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(weekStart, i));

/** A `YYYY-MM-DD` back to its local midnight; null when it isn't one. */
export function dayOfYmd(ymd: unknown): Date | null {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
  return Number.isNaN(day.getTime()) ? null : day;
}

/** "27 nov": a day and its month, as the calendar writes them (no "de", no abbreviation dot). */
export const dayMonth = (locale: string, d: Date) =>
  dateFormat(locale, { day: "numeric", month: "short" }).format(d).replace(/\./g, "").replace(/ de /g, " ");

/** "sexta-feira": a day's name in the reader's language. */
export const weekdayName = (locale: string, d: Date) => dateFormat(locale, { weekday: "long" }).format(d);

/** "novembro": a month's name. */
export const monthName = (locale: string, d: Date) => dateFormat(locale, { month: "long" }).format(d);

/** The items of a range: events, reminders and tasks due (the range's routine runs stay out, as on the web). */
export const agendaItems = (range: CalendarRange | undefined): CalItem[] => toItems(range);

/** A reminder (a moment) is over once its time came; anything else once it ended. */
export const isOver = (item: CalItem, now: Date) => (item.kind === "reminder" ? item.start <= now : item.end <= now);

/** An all-day row of a day (a task due, an all-day event): first in its day, with no time of its own. */
export const isAllDayEntry = (e: DayEntry) => e.item.allDay;

/** One block of the list: a day with its rows (and the times agents proposed on it), or a run of days with nothing. */
export type AgendaSection =
  | { kind: "day"; key: string; day: Date; entries: DayEntry[]; proposals: CalendarProposal[] }
  | { kind: "quiet"; key: string; from: Date; to: Date };

/**
 * The list of a stretch of days: each day with something is a block (its rows, all day first, then by time), and the
 * days in a row with nothing fold into one quiet line. Today always has its block, even empty, as the now line lives
 * there.
 */
export function agendaSections(
  items: CalItem[],
  proposals: readonly CalendarProposal[],
  days: Date[],
  today: Date,
): AgendaSection[] {
  const out: AgendaSection[] = [];
  let quiet: Date[] = [];
  const flush = () => {
    const from = quiet[0];
    const to = quiet[quiet.length - 1];
    if (from && to) out.push({ kind: "quiet", key: `q-${toYmd(from)}`, from, to });
    quiet = [];
  };
  for (const day of days) {
    const entries = dayEntries(items, day);
    const asked = proposals
      .filter((p) => p.status === "pending" && sameDay(new Date(p.start), day))
      .sort((a, b) => a.start.localeCompare(b.start));
    if (entries.length === 0 && asked.length === 0 && !sameDay(day, today)) {
      quiet.push(day);
      continue;
    }
    flush();
    out.push({ kind: "day", key: toYmd(day), day, entries, proposals: asked });
  }
  flush();
  return out;
}

/** The block a day sits in (its own, or the quiet line that holds it), to scroll the list to it. */
export function sectionOfDay(sections: readonly AgendaSection[], day: Date): string | null {
  const t = startOfDay(day).getTime();
  for (const s of sections) {
    if (s.kind === "day" && sameDay(s.day, day)) return s.key;
    if (s.kind === "quiet" && t >= s.from.getTime() && t <= s.to.getTime()) return s.key;
  }
  return null;
}

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

/** Whose color a row's dot on the strip takes: its agent's, or none (a person's event, a task with nobody). */
export function rowAgent(row: DayRow): string | null {
  if (row.kind === "proposal") return row.proposal.agentId;
  const it = row.entry.item;
  if (it.agentId) return it.agentId;
  const owner = it.owner;
  return owner?.type === "agent" ? owner.id : null;
}

/**
 * The marks under a day on the strip: one per agent at work that day (its color) and one for people's own events,
 * at most three, agents first.
 */
export function dayMarks(sections: readonly AgendaSection[], day: Date, max = 3): (string | "people")[] {
  const block = sections.find((s) => s.kind === "day" && sameDay(s.day, day));
  if (block?.kind !== "day") return [];
  const agents: string[] = [];
  let people = false;
  for (const row of dayRows(block.entries, block.proposals)) {
    const agent = rowAgent(row);
    if (agent) {
      if (!agents.includes(agent)) agents.push(agent);
    } else people = true;
  }
  return [...agents, ...(people ? (["people"] as const) : [])].slice(0, max);
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

/** The people and agents of an event but the one reading it, for its line ("Bruno, Iris e Carla"). */
export const othersIn = (people: readonly Actor[], meId: string | null) =>
  people.filter((p) => !(p.type === "person" && p.id === meId));
