import {
  type Actor,
  type CalendarEvent,
  type CalendarEventPatch,
  type SeriesScope,
  useCalendarAction,
} from "@agenteschat/client";
import { shortDay } from "@agenteschat/client/lib/calendar";
import { errorText } from "@agenteschat/client/lib/errors";
import { FIELD_LIMITS } from "@agenteschat/client/lib/field-limits";
import { toYmd, upperFirst } from "@agenteschat/client/lib/format";
import { browserTimezone } from "@agenteschat/client/lib/routines";
import { weekdayOfYmd } from "@agenteschat/ui/recurrence";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { EmptyState, GroupedFooter, GroupedHeader, GroupedList, GroupedRow, SkeletonList, useToast } from "@/ui";
import { goBack, router } from "@/ui/navigation";
import {
  COMMON_RULES,
  fromApiRule,
  HALF_HOURS,
  nextDays,
  presetOf,
  type RecurrenceRule,
  type RulePreset,
  toApiRule,
  withPreset,
} from "../routines/rule";
import { chooseAction, Gap, NEXT_FIELD, SettingsPage, useUnsavedGuard } from "../settings/parts";
import { Face } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { successHaptic } from "../shared/parts";
import { overLimit, TextArea } from "../shared/TextArea";
import { useListedEvent } from "./EventScreen";
import { dayOfYmd, isSeries, seriesOf } from "./logic";
import { closePeoplePick, openPeoplePick } from "./people-pick";

const DESCRIPTION_LIMIT = { max: FIELD_LIMITS.eventDescription };
const BACK = "/calendar";
/** The days the Data rows offer: from today (or the event's own day, earlier), four months ahead. */
const DAYS_AHEAD = 120;
/** A participant's face, in the grouped row's leading column. */
const FACE = 32;

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (ymd: string, time: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
};
const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const shiftYmd = (ymd: string, days: number) => {
  const d = dayOfYmd(ymd) ?? new Date();
  return toYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
};
/** A list of people and agents as one key, whatever its order. */
const keyed = (list: readonly Actor[]) =>
  list
    .map((p) => `${p.type}:${p.id}`)
    .sort()
    .join(",");
const daysBetween = (a: string, b: string) =>
  Math.round(((dayOfYmd(b)?.getTime() ?? 0) - (dayOfYmd(a)?.getTime() ?? 0)) / 86_400_000);

/** "Novo evento", pushed from the calendar's "+" (`?day=`: the day chosen on its strip). */
export function NewEventRoute() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  return <EventForm event={null} day={dayOfYmd(day) ?? new Date()} />;
}

/** "Editar evento", pushed from an event's page: the event read from the list's range (`key`, `w`). */
export function EditEventRoute() {
  const { t } = useTranslation();
  const { key, w } = useLocalSearchParams<{ key?: string; w?: string }>();
  const { range, event } = useListedEvent(key, w);
  if (event) return <EventForm key={event.id} event={event} day={new Date(event.start)} />;
  return (
    <SettingsPage title={t("calendar.form.editTitle")}>
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

/**
 * Novo evento / Editar evento, a pushed screen on the settings' form page (the bar: back, the title, "Criar" or
 * "Salvar"): the title and where (the person taps them: the keyboard never comes up on its own), then when (Dia todo,
 * the day, the start and end times, or the days of an all-day event; each value from the app's list of choices, as a
 * routine's), how it repeats (the routine's common choices; a rule the phone can't say stays as it was), who takes part
 * (picked on its own pushed screen; agents get the agenda and prepare a summary before) and a description. A change to
 * a recurring event asks which occurrences it reaches. Leaving with changes not saved asks first.
 */
export function EventForm({ event, day }: { event: CalendarEvent | null; day: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const toast = useToast();
  const dir = useDirectory();
  const meId = useMeId();
  const action = useCalendarAction(useOrgId());
  const myZone = (meId ? dir.memberById.get(meId)?.timezone : undefined) || browserTimezone() || "UTC";

  // A new event starts on the next half hour of today, or at 09:00 on another day; 30 minutes long.
  const start0 = (() => {
    if (event) return new Date(event.start);
    const now = new Date();
    const base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    if (toYmd(day) !== toYmd(now)) return base;
    const next = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30;
    return next >= 24 * 60 ? base : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, next);
  })();
  const end0 = event ? new Date(event.end) : new Date(start0.getTime() + 30 * 60_000);
  const [title, setTitle] = useState(event?.title ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  // All-day events carry their days (`startDate`/`endDate`, the end inclusive), as the web's form.
  const [startDay, setStartDay] = useState(event?.allDay && event.startDate ? event.startDate : toYmd(start0));
  const [startTime, setStartTime] = useState(hm(start0));
  const [endDay, setEndDay] = useState(
    event?.allDay && event.endDate
      ? event.endDate
      : toYmd(event?.allDay ? new Date(end0.getTime() - 86_400_000) : end0),
  );
  const [endTime, setEndTime] = useState(hm(end0));
  const zone = event?.timezone || myZone;
  const [rule, setRule] = useState<RecurrenceRule>(() =>
    event?.rule
      ? fromApiRule(event.rule, toYmd(start0))
      : { freq: "once", interval: 1, times: [hm(start0)], timezone: zone, start: toYmd(start0) },
  );
  const [people, setPeople] = useState<Actor[]>(() =>
    (event?.participants ?? []).filter((p) => !(p.type === "person" && p.id === meId)),
  );
  // The people picker writes back while it shows; it closes with this form.
  useEffect(() => () => closePeoplePick(), []);

  // The rule follows the event's first day and time.
  const syncedRule: RecurrenceRule = {
    ...rule,
    start: startDay,
    times: [allDay ? "00:00" : startTime],
    ...(rule.freq === "weekly" && !rule.byWeekday?.length ? { byWeekday: [weekdayOfYmd(startDay)] } : {}),
  };
  const start = at(startDay, allDay ? "00:00" : startTime);
  const end = allDay ? at(endDay, "00:00") : at(endDay, endTime);
  const timeOk = allDay ? end >= start : end > start;
  const tooLong = overLimit(description, DESCRIPTION_LIMIT);
  const ready = title.trim().length > 0 && timeOk && !tooLong && !action.isPending;
  // Who writes a new event takes part in it; editing one keeps me in it only if I was.
  const withMe = Boolean(meId) && (!event || event.participants.some((p) => p.type === "person" && p.id === meId));
  const participants: Actor[] = [...(withMe && meId ? [{ type: "person" as const, id: meId }] : []), ...people];
  // Anything changed since the form opened: leaving asks first.
  const snapshot = JSON.stringify([
    title.trim(),
    location.trim(),
    description.trim(),
    allDay,
    startDay,
    startTime,
    endDay,
    endTime,
    syncedRule.freq === "once" ? null : toApiRule(syncedRule),
    keyed(people),
  ]);
  const [opened] = useState(snapshot);
  const dirty = snapshot !== opened;
  const leave = useUnsavedGuard(dirty);

  const submit = () => {
    if (!ready) return;
    const endAt = allDay ? new Date(end.getTime() + 86_400_000) : end;
    const input = {
      title: title.trim(),
      start: start.toISOString(),
      end: endAt.toISOString(),
      allDay,
      timezone: syncedRule.timezone,
      participants,
      rule: syncedRule.freq === "once" ? null : toApiRule(syncedRule),
      ...(allDay ? { startDate: startDay, endDate: endDay } : {}),
      location: location.trim() || null,
      description: description.trim(),
    };
    const failed = (error: unknown) => toast({ title: errorText(t, error, locale), icon: "x" });
    const done = (words: string) => () => {
      successHaptic();
      toast({ title: words });
      leave();
      goBack(BACK);
    };
    if (!event) {
      action.mutate(
        { type: "create", input: { ...input, recurrence: "none" } },
        { onSuccess: done(t("calendar.form.created")), onError: failed },
      );
      return;
    }
    // Editing: only what changed, as the web's form sends it.
    const patch: CalendarEventPatch = {};
    if (input.title !== event.title) patch.title = input.title;
    if (input.start !== new Date(event.start).toISOString()) patch.start = input.start;
    if (input.end !== new Date(event.end).toISOString()) patch.end = input.end;
    if (input.allDay !== event.allDay) patch.allDay = input.allDay;
    if (allDay && (startDay !== event.startDate || endDay !== event.endDate)) {
      patch.startDate = startDay;
      patch.endDate = endDay;
    }
    if (input.location !== (event.location ?? null)) patch.location = input.location;
    if (input.description !== (event.description ?? "")) patch.description = input.description;
    const before = event.rule ? JSON.stringify(toApiRule(fromApiRule(event.rule, toYmd(start0)))) : "null";
    if (JSON.stringify(input.rule) !== before) patch.rule = input.rule;
    if (keyed(participants) !== keyed(event.participants)) patch.participants = participants;
    if (Object.keys(patch).length === 0) {
      leave();
      goBack(BACK);
      return;
    }
    const run = (scope?: SeriesScope) =>
      action.mutate(
        { type: "update", id: event.id, patch, ...(scope ? { series: seriesOf(event, scope) } : {}) },
        { onSuccess: done(t("calendar.saved")), onError: failed },
      );
    if (isSeries(event))
      chooseAction(
        t("calendar.series.editTitle"),
        (["this", "following", "all"] as const).map((scope) => ({
          label: t(`calendar.series.${scope}`),
          onPress: () => run(scope),
        })),
        t("common.cancel"),
      );
    else run();
  };

  // Each value from the app's list of choices (as a routine's day and time), the one in use checked.
  const choose = (heading: string, options: { label: string; checked: boolean; onPress: () => void }[]) =>
    void pickOne({
      title: heading,
      value: String(options.findIndex((o) => o.checked)),
      options: options.map((o, i) => ({ key: String(i), label: o.label })),
    }).then((key) => {
      if (key !== null) options[Number(key)]?.onPress();
    });
  const dayWord = (ymd: string) => upperFirst(shortDay(locale, dayOfYmd(ymd) ?? new Date()), locale);
  const dayList = (from: string, current: string) => {
    const today = toYmd(new Date());
    const first = from < today ? from : today;
    const list = nextDays(dayOfYmd(first) ?? new Date(), DAYS_AHEAD + daysBetween(first, today));
    return list.includes(current) ? list : [...list, current].sort();
  };
  const pickStartDay = () =>
    choose(
      t("calendar.form.startDate"),
      dayList(startDay, startDay).map((ymd) => ({
        label: dayWord(ymd),
        checked: ymd === startDay,
        onPress: () => {
          // The end keeps the same length.
          setEndDay(shiftYmd(endDay, daysBetween(startDay, ymd)));
          setStartDay(ymd);
        },
      })),
    );
  const pickEndDay = () =>
    choose(
      t("calendar.form.endDate"),
      dayList(startDay, endDay)
        .filter((ymd) => ymd >= startDay)
        .map((ymd) => ({ label: dayWord(ymd), checked: ymd === endDay, onPress: () => setEndDay(ymd) })),
    );
  const timeList = (current: string) => (HALF_HOURS.includes(current) ? HALF_HOURS : [...HALF_HOURS, current].sort());
  const pickStartTime = () =>
    choose(
      t("calendar.form.startTime"),
      timeList(startTime).map((hhmm) => ({
        label: hhmm,
        checked: hhmm === startTime,
        onPress: () => {
          // The end keeps the same length, on the same day while it fits in it.
          const length = Math.max(15, minutesOf(endTime) - minutesOf(startTime) + daysBetween(startDay, endDay) * 1440);
          const endAt = minutesOf(hhmm) + length;
          setStartTime(hhmm);
          setEndTime(timeOf(endAt));
          setEndDay(shiftYmd(startDay, Math.floor(endAt / 1440)));
        },
      })),
    );
  const pickEndTime = () =>
    choose(
      t("calendar.form.endTime"),
      timeList(endTime).map((hhmm) => ({ label: hhmm, checked: hhmm === endTime, onPress: () => setEndTime(hhmm) })),
    );
  const preset: RulePreset = presetOf(syncedRule);
  const presetWord = (p: RulePreset) =>
    p === "once"
      ? t("mobile.calendar.noRepeat")
      : p === "daily"
        ? t("recurrence.s.daily", { count: 1 })
        : p === "business"
          ? t("recurrence.s.businessDays")
          : p === "weekly"
            ? t("recurrence.s.weekly", { count: 1 })
            : p === "monthly"
              ? t("recurrence.s.monthly", { count: 1 })
              : t("mobile.routines.when.custom");
  const pickRepeat = () =>
    choose(
      t("calendar.form.repeat"),
      COMMON_RULES.map((p) => ({
        label: presetWord(p),
        checked: preset === p,
        onPress: () => setRule(withPreset(syncedRule, p)),
      })),
    );
  const addPeople = () => {
    openPeoplePick({ value: people, apply: setPeople });
    router.push("/calendar/people" as never);
  };
  const nameOf = (who: Actor) => dir.nameOf(who);
  // Its end on another day than it starts (an all-day event over several days, a night that crosses midnight).
  const endsOtherDay = allDay || endDay !== startDay;

  return (
    <SettingsPage
      title={event ? t("calendar.form.editTitle") : t("calendar.new")}
      action={{
        label: event ? t("calendar.form.save") : t("calendar.form.create"),
        disabled: !ready,
        onPress: submit,
      }}
      locked={action.isPending}
      toolbar
    >
      <View style={styles.fields}>
        <TextArea
          value={title}
          onChangeText={setTitle}
          placeholder={t("calendar.form.titlePlaceholder")}
          accessibilityLabel={t("calendar.form.title")}
          multiline={false}
          minHeight={50}
          maxLength={300}
          {...NEXT_FIELD}
        />
        <TextArea
          value={location}
          onChangeText={setLocation}
          placeholder={t("calendar.form.locationPlaceholder")}
          accessibilityLabel={t("calendar.form.location")}
          multiline={false}
          minHeight={50}
          maxLength={500}
          {...NEXT_FIELD}
        />
        <View>
          <GroupedList>
            <GroupedRow
              key="allDay"
              icon="sun"
              label={t("calendar.form.allDay")}
              toggle
              checked={allDay}
              onPress={() => setAllDay((v) => !v)}
            />
            <GroupedRow
              key="startDay"
              icon="calendar"
              label={t("calendar.form.startDate")}
              value={dayWord(startDay)}
              menu
              onPress={pickStartDay}
            />
            {allDay ? null : (
              <GroupedRow
                key="startTime"
                icon="clock"
                label={t("calendar.form.startTime")}
                value={startTime}
                menu
                onPress={pickStartTime}
              />
            )}
            {endsOtherDay ? (
              <GroupedRow
                key="endDay"
                icon="calendar"
                label={t("calendar.form.endDate")}
                value={dayWord(endDay)}
                menu
                onPress={pickEndDay}
              />
            ) : null}
            {allDay ? null : (
              <GroupedRow
                key="endTime"
                icon="clock"
                label={t("calendar.form.endTime")}
                value={endTime}
                menu
                onPress={pickEndTime}
              />
            )}
            <GroupedRow
              key="repeat"
              icon="replay"
              label={t("calendar.form.repeat")}
              value={presetWord(preset)}
              menu
              onPress={pickRepeat}
            />
          </GroupedList>
          {timeOk ? null : <GroupedFooter>{t("calendar.form.timeInvalid")}</GroupedFooter>}
        </View>
        <View>
          <GroupedHeader>{t("calendar.form.participants")}</GroupedHeader>
          <GroupedList>
            {people.map((p) => (
              <GroupedRow
                key={`${p.type}:${p.id}`}
                leading={<Face who={p} size={FACE} live={false} />}
                label={nameOf(p)}
                remove={{
                  label: t("common.removeName", { name: nameOf(p) }),
                  onPress: () => setPeople((list) => list.filter((x) => !(x.type === p.type && x.id === p.id))),
                }}
              />
            ))}
            <GroupedRow key="add" icon="plus" label={t("mobile.calendar.add")} chevron onPress={addPeople} />
          </GroupedList>
          <GroupedFooter>{t("calendar.form.participantsHelp")}</GroupedFooter>
        </View>
        <Gap />
        <TextArea
          value={description}
          onChangeText={setDescription}
          placeholder={t("calendar.form.description")}
          accessibilityLabel={t("calendar.form.description")}
          minHeight={96}
          limit={DESCRIPTION_LIMIT}
        />
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  // Under the page's own 4 pt top: the fields 8 under the bar, 12 apart.
  fields: { paddingTop: 4, gap: 12 },
});
