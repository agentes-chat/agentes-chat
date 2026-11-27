import { type CalendarProposal, useCalendar, useCalendarAction, useChannels } from "@agenteschat/client";
import { type CalItem, sameDay, startOfDay } from "@agenteschat/client/lib/calendar";
import { errorText } from "@agenteschat/client/lib/errors";
import { toYmd, upperFirst } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import { gradientOf } from "@agenteschat/ui/agent/engine";
import { useLocalSearchParams } from "expo-router";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LayoutChangeEvent,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import { Button, EmptyState, SCREEN_X, SkeletonList, Text, useReducedMotion, useTheme, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useMeId, useNow, useOrgId, usePullRefresh } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { PushedHeader, successHaptic } from "../shared/parts";
import { AgendaRow, DayHeader, NothingToday, NowLine, ProposalCard, QuietLine } from "./AgendaParts";
import {
  type AgendaSection,
  agendaDays,
  agendaItems,
  agendaRange,
  agendaSections,
  type DayRow,
  dayMarks,
  dayOfYmd,
  dayRows,
  isOver,
  monthName,
  nowLineAfter,
  sectionOfDay,
  stripWeeks,
  weekDays,
  weekStartOf,
} from "./logic";
import { WeekStrip } from "./WeekStrip";

/** Where the list lands: a day's block, on the first load at once, on a tap gliding. */
interface Landing {
  day: Date;
  animated: boolean;
}

/**
 * Calendário, pushed from Você › Trabalho (the approved agenda): the bar with its title and "+" (Novo evento, for who
 * may post), the month over the week strip, then the days that have something as a list (`agendaSections`): each day
 * its heading and its rows, all day first, then by time, past ones faint, today's now line in red among them, an
 * agent's proposed time as a card with its answers; days in a row with nothing fold into one quiet line. It opens on
 * today (or the day of a link, `?day=`); a tap on a day of the strip takes the list to it, a swipe pages to another
 * week and the list reads from that week on. A row opens what it stands for: an event its page, a reminder its
 * conversation, a task due the task. Routines stay on their own page (ADR 0053's 2026-11-27 addendum).
 */
export function CalendarScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduced = useReducedMotion();
  const orgId = useOrgId();
  const { org } = useOrg();
  const meId = useMeId();
  const dir = useDirectory();
  const { day: linked } = useLocalSearchParams<{ day?: string }>();
  // The clock the now line and the faint rows follow, a tick a minute; the day changes with it at midnight.
  const nowMs = useNow(60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const todayYmd = toYmd(now);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new day only when the date changes
  const today = useMemo(() => startOfDay(new Date(nowMs)), [todayYmd]);
  const weeks = useMemo(() => stripWeeks(today), [today]);
  const [selected, setSelected] = useState<Date>(() => dayOfYmd(linked) ?? startOfDay(new Date()));
  const [week, setWeek] = useState<Date>(() => weekStartOf(selected));
  const thisWeek = useMemo(() => weekStartOf(today), [today]);

  const days = useMemo(() => agendaDays(week), [week]);
  const { from, to } = useMemo(() => agendaRange(week), [week]);
  const range = useCalendar(orgId, from, to);
  const items = useMemo(() => agendaItems(range.data), [range.data]);
  const sections = useMemo(
    () => agendaSections(items, range.data?.proposals ?? [], days, today),
    [items, range.data?.proposals, days, today],
  );
  // Another week's read on its way: its own rows' shape, not the last week's rows under this week's days.
  const loading = range.isLoading || range.isPlaceholderData;
  const pull = usePullRefresh(range.refetch);

  // The strip's marks for the shown week: each agent at work that day in its color, people's events in faint.
  const marks = useMemo(() => {
    const out = new Map<string, readonly string[]>();
    if (loading) return out;
    for (const d of weekDays(week))
      out.set(
        toYmd(d),
        dayMarks(sections, d).map((m) => (m === "people" ? c.faint : gradientOf(agentLook(dir.anyAgent(m)).color)[1])),
      );
    return out;
  }, [loading, week, sections, c.faint, dir]);

  // Each block's place in the list (by the week it was laid out for), and where to land once it is there.
  const scroll = useRef<ScrollViewInstance>(null);
  const places = useRef({ week: week.getTime(), y: new Map<string, number>() });
  const landing = useRef<Landing | null>({ day: selected, animated: false });
  const landNow = useCallback(
    (land: Landing) => {
      const key = sectionOfDay(sections, land.day);
      const y = key && places.current.week === week.getTime() ? places.current.y.get(key) : undefined;
      if (y === undefined) {
        landing.current = land;
        return;
      }
      landing.current = null;
      scroll.current?.scrollTo({ y: Math.max(0, y - 4), animated: land.animated && !reduced });
    },
    [sections, week, reduced],
  );
  const onPlace = useCallback(
    (key: string, e: LayoutChangeEvent) => {
      if (places.current.week !== week.getTime()) places.current = { week: week.getTime(), y: new Map() };
      places.current.y.set(key, e.nativeEvent.layout.y);
      const land = landing.current;
      if (land && !loading && sectionOfDay(sections, land.day) === key) landNow(land);
    },
    [week, sections, loading, landNow],
  );

  const onDay = useCallback(
    (day: Date) => {
      setSelected(day);
      landNow({ day, animated: true });
    },
    [landNow],
  );
  const onWeek = useCallback(
    (next: Date) => {
      const day = sameDay(next, thisWeek) ? today : next;
      setWeek(next);
      setSelected(day);
      landing.current = { day, animated: false };
      scroll.current?.scrollTo({ y: 0, animated: false });
    },
    [thisWeek, today],
  );
  const toToday = () => onWeek(thisWeek);

  const channels = useChannels(orgId).data;
  const placeOf = useCallback(
    (channelId: string) => {
      const name = channels?.find((ch) => ch.id === channelId)?.name;
      return name ? `#${name}` : null;
    },
    [channels],
  );
  const nameOf = useCallback((who: { type: string; id: string }) => dir.nameOf(who), [dir]);
  const weekYmd = toYmd(week);
  const onOpen = useCallback(
    (it: CalItem) => {
      if (it.kind === "event") router.push(`/calendar/event?key=${encodeURIComponent(it.key)}&w=${weekYmd}` as never);
      else if (it.kind === "reminder" && it.target && "channelId" in it.target)
        router.push(chatHref(it.target.channelId, "threadId" in it.target ? it.target.threadId : null) as never);
      else if (it.kind === "deadline" && it.issueNumber) router.push(`/issues/${it.issueNumber}` as never);
    },
    [weekYmd],
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

  const posts = can(org, "post");
  const openNew = () => router.push(`/calendar/new?day=${toYmd(selected)}` as never);
  const empty = sections.every((s) => s.kind === "quiet" || (s.entries.length === 0 && s.proposals.length === 0));
  const monthOf = selected;

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <PushedHeader
        title={t("calendar.title")}
        {...(posts ? { actions: [{ icon: "plus", sf: "plus", label: t("calendar.new"), onPress: openNew }] } : {})}
      />
      <View style={[styles.top, { borderBottomColor: c.separator }]}>
        <View style={styles.month}>
          <Text variant="title2" numberOfLines={1} style={styles.shrink}>
            {upperFirst(monthName(locale, monthOf), locale)}
            <Text variant="title2" tone="faint" style={styles.year}>{` ${monthOf.getFullYear()}`}</Text>
          </Text>
          {sameDay(week, thisWeek) ? null : (
            <Button variant="text" size="sm" label={t("calendar.today")} onPress={toToday} />
          )}
        </View>
        <WeekStrip
          weeks={weeks}
          week={week}
          today={today}
          selected={selected}
          marks={marks}
          onWeek={onWeek}
          onDay={onDay}
        />
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {loading ? (
          // Loading: the rows' own shape, never a spinner.
          <View style={styles.skeleton}>
            <SkeletonList rows={5} />
          </View>
        ) : range.isError && !range.data ? (
          <LoadFailed onRetry={() => void range.refetch()} />
        ) : empty ? (
          <EmptyState
            size="panel"
            title={t("calendar.agendaEmptyTitle")}
            subtitle={t("calendar.agendaEmpty")}
            {...(posts
              ? { action: <Button variant="secondary" size="sm" label={t("calendar.new")} onPress={openNew} /> }
              : {})}
          />
        ) : (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(160)} key={weekYmd}>
            {sections.map((s) => (
              <View key={s.key} onLayout={(e) => onPlace(s.key, e)}>
                <Section
                  section={s}
                  today={today}
                  now={now}
                  nameOf={nameOf}
                  placeOf={placeOf}
                  meId={meId}
                  onOpen={onOpen}
                  busy={action.isPending}
                  onConfirm={onConfirm}
                  onDismiss={onDismiss}
                />
              </View>
            ))}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

/** One block of the list: a quiet line, or a day's heading and rows (today with its now line among them). */
function Section({
  section,
  today,
  now,
  nameOf,
  placeOf,
  meId,
  onOpen,
  busy,
  onConfirm,
  onDismiss,
}: {
  section: AgendaSection;
  today: Date;
  now: Date;
  nameOf: (who: { type: string; id: string }) => string;
  placeOf: (channelId: string) => string | null;
  meId: string | null;
  onOpen: (it: CalItem) => void;
  busy: boolean;
  onConfirm: (p: CalendarProposal) => void;
  onDismiss: (p: CalendarProposal) => void;
}) {
  if (section.kind === "quiet") return <QuietLine from={section.from} to={section.to} />;
  const rows: DayRow[] = dayRows(section.entries, section.proposals);
  const isToday = sameDay(section.day, today);
  const nowAfter = isToday ? nowLineAfter(rows, now) : -2;
  return (
    <>
      <DayHeader day={section.day} today={today} />
      {rows.length === 0 ? <NothingToday /> : null}
      {nowAfter === -1 && rows.length > 0 ? <NowLine now={now} /> : null}
      {rows.map((row, i) => (
        <Fragment key={row.kind === "entry" ? row.entry.key : `p-${row.proposal.id}`}>
          {row.kind === "entry" ? (
            <AgendaRow
              entry={row.entry}
              over={isOver(row.entry.item, now)}
              divider={i > 0 && rows[i - 1]?.kind === "entry" && i - 1 !== nowAfter}
              nameOf={nameOf}
              placeOf={placeOf}
              meId={meId}
              onOpen={onOpen}
            />
          ) : (
            <ProposalCard
              proposal={row.proposal}
              nameOf={nameOf}
              busy={busy}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          )}
          {i === nowAfter ? <NowLine now={now} /> : null}
        </Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  shrink: { flexShrink: 1 },
  year: { fontWeight: "400" },
  top: { borderBottomWidth: StyleSheet.hairlineWidth },
  // The month at the screen's side, its "Hoje" at the other end when another week shows.
  month: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 44,
    paddingLeft: SCREEN_X,
    paddingRight: 8,
  },
  skeleton: { paddingTop: 12 },
});
