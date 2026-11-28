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
import { monthWeeks } from "./logic";

/** The weekday letters, Sunday first (the shared `recurrence.wd.*.short`: "D S T Q Q S S"). */
export const LETTERS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
/** The number's circle: today filled in ink, the chosen day on the plate. */
const DAY = 34;
/** A week's row: the circle, its dot and the room between rows. */
const ROW = 46;
const DOT = 4;

export interface MonthGridProps {
  /** Every month the grid pages through, oldest first (`pagerMonths`). */
  months: readonly Date[];
  /** The month shown: a change from outside (today) pages the grid to it. */
  month: Date;
  today: Date;
  selected: Date;
  /** The days that have something, by `YYYY-MM-DD`: one quiet dot each. */
  busy: ReadonlySet<string>;
  /** A swipe landed on another month (stable). */
  onMonth: (month: Date) => void;
  /** A day tapped (stable). */
  onDay: (day: Date) => void;
}

/**
 * The month under its large title, as the system's calendar draws it: the weekday letters, then its weeks (only the
 * month's own days, the rest blank), today in the ink circle, the chosen day on the plate, one quiet dot under a day
 * that has something (never an agent's color: the list says whose). A swipe pages to the next or the last month, the
 * system's own paging scroll on the native thread; a tap on a day shows that day under the grid. The pager is as tall
 * as the shown month's weeks.
 */
export function MonthGrid({ months, month, today, selected, busy, onMonth, onDay }: MonthGridProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<Date>>(null);
  const shownAt = months.findIndex((m) => m.getTime() === month.getTime());
  // The page the grid rests on: a change of `month` that isn't where it rests (today) pages it there.
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
      const next = months[index];
      if (!next || index === at.current) return;
      at.current = index;
      onMonth(next);
    },
    [months, width, onMonth],
  );
  const layout = useCallback(
    (_: ArrayLike<Date> | null | undefined, index: number) => ({ length: width, offset: width * index, index }),
    [width],
  );
  const shownYmd = toYmd(month);
  const renderItem = useCallback(
    ({ item }: { item: Date }) => (
      <MonthPage
        month={item}
        width={width}
        today={today}
        selected={toYmd(item) === shownYmd ? selected : null}
        busy={toYmd(item) === shownYmd ? busy : NONE}
        onDay={onDay}
      />
    ),
    [width, today, selected, busy, shownYmd, onDay],
  );
  const height = monthWeeks(month).length * ROW;
  return (
    <View onLayout={onLayout}>
      <View style={styles.letters} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {LETTERS.map((l) => (
          <Text key={l} variant="caption" tone="faint" style={styles.letter}>
            {t(`recurrence.wd.${l}.short`)}
          </Text>
        ))}
      </View>
      <View style={{ height }}>
        {width > 0 ? (
          <FlatList
            ref={list}
            data={months as Date[]}
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
        ) : null}
      </View>
    </View>
  );
}

const NONE: ReadonlySet<string> = new Set();

/** One month's weeks. Drawn again only when the chosen day, today or its dots change. */
const MonthPage = memo(function MonthPage({
  month,
  width,
  today,
  selected,
  busy,
  onDay,
}: {
  month: Date;
  width: number;
  today: Date;
  selected: Date | null;
  busy: ReadonlySet<string>;
  onDay: (day: Date) => void;
}) {
  return (
    <View style={[styles.page, { width }]}>
      {monthWeeks(month).map((week) => (
        <View key={toYmd(week.find(Boolean) ?? month)} style={styles.week}>
          {week.map((d, i) =>
            d ? (
              <DayCell
                key={toYmd(d)}
                day={d}
                isToday={sameDay(d, today)}
                chosen={selected !== null && sameDay(d, selected)}
                busy={busy.has(toYmd(d))}
                onDay={onDay}
              />
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: a blank cell's place in its week
              <View key={`blank-${i}`} style={styles.cell} />
            ),
          )}
        </View>
      ))}
    </View>
  );
});

/** A day of the grid: its number in the 34 circle and its dot; the system's own press. */
export function DayCell({
  day,
  isToday,
  chosen,
  busy,
  onDay,
}: {
  day: Date;
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
  letters: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 6 },
  letter: { flex: 1, textAlign: "center", lineHeight: 22, fontWeight: weights.semibold },
  page: { paddingHorizontal: 8 },
  week: { flexDirection: "row", height: ROW },
  cell: { flex: 1 },
  // The column's target, a finger's 44 at least (the screen's seventh is wider on every phone).
  cellIn: { alignItems: "center", gap: 2, minHeight: 44 },
  num: { width: DAY, height: DAY, borderRadius: DAY / 2, alignItems: "center", justifyContent: "center" },
  // Centred in its circle on Android too: no extra font padding under the digits (the kit's `countBadge`).
  digits: { fontVariant: ["tabular-nums"], includeFontPadding: false, textAlignVertical: "center" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
