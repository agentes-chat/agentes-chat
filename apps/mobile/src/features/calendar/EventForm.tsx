import {
  type Actor,
  type CalendarEvent,
  type CalendarEventPatch,
  type SeriesScope,
  useCalendarAction,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { FIELD_LIMITS } from "@agenteschat/client/lib/field-limits";
import { formatTime, toYmd } from "@agenteschat/client/lib/format";
import { browserTimezone } from "@agenteschat/client/lib/routines";
import { weekdayOfYmd } from "@agenteschat/ui/recurrence";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import {
  EmptyState,
  GROUPED_ROW,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  PressScale,
  SkeletonList,
  Text,
  useSystemText,
  useTheme,
  useToast,
} from "@/ui";
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
import { chooseAction, NEXT_FIELD, SettingsPage, useUnsavedGuard } from "../settings/parts";
import { Face } from "../shared/Face";
import { LoadFailed } from "../shared/FirstUse";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { successHaptic } from "../shared/parts";
import { overLimit, TextArea } from "../shared/TextArea";
import { useListedEvent } from "./EventScreen";
import { dayOfYmd, isSeries, repeatWord, seriesOf, shortDate } from "./logic";
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

/** "Novo evento", pushed from the calendar's "+" (`?day=`: the day chosen under the month). */
export function NewEventRoute() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  return <EventForm event={null} day={dayOfYmd(day) ?? new Date()} />;
}

/** "Editar evento", pushed from an event's page: the event read from the list's range (`key`, `from`, `to`). */
export function EditEventRoute() {
  const { t } = useTranslation();
  const { key, from, to } = useLocalSearchParams<{ key?: string; from?: string; to?: string }>();
  const { range, event } = useListedEvent(key, from, to);
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
 * "Salvar"): the title and where in one group (the person taps them: the keyboard never comes up on its own), then
 * when: Dia todo, "Começa" and "Termina" each with its day and its hour as value chips on its line (the end's day only
 * when it ends on another day; each chip opens the app's list of choices, as a routine's), and how it repeats (the
 * routine's common choices; a rule the phone can't say stays as it was); who takes part, each with its ×, and "Adicionar
 * pessoa ou agente" (picked on its own pushed screen; an agent prepares a summary before); and a description. A change
 * to a recurring event asks which occurrences it reaches. Leaving with changes not saved asks first.
 */
export function EventForm({ event, day }: { event: CalendarEvent | null; day: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const toast = useToast();
  // The title in the size of a heading (20), the rest in the body's; both grow with the system's text size.
  const titleText = useSystemText("title3");
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
  const dayWord = (ymd: string) => shortDate(locale, dayOfYmd(ymd) ?? new Date());
  const hourWord = (hhmm: string) => formatTime(locale, at(startDay, hhmm).toISOString());
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
        label: hourWord(hhmm),
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
      timeList(endTime).map((hhmm) => ({
        label: hourWord(hhmm),
        checked: hhmm === endTime,
        onPress: () => setEndTime(hhmm),
      })),
    );
  const preset: RulePreset = presetOf(syncedRule);
  const pickRepeat = () =>
    choose(
      t("mobile.calendar.repeats"),
      COMMON_RULES.map((p) => ({
        label: repeatWord(t, p),
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

  const startChips: WhenChip[] = [
    { key: "day", label: dayWord(startDay), onPress: pickStartDay },
    ...(allDay ? [] : [{ key: "time", label: hourWord(startTime), onPress: pickStartTime }]),
  ];
  const endChips: WhenChip[] = [
    ...(endsOtherDay ? [{ key: "day", label: dayWord(endDay), onPress: pickEndDay }] : []),
    ...(allDay ? [] : [{ key: "time", label: hourWord(endTime), onPress: pickEndTime }]),
  ];

  return (
    <SettingsPage
      title={event ? t("calendar.form.editTitle") : t("calendar.new")}
      action={{
        label: event ? t("calendar.form.save") : t("mobile.routines.create"),
        disabled: !ready,
        onPress: submit,
      }}
      locked={action.isPending}
      toolbar
    >
      <View style={styles.fields}>
        <GroupedList>
          <TextArea
            key="title"
            value={title}
            onChangeText={setTitle}
            placeholder={t("calendar.form.title")}
            accessibilityLabel={t("calendar.form.title")}
            multiline={false}
            minHeight={52}
            maxLength={300}
            style={[styles.inGroup, titleText]}
            {...NEXT_FIELD}
          />
          <TextArea
            key="location"
            value={location}
            onChangeText={setLocation}
            placeholder={t("calendar.form.location")}
            accessibilityLabel={t("calendar.form.location")}
            multiline={false}
            minHeight={48}
            maxLength={500}
            style={styles.inGroup}
            {...NEXT_FIELD}
          />
        </GroupedList>
        <View>
          <GroupedList>
            <GroupedRow
              key="allDay"
              label={t("calendar.form.allDay")}
              toggle={allDay}
              onPress={() => setAllDay((v) => !v)}
            />
            <WhenRow key="start" label={t("mobile.calendar.starts")} chips={startChips} />
            <WhenRow key="end" label={t("mobile.calendar.ends")} chips={endChips} />
            <GroupedRow
              key="repeat"
              label={t("mobile.calendar.repeats")}
              value={repeatWord(t, preset)}
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
                {...(p.type === "agent" ? { sub: t("mobile.calendar.agentPrepares") } : {})}
                remove={{
                  label: t("common.removeName", { name: nameOf(p) }),
                  onPress: () => setPeople((list) => list.filter((x) => !(x.type === p.type && x.id === p.id))),
                }}
              />
            ))}
            <GroupedRow key="add" accent label={t("mobile.calendar.addPeople")} onPress={addPeople} />
          </GroupedList>
        </View>
        <GroupedList>
          <TextArea
            key="description"
            value={description}
            onChangeText={setDescription}
            placeholder={t("calendar.form.description")}
            accessibilityLabel={t("calendar.form.description")}
            minHeight={96}
            limit={DESCRIPTION_LIMIT}
            style={styles.inGroup}
          />
        </GroupedList>
      </View>
    </SettingsPage>
  );
}

interface WhenChip {
  key: string;
  label: string;
  onPress: () => void;
}

/**
 * "Começa" or "Termina" as a row of its group: the label, then its day and its hour as value chips on the plate, as
 * the system's date rows show them; each chip opens its own list of choices.
 */
function WhenRow({ label, chips }: { label: string; chips: readonly WhenChip[] }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.when}>
      <Text variant="body" numberOfLines={1} style={styles.whenLabel}>
        {label}
      </Text>
      {chips.map((chip) => (
        <PressScale
          key={chip.key}
          fill={false}
          haptic={false}
          onPress={chip.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${chip.label}`}
          style={[styles.chip, { backgroundColor: c.plate }]}
          contentStyle={styles.chipIn}
        >
          <Text variant="body" numberOfLines={1} style={styles.digits}>
            {chip.label}
          </Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Under the page's own 4 pt top: the groups 8 under the bar, 12 apart.
  fields: { paddingTop: 4, gap: 12 },
  // A field as a row of its group: the row's own sides, no border, fill or corners of its own.
  inGroup: { borderRadius: 0, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: GROUPED_ROW.padX },
  // A row's height and sides, the chips at its end.
  when: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: GROUPED_ROW.minHeight,
    paddingHorizontal: GROUPED_ROW.padX,
    paddingVertical: 8,
  },
  whenLabel: { flex: 1, minWidth: 0 },
  chip: { borderRadius: 8, borderCurve: "continuous" },
  chipIn: { paddingHorizontal: 11, paddingVertical: 6 },
  digits: { fontVariant: ["tabular-nums"] },
});
