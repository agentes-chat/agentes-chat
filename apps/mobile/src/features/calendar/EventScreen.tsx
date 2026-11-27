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
import { dateFormat, formatTime, upperFirst } from "@agenteschat/client/lib/format";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import {
  EmptyState,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  Segmented,
  SkeletonList,
  Text,
  useTheme,
  useToast,
} from "@/ui";
import { goBack, router } from "@/ui/navigation";
import { chatHref } from "../links/logic";
import { chooseAction, SettingsPage } from "../settings/parts";
import { Face } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { agendaRange, dayOfYmd, eventsByKey, isSeries, seriesOf, weekStartOf } from "./logic";

/** A participant's face, in the grouped row's leading column. */
const FACE = 32;
const BACK = "/calendar";

/** The event of a list's key, read from the same range the list read (`w`: its week), so both stay one cache. */
export function useListedEvent(key: string | undefined, w: string | undefined) {
  const orgId = useOrgId();
  const week = weekStartOf(dayOfYmd(w) ?? new Date());
  const { from, to } = agendaRange(week);
  const range = useCalendar(orgId, from, to);
  const event = key ? eventsByKey(range.data).get(key) : undefined;
  return { range, event, week };
}

/**
 * An event, pushed from the calendar's list: its title, the day and its times (and where), whether it repeats; Vou /
 * Não vou for who is invited (their answer saved at once); who takes part with each person's answer and what an agent
 * does with it (gets the agenda and prepares a summary); its description; the task and the conversation it belongs
 * to; and Apagar evento at the end. "Editar" in the bar opens the same form as Novo evento, filled in. A recurring
 * event asks which occurrences a delete reaches (Só este / Este e os próximos / Todos), in the app's own menu.
 */
export function EventScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors: c } = useTheme();
  const toast = useToast();
  const orgId = useOrgId();
  const meId = useMeId();
  const dir = useDirectory();
  const { key, w } = useLocalSearchParams<{ key?: string; w?: string }>();
  const { range, event } = useListedEvent(key, w);
  const action = useCalendarAction(orgId);

  const edit = () => {
    if (key && w) router.push(`/calendar/edit?key=${encodeURIComponent(key)}&w=${w}` as never);
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
  const answerWord = (status: RsvpStatus | undefined) =>
    status === "accepted"
      ? t("calendar.rsvp.accepted")
      : status === "declined"
        ? t("calendar.rsvp.declined")
        : t("mobile.calendar.noAnswer");
  const person = (p: Actor) =>
    p.type === "person" && p.id === meId ? t("mobile.calendar.you", { name: dir.nameOf(p) }) : dir.nameOf(p);
  // Who takes part: me first, then the people, then the agents.
  const people = [...event.participants].sort(
    (a, b) =>
      Number(b.type === "person" && b.id === meId) - Number(a.type === "person" && a.id === meId) ||
      Number(a.type === "agent") - Number(b.type === "agent"),
  );
  return (
    <SettingsPage title="" action={{ label: t("calendar.edit"), onPress: edit, opens: true }}>
      <View style={styles.page}>
        <View style={styles.head}>
          <Text variant="display2">{event.title}</Text>
          <Text variant="body" tone="ink2">
            {day}
          </Text>
          {time || event.location ? (
            <Text variant="body" tone="muted">
              {[time, event.location].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {isSeries(event) ? (
            <View style={styles.repeat}>
              <Icon name="replay" size={15} color={c.muted} />
              <Text variant="small" tone="muted">
                {t("calendar.recurring")}
              </Text>
            </View>
          ) : null}
        </View>
        {mine ? (
          <View>
            <Segmented
              wide
              items={[
                { key: "accepted", label: t("calendar.rsvp.accept") },
                { key: "declined", label: t("calendar.rsvp.decline") },
              ]}
              value={mine === "needs_action" ? "" : mine}
              onChange={respond}
            />
            <GroupedFooter>{t(`calendar.rsvp.mine.${mine}`)}</GroupedFooter>
          </View>
        ) : null}
        {people.length > 0 ? (
          <View>
            <GroupedHeader>{t("calendar.form.participants")}</GroupedHeader>
            <GroupedList>
              {people.map((p) => (
                <GroupedRow
                  key={`${p.type}:${p.id}`}
                  leading={<Face who={p} size={FACE} live={false} />}
                  label={person(p)}
                  {...(p.type === "agent"
                    ? { sub: t("mobile.calendar.agentPrepares"), subLines: 2 }
                    : { value: answerWord(answers.get(p.id)) })}
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
            <ChannelLink key="channel" channelId={event.channelId} />
          </GroupedList>
        ) : null}
        <GroupedList>
          <GroupedRow key="delete" icon="trash" danger label={t("mobile.calendar.deleteEvent")} onPress={remove} />
        </GroupedList>
      </View>
    </SettingsPage>
  );
}

/** "Sexta-feira, 27 de novembro" and "14:00 às 15:00"; an all-day event its days and no time. */
function whenOf(
  e: CalendarEvent,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
): { day: string; time: string | null } {
  const long = (d: Date) =>
    upperFirst(dateFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(d), locale);
  if (e.allDay) {
    const first = dayOfYmd(e.startDate) ?? new Date(e.start);
    const last = dayOfYmd(e.endDate) ?? addDays(new Date(e.end), -1);
    const day =
      first.getTime() >= last.getTime()
        ? long(first)
        : t("mobile.calendar.dayRange", { from: long(first), to: long(last) });
    return { day, time: t("calendar.allDay") };
  }
  const start = new Date(e.start);
  const end = new Date(e.end);
  const sameDate = start.toDateString() === end.toDateString();
  return {
    day: long(start),
    time: sameDate
      ? t("mobile.calendar.timeRange", { from: formatTime(locale, e.start), to: formatTime(locale, e.end) })
      : t("mobile.calendar.timeRange", {
          from: formatTime(locale, e.start),
          to: `${long(end)}, ${formatTime(locale, e.end)}`,
        }),
  };
}

/**
 * The task an event belongs to, by its number (read from the tasks' list, only for an event with a task), and the
 * conversation it was made in.
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
          icon="issue"
          label={t("calendar.openIssue")}
          value={`#${issue.number}`}
          chevron
          onPress={() => router.push(`/issues/${issue.number}` as never)}
        />
      ) : null}
      {channelId ? <ChannelLink key="channel" channelId={channelId} /> : null}
    </GroupedList>
  );
}

/** The conversation an event was made in: its channel by name, or the conversation itself. */
function ChannelLink({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const name = useChannels(useOrgId()).data?.find((ch) => ch.id === channelId)?.name;
  return (
    <GroupedRow
      icon="chat"
      label={name ? t("mobile.calendar.openChannel", { name }) : t("mobile.calendar.openConversation")}
      chevron
      onPress={() => router.push(chatHref(channelId) as never)}
    />
  );
}

const styles = StyleSheet.create({
  // Under the page's own 4 pt top: the blocks 12 apart, as a form's.
  page: { paddingTop: 4, gap: 12 },
  head: { gap: 4, paddingHorizontal: 4, paddingBottom: 8 },
  repeat: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  description: { paddingHorizontal: 16, paddingVertical: 12 },
});
