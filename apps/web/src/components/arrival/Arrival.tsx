import { useAiStatus } from "@agenteschat/client";
import { teamThinks } from "@agenteschat/client/lib/no-ai";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectAi, useMayConnectAi } from "@/components/connect-ai-context";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { ARRIVAL_BETA_ONLY, ARRIVAL_PARAM, welcomeSeen } from "@/lib/arrival";
import { lazyDialog } from "@/lib/lazy-dialog";
import { useOpenParam } from "@/lib/open-param";
import { usePaidMoment } from "@/lib/paid-return";
import { PaidCard, PaidDialog, type PaidNext } from "./PaidMoment";

/** Its code (the pictures, the first-run list's reads) comes when it first opens, or in the background before. */
const WelcomeWizard = lazyDialog(() => import("./WelcomeWizard").then((m) => m.WelcomeWizard));

/**
 * Right after the onboarding (ADR 0160, addendum of 2026-11-26): the welcome wizard, then Connect an AI with the team
 * on its stage, for a person who has an AI to connect while some agent has none. Asked for by the address, once: the
 * mark is dropped as it opens, so a reload or Back shows neither again, and this browser keeps that the wizard was
 * shown to this person here (`welcomeSeen`), so the same address again opens nothing. `?arrival=beta` is the wizard
 * alone: the onboarding already asked for the AI in its own step, or the plan was left for later and its row leads
 * the right hand's card (ADR 0162). A row of the wizard's last step that leads somewhere of its own replaces Connect.
 *
 * Right after paying (ADR 0079, `usePaidMoment`), the moment the plan turned on, once its hold lifts: in full on the
 * page the return landed on (before the wizard when both came together, after it when the plan turned on during it),
 * else as a card in the corner. One thing at a time: never two dialogs, and the card never over one (it sits under
 * every dialog's scrim).
 */
export function Arrival() {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const [asked, clear] = useOpenParam(ARRIVAL_PARAM);
  // The value it was asked with, kept once the address drops it; null: nothing to show.
  const [arrival, setArrival] = useState<string | null>(null);
  // A dialog of the person's own open as the plan turns on: the moment comes as the card, under it. The wizard is
  // this component's, and the moment follows it.
  const paid = usePaidMoment(
    org.id,
    org.standing,
    arrival === null && document.querySelector("[role='dialog']") !== null,
  );
  // The paid moment was there as the wizard was asked for: it comes first. One that comes during the wizard waits.
  const [paidFirst, setPaidFirst] = useState(false);
  const connect = useConnectAi();
  const mayConnect = useMayConnectAi();
  const dir = useDirectory(org.id);
  const status = useAiStatus(org.id);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per link
  useEffect(() => {
    if (asked === null) return;
    // Shown here already (another tab, the same address again): the mark goes, and nothing opens.
    if (!welcomeSeen(me.user.id, org.id)) {
      setArrival(asked);
      setPaidFirst(paid.moment !== null);
    }
    clear(null);
  }, [asked]);
  // Every agent already thinks (a workspace joined with its AI in place): nothing to connect.
  const allThink =
    teamThinks(
      dir.agents.map((a) => a.id),
      status.data,
    ) === true;
  const toConnect = mayConnect && !allThink && connect !== null;
  // Before the wizard, the moment's way on is the wizard itself (Continue).
  if (paid.moment && arrival !== null && paidFirst)
    return <PaidDialog moment={paid.moment} next={null} onClose={paid.done} onScreen={paid.onScreen} />;
  if (arrival !== null)
    return (
      <Suspense fallback={null}>
        <WelcomeWizard
          onDone={(handOff) => {
            const was = arrival;
            setArrival(null);
            // A paid moment waiting after the wizard leads to Connect itself, as its one way on.
            if (handOff && was !== ARRIVAL_BETA_ONLY && toConnect && !paid.moment) connect?.open({ arrival: true });
          }}
        />
      </Suspense>
    );
  // Its one way on is known before it shows: never a button that changes under the person.
  if (!paid.moment || dir.loading || status.isPending) return null;
  // The one way on: an AI for the team to think with, else the first conversation, with the right hand.
  const lead = rightHandOf(dir.agents);
  const leadPath = lead ? `/org/${org.id}/dm/agent/${lead.id}` : null;
  const next: PaidNext = toConnect
    ? { label: t("paidMoment.next.ai"), run: () => connect?.open({}) }
    : lead && leadPath !== path
      ? {
          label: t("paidMoment.next.talk", { name: lead.name }),
          run: () =>
            void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: lead.id } }),
        }
      : null;
  return paid.form === "dialog" ? (
    <PaidDialog moment={paid.moment} next={next} onClose={paid.done} onScreen={paid.onScreen} />
  ) : (
    <PaidCard moment={paid.moment} next={next} onClose={paid.done} onScreen={paid.onScreen} />
  );
}
