import type { Agent, FirstAgentOption } from "@agenteschat/client";
import { useRoutines } from "@agenteschat/client";
import type { PlanOffer } from "@agenteschat/client/lib/billing";
import { joinNames } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { firstJob } from "@agenteschat/client/lib/onboarding";
import { Avatar, Button, HintLine, Spinner } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOpenBilling } from "@/components/BillingLinkButton";
import { lookOf } from "@/lib/look";
import { Box, Pass, type ShellFace } from "./Shell";
import "./hire-step.css";

/*
 * "Hire the team" (ADR 0162, amended for the first agent asked of the person's own AI): the plan step of a workspace
 * waiting for its first plan (agentes.chat Cloud). The team asleep beside its computer at night, who is being hired (the
 * first agent with its role and what it does; the right hand as the agents' HR), and the plan the billing service
 * recommends in two lines: its name and price, then what it includes. "Not now" leaves the plan for later; the button
 * opens the plan's Checkout. Back from paying (`confirming`), the payment said as received until the hold lifts.
 */

/** How many agents the roster lists besides the right hand (an import may bring more). */
const ROSTER_MAX = 4;

/** An agent's name with the article its language gives it ("o Caio", "a Nina"; "Caio" in English). */
const the = (t: TFunction, name: string) => t("onboarding.hire.the", agentGrammar(name));

/** A role inside a sentence ("for billing"): lower case, unless it reads as a name or an acronym ("SEO", "Stripe"). */
export function roleWord(role: string, locale: string) {
  const r = role.trim();
  const second = r.charAt(1);
  return second && second === second.toLocaleLowerCase(locale) && second !== second.toLocaleUpperCase(locale)
    ? r.charAt(0).toLocaleLowerCase(locale) + r.slice(1)
    : r;
}

export function HireTeam({
  orgId,
  lodi,
  team,
  option,
  offer,
  personal,
  confirming,
  skipping,
  onSkip,
  eyebrow,
}: {
  orgId: string;
  /** The right hand, standing first. */
  lodi: ShellFace;
  /** The agents besides the right hand, in the order they were made: the first agent first. */
  team: readonly Agent[];
  /** The option the first agent was picked from, when it was: its role and its first task say what it does. */
  option: FirstAgentOption | null;
  offer: PlanOffer | null;
  personal: boolean;
  /** Back from paying: the payment is being confirmed. */
  confirming: boolean;
  /** "Not now" is opening the workspace. */
  skipping: boolean;
  onSkip: () => void;
  eyebrow?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const routines = useRoutines(orgId).data;
  const hire = useOpenBilling(orgId, "onboarding", offer?.key);
  const allPlans = useOpenBilling(orgId, "onboarding");
  const [first] = team;
  const hired = team.slice(0, ROSTER_MAX);
  const faces: ShellFace[] = [lodi, ...hired.map((a) => ({ id: a.id, name: a.name, look: lookOf(a) }))];

  // Who is hired, in words: the first agent for its role, the ones an import brought by name, or the right hand alone.
  const role = (option?.role ?? first?.role ?? "").trim();
  const lead = !first
    ? t("onboarding.hire.leadAlone", agentGrammar(lodi.name))
    : team.length > 1
      ? t("onboarding.hire.leadMany", {
          names: joinNames(
            hired.map((a) => the(t, a.name)),
            t,
          ),
          lodi: the(t, lodi.name),
        })
      : t(role ? "onboarding.hire.lead" : "onboarding.hire.leadNoRole", {
          ...agentGrammar(first.name),
          agent: the(t, first.name),
          lodi: the(t, lodi.name),
          role: roleWord(role, i18n.language),
        });
  // A team hires its team; a personal workspace, its one agent by name (the right hand when it starts alone).
  const one = team.length <= 1 ? (first?.name ?? lodi.name) : null;
  const title = !personal
    ? t("onboarding.hire.title")
    : one
      ? t("onboarding.hire.titleOne", agentGrammar(one))
      : t("onboarding.hire.titlePersonal");
  const cta = !personal
    ? t("onboarding.hire.cta")
    : one
      ? t("onboarding.hire.ctaOne", agentGrammar(one))
      : t("onboarding.hire.ctaPersonal");

  /** What an agent does, in one line: the first agent's first task, else its first routine (when it isn't its role). */
  const lineOf = (a: Agent) => {
    if (a.id === first?.id && option?.tasks[0]) return option.tasks[0];
    const job = firstJob(a, routines);
    return job && job !== a.role ? job : "";
  };
  // The people it includes only where people are invited: a personal workspace is its owner's alone.
  const fine =
    !personal && offer?.people ? t("onboarding.hire.fine", { count: offer.people }) : t("onboarding.hire.fineAny");

  return (
    <Box
      cover={<Pass day={0} awake={false} cast={faces} />}
      eyebrow={eyebrow}
      title={title}
      lead={lead}
      note={
        confirming ? (
          // Back from paying: the billing service lifts the hold on its next pass, and the next step opens then.
          <span className="onbx__note" role="status">
            <Spinner size={14} />
            <span>{t("standing.billing.paid")}</span>
          </span>
        ) : (
          <button
            type="button"
            className="onbx__back onbx__back--text"
            disabled={skipping || hire.isPending}
            onClick={onSkip}
          >
            {t("onboarding.hire.later")}
          </button>
        )
      }
      acts={
        !confirming && (
          <Button
            variant="primary"
            kbd={["↵"]}
            data-enter=""
            loading={hire.isPending}
            disabled={skipping}
            onClick={() => hire.mutate()}
          >
            {cta}
          </Button>
        )
      }
    >
      {first && (
        <ul className="onb-roster">
          {[...hired, null].map((a) => {
            // The right hand last, as what it is to the person.
            const who = a ? { id: a.id, name: a.name, look: lookOf(a) } : lodi;
            const job = a ? (a.id === first.id && option ? option.role : a.role) : t("onboarding.hire.rightHand");
            const line = a ? lineOf(a) : t("onboarding.hire.rightHandLine");
            return (
              <li key={who.id}>
                <Avatar kind="agent" name={who.name} appearance={who.look} size="sm" framed={false} />
                <span>
                  <b>
                    {who.name}
                    {job && <span>{job}</span>}
                  </b>
                  {line && <span>{line}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="onb-offer">
        <div className="onb-offer__head">
          <span className="onb-offer__name">
            {/* Why the Cloud costs, beside the plan's name: one's own server is free, said here and nowhere louder. */}
            <HintLine name={t("hosting.whyPaid")} hint={t("hosting.whyPaidText")}>
              <b>{offer ? t("onboarding.hire.plan", { name: offer.name }) : t("onboarding.flow.plan.generic")}</b>
            </HintLine>
            {offer && (
              <button
                type="button"
                className="ac-link onb__link"
                disabled={allPlans.isPending || skipping}
                onClick={() => allPlans.mutate()}
              >
                {t("onboarding.flow.plan.all")}
              </button>
            )}
          </span>
          {offer?.price && (
            <span className="onb-offer__price">
              <b>{offer.price}</b>
              <span>{t("onboarding.hire.perMonth")}</span>
            </span>
          )}
        </div>
        <p className="onb-offer__fine">{fine}</p>
      </div>
    </Box>
  );
}
