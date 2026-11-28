import { sameDay } from "@agenteschat/client/lib/calendar";
import { dateFormat, toYmd } from "@agenteschat/client/lib/format";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from "react-native";
import { CHROME_MAX_SCALE, PressScale, Text, useTheme, weights } from "@/ui";
import { weekDays } from "./logic";
import { LETTERS } from "./MonthGrid";

/** The number's circle: today filled in ink, the chosen day on the tonal plate. */
const DAY = 34;
const DOT = 4;

export interface WeekStripProps {
  /** Every week the strip pages through, oldest first (`stripWeeks`). */
  weeks: readonly Date[];
  /** The week shown: a change from outside ("Today") pages the strip to it. */
  week: Date;
  today: Date;
  selected: Date;
  /** The days that have something, by `YYYY-MM-DD`: one quiet dot each, as the month's grid. */
  busy: ReadonlySet<string>;
  /** A swipe landed on another week (stable). */
  onWeek: (week: Date) => void;
  /** A day tapped (stable). */
  onDay: (day: Date) => void;
}

/**
 * The month folded to its week, as the system's calendar draws it: seven columns (the weekday's letter, the day's
 * number, one quiet dot under a day that has something), today in a filled circle, the chosen day on a plate. A swipe
 * pages to the next or the last week, the system's own paging scroll on the native thread (nothing of ours moves per
 * frame); a tap on a day shows that day.
 */
export function WeekStrip({ weeks, week, today, selected, busy, onWeek, onDay }: WeekStripProps) {
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<Date>>(null);
  const shownAt = weeks.findIndex((w) => w.getTime() === week.getTime());
  // The page the strip rests on: a change of `week` that isn't where it rests (Today) pages it there.
  const at = useRef(shownAt);
  useEffect(() => {
    if (width === 0 || shownAt < 0 || shownAt === at.current) return;
    at.current = shownAt;
    list.current?.scrollToIndex({ index: shownAt, animated: true });
  }, [shownAt, width]);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width)), []);
  const onEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width === 0) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / width);
      const next = weeks[index];
      if (!next || index === at.current) return;
      at.current = index;
      onWeek(next);
    },
    [weeks, width, onWeek],
  );
  const layout = useCallback(
    (_: ArrayLike<Date> | null | undefined, index: number) => ({ length: width, offset: width * index, index }),
    [width],
  );
  const shownYmd = toYmd(week);
  const renderItem = useCallback(
    ({ item }: { item: Date }) => (
      <WeekPage
        start={item}
        width={width}
        today={today}
        selected={toYmd(item) === shownYmd ? selected : null}
        busy={busy}
        onDay={onDay}
      />
    ),
    [width, today, selected, busy, shownYmd, onDay],
  );
  return (
    <View onLayout={onLayout} style={styles.strip}>
      {width > 0 ? (
        <FlatList
          ref={list}
          data={weeks as Date[]}
          keyExtractor={toYmd}
          renderItem={renderItem}
          extraData={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={layout}
          initialScrollIndex={Math.max(0, shownAt)}
          initialNumToRender={1}
          windowSize={3}
          maxToRenderPerBatch={2}
          onMomentumScrollEnd={onEnd}
        />
      ) : (
        <View style={styles.room} />
      )}
    </View>
  );
}

/** One week's seven days. Drawn again only when the chosen day, today or its dots change. */
const WeekPage = memo(function WeekPage({
  start,
  width,
  today,
  selected,
  busy,
  onDay,
}: {
  start: Date;
  width: number;
  today: Date;
  selected: Date | null;
  busy: ReadonlySet<string>;
  onDay: (day: Date) => void;
}) {
  return (
    <View style={[styles.page, { width }]}>
      {weekDays(start).map((d, i) => (
        <DayCell
          key={toYmd(d)}
          day={d}
          letter={LETTERS[i] ?? "SU"}
          isToday={sameDay(d, today)}
          chosen={selected !== null && sameDay(d, selected)}
          busy={busy.has(toYmd(d))}
          onDay={onDay}
        />
      ))}
    </View>
  );
});

function DayCell({
  day,
  letter,
  isToday,
  chosen,
  busy,
  onDay,
}: {
  day: Date;
  letter: (typeof LETTERS)[number];
  isToday: boolean;
  chosen: boolean;
  busy: boolean;
  onDay: (day: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors: c } = useTheme();
  const said = dateFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(day);
  return (
    <PressScale
      haptic={false}
      fill={false}
      onPress={() => onDay(day)}
      accessibilityRole="button"
      accessibilityLabel={isToday ? `${t("calendar.today")}, ${said}` : said}
      accessibilityState={{ selected: chosen }}
      style={styles.cell}
      contentStyle={styles.cellIn}
    >
      <Text variant="caption" tone="faint" style={styles.letter}>
        {t(`recurrence.wd.${letter}.short`)}
      </Text>
      <View style={[styles.num, isToday ? { backgroundColor: c.ink } : chosen ? { backgroundColor: c.plate } : null]}>
        {/* Grown only as far as the fixed circle and the week's row hold it, as the weekday letters are. */}
        <Text
          variant="body"
          maxFontSizeMultiplier={CHROME_MAX_SCALE}
          style={[
            styles.digits,
            isToday ? { color: c.bg, fontWeight: weights.semibold } : chosen ? { fontWeight: weights.semibold } : null,
          ]}
        >
          {day.getDate()}
        </Text>
      </View>
      <View style={[styles.dot, busy ? { backgroundColor: c.label3 } : null]} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  // Its height held while its width is measured, so the list under it never jumps.
  strip: { minHeight: 70 },
  room: { height: 70 },
  page: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 8 },
  cell: { flex: 1 },
  // The column's target, a finger's 44 wide at least (the screen's seventh is wider on every phone).
  cellIn: { alignItems: "center", gap: 2, minHeight: 62, justifyContent: "flex-start" },
  letter: { fontWeight: weights.semibold },
  num: { width: DAY, height: DAY, borderRadius: DAY / 2, alignItems: "center", justifyContent: "center" },
  // Centred in its circle on Android too: no extra font padding under the digits (the kit's `countBadge`).
  digits: { fontVariant: ["tabular-nums"], includeFontPadding: false, textAlignVertical: "center" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
