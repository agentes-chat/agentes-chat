import {
  type Actor,
  type CalendarEvent,
  type SeriesScope,
  useCalendar,
  useCalendarAction,
  useChannels,
  useIssues,
} from "@agenteschat/client";
import { addDays, myRsvp, type RsvpStatus } from "@agenteschat/client/lib/calendar";
import { errorText } from "@agenteschat/client/lib/errors";
import { formatTime, toYmd } from "@agenteschat/client/lib/format";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { EmptyState, GroupedHeader, GroupedList, GroupedRow, Segmented, SkeletonList, Text, useToast } from "@/ui";
import { goBack, router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { fromApiRule, presetOf } from "../routines/rule";
import { chooseAction, SettingsPage } from "../settings/parts";
import { Face } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import {
  dayOfYmd,
  eventsByKey,
  isSeries,
  monthStartOf,
  othersIn,
  readRange,
  repeatWord,
  seriesOf,
  shortDate,
} from "./logic";

/** A participant's face, in the grouped row's leading column. */
const FACE = 32;
const BACK = "/calendar";

/**
 * The event of a list's key, read from the same range the list read (`from`, `to`: the calendar's own read, passed in
 * the route), so both stay one cache; without them, the range the calendar reads for today.
 */
export function useListedEvent(key: string | undefined, from: string | undefined, to: string | undefined) {
  const orgId = useOrgId();
  const today = new Date();
  const fallback = readRange(monthStartOf(today), today);
  const range = useCalendar(orgId, from && to ? from : fallback.from, from && to ? to : fallback.to);
  const event = key ? eventsByKey(range.data).get(key) : undefined;
  return { range, event };
}

/** The route's own words for the list's read: the event's key and the range it came from. */
export const listedParams = (key: string, from: string, to: string) =>
  `key=${encodeURIComponent(key)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/**
 * An event, pushed from the calendar's list: its title alone on top, then its day, its time and where as rows (and how
 * it repeats); "Você vai?" with Vou / Não vou for who is invited (the answer saved at once); who else takes part, each
 * person's answer in its color, and what an agent does with it; the description; the task and the conversation it
 * belongs to; and "Apagar evento" alone in its group, red, asked first. "Editar" in the bar opens the same form as
 * Novo evento, filled in. A recurring event asks which occurrences a delete reaches (Só este / Este e os próximos /
 * Todos), in the app's own menu.
 */
export function EventScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const toast = useToast();
  const orgId = useOrgId();
  const meId = useMeId();
  const dir = useDirectory();
  const { key, from, to } = useLocalSearchParams<{ key?: string; from?: string; to?: string }>();
  const { range, event } = useListedEvent(key, from, to);
  const action = useCalendarAction(orgId);

  const edit = () => {
    if (key && from && to) router.push(`/calendar/edit?${listedParams(key, from, to)}` as never);
  };
  if (!event) {
    return (
      <SettingsPage title="">
        {range.isLoading ? (
          <SkeletonList rows={3} />
        ) : range.isError ? (
          <LoadFailed onRetry={() => void range.refetch()} />
        ) : (
          <EmptyState size="panel" title={t("common.gone")} />
        )}
      </SettingsPage>
    );
  }

  const failed = (error: unknown) => toast({ title: errorText(t, error, locale), icon: "x" });
  const mine = meId ? myRsvp(event, meId) : null;
  const respond = (status: string) => {
    if (status !== "accepted" && status !== "declined") return;
    action.mutate({ type: "respond", id: event.id, status }, { onError: failed });
  };
  const remove = () => {
    const run = (scope?: SeriesScope) => {
      action.mutate(
        { type: "remove", id: event.id, ...(scope ? { series: seriesOf(event, scope) } : {}) },
        { onSuccess: () => toast({ title: t("calendar.deleted") }), onError: failed },
      );
      // Gone from the list at once (a single event; a series once the answer comes): back to it.
      goBack(BACK);
    };
    if (isSeries(event))
      chooseAction(
        t("calendar.series.deleteTitle"),
        (["this", "following", "all"] as const).map((scope) => ({
          label: t(`calendar.series.${scope}`),
          destructive: true,
          onPress: () => run(scope),
        })),
        t("common.cancel"),
      );
    else
      chooseAction(
        t("mobile.calendar.deleteAsk"),
        [{ label: t("calendar.delete"), destructive: true, onPress: () => run() }],
        t("common.cancel"),
      );
  };

  const { day, time } = whenOf(event, locale, t);
  const answers = new Map(event.rsvp.filter((r) => r.type === "person").map((r) => [r.id, r.status]));
  // Who else takes part (my own answer is "Você vai?"): the people, then the agents.
  const others = othersIn(event.participants, meId).sort(
    (a, b) => Number(a.type === "agent") - Number(b.type === "agent"),
  );
  const answerOf = (p: Actor) => answerRow(answers.get(p.id), t);
  const repeats =
    isSeries(event) && event.rule
      ? repeatWord(t, presetOf(fromApiRule(event.rule, toYmd(new Date(event.start)))))
      : null;
  return (
    <SettingsPage title="" action={{ label: t("calendar.edit"), onPress: edit, opens: true }}>
      <View style={styles.page}>
        <Text variant="display2" style={styles.title}>
          {event.title}
        </Text>
        <GroupedList>
          <GroupedRow key="day" label={t("mobile.calendar.day")} value={day} />
          <GroupedRow key="time" label={t("mobile.calendar.time")} value={time} />
          {event.location ? <GroupedRow key="location" label={t("calendar.location")} value={event.location} /> : null}
          {repeats ? <GroupedRow key="repeat" label={t("mobile.calendar.repeats")} value={repeats} /> : null}
        </GroupedList>
        {mine ? (
          <View>
            <GroupedHeader>{t("mobile.calendar.going")}</GroupedHeader>
            <Segmented
              wide
              items={[
                { key: "accepted", label: t("calendar.rsvp.accept") },
                { key: "declined", label: t("calendar.rsvp.decline") },
              ]}
              value={mine === "needs_action" ? "" : mine}
              onChange={respond}
            />
          </View>
        ) : null}
        {others.length > 0 ? (
          <View>
            <GroupedHeader>
              {t("mobile.calendar.participantsCount", { count: event.participants.length })}
            </GroupedHeader>
            <GroupedList>
              {others.map((p) => (
                <GroupedRow
                  key={`${p.type}:${p.id}`}
                  leading={<Face who={p} size={FACE} live={false} />}
                  label={dir.nameOf(p)}
                  {...(p.type === "agent" ? { sub: t("mobile.calendar.agentPrepares") } : answerOf(p))}
                />
              ))}
            </GroupedList>
          </View>
        ) : null}
        {event.description ? (
          <View>
            <GroupedHeader>{t("calendar.form.description")}</GroupedHeader>
            <GroupedList>
              <View key="description" style={styles.description}>
                <Text variant="body" tone="ink2" selectable>
                  {event.description}
                </Text>
              </View>
            </GroupedList>
          </View>
        ) : null}
        {event.issueId ? (
          <EventLinks issueId={event.issueId} channelId={event.channelId} />
        ) : event.channelId ? (
          <GroupedList>
            <ChannelRow key="channel" channelId={event.channelId} />
          </GroupedList>
        ) : null}
        <GroupedList>
          <GroupedRow key="delete" danger centered label={t("mobile.calendar.deleteEvent")} onPress={remove} />
        </GroupedList>
      </View>
    </SettingsPage>
  );
}

/** A person's answer as a row's value in its color: "vai" green, "não vai" red, "não respondeu" faint. */
function answerRow(status: RsvpStatus | undefined, t: ReturnType<typeof useTranslation>["t"]) {
  if (status === "accepted") return { value: t("calendar.rsvp.accepted"), valueTone: "ok" as const };
  if (status === "declined") return { value: t("calendar.rsvp.declined"), valueTone: "danger" as const };
  return { value: t("mobile.calendar.noAnswer") };
}

/** "sex, 27 de nov" and "14:00 às 15:00"; an all-day event its days and "Dia todo"; one over days both its days. */
function whenOf(
  e: CalendarEvent,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
): { day: string; time: string } {
  const short = (d: Date) => shortDate(locale, d);
  const days = (first: Date, last: Date) =>
    toYmd(first) >= toYmd(last) ? short(first) : t("mobile.calendar.dayRange", { from: short(first), to: short(last) });
  if (e.allDay) {
    const first = dayOfYmd(e.startDate) ?? new Date(e.start);
    const last = dayOfYmd(e.endDate) ?? addDays(new Date(e.end), -1);
    return { day: days(first, last), time: t("calendar.allDay") };
  }
  return {
    day: days(new Date(e.start), new Date(e.end)),
    time: t("mobile.calendar.timeRange", { from: formatTime(locale, e.start), to: formatTime(locale, e.end) }),
  };
}

/**
 * The task an event belongs to, its number and title (read from the tasks' list, only for an event with a task), and
 * the conversation it was made in: rows that open them.
 */
function EventLinks({ issueId, channelId }: { issueId: string; channelId: string | null }) {
  const { t } = useTranslation();
  const issues = useIssues(useOrgId(), "", "", { poll: false });
  const issue = issues.data?.find((i) => i.id === issueId);
  if (!issue && !channelId) return null;
  return (
    <GroupedList>
      {issue ? (
        <GroupedRow
          key="issue"
          label={t("mobile.calendar.task")}
          value={`#${issue.number} ${issue.title}`}
          chevron
          onPress={() => router.push(`/issues/${issue.number}` as never)}
        />
      ) : null}
      {channelId ? <ChannelRow key="channel" channelId={channelId} /> : null}
    </GroupedList>
  );
}

/** The conversation an event was made in, by its channel's name when it has one. */
function ChannelRow({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const name = useChannels(useOrgId()).data?.find((ch) => ch.id === channelId)?.name;
  return (
    <GroupedRow
      label={t("mobile.calendar.conversation")}
      {...(name ? { value: `#${name}` } : {})}
      chevron
      onPress={() => router.push(chatHref(channelId) as never)}
    />
  );
}

const styles = StyleSheet.create({
  // Under the page's own 4 pt top: the blocks 12 apart, as a form's.
  page: { paddingTop: 4, gap: 12 },
  title: { paddingHorizontal: 4, paddingBottom: 4 },
  description: { paddingHorizontal: 16, paddingVertical: 12 },
});
