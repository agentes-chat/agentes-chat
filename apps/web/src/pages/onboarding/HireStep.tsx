import type { PlanOffer } from "@agenteschat/client/lib/billing";
import { type FirstArea, nextAreas } from "@agenteschat/client/lib/first-areas";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { Button, HintLine, Icon, PixelSky, Spinner, teamSky } from "@agenteschat/ui";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOpenBilling } from "@/components/BillingLinkButton";
import { AREA_ICON } from "./areas";
import { Box, type ShellFace } from "./Shell";
import "./hire-step.css";

/*
 * The plan step (ADR 0162, amended by ADR 0256's addendum of 2026-11-27) of a workspace waiting for its first plan
 * (agentes.chat Cloud, ADR 0079): the first agent asleep at night in the middle of the places the next ones can take,
 * what it delivers today and that more agents come later, then the plan the billing service recommends: its name and
 * price on one line, what it includes, and the way to every plan. "Not now" leaves the plan for later; the button opens
 * the plan's Checkout. Back from paying (`confirming`), the payment said as received until the hold lifts. The plan's
 * facts are the billing service's list, never this server's.
 */

/**
 * The plan's band: the night sky, the first agent asleep in the middle, and four empty places around it in the kit's
 * empty-slot look (the outer two smaller and fainter), each with another area's icon, joined to it by dotted pixels.
 * Decorative: no words on the sky.
 */
function HireBand({ who, next }: { who: ShellFace; next: readonly FirstArea[] }) {
  const options = useMemo(() => teamSky(0, 0), []);
  const place = (area: FirstArea | undefined, far: boolean) =>
    area && (
      <span className="team-scene__mark team-scene__mark--slot onb-place" data-far={far ? "" : undefined}>
        <Icon name={AREA_ICON[area]} size={far ? 14 : 16} />
      </span>
    );
  const dots = <span className="onb-dots" />;
  return (
    <div className="onb-pass" aria-hidden="true">
      <div className="team-scene team-scene--band onb-pass__sky">
        <PixelSky options={options} />
        <div className="team-scene__row onb-grow">
          {place(next[0], true)}
          {next[0] && dots}
          {place(next[1], false)}
          {next[1] && dots}
          <span className="team-scene__agent" data-lead="" style={{ "--i": 0 } as CSSProperties}>
            <AgentAvatar name={who.name} appearance={who.look} size="lg" framed={false} state="sleeping" />
          </span>
          {next[2] && dots}
          {place(next[2], false)}
          {next[3] && dots}
          {place(next[3], true)}
        </div>
      </div>
    </div>
  );
}

export function HireTeam({
  orgId,
  org,
  agent,
  area,
  offer,
  personal,
  confirming,
  skipping,
  onSkip,
  eyebrow,
}: {
  orgId: string;
  /** The workspace's name. */
  org: string;
  /** The first agent. */
  agent: ShellFace;
  /** The work it was made for, when it was made from one: its first delivery in the lead. */
  area: FirstArea | null;
  offer: PlanOffer | null;
  personal: boolean;
  /** Back from paying: the payment is being confirmed. */
  confirming: boolean;
  /** "Not now" is opening the workspace. */
  skipping: boolean;
  onSkip: () => void;
  eyebrow?: ReactNode;
}) {
  const { t } = useTranslation();
  const hire = useOpenBilling(orgId, "onboarding", offer?.key);
  const allPlans = useOpenBilling(orgId, "onboarding");
  const who = agentGrammar(agent.name);
  const the = t("onboarding.hire.the", who);
  const next = nextAreas(personal, area);
  const title = personal
    ? t("onboarding.hire.titlePersonal", { agent: the })
    : t("onboarding.hire.title", { org, agent: the });
  const lead = area
    ? t("onboarding.hire.lead", { ...who, today: t(`onboarding.areas.list.${area}.today`, { org }) })
    : t("onboarding.hire.leadAny", who);
  // The people it includes only where people are invited: a personal workspace is its owner's alone.
  const fine = personal
    ? t("onboarding.hire.finePersonal")
    : offer?.people
      ? t("onboarding.hire.fine", { count: offer.people })
      : t("onboarding.hire.fineAny");

  return (
    <Box
      cover={<HireBand who={agent} next={next} />}
      eyebrow={eyebrow}
      title={title}
      lead={
        <>
          {lead}
          {/* What the next agents could be, in words under the lead: each icon before its name. */}
          <span className="onb-next-areas">
            <span>{t("onboarding.hire.next")}</span>
            {next.map((a, i) => (
              <span key={a} className="onb-next-areas__item">
                <Icon name={AREA_ICON[a]} size={14} />
                {t(`onboarding.areas.list.${a}.role`)}
                {/* The dot ends its name's piece, so a wrapped line never starts with one. */}
                {i < next.length - 1 && <span className="onb-next-areas__sep">·</span>}
              </span>
            ))}
          </span>
        </>
      }
      note={
        confirming ? (
          // Back from paying: the billing service lifts the hold on its next pass, and the next step opens then.
          <span className="onbx__note ac-iconline" role="status">
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
            {offer ? t("onboarding.hire.subscribe", { name: offer.name }) : t("onboarding.hire.subscribeAny")}
          </Button>
        )
      }
    >
      <div className="onb-offer">
        <div className="onb-offer__head">
          <span className="onb-offer__name">
            {/* Why the Cloud costs, beside the plan's name: one's own server is free, said here and nowhere louder. */}
            <HintLine name={t("hosting.whyPaid")} hint={t("hosting.whyPaidText")}>
              <b>{offer ? t("onboarding.hire.plan", { name: offer.name }) : t("onboarding.flow.plan.generic")}</b>
            </HintLine>
          </span>
          {offer?.price && (
            <span className="onb-offer__price">
              <b>{offer.price}</b>
              <span>{t("onboarding.hire.perMonth")}</span>
            </span>
          )}
        </div>
        <p className="onb-offer__fine">{fine}</p>
        {offer && (
          <button
            type="button"
            className="ac-link onb__link onb-offer__all"
            disabled={allPlans.isPending || skipping}
            onClick={() => allPlans.mutate()}
          >
            {t("onboarding.flow.plan.all")}
          </button>
        )}
      </div>
    </Box>
  );
}
