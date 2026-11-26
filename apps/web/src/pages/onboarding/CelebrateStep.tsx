import { joinNames } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { Button, Icon } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { Box, Photo, type ShellFace } from "./Shell";
import "./celebrate-step.css";

/*
 * Back from a paid Checkout, once (ADR 0079, the moment the plan turned on): the team's photo in daylight with the
 * person among the agents and a few pixels of confetti, the right hand saying hello, the day the team began, who is in
 * it, and what is left before the work starts (the plan already checked). It stands in the plan step's place until its
 * one button, which goes on to the step the data reached: connecting the AI, else the next one.
 */

export function TeamWelcome({
  org,
  person,
  first,
  lodi,
  team,
  plan,
  personal,
  aiDone,
  toAi,
  people,
  deliveries,
  onNext,
}: {
  /** The workspace's name. */
  org: string;
  person: { name: string; image: string | null };
  /** The person's first name, greeted by the right hand. */
  first: string;
  lodi: ShellFace;
  /** The agents besides the right hand, awake. */
  team: readonly ShellFace[];
  /** The plan's name, when the paid return said which. */
  plan: string | null;
  personal: boolean;
  /** Every agent already thinks: the AI row is checked. */
  aiDone: boolean;
  /** The button leads to connecting the AI ("Connect the AI"), else on ("Continue"). */
  toAi: boolean;
  /** A team's people row, checked once they were invited; null in a personal workspace. */
  people: boolean | null;
  /** What the first agent delivers on its first day, when its AI said. */
  deliveries: number;
  onNext: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date());
  const names = joinNames(
    [t("onboarding.celebrate.you"), ...[lodi, ...team].map((a) => t("onboarding.hire.the", agentGrammar(a.name)))],
    t,
  );
  const rows = [
    {
      key: "plan",
      done: true,
      text: plan ? t("onboarding.celebrate.plan", { name: plan }) : t("onboarding.celebrate.planAny"),
    },
    { key: "ai", done: aiDone, text: t(personal ? "onboarding.celebrate.aiPersonal" : "onboarding.celebrate.ai") },
    ...(people !== null ? [{ key: "people", done: people, text: t("onboarding.celebrate.people") }] : []),
  ];
  const eyebrow = personal
    ? t("onboarding.celebrate.eyebrowPersonal", { date })
    : t("onboarding.celebrate.eyebrow", { org, date });
  const start =
    deliveries > 0
      ? t(personal ? "onboarding.celebrate.startPersonal" : "onboarding.celebrate.start", { count: deliveries })
      : t(personal ? "onboarding.celebrate.startAnyPersonal" : "onboarding.celebrate.startAny");

  return (
    <Box
      cover={
        <Photo
          cast={[lodi, ...team]}
          person={person}
          say={first ? t("onboarding.celebrate.say", { first }) : t("onboarding.celebrate.sayAny")}
        />
      }
      eyebrow={eyebrow}
      title={personal ? t("onboarding.celebrate.titlePersonal") : t("onboarding.celebrate.title", { org })}
      lead={t("onboarding.celebrate.lead", { names })}
      acts={
        <Button variant="primary" kbd={["↵"]} data-enter="" onClick={onNext}>
          {t(toAi ? "onboarding.celebrate.connect" : "onboarding.actions.continue")}
        </Button>
      }
    >
      <ol className="onb-next">
        {rows.map((r, i) => (
          <li key={r.key} className="onb-next__row" data-done={r.done ? "" : undefined}>
            <span className="onb-next__n" aria-hidden="true">
              {r.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span>
              {r.text}
              {r.done && <span className="ac-visually-hidden"> {t("onboarding.stepDone")}</span>}
            </span>
          </li>
        ))}
        <li className="onb-next__row onb-next__end">
          <span className="onb-next__n" aria-hidden="true">
            <Icon name="sparkle" size={14} />
          </span>
          <span>{start}</span>
        </li>
      </ol>
    </Box>
  );
}
