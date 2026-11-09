import type { ConnectIntent } from "@agenteschat/client";
import { useAgentDetail, useAiStatus, useApi } from "@agenteschat/client";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { stepPermissions } from "@agenteschat/client/lib/home";
import { aiStateOf, choiceOfIntent, mayConnectAi, type PlanChoice } from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { isRightHand, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { Dialog, DialogBody, Spinner } from "@agenteschat/ui";
import { useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAiForm, type AiAgent, type AiStart, LoneAiFlow, TeamAi } from "@/components/ai/AgentAi";
import { PlanHold, usePlanHold } from "@/components/ai/ConnectAiSteps";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useOpenParam } from "@/lib/open-param";
import { useToast } from "@/lib/toast";
import "./no-ai.css";

/*
 * "Conectar uma IA" (ADR 0061): one dialog for every place that says an agent has no AI (the banner, the agent's
 * card, the receipt under a message, its "Sem IA" chip, Settings › Contas de IA). For one agent, the AI select of its
 * page (`AgentAiForm`), each pick saved at once; for several, who it's for and the same select; for someone with no
 * agent, the steps alone. A message or card that named a plan or a key opens on its steps. Connected from a card or a
 * message, the agent then answers it by itself.
 */

export interface ConnectAiRequest {
  /** The step the message asked for (Jev); `any`, `task` or none: the first step. */
  intent?: ConnectIntent;
  /** The plan it opens on, over `intent`: a card's Sign in again, on the agent's own plan (a coding plan's too). */
  plan?: PlanChoice;
  /** With `api_key`: the provider it named. */
  provider?: string;
  /** The agent to connect: the dialog is for it alone. */
  agentId?: string;
  /** The agents to choose from (an agent's card names them); `agentId` is chosen first. */
  agentIds?: string[];
  /** The no-AI card or the person's message: once connected, it is answered ("Responder agora"). */
  from?: string;
  /** A key pasted in the composer. */
  apiKey?: string;
  /** Opened by itself (Jev), not by a click: never over a dialog already open. */
  auto?: boolean;
  /** Opened because the workspace's computer just got ready (its email, its notification): a plan's panel says so. */
  ready?: boolean;
  /**
   * Opened from the create-agent step for an agent of the person's own still being made: a plan signs in for the
   * agents they create (as with no agent yet), never for one they have, and a computer opens in a new tab (the draft
   * stays).
   */
  forNewAgent?: boolean;
}

/** How "Responder agora" went for a message, in this tab. */
export type AnswerState = "pending" | "answering" | "still_missing";

export interface ConnectAi {
  open(request: ConnectAiRequest): void;
  /** "Responder agora" (`from`: the no-AI card or the person's message). */
  answer(from: string): Promise<void>;
  answered: Record<string, AnswerState>;
}

const ConnectAiContext = createContext<ConnectAi | null>(null);

/** Null outside the workspace shell (an isolated page in a test): no Connect there. */
export const useConnectAi = () => useContext(ConnectAiContext);

/**
 * Whether this person has an AI to connect: the workspace's key, a plan for an agent they have or may make, or their
 * own for the right hand. Yes until the agents are known, so nobody reads "who connects it" for a moment.
 */
export function useMayConnectAi() {
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  return (
    dir.loading ||
    stepPermissions(org, me.user.id, dir.agents).connectAi ||
    can(org, "create_agents") ||
    mayConnectAi(rightHandOf(dir.agents), me.user.id, org)
  );
}

export function ConnectAiProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const toast = useToast();
  // Each opening is its own dialog (`n`): what was chosen in another one doesn't carry over.
  const [request, setRequest] = useState<(ConnectAiRequest & { n: number }) | null>(null);
  const [answered, setAnswered] = useState<Record<string, AnswerState>>({});
  const open = useCallback((next: ConnectAiRequest) => {
    setRequest((current) => (current && next.auto ? current : { ...next, n: (current?.n ?? 0) + 1 }));
  }, []);
  // A link that asks for it (the computer ready email's "Connect your AI"): open once, then drop it from the address.
  const [asked, clearAsked] = useOpenParam("connect");
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per link
  useEffect(() => {
    if (asked !== "ai") return;
    open({ ready: true });
    clearAsked(null);
  }, [asked]);
  const answer = useCallback(
    async (from: string) => {
      setAnswered((a) => ({ ...a, [from]: "pending" }));
      try {
        await api.chat.answerNow(org.id, from);
        setAnswered((a) => ({ ...a, [from]: "answering" }));
      } catch (error) {
        const missing = errorCode(error) === "ai.still_missing";
        setAnswered((a) => {
          const { [from]: _pending, ...rest } = a;
          return missing ? { ...rest, [from]: "still_missing" } : rest;
        });
        if (!missing) toast.show(errorText(t, error), "error");
      }
    },
    [api, org.id, toast, t],
  );
  const value = useMemo(() => ({ open, answer, answered }), [open, answer, answered]);
  return (
    <ConnectAiContext.Provider value={value}>
      {children}
      {request && (
        <ConnectAiDialog
          key={request.n}
          request={request}
          onClose={() => setRequest(null)}
          onConnected={() => {
            if (request.from) void answer(request.from);
          }}
        />
      )}
    </ConnectAiContext.Provider>
  );
}

function ConnectAiDialog({
  request,
  onClose,
  onConnected,
}: {
  request: ConnectAiRequest;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const navigate = useNavigate();
  const dir = useDirectory(org.id);
  const status = useAiStatus(org.id);
  const hold = usePlanHold();
  // The team's right hand thinks with each person's own AI (ADR 0137 §11): everyone's to connect for their DM.
  const mine = dir.agents.filter((a) => a.ownerUserId === me.user.id || isRightHand(a));
  // An agent's card names whom it's for; opened for one agent, it is for that agent alone.
  const named = request.agentIds?.length ? request.agentIds : null;
  const only = named ? (named.length === 1 ? named[0] : undefined) : request.agentId;
  const one = only ? dir.agentById.get(only) : undefined;
  const pool = request.forNewAgent ? [] : one ? [one.id] : named;
  // Of theirs, those that still have no AI (by the AI status, as its "Sem IA" chip); one asked for, whatever it has.
  // With every one of theirs thinking already: their one agent, else none, since a new AI moving them all would be a
  // surprise (it is added, for each agent's select, as for someone with no agent).
  const noAi = (id: string) => (aiStateOf(status.data, id) ?? "no_ai") === "no_ai";
  const own = mine.filter((a) => !isRightHand(a));
  const withoutAi = mine.filter((a) => noAi(a.id));
  // Named ones in the order they were named.
  const found = (
    pool
      ? pool.flatMap((id) => dir.agentById.get(id) ?? [])
      : withoutAi.length > 0
        ? withoutAi
        : own.length === 1
          ? own
          : []
  ).filter((a) => one || mine.includes(a));
  // Held from the moment they're known: agents getting an AI here, one by one, don't change whom it's for midway.
  const [held, setHeld] = useState<string[] | null>(null);
  const ready = !dir.loading && !status.isPending;
  useEffect(() => {
    if (ready && held === null) setHeld(found.map((a) => a.id));
  }, [ready, held, found]);
  const agents = held ? held.flatMap((id) => dir.agentById.get(id) ?? []) : found;
  const detail = useAgentDetail(org.id, one?.id ?? agents[0]?.id ?? "");
  // A plan or a key the message or card named, a key pasted in the composer, or the computer just got ready.
  const asked = request.plan ?? choiceOfIntent(request.intent);
  const start: AiStart = {
    ...(asked && asked !== "key" ? { plan: asked } : {}),
    ...(asked === "key" || request.apiKey ? { key: true } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    ...(request.ready ? { ready: true } : {}),
    // Not opened for an agent (Settings, the banner): a new AI to connect, its providers at once.
    ...(only ? {} : { other: true }),
  };
  const asAi = (a: (typeof dir.agents)[number]): AiAgent => ({
    id: a.id,
    name: a.name,
    ownerUserId: a.ownerUserId,
    model: detail.data?.id === a.id ? detail.data.model : a.model,
    key: detail.data?.id === a.id ? detail.data.credentialId : null,
  });
  const single = one ?? (agents.length === 1 ? agents[0] : undefined);
  // Over Criar agente a computer connects in a new tab, so the draft stays; anywhere else the dialog makes way for it.
  const toComputers = () => {
    if (request.forNewAgent) {
      window.open(`/org/${org.id}/settings/computers`, "_blank", "noopener");
      return;
    }
    onClose();
    void navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section: "computers" } });
  };
  const keyFirst =
    !request.plan &&
    !request.forNewAgent &&
    own.length === 0 &&
    dir.agents.length > 0 &&
    can(org, "manage_credentials");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={one ? t("connectAi.titleFor", agentGrammar(one.name)) : t("connectAi.title.any")}
      closeLabel={t("common.close")}
      width={560}
      className="agp-wdlg"
    >
      <DialogBody>
        {hold ? (
          // Every way in lands here, a card's or a key pasted in the composer: nothing connects before the plan.
          <PlanHold hold={hold} />
        ) : dir.loading || status.isPending ? (
          <Spinner />
        ) : single ? (
          <AgentAiForm
            agent={asAi(single)}
            mode="connect"
            start={start}
            onThinks={onConnected}
            onComputer={toComputers}
          />
        ) : agents.length > 1 ? (
          <TeamAi agents={agents.map(asAi)} start={start} onThinks={onConnected} onComputer={toComputers} />
        ) : (
          // No agent of theirs without an AI: a plan signs in for the agents they create. An admin among other
          // people's agents starts on the workspace's key, which serves every agent with no plan.
          <LoneAiFlow
            start={keyFirst ? { ...start, key: true } : start}
            onDone={onConnected}
            onComputer={toComputers}
          />
        )}
      </DialogBody>
    </Dialog>
  );
}
