import type { Agent } from "@agenteschat/client";
import { useRoutines } from "@agenteschat/client";
import type { PlanOffer } from "@agenteschat/client/lib/billing";
import { firstJob } from "@agenteschat/client/lib/onboarding";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import { Button, Chip, HintLine, Icon, Spinner } from "@agenteschat/ui";
import { Trans, useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { type PaidComputer, PaidScene } from "@/components/arrival/PaidMoment";
import { useOpenBilling } from "@/components/BillingLinkButton";
import { TeamAsleepSky } from "@/components/Sky";
import { lookOf } from "@/lib/look";

/**
 * The plan step, "Turn the team on" (agentes.chat Cloud, a workspace waiting for its first plan): the team asleep until it,
 * what each one does (its first routine, else its role; the right hand, what it is to the person), the plan the
 * billing service recommends with its price when it says one, what comes after it (`next`: connecting an AI, ADR
 * 0162), and the way in without it, where the right hand's card keeps the plan. Back from paying (`confirming`), the
 * payment said as received until the hold lifts. Then (`awake`, ADR 0079) the moment the plan turned on: day over
 * the team, the computer as it is (on, or getting ready), a hello to the person who paid, and the step that comes
 * next as the one way on.
 */
export function PlanStep({
  orgId,
  team,
  offer,
  skipping,
  onSkip,
  next,
  confirming,
  personal,
  awake,
}: {
  orgId: string;
  team: Agent[];
  offer: PlanOffer | null;
  skipping: boolean;
  onSkip: () => void;
  next: boolean;
  confirming: boolean;
  personal: boolean;
  /** The plan just turned on: who paid (greeted by their first name), the computer as it is, and the step after it. */
  awake: { name: string | null | undefined; computer: PaidComputer; next: string; onNext: () => void } | null;
}) {
  const { t } = useTranslation();
  const routines = useRoutines(orgId).data;
  const turnOn = useOpenBilling(orgId, "onboarding", offer?.key);
  const allPlans = useOpenBilling(orgId, "onboarding");
  if (awake)
    return (
      <section
        className="onb__plan"
        aria-label={t(personal ? "onboarding.flow.steps.planPersonal" : "onboarding.flow.steps.plan")}
      >
        <PaidScene agents={team} name={awake.name} computer={awake.computer} className="onb__plan-scene" />
        <PlanWeek team={team} routines={routines} />
        <div className="onb__plan-acts">
          <Button variant="primary" kbd={["↵"]} data-enter="" onClick={awake.onNext}>
            {awake.next}
          </Button>
        </div>
      </section>
    );
  return (
    <>
      <section
        className="onb__plan"
        aria-label={t(personal ? "onboarding.flow.steps.planPersonal" : "onboarding.flow.steps.plan")}
      >
        {/* A picture of the list under it (each name, then what it does first): read once, from the list. */}
        <div className="onb__plan-faces" aria-hidden="true">
          <TeamAsleepSky />
          {team.map((a) => (
            <span key={a.id} className="onb__plan-face">
              <AgentAvatar name={a.name} appearance={lookOf(a)} size="lg" state="sleeping" />
              <Chip className="sky-chip">{a.name}</Chip>
            </span>
          ))}
          <Chip className="sky-chip onb__plan-zz">
            {t(personal ? "onboarding.flow.plan.asleepPersonal" : "onboarding.flow.plan.asleep")}
          </Chip>
        </div>
        <PlanWeek team={team} routines={routines} />
        <div className="onb__plan-price">
          {/* Why the Cloud costs, where the price is: one's own server is free, said here and nowhere louder. */}
          <HintLine name={t("hosting.whyPaid")} hint={t("hosting.whyPaidText")}>
            {offer ? (
              <Trans
                i18nKey={offer.price ? "onboarding.flow.plan.price" : "onboarding.flow.plan.name"}
                values={{ name: offer.name, price: offer.price }}
                components={{ b: <b /> }}
              />
            ) : (
              t("onboarding.flow.plan.generic")
            )}
          </HintLine>
          <span className="muted">{t("onboarding.flow.plan.cancel")}</span>
        </div>
        {confirming ? (
          // Back from paying: the billing service lifts the hold on its next pass, and the next step opens then. A line
          // of the card in place of its buttons, never a box inside it.
          <p className="onb__paid ac-iconline" role="status">
            <Spinner size={14} />
            <span>{t("standing.billing.paid")}</span>
          </p>
        ) : (
          <div className="onb__plan-acts">
            <Button variant="primary" loading={turnOn.isPending} disabled={skipping} onClick={() => turnOn.mutate()}>
              {t(personal ? "onboarding.flow.plan.ctaPersonal" : "onboarding.flow.plan.cta")}
            </Button>
            {offer && (
              <button
                type="button"
                className="ac-link"
                disabled={allPlans.isPending || skipping}
                onClick={() => allPlans.mutate()}
              >
                {t("onboarding.flow.plan.all")}
              </button>
            )}
            {next && <span className="muted">{t("onboarding.flow.plan.next")}</span>}
          </div>
        )}
      </section>
      {!confirming && (
        <p className="onb__skip">
          <button type="button" className="ac-link" disabled={skipping || turnOn.isPending} onClick={onSkip}>
            {t("onboarding.flow.plan.skip")}
          </button>
        </p>
      )}
    </>
  );
}

/** What each one does: its first routine, else its role; the right hand, what it is to the person. */
function PlanWeek({ team, routines }: { team: Agent[]; routines: Parameters<typeof firstJob>[1] }) {
  const { t } = useTranslation();
  return (
    <ul className="onb__plan-week">
      {team.map((a) => {
        // The right hand has no role of its own: it is said as what it is to the person. Nothing to say, no dot.
        const job = firstJob(a, routines) || (isRightHand(a) ? t("rightHand.labelCapitalized") : "");
        return (
          <li key={a.id} className="ac-iconline">
            <Icon name="check" size={14} />
            <span>
              <b>{a.name}</b>
              {job && ` · ${job}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
