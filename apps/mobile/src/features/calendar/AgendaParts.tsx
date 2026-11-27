import type { CalendarProposal } from "@agenteschat/client";
import { type CalItem, type DayEntry, sameDay } from "@agenteschat/client/lib/calendar";
import { formatTime, joinNames, upperFirst, uses12h } from "@agenteschat/client/lib/format";
import { memo, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, Icon, type IconName, RowPressable, SCREEN_X, Text, useTheme, weights } from "@/ui";
import { AgentFace } from "../shared/Face";
import { dayMonth, isAllDayEntry, othersIn, weekdayName } from "./logic";

/** The lead of a row: an agent's face, an event's or a task's tile. */
export const LEAD = 32;
const SIDE = SCREEN_X;
const GAP = 12;
/** The time column, wide enough for "10:30 AM" where the clock has twelve hours. */
export const timeWidth = (locale: string) => (uses12h(locale) ? 64 : 44);
/** Where the hairline between a day's rows starts: its text column. */
const insetOf = (locale: string) => SIDE + timeWidth(locale) + GAP + LEAD + GAP;

const atOf = (d: Date) => d.toISOString();

/** A day's heading: "Hoje" and its day, or the weekday and its day ("Sábado", "28 nov"). */
export function DayHeader({ day, today }: { day: Date; today: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isToday = sameDay(day, today);
  const big = isToday ? t("calendar.today") : upperFirst(weekdayName(locale, day), locale);
  const small = isToday ? `${weekdayName(locale, day)}, ${dayMonth(locale, day)}` : dayMonth(locale, day);
  return (
    <View style={styles.day} accessible accessibilityRole="header" accessibilityLabel={`${big}, ${small}`}>
      <Text variant="title3">{big}</Text>
      <Text variant="body" tone="faint" style={styles.shrink} numberOfLines={1}>
        {small}
      </Text>
    </View>
  );
}

/** Days in a row with nothing on them, said once: "Domingo, 29 · nada marcado", "29 nov – 2 dez · nada marcado". */
export function QuietLine({ from, to }: { from: Date; to: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const days = sameDay(from, to)
    ? `${upperFirst(weekdayName(locale, from), locale)}, ${dayMonth(locale, from)}`
    : `${dayMonth(locale, from)} – ${dayMonth(locale, to)}`;
  return (
    <Text variant="small" tone="faint" style={styles.quiet}>
      {t("mobile.calendar.nothing", { days })}
    </Text>
  );
}

/** Today with nothing on it: one quiet sentence under its heading. */
export function NothingToday() {
  const { t } = useTranslation();
  return (
    <Text variant="small" tone="faint" style={styles.quietToday}>
      {t("mobile.calendar.nothingToday")}
    </Text>
  );
}

/** The time now across today's rows: its time in the time column, a red line with a dot after it. */
export function NowLine({ now }: { now: Date }) {
  const { i18n } = useTranslation();
  const { colors: c } = useTheme();
  const locale = i18n.language;
  return (
    <View style={styles.now} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text variant="caption" style={[styles.nowTime, { width: timeWidth(locale), color: c.badge }]}>
        {formatTime(locale, atOf(now))}
      </Text>
      <View style={[styles.nowLine, { backgroundColor: c.badge }]}>
        <View style={[styles.nowDot, { backgroundColor: c.badge }]} />
      </View>
    </View>
  );
}

export interface AgendaRowProps {
  entry: DayEntry;
  /** It already happened (a run that came, a meeting that ended): drawn faint. */
  over: boolean;
  /** A hairline above it (every row of a day but the first). */
  divider: boolean;
  /** Names worked out once for the list: people and agents, and a conversation's place ("#vendas"). */
  nameOf: (who: { type: string; id: string }) => string;
  placeOf: (channelId: string) => string | null;
  meId: string | null;
  /** Opens what the row stands for (stable). */
  onOpen: (item: CalItem) => void;
}

/**
 * One row of a day: its time (start in bold, end faint; "Dia todo"), what leads it (the agent's face for a reminder,
 * a soft blue tile for an event, a quiet tile for a task due), its title on one line and one line of facts (where and
 * with whom; who reminds and where; whose task). A row is the
 * system's list row: it lights a beat after the finger lands and opens what it stands for. Memoized on plain values.
 */
export const AgendaRow = memo(function AgendaRow({
  entry,
  over,
  divider,
  nameOf,
  placeOf,
  meId,
  onOpen,
}: AgendaRowProps) {
  const { t, i18n } = useTranslation();
  const { colors: c } = useTheme();
  const locale = i18n.language;
  const it = entry.item;
  const allDay = isAllDayEntry(entry);
  const start = formatTime(locale, atOf(entry.at));
  const end = it.kind === "event" && !allDay ? formatTime(locale, atOf(it.end)) : null;
  const title = it.kind === "deadline" ? t("calendar.deadline", { number: it.issueNumber, title: it.title }) : it.title;
  const agentId = it.kind === "reminder" ? (it.agentId ?? null) : null;
  const lead: ReactNode = agentId ? (
    <AgentFace agentId={agentId} size={LEAD} live={false} />
  ) : it.kind === "event" ? (
    <LeadTile icon="calendar" soft />
  ) : (
    <LeadTile icon="issue" />
  );
  const facts = lineOf(it, { t, nameOf, placeOf, meId });
  const said = [allDay ? t("calendar.allDay") : end ? `${start}–${end}` : start, title, facts.text]
    .filter(Boolean)
    .join(", ");
  return (
    <RowPressable
      onPress={() => onOpen(it)}
      hold
      accessibilityRole="button"
      accessibilityLabel={said}
      style={styles.row}
    >
      {divider ? <View style={[styles.divider, { left: insetOf(locale), backgroundColor: c.separator }]} /> : null}
      <View style={[styles.time, { width: timeWidth(locale) }]}>
        {allDay ? (
          <Text variant="caption" tone="faint" style={styles.allDay} numberOfLines={2}>
            {t("calendar.allDay")}
          </Text>
        ) : (
          <>
            <Text variant="small" tone={over ? "faint" : "ink"} style={over ? styles.startOver : styles.start}>
              {start}
            </Text>
            {end ? (
              <Text variant="footnote" tone="faint" style={styles.tabular}>
                {end}
              </Text>
            ) : null}
          </>
        )}
      </View>
      <View style={[styles.lead, over ? styles.leadOver : null]}>{lead}</View>
      <View style={styles.text}>
        <Text variant="title" tone={over ? "faint" : "ink"} numberOfLines={1} style={over ? styles.titleOver : null}>
          {title}
        </Text>
        {facts.text ? (
          <View style={styles.facts}>
            {facts.icon ? <Icon name={facts.icon} size={14} color={c.faint} /> : null}
            <Text variant="small" tone={over ? "faint" : "muted"} numberOfLines={1} style={styles.shrink}>
              {facts.text}
            </Text>
          </View>
        ) : null}
      </View>
    </RowPressable>
  );
});

/** A row's line of facts and the icon before it (a repeat, a bell). */
function lineOf(
  it: CalItem,
  {
    t,
    nameOf,
    placeOf,
    meId,
  }: {
    t: ReturnType<typeof useTranslation>["t"];
    nameOf: AgendaRowProps["nameOf"];
    placeOf: AgendaRowProps["placeOf"];
    meId: string | null;
  },
): { text: string; icon: IconName | null } {
  if (it.kind === "reminder") {
    const agent = it.agentId ? nameOf({ type: "agent", id: it.agentId }) : "";
    const place = it.target && "channelId" in it.target ? placeOf(it.target.channelId) : null;
    return {
      text: place ? t("mobile.calendar.reminderIn", { agent, place }) : t("mobile.calendar.reminder", { agent }),
      icon: "bell",
    };
  }
  if (it.kind === "deadline") {
    const owners = (it.owners ?? (it.owner ? [it.owner] : [])).map(nameOf).filter(Boolean);
    return {
      text: owners.length
        ? t("mobile.calendar.deadlineOf", { name: joinNames(owners, t) })
        : t("mobile.calendar.deadline"),
      icon: null,
    };
  }
  const people = othersIn(it.people, meId).map(nameOf).filter(Boolean);
  const text = [it.location ?? "", people.length ? joinNames(people, t) : ""].filter(Boolean).join(" · ");
  return {
    text: text || (it.recurring ? t("calendar.recurring") : ""),
    icon: it.recurring ? "replay" : null,
  };
}

/**
 * A row's tile: an event's on the agents' quiet surface with the glyph in the agent color (a channel's own tile,
 * `ChannelTile`), a task's quiet gray.
 */
function LeadTile({ icon, soft = false }: { icon: IconName; soft?: boolean }) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: soft ? c.agentSoft : c.sunken }]}>
      <Icon name={icon} size={18} color={soft ? c.agent : c.muted} />
    </View>
  );
}

/**
 * A time an agent proposed (`propose_event`) on its day, as a card among the rows: who proposes, what, when and with
 * whom, and the two answers. Confirmar e convidar creates the event and invites everyone; Outro horário drops it and
 * the agent asks again in its conversation.
 */
export function ProposalCard({
  proposal,
  nameOf,
  busy,
  onConfirm,
  onDismiss,
}: {
  proposal: CalendarProposal;
  nameOf: AgendaRowProps["nameOf"];
  busy: boolean;
  onConfirm: (proposal: CalendarProposal) => void;
  onDismiss: (proposal: CalendarProposal) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors: c, shadows } = useTheme();
  const locale = i18n.language;
  const when = `${formatTime(locale, proposal.start)}–${formatTime(locale, proposal.end)}`;
  const people = joinNames(proposal.participants.map(nameOf).filter(Boolean), t);
  const name = nameOf({ type: "agent", id: proposal.agentId });
  return (
    <View
      style={[styles.proposal, { backgroundColor: c.raised, boxShadow: `${shadows.e1}, ${shadows.top}` }]}
      accessibilityRole="summary"
    >
      <View style={styles.proposalHead}>
        <AgentFace agentId={proposal.agentId} size={20} live={false} />
        <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.shrink}>
          <Trans
            i18nKey="calendar.proposes"
            values={{ name }}
            components={[<Text key="name" variant="footnote" tone="ink2" style={styles.bold} />]}
          />
        </Text>
      </View>
      <Text variant="title">{proposal.title}</Text>
      <Text variant="small" tone="muted">
        {[t("calendar.proposalDetail", { when, people }), proposal.note].filter(Boolean).join(" · ")}
      </Text>
      <View style={styles.proposalActs}>
        <Button
          variant="primary"
          size="sm"
          label={t("calendar.confirm")}
          disabled={busy}
          onPress={() => onConfirm(proposal)}
        />
        <Button
          variant="secondary"
          size="sm"
          label={t("calendar.otherTime")}
          disabled={busy}
          onPress={() => onDismiss(proposal)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  bold: { fontWeight: weights.semibold },
  day: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingTop: 20,
    paddingBottom: 4,
    paddingHorizontal: SIDE,
  },
  quiet: { paddingHorizontal: SIDE, paddingTop: 16, paddingBottom: 2 },
  quietToday: { paddingHorizontal: SIDE, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: GAP,
    paddingVertical: 9,
    paddingHorizontal: SIDE,
    minHeight: 60,
  },
  divider: { position: "absolute", top: 0, right: 0, height: StyleSheet.hairlineWidth },
  // The time keeps to the row's top line, beside the title.
  time: { alignSelf: "flex-start", paddingTop: 1, alignItems: "flex-end", gap: 1 },
  start: { fontWeight: weights.semibold, fontVariant: ["tabular-nums"] },
  startOver: { fontWeight: weights.medium, fontVariant: ["tabular-nums"] },
  tabular: { fontVariant: ["tabular-nums"] },
  allDay: { fontWeight: weights.semibold, textAlign: "right", lineHeight: 20 },
  lead: { width: LEAD, height: LEAD, alignItems: "center", justifyContent: "center" },
  leadOver: { opacity: 0.55 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  titleOver: { fontWeight: weights.medium },
  facts: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  tile: {
    width: LEAD,
    height: LEAD,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
  },
  now: { flexDirection: "row", alignItems: "center", height: 18, paddingLeft: SIDE },
  nowTime: { textAlign: "right", fontWeight: weights.bold, fontVariant: ["tabular-nums"] },
  nowLine: { flex: 1, height: 1.5, marginLeft: 8 },
  nowDot: { position: "absolute", left: -4, top: -3.25, width: 8, height: 8, borderRadius: 4 },
  proposal: {
    marginHorizontal: SIDE,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    gap: 6,
  },
  proposalHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  proposalActs: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" },
});
