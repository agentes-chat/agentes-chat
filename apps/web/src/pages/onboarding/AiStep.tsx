import { type Agent, type Me, type OrgSummary, useComputerSetup } from "@agenteschat/client";
import { type AiChoice, gateDims, planOffSystem } from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePlanGates } from "@/components/ai/ConnectAiSteps";
import { ConnectChoices } from "@/components/arrival/ConnectChoices";
import { ConnectAiProvider, type ConnectAiRequest, useConnectAi } from "@/components/connect-ai-context";
import { OrgProvider, useOrg } from "@/components/org-context";

/*
 * The onboarding's Connect an AI step (ADR 0162, amended by ADR 0264's addendum of 2026-11-27), right after the plan:
 * the arrival's choices as flat rows (ADR 0160), each opening the same Connect dialog as anywhere in the app for the
 * right hand and the first agent. The step is answered by the data (every agent ready or waiting), never by the dialog
 * closing, so a connect made in another tab moves it on too.
 */

/** Asked again this often while the choices show: this page opens no socket, so no event says a plan can sign in. */
const GATES_POLL_MS = 5000;

/**
 * What the step and the column beside it need from the workspace's shell, which this page is outside of: the
 * workspace and the person (`useOrg`), and the Connect dialog. Mounted only on this step.
 */
export function AiHost({ org, me, children }: { org: OrgSummary; me: Me; children: ReactNode }) {
  return (
    <OrgProvider org={org} me={me}>
      {/* No socket here: the dialog reads its status, computers and plans again as the step does. The workspace's
          pages open only after this step, so the dialog never leaves for one. */}
      <ConnectAiProvider poll={GATES_POLL_MS} settingUp>
        {children}
      </ConnectAiProvider>
    </OrgProvider>
  );
}

/**
 * The dialog a pick opens. For the team (the right hand and the others), Connect for the whole team on the card picked
 * (`start`), the key's included (ADR 0160 addendum, ADR 0162). The right hand alone is its own dialog, on the card
 * picked too.
 */
export function connectRequest(choice: AiChoice, agentIds: readonly string[]): ConnectAiRequest {
  const [first, ...rest] = agentIds;
  if (first === undefined || rest.length > 0) return { agentIds: [...agentIds], start: choice };
  return { agentId: first, start: choice };
}

/**
 * The step's body: the choices (ADR 0160), each opening the same Connect dialog as anywhere in the app, for the right
 * hand and the first agent alike. Its ways out ("Connect later", which asks first) are the box's footer, the page's;
 * every agent thinking moves the page on to the photo. `agents`: the right hand first, then the others.
 */
export function AiStep({
  orgId,
  agents,
  onConnected,
}: {
  orgId: string;
  agents: readonly Agent[];
  /**
   * What the dialog connected ("Claude"): the photo names it. Not the card picked, since the dialog's Back leads to
   * every other choice.
   */
  onConnected?: (choice: AiChoice) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const connect = useConnectAi();
  const ids = agents.map((a) => a.id);
  // A plan's mark dims while it can't sign in (no computer yet, or the Cloud's still being prepared after paying):
  // read again while the choices show, the computer's setup too (the dialog reads the same), so they light up alone.
  // Read for the first agent other than the right hand, which never has a computer (ADR 0160 addendum), as the
  // dialog reads it; the right hand alone reads its own.
  const reader = agents.find((a) => !isRightHand(a)) ?? agents[0];
  const gates = usePlanGates(orgId, reader?.id, GATES_POLL_MS);
  useComputerSetup(orgId, true, GATES_POLL_MS);
  return (
    <ConnectChoices
      mayAddKey={can(org, "manage_credentials")}
      dims={(c) => reader !== undefined && gateDims(gates.gateOf(c))}
      offSystem={(c) => (reader !== undefined ? planOffSystem(t, gates.gateOf(c)) : null)}
      onPick={(choice) => connect?.open({ ...connectRequest(choice, ids), ...(onConnected ? { onConnected } : {}) })}
    />
  );
}
