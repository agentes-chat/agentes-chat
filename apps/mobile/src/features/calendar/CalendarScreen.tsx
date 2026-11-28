import { type CalendarProposal, useCalendar, useCalendarAction } from "@agenteschat/client";
import { type CalItem, sameDay, startOfDay } from "@agenteschat/client/lib/calendar";
import { errorText } from "@agenteschat/client/lib/errors";
import { toYmd } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import { useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useOrg } from "@/providers/org";
import { type HeaderAction, SkeletonList, TOUCH, useReducedMotion, useTheme, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useNow, useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { successHaptic } from "../shared/parts";
import { CalRow, DayHeading, NothingOn, NowLine, type RowContext, rowProps } from "./DayParts";
import { listedParams } from "./EventScreen";
import {
  busyDays,
  calendarItems,
  dayOfYmd,
  monthStartOf,
  monthTitle,
  nextAfter,
  nowLineAfter,
  pagerMonths,
  readRange,
  rowsOn,
  stripWeeks,
  weekStartOf,
} from "./logic";
import { MonthGrid } from "./MonthGrid";
import { WeekStrip } from "./WeekStrip";

/** How far a drag on the handle (or how fast a flick) folds the month to its week, or opens it again. */
const FOLD_DISTANCE = 24;
const FOLD_SPEED = 400;
/** The handle's line. */
const GRABBER = 5;

/**
 * Calendário, pushed from Você › Trabalho (the month and the day, the approved direction): the month as the system's
 * large title, the bar's calendar button (back to today) and "+" (Novo evento, for who may post). Under the title the
 * month's grid, a quiet dot under each day that has something; then its handle, and the chosen day under it: its
 * heading and one line per item (the time, the kind's mark, the title), past ones faint, today's now line in red among
 * them, an agent's proposed time with its two answers. A day with nothing says so and shows what comes next ("Depois").
 * The grid is the list's header, so the large title folds with the list as it scrolls. Pulled up (or tapped), the
 * handle folds the month into its week strip; pulled down, it opens it again. A swipe on the grid pages months, on the
 * strip weeks; a tap on a day shows it. A row opens what it stands for: an event its page, a reminder its conversation,
 * a task due the task. Routines stay on their own page (ADR 0053's 2026-11-27 addendum).
 */
export function CalendarScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors: c } = useTheme();
  const toast = useToast();
  const reduced = useReducedMotion();
  const orgId = useOrgId();
  const { org } = useOrg();
  const dir = useDirectory();
  const { day: linked } = useLocalSearchParams<{ day?: string }>();
  // The clock the now line and the faint rows follow, a tick a minute; the day changes with it at midnight.
  const nowMs = useNow(60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const todayYmd = toYmd(now);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new day only when the date changes
  const today = useMemo(() => startOfDay(new Date(nowMs)), [todayYmd]);
  const months = useMemo(() => pagerMonths(today), [today]);
  const weeks = useMemo(() => stripWeeks(today), [today]);
  const [selected, setSelected] = useState<Date>(() => dayOfYmd(linked) ?? startOfDay(new Date()));
  const [month, setMonth] = useState<Date>(() => monthStartOf(selected));
  const [folded, setFolded] = useState(false);

  const { from, to } = useMemo(() => readRange(month, selected), [month, selected]);
  const range = useCalendar(orgId, from, to);
  const items = useMemo(() => calendarItems(range.data), [range.data]);
  const proposals = useMemo(() => range.data?.proposals ?? [], [range.data?.proposals]);
  // Another range's read on its way: the day's own rows' shape, not the last range's rows under this day.
  const loading = range.isLoading || range.isPlaceholderData;
  const pull = usePullRefresh(range.refetch);
  const busy = useMemo(
    () => (loading ? new Set<string>() : busyDays(items, proposals, new Date(from), new Date(to))),
    [loading, items, proposals, from, to],
  );
  const rows = useMemo(() => rowsOn(items, proposals, selected), [items, proposals, selected]);

  // A day tapped shows it (its month comes with it); a month or a week paged to lands on today when it holds today,
  // else on its first day, as the system's calendar does.
  const onDay = useCallback((day: Date) => {
    setSelected(day);
    setMonth(monthStartOf(day));
  }, []);
  const onMonth = useCallback(
    (next: Date) => {
      setMonth(next);
      setSelected(sameDay(next, monthStartOf(today)) ? today : next);
    },
    [today],
  );
  const onWeek = useCallback(
    (next: Date) => {
      const day = sameDay(next, weekStartOf(today)) ? today : next;
      setSelected(day);
      setMonth(monthStartOf(day));
    },
    [today],
  );
  const toToday = useCallback(() => onDay(today), [onDay, today]);

  // The handle: pulled up it folds the month into its week, pulled down it opens it; a tap does whichever it isn't.
  // The decision is made where the finger lets go, on the UI thread; React only hears the outcome.
  const fold = useCallback((next: boolean) => setFolded(next), []);
  const toggle = useCallback(() => setFolded((f) => !f), []);
  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onDeactivate: (e) => {
      "worklet";
      if (e.translationY < -FOLD_DISTANCE || e.velocityY < -FOLD_SPEED) scheduleOnRN(fold, true);
      else if (e.translationY > FOLD_DISTANCE || e.velocityY > FOLD_SPEED) scheduleOnRN(fold, false);
    },
  });
  const tap = useTapGesture({
    onDeactivate: (e) => {
      "worklet";
      if (!e.canceled) scheduleOnRN(toggle);
    },
  });
  const handle = useExclusiveGestures(pan, tap);

  const nameOf = useCallback((who: { type: string; id: string }) => dir.nameOf(who), [dir]);
  const onOpen = useCallback(
    (it: CalItem) => {
      if (it.kind === "event") router.push(`/calendar/event?${listedParams(it.key, from, to)}` as never);
      else if (it.kind === "reminder" && it.target && "channelId" in it.target)
        router.push(chatHref(it.target.channelId, "threadId" in it.target ? it.target.threadId : null) as never);
      else if (it.kind === "deadline" && it.issueNumber) router.push(`/issues/${it.issueNumber}` as never);
    },
    [from, to],
  );

  const action = useCalendarAction(orgId);
  const decide = useCallback(
    (proposal: CalendarProposal, decision: "confirm" | "dismiss") =>
      action.mutate(
        { type: decision, id: proposal.id },
        {
          onSuccess: () => {
            if (decision !== "confirm") return;
            successHaptic();
            toast({ title: t("calendar.confirmed"), agentId: proposal.agentId });
          },
          onError: (error) => toast({ title: errorText(t, error, locale), icon: "x" }),
        },
      ),
    [action, toast, t, locale],
  );
  const onConfirm = useCallback((p: CalendarProposal) => decide(p, "confirm"), [decide]);
  const onDismiss = useCallback((p: CalendarProposal) => decide(p, "dismiss"), [decide]);
  const ctx: RowContext = { locale, now, t, nameOf, onOpen, busy: action.isPending, onConfirm, onDismiss };

  const posts = can(org, "post");
  const openNew = () => router.push(`/calendar/new?day=${toYmd(selected)}` as never);
  const actions: HeaderAction[] = [
    { icon: "calendar", sf: "calendar", label: t("calendar.today"), onPress: toToday },
    ...(posts ? [{ icon: "plus" as const, sf: "plus" as const, label: t("calendar.new"), onPress: openNew }] : []),
  ];
  const isToday = sameDay(selected, today);
  const nowAfter = isToday ? nowLineAfter(rows, now) : -2;
  const next = !loading && rows.length === 0 ? nextAfter(items, proposals, selected, new Date(to)) : null;
  const motion = reduced ? {} : { entering: FadeIn.duration(160), exiting: FadeOut.duration(120) };

  return (
    <PushedLargeTitle
      title={monthTitle(locale, month, today)}
      actions={actions}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {folded ? (
        <Animated.View key="week" {...motion}>
          <WeekStrip
            weeks={weeks}
            week={weekStartOf(selected)}
            today={today}
            selected={selected}
            busy={busy}
            onWeek={onWeek}
            onDay={onDay}
          />
        </Animated.View>
      ) : (
        <Animated.View key="month" {...motion}>
          <MonthGrid
            months={months}
            month={month}
            today={today}
            selected={selected}
            busy={busy}
            onMonth={onMonth}
            onDay={onDay}
          />
        </Animated.View>
      )}
      <GestureDetector gesture={handle}>
        <View
          style={styles.handle}
          accessible
          accessibilityRole="button"
          accessibilityLabel={folded ? t("mobile.calendar.showMonth") : t("mobile.calendar.showWeek")}
          onAccessibilityTap={toggle}
        >
          <View style={[styles.grabber, { backgroundColor: c.label3 }]} />
        </View>
      </GestureDetector>
      <View style={[styles.day, { borderTopColor: c.separator }]}>
        <DayHeading day={selected} today={today} />
        {loading ? (
          // Loading (or another range on its way): the rows' own shape, never a spinner or the last range's rows.
          <SkeletonList rows={3} />
        ) : range.isError && !range.data ? (
          <LoadFailed onRetry={() => void range.refetch()} />
        ) : rows.length === 0 ? (
          <NothingOn
            next={next ? <CalRow {...rowProps(next.row, ctx, { divider: false, timeWord: next.day })} /> : null}
          />
        ) : (
          <>
            {nowAfter === -1 ? <NowLine now={now} /> : null}
            {rows.map((row, i) => (
              <Fragment key={row.kind === "entry" ? row.entry.key : `p-${row.proposal.id}`}>
                <CalRow {...rowProps(row, ctx, { divider: i > 0 && i - 1 !== nowAfter })} />
                {i === nowAfter ? <NowLine now={now} /> : null}
              </Fragment>
            ))}
          </>
        )}
      </View>
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  // The handle's line, a finger's 44 to pull or tap: its half under the line reaches over the day's heading's empty
  // top (never up into the grid's days), drawn over it so it takes the touch, nothing below it moved.
  handle: {
    height: TOUCH,
    marginTop: 2,
    marginBottom: -TOUCH / 2,
    paddingTop: (TOUCH / 2 - GRABBER) / 2,
    alignItems: "center",
    zIndex: 1,
  },
  grabber: { width: 36, height: GRABBER, borderRadius: 3 },
  day: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
});
