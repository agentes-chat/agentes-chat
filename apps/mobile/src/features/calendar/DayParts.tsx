import type { CalendarProposal } from "@agenteschat/client";
import { type CalItem, sameDay } from "@agenteschat/client/lib/calendar";
import { formatTime, upperFirst, uses12h } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, CHROME_MAX_SCALE, Icon, RowPressable, SCREEN_X, Text, useFontScale, useTheme, weights } from "@/ui";
import { AgentFace } from "../shared/Face";
import { type DayRow, isOn, isOver, markOf, type RowMark, shortWeekday, weekdayName } from "./logic";

/** The mark column: an agent's face, an event's dot or a task's mark, all in one 22 box. */
const MARK = 22;
const DOT = 9;
const GAP = 12;
/** The time's column: "14:00" (or "prazo", "dia todo"); wider where the clock has twelve hours ("10:30 AM"). */
export const timeWidth = (locale: string) => (uses12h(locale) ? 64 : 48);
/**
 * The time's column on screen: its width at the default text size, grown as far as its words grow (they stop at the
 * chrome's cap), so a larger text size never cuts "14:30" to "14:…".
 */
function useTimeWidth(locale: string) {
  return Math.round(timeWidth(locale) * Math.min(useFontScale(), CHROME_MAX_SCALE));
}
/** Where the hairline between a day's rows starts: its text column (16 + 48 + 12 + 22 + 12 = 110 at the default size). */
const insetOf = (time: number) => SCREEN_X + time + GAP + MARK + GAP;

const at = (d: Date) => d.toISOString();

/** A day's heading: "Hoje" and "sexta, 27", or the weekday and its date ("Sábado" 28). */
export function DayHeading({ day, today }: { day: Date; today: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isToday = sameDay(day, today);
  const big = isToday ? t("calendar.today") : upperFirst(weekdayName(locale, day), locale);
  const small = isToday ? `${weekdayName(locale, day)}, ${day.getDate()}` : String(day.getDate());
  return (
    <View style={styles.heading} accessible accessibilityRole="header" accessibilityLabel={`${big}, ${small}`}>
      <Text variant="title3">{big}</Text>
      <Text variant="small" tone="faint" numberOfLines={1} style={styles.shrink}>
        {small}
      </Text>
    </View>
  );
}

/** The time now across today's rows: its time in the time column, a red line with its dot. */
export function NowLine({ now }: { now: Date }) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const locale = i18n.language;
  const time = useTimeWidth(locale);
  return (
    <View style={styles.now} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text
        variant="footnote"
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        style={[styles.nowTime, { width: time, color: c.badge }]}
      >
        {formatTime(locale, at(now))}
      </Text>
      <View style={[styles.nowLine, { backgroundColor: c.badge }]}>
        <View style={[styles.nowDot, { backgroundColor: c.badge }]} />
      </View>
    </View>
  );
}

/** A row's kind as a mark, never as words: an agent's face, an event's dot in the agent blue, a task's mark. */
function Mark({ mark }: { mark: RowMark }) {
  const { colors: c } = useTheme();
  if (mark.kind === "agent") return <AgentFace agentId={mark.agentId} size={MARK} live={false} framed />;
  if (mark.kind === "event") return <View style={[styles.dot, { backgroundColor: c.agent }]} />;
  return <Icon name="issue" size={17} color={c.faint} />;
}

export interface CalRowProps {
  /** "14:00", or words in the time's place ("prazo", "dia todo", "seg, 30"). */
  time: string;
  /** The time column holds words: smaller and faint. */
  words: boolean;
  mark: RowMark;
  title: string;
  /** A second line only where it helps now (what's on: until when and where) or asks you (a proposal). */
  sub?: string | null;
  /** The second line asks you something: in the color of what waits on you. */
  asks?: boolean;
  /** Its buttons under the words (a proposal's answers). */
  acts?: ReactNode;
  past: boolean;
  /** A hairline above it (every row of a day but the first, and the one under the now line). */
  divider: boolean;
  /** What a tap opens; none for a row whose buttons answer it. */
  onPress?: () => void;
  /** What VoiceOver hears: the time, the title and its line. */
  said: string;
}

/**
 * One line of a day: the time in its column, the kind's mark, the title in 17 regular on one line; past rows faint
 * (the mark at half). The system's list row: it lights a beat after the finger lands and opens what it stands for.
 */
export const CalRow = memo(function CalRow({
  time,
  words,
  mark,
  title,
  sub,
  asks = false,
  acts,
  past,
  divider,
  onPress,
  said,
}: CalRowProps) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const timeCol = useTimeWidth(i18n.language);
  const body = (
    <>
      {divider ? <View style={[styles.divider, { left: insetOf(timeCol), backgroundColor: c.separator }]} /> : null}
      <Text
        variant={words ? "footnote" : "small"}
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        style={[
          styles.time,
          words ? styles.timeWords : null,
          { width: timeCol, color: past || words ? c.faint : c.ink2 },
        ]}
      >
        {time}
      </Text>
      <View style={[styles.mark, past ? styles.markPast : null]}>
        <Mark mark={mark} />
      </View>
      <View style={styles.text}>
        <Text variant="body" numberOfLines={1} style={{ color: past ? c.faint : c.ink }}>
          {title}
        </Text>
        {sub ? (
          <Text variant="small" numberOfLines={1} style={{ color: asks ? c.amber : c.muted }}>
            {sub}
          </Text>
        ) : null}
        {acts ? <View style={styles.acts}>{acts}</View> : null}
      </View>
    </>
  );
  return onPress ? (
    <RowPressable onPress={onPress} hold accessibilityRole="button" accessibilityLabel={said} style={styles.row}>
      {body}
    </RowPressable>
  ) : (
    <View style={styles.row} accessible={!acts} accessibilityLabel={acts ? undefined : said}>
      {body}
    </View>
  );
});

/** Names worked out once for the list, and what a row opens. */
export interface RowContext {
  locale: string;
  now: Date;
  t: ReturnType<typeof useTranslation>["t"];
  nameOf: (who: { type: string; id: string }) => string;
  onOpen: (item: CalItem) => void;
  busy: boolean;
  onConfirm: (proposal: CalendarProposal) => void;
  onDismiss: (proposal: CalendarProposal) => void;
}

/**
 * A day's row as `CalRow` draws it: an item's time (or "prazo" for a task due, "dia todo" for an all-day event), its
 * mark and title, "até 15:00 · Sala 2" while it's on; an agent's proposal with "Proposta do Theo" and its two answers.
 * `timeWord` puts a day in the time's place ("seg, 30", under "Depois").
 */
export function rowProps(
  row: DayRow,
  ctx: RowContext,
  { divider, timeWord }: { divider: boolean; timeWord?: Date },
): CalRowProps {
  const { locale, now, t } = ctx;
  const mark = markOf(row);
  if (row.kind === "proposal") {
    const p = row.proposal;
    const g = agentGrammar(ctx.nameOf({ type: "agent", id: p.agentId }));
    const time = timeWord ? shortWeekday(locale, timeWord) : formatTime(locale, p.start);
    const sub = t("mobile.calendar.proposalBy", { name: g.name, context: g.context });
    return {
      time,
      words: Boolean(timeWord),
      mark,
      title: p.title,
      sub,
      asks: true,
      acts: (
        <>
          <Button
            variant="primary"
            size="sm"
            label={t("mobile.calendar.confirm")}
            disabled={ctx.busy}
            onPress={() => ctx.onConfirm(p)}
          />
          <Button
            variant="secondary"
            size="sm"
            label={t("calendar.otherTime")}
            disabled={ctx.busy}
            onPress={() => ctx.onDismiss(p)}
          />
        </>
      ),
      past: false,
      divider,
      said: [time, p.title, sub].join(", "),
    };
  }
  const it = row.entry.item;
  const start = formatTime(locale, at(row.entry.at));
  const allDayWord = it.kind === "deadline" ? t("mobile.calendar.due") : t("mobile.calendar.allDay");
  const time = timeWord ? shortWeekday(locale, timeWord) : it.allDay ? allDayWord : start;
  const words = Boolean(timeWord) || it.allDay;
  // While it's on, until when and where; under "Depois", its own time beside the day.
  const on = !timeWord && it.kind === "event" && !it.allDay && isOn(it, now);
  const sub = timeWord
    ? it.allDay
      ? allDayWord
      : start
    : on
      ? [t("mobile.calendar.until", { time: formatTime(locale, at(it.end)) }), it.location].filter(Boolean).join(" · ")
      : null;
  return {
    time,
    words,
    mark,
    title: it.title,
    sub,
    past: !timeWord && isOver(it, now),
    divider,
    onPress: () => ctx.onOpen(it),
    said: [time, it.title, sub].filter(Boolean).join(", "),
  };
}

/** A day with nothing on it: one quiet sentence, then what comes next ("Depois"), when something does. */
export function NothingOn({ next }: { next: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text variant="body" tone="muted" style={styles.nothing}>
        {t("mobile.calendar.nothingThatDay")}
      </Text>
      {next ? (
        <>
          <Text variant="footnote" tone="faint" style={styles.after} accessibilityRole="header">
            {t("mobile.calendar.after")}
          </Text>
          {next}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingTop: 22,
    paddingBottom: 4,
    paddingHorizontal: SCREEN_X,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: GAP, paddingVertical: 11, paddingHorizontal: SCREEN_X },
  divider: { position: "absolute", top: 0, right: 0, height: StyleSheet.hairlineWidth },
  // The time on the title's line: 15 on the title's 22, tabular so the column reads straight.
  time: { lineHeight: 22, fontVariant: ["tabular-nums"] },
  timeWords: { lineHeight: 22 },
  mark: { width: MARK, height: 22, alignItems: "center", justifyContent: "center" },
  markPast: { opacity: 0.5 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  now: {
    flexDirection: "row",
    alignItems: "center",
    height: 16,
    marginTop: -3,
    marginBottom: -2,
    paddingLeft: SCREEN_X,
    zIndex: 1,
  },
  nowTime: { fontWeight: weights.semibold, fontVariant: ["tabular-nums"] },
  nowLine: { flex: 1, height: 1.5, marginLeft: GAP },
  nowDot: { position: "absolute", left: 7, top: -3.25, width: 8, height: 8, borderRadius: 4 },
  nothing: { paddingHorizontal: SCREEN_X, paddingTop: 10, paddingBottom: 4 },
  after: { paddingHorizontal: SCREEN_X, paddingTop: 28, paddingBottom: 8, fontWeight: weights.semibold },
});
