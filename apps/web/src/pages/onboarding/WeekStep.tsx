import type { ApiRule, FirstAgentOption, Routine } from "@agenteschat/client";
import { useRoutines } from "@agenteschat/client";
import type { AppClient } from "@agenteschat/client/lib/app-clients";
import { clockHour } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { cronRule } from "@agenteschat/client/lib/routine-view";
import { isTimeZone } from "@agenteschat/client/lib/routines";
import {
  type AgentAppearance,
  BUSINESS_DAYS,
  dotTone,
  Icon,
  nextOccurrences,
  ProviderLogo,
  WEEKDAYS,
  type Weekday,
  weekdayOfYmd,
} from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { fromApiRule } from "@/lib/recurrence";
import { Box } from "./Shell";
import "./week-step.css";

/*
 * "<Agent>'s first week" (ADR 0162, amended for the first agent asked of the person's own AI): a planner page for the
 * agent just picked. The next seven days from today in a plain strip (today in a dark circle, the agent's working days
 * in its color), then only the days that matter: today, with what it delivers on its first day, and its routine's next
 * day, at its time and with how it repeats (today itself when the routine still runs today). Under them, what the
 * person's AI said about the workspace. Nothing to type.
 */

/** What the week shows of an agent: what it delivers today, and its routine (`cron` read by the server). */
export interface WeekPlan {
  today: readonly string[];
  routine: { title: string; schedule: string; cron: string | null; timezone: string | null } | null;
}

/** A picked option's week: what its AI said it delivers on the first day, and its routine. */
export const weekOfOption = (o: FirstAgentOption): WeekPlan => ({ today: o.today, routine: o.routine });

/** An agent brought another way (an import): its first scheduled routine, and nothing said for today. */
export function weekOfRoutines(agentId: string, routines: readonly Routine[]): WeekPlan {
  for (const r of routines) {
    if (r.agentId !== agentId || !r.active || r.trigger.type !== "schedule") continue;
    const { cron, timezone, description } = r.trigger;
    return { today: [], routine: { title: r.name, schedule: description, cron, timezone } };
  }
  return { today: [], routine: null };
}

/** How many of a day's runs the page lists: an hourly routine is one block a day, not twenty-four. */
const SLOTS_A_DAY = 3;

/** A day in a zone, `YYYY-MM-DD`. */
function ymdIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The day `n` days after a `YYYY-MM-DD` one. */
function plusDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** How the routine repeats, in a few words ("every Monday", "every day"); the AI's own words when the rule says more. */
function repeatOf(t: TFunction, rule: ApiRule | null, schedule: string): string {
  const days = (rule?.byWeekday ?? []).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
  const every = Math.max(1, rule?.interval ?? 1);
  if (rule && every === 1 && (rule.freq === "daily" || rule.freq === "weekly")) {
    if (days.length === 0 || days.length === 7) return t("onboarding.week.every.day");
    if (days.length === 1 && days[0]) return t(`onboarding.week.every.${days[0]}`);
    if (days.length === 5 && BUSINESS_DAYS.every((d) => days.includes(d)))
      return t("onboarding.week.every.businessDays");
  }
  return schedule;
}

/**
 * The step's box: the title by the agent's name, the lead with its routine and how it repeats (else the plain one),
 * the planner, and what the AI said. `zone`: the workspace's, for a routine the server kept none for.
 */
export function FirstWeek({
  orgId,
  agent,
  option,
  about,
  app = null,
  zone,
  personal,
  eyebrow,
  acts,
}: {
  orgId: string;
  agent: { id: string; name: string; look: AgentAppearance | undefined };
  /** The option it was made from; null for an agent brought another way, whose own routine says its week. */
  option: FirstAgentOption | null;
  /** What the person's AI said the workspace (or the person) does. */
  about: string | null;
  /** The assistant the request was sent to, when this visit knows it. */
  app?: Pick<AppClient, "name" | "mark"> | null;
  zone: string;
  personal: boolean;
  eyebrow?: ReactNode;
  acts: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const routines = useRoutines(orgId).data;
  const plan = option ? weekOfOption(option) : weekOfRoutines(agent.id, routines ?? []);
  const routine = plan.routine;
  const tz = routine?.timezone && isTimeZone(routine.timezone) ? routine.timezone : isTimeZone(zone) ? zone : "UTC";

  // Read once per visit: the strip starts on the day the step opened, in the routine's zone.
  const week = useMemo(() => {
    const now = new Date();
    const today = ymdIn(now, tz);
    const days = Array.from({ length: 7 }, (_, i) => plusDays(today, i));
    const rule = routine?.cron ? cronRule(routine.cron, tz) : null;
    const time = new Intl.DateTimeFormat(locale, { hour: clockHour(locale), minute: "2-digit", timeZone: tz });
    const slots = rule
      ? nextOccurrences(fromApiRule(rule, today), now, 24).map((at) => ({ ymd: ymdIn(at, tz), time: time.format(at) }))
      : [];
    const last = days[days.length - 1] ?? today;
    // The next day the routine runs after today: in the strip, or later (a monthly one).
    const next = slots.find((s) => s.ymd > today)?.ymd ?? null;
    const work = new Set(slots.filter((s) => s.ymd <= last).map((s) => s.ymd));
    if (plan.today.length > 0) work.add(today);
    return { today, days, rule, slots, next, work, last };
  }, [routine?.cron, tz, locale, plan.today.length]);

  const grammar = agentGrammar(agent.name);
  const repeat = routine ? repeatOf(t, week.rule, routine.schedule) : null;
  const lead = routine
    ? t(personal ? "onboarding.week.leadRoutinePersonal" : "onboarding.week.leadRoutine", {
        ...grammar,
        routine: routine.title,
        when: repeat,
      })
    : t(personal ? "onboarding.week.leadPersonal" : "onboarding.week.lead", grammar);

  /** "terça, 24", or with its month past the strip ("segunda, 15 de dezembro"). */
  const dateOf = (ymd: string) => {
    const wd = weekdayOfYmd(ymd);
    const n = Number(ymd.slice(8, 10));
    const weekday = t(`onboarding.week.days.${wd}`);
    if (ymd <= week.last) return t("onboarding.week.date", { weekday, n });
    const [y, m] = ymd.split("-").map(Number);
    const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)),
    );
    return t("onboarding.week.dateFar", { weekday, n, month });
  };
  const upper = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  const titleOf = (ymd: string) =>
    ymd === week.today
      ? t("onboarding.week.today", { date: dateOf(ymd) })
      : ymd === plusDays(week.today, 1)
        ? t("onboarding.week.tomorrow", { date: dateOf(ymd) })
        : upper(dateOf(ymd));

  const at = (ymd: string) => week.slots.filter((s) => s.ymd === ymd).slice(0, SLOTS_A_DAY);
  const todayEvents = [
    ...plan.today.map((text, i) => ({ key: `now-${i}`, at: t("onboarding.week.now"), text })),
    ...(routine ? at(week.today).map((s) => ({ key: `r-${s.time}`, at: s.time, text: routine.title })) : []),
  ];
  // The days that matter, opened: today, then the routine's next day.
  // A routine that still runs today says how it repeats there: its next day would show the same run again.
  const runsToday = routine !== null && at(week.today).length > 0;
  const opened = [
    ...(todayEvents.length > 0 ? [{ ymd: week.today, repeat: runsToday ? repeat : null, events: todayEvents }] : []),
    ...(routine && week.next && !runsToday
      ? [
          {
            ymd: week.next,
            repeat,
            events: at(week.next).map((s) => ({ key: `r-${s.time}`, at: s.time, text: routine.title })),
          },
        ]
      : []),
  ];
  const planner = opened.length > 0 && (
    <div className="onb-week" style={{ "--c": dotTone(agent.look?.color ?? "sky") } as CSSProperties}>
      <ol className="onb-week__strip" aria-label={t("onboarding.week.strip")}>
        {week.days.map((ymd) => (
          <li
            key={ymd}
            data-today={ymd === week.today ? "" : undefined}
            data-work={week.work.has(ymd) ? "" : undefined}
          >
            <span className="onb-week__wd">{t(`recurrence.wd.${weekdayOfYmd(ymd)}.abbr`)}</span>
            <span className="onb-week__n">{Number(ymd.slice(8, 10))}</span>
            <i aria-hidden="true" />
          </li>
        ))}
      </ol>
      {opened.map((d) => (
        <section key={d.ymd} className="onb-week__day">
          <p className="onb-week__title">
            <b>{titleOf(d.ymd)}</b>
            {d.repeat && (
              <span>
                <Icon name="repeat" size={14} />
                {d.repeat}
              </span>
            )}
          </p>
          <ul className="onb-week__evs">
            {d.events.map((e) => (
              <li key={e.key}>
                <span className="onb-week__at">{e.at}</span>
                <span className="onb-week__ev">
                  <AgentAvatar name={agent.name} appearance={agent.look} size="xs" framed={false} />
                  <span>{e.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
  const told = about?.trim() && (
    <div className="onb-week__about" data-after={planner ? "" : undefined}>
      <p className="onb-week__from">
        {app?.mark ? <ProviderLogo id={app.mark} size="sm" /> : <Icon name="sparkle" size={18} />}
        <b>{app?.name ? t("onboarding.week.about", { app: app.name }) : t("onboarding.week.aboutAny")}</b>
      </p>
      <p className="onb-week__text">{about}</p>
    </div>
  );

  return (
    <Box eyebrow={eyebrow} title={t("onboarding.week.title", grammar)} lead={lead} acts={acts}>
      {planner || told ? (
        <>
          {planner}
          {told}
        </>
      ) : undefined}
    </Box>
  );
}
