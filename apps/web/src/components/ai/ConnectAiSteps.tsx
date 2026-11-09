import type { Edition, MachineAccount, MachineAccountKind } from "@agenteschat/client";
import {
  keys,
  useAgentBrain,
  useAiAccounts,
  useApi,
  useAuthConfig,
  useComputerSetup,
  useMachines,
} from "@agenteschat/client";
import type { BillingHold } from "@agenteschat/client/lib/billing";
import {
  computerEdition,
  computerName,
  etaLine,
  setupView,
  statusRestatesChip,
} from "@agenteschat/client/lib/computer";
import { CUSTOM_PROVIDER } from "@agenteschat/client/lib/endpoints";
import { holdText, type keyRefusal } from "@agenteschat/client/lib/errors";
import { NAMES_SHOWN, namesText } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import {
  behindComputer,
  catchUp,
  type ExistingSignIn,
  freePlanAccount,
  gateLine,
  kindOf,
  type PlanChoice,
  type PlanGate,
  planGate,
  planGateWithoutAgent,
  planHoldOf,
  planLabel,
  planTitle,
  signsInOnce,
} from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { geminiPersonal, isPlanId, providerFitsChoice, signInProviderOf } from "@agenteschat/client/lib/plans";
import {
  keyLooksValid,
  keyStepHint,
  type ProviderId,
  providerLabel,
  providerOf,
} from "@agenteschat/client/lib/providers";
import { thinksWithLine } from "@agenteschat/client/lib/right-hand";
import {
  type AgentAppearance,
  Button,
  Card,
  Icon,
  InfoHint,
  Input,
  Locked,
  SettingNote,
  Spinner,
} from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { BillingLinkButton } from "@/components/BillingLinkButton";
import { useOrg } from "@/components/org-context";
import { KeyMismatch, KeyRefused } from "@/components/ProviderKey";
import { managedOf, SetupProgress, useSetupWait, useWaitReader } from "@/components/WorkspaceComputer";
import { AddAccount, OpenPage, Step, StepTitle } from "./AddAccountFlow";

/*
 * The steps of "Conectar outra IA" (the AI select's last row, and Connect an AI where nothing is connected yet): a
 * plan's sign-in on the agent's computer (ADR 0059) or an API key, under the provider select that names them. While
 * the workspace's computer is on its way a plan's steps wait in place and turn on by themselves, with what needs no
 * computer (a maker's page, a key to paste) on meanwhile.
 */

/**
 * What each plan can do now for one agent (`planGate`), from its brain view, its computer's accounts row and the
 * workspace's setup. `poll`: asked again this often where no event keeps them current (the setup opens no socket).
 */
export function usePlanGates(orgId: string, agentId: string | undefined, poll: number | false = false) {
  const { org } = useOrg();
  const asks = agentId !== undefined;
  const brain = useAgentBrain(orgId, agentId ?? "", asks, poll);
  const ai = useAiAccounts(orgId, asks, poll);
  const setupQ = useComputerSetup(orgId);
  const edition = computerEdition(setupQ.data);
  const setup = setupView(setupQ.data, setupQ.dataUpdatedAt);
  const view = brain.data;
  const row = ai.data?.computers.find((c) => c.machineId === view?.computer?.machineId);
  // Once ready, the workspace's computer is every agent's: a view from before that still has none is asked again
  // now with the accounts (a coding plan reads that computer's row there), not at their next poll. Until both
  // answers are in (`catchUp`, bounded), every plan reads as ready with its sign-in loading, as the rest of the page
  // says ready. Asked once per agent: still none after it, and nothing is coming (`caughtUp`).
  const behind = behindComputer({ edition, setup, brain: view });
  const [caughtUp, setCaughtUp] = useState<string>();
  const caught = agentId !== undefined && caughtUp === agentId;
  const [asking, setAsking] = useState(false);
  const { refetch: brainAgain } = brain;
  const { refetch: accountsAgain } = ai;
  useEffect(() => {
    if (!behind || caught) return;
    setAsking(true);
    void catchUp([brainAgain(), accountsAgain()]).then(() => {
      setAsking(false);
      setCaughtUp(agentId);
    });
  }, [behind, caught, agentId, brainAgain, accountsAgain]);
  const catching = (behind && !caught) || asking;
  // A panel here waited for that computer: once it's ready, it says so whenever it shows again (another plan, another
  // step and back).
  const [waited, setWaited] = useState(false);
  const markWaited = useCallback(() => setWaited(true), []);
  const gateOf = (choice: PlanChoice): PlanGate =>
    catching
      ? { state: "ready" }
      : planGate({
          choice,
          edition,
          setup,
          // A coding plan also needs to know whether that computer takes a plan's key, and Claude or ChatGPT on a
          // computer the person connected whether its own sign-in is there (`ownSignInFor`).
          brain: view && (ai.data || !(isPlanId(choice) || view.ownSignIn)) ? view : undefined,
          computer: row,
          caughtUp: caught,
          standing: org.standing,
        });
  // A poll that fails once keeps the last view: a sign-in in progress goes on. A read that failed with nothing to show
  // ends the panel's wait with Tentar de novo.
  const failed = (brain.isError && !view) || (ai.isError && !ai.data) || (setupQ.isError && !setupQ.data);
  const { refetch: setupAgain } = setupQ;
  const retry = useCallback(() => {
    for (const again of [brainAgain, accountsAgain, setupAgain]) void again();
  }, [brainAgain, accountsAgain, setupAgain]);
  return { gateOf, view, row, failed, retry, edition, waited, markWaited, catching };
}

export type PlanGates = ReturnType<typeof usePlanGates>;

/** An agent a plan may think for, as the who row draws it. */
export interface PlanAgent {
  id: string;
  name: string;
  appearance?: AgentAppearance;
  initials?: string;
}

/** An agent of "All agents"; `done`: it already thinks with this plan. */
export type PlanSetAgent = PlanAgent & { done?: boolean };

export interface PlanPanelProps {
  choice: PlanChoice;
  gates: PlanGates;
  /** Whom it signs in for: one agent, or several in turn (one login each where the plan needs it). `done`: on it already. */
  forWhom: PlanSetAgent[];
  /** Why this person connects no plan here (an agent of someone else's): nothing else shows. */
  locked?: ReactNode;
  /** The person came because the computer just got ready (its email, its notification): said first, once it is. */
  justReady?: boolean;
  /** An account of theirs signs in here, for the one agent: again (`again`), or once more for it. */
  login?: ExistingSignIn;
  /** "Atende outras pessoas" on: the agents it moves onto the plan let others talk to them. */
  toEveryone?: boolean;
  /**
   * Reached from the AI select's "Conectar outra IA", past the accounts it lists: a sign-in adds another, with no offer
   * to sign in again to one of them.
   */
  fresh?: boolean;
  /** "Usar uma chave de API agora". */
  onKey: () => void;
  /** Self-host with no computer for the agent: where one is connected. */
  onComputer: () => void;
  /** These agents think with the plan now: the account they signed in. */
  onDone: (agentIds: string[], account: MachineAccount | null) => void;
  /**
   * A key or a code went to the computer, or an agent is being moved onto the plan: whom it is for, and whose computer
   * it reads, must hold from here, though the agents it moves get an AI meanwhile.
   */
  onStart?: () => void;
}

/** `usePlanGates` for a person who owns no agent yet: each plan's gate on the computer it would sign in on. */
export function useGatesWithoutAgent(orgId: string, on: boolean) {
  const { org } = useOrg();
  const ai = useAiAccounts(orgId, on);
  const machines = useMachines(orgId, on);
  const setupQ = useComputerSetup(orgId);
  const edition = computerEdition(setupQ.data);
  const setup = setupView(setupQ.data, setupQ.dataUpdatedAt);
  const at = (choice: PlanChoice) =>
    planGateWithoutAgent({
      choice,
      edition,
      setup,
      computers: ai.data?.computers,
      machines: machines.data,
      standing: org.standing,
    });
  return { at, edition, accounts: ai.data?.accounts };
}

export type GatesWithoutAgent = ReturnType<typeof useGatesWithoutAgent>;

/**
 * A plan's panel for a person who owns no agent yet: it signs in on a computer they may add accounts to, waiting and
 * saying why as `PlanPanel` does, and the account then thinks for the agents they create there.
 */
export function PlanWithoutAgent({
  choice,
  gates,
  mayAddKey,
  onKey,
  onComputer,
  onDone,
}: {
  choice: PlanChoice;
  gates: GatesWithoutAgent;
  /** Only an admin adds an API key: the way on from someone else's computer for them. */
  mayAddKey: boolean;
  onKey: () => void;
  onComputer: () => void;
  onDone: (account: MachineAccount) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const machines = useMachines(org.id, gates.edition !== null);
  const [signingIn, setSigningIn] = useState(false);
  const [added, setAdded] = useState<MachineAccount | null>(null);
  const { gate, computer } = gates.at(choice);
  // An account of this plan they already have (their agents deleted) thinks for the next one: no second sign-in.
  const has = added ?? freePlanAccount(gates.accounts, choice);
  const title = planTitle(t, choice);
  const cloud = gates.edition === "cloud";
  const name = cloud ? computerName(t, org.name, managedOf(machines.data)) : (computer?.name ?? "");
  const steps = gate.state === "ready" || gate.state === "preparing" || (gate.state === "offline" && signingIn);
  // Only whoever connected the computers there signs a plan in on them: a computer of their own is the way on.
  const elsewhere = gate.state === "locked" && !cloud;
  return (
    <Card as="section" className="ai-panel ai-panel--plan" aria-label={title}>
      {has ? (
        <>
          <SettingNote icon="check" live>
            {t("connectAi.forNewAgents", { label: has.label })}
          </SettingNote>
          {choice === "gemini" && geminiPersonal(has) && (
            <SettingNote icon="alert">{t("connectAi.plan.gemini.warning")}</SettingNote>
          )}
        </>
      ) : (
        <>
          <GateWait
            gate={gate}
            kind={kindOf(choice)}
            coding={isPlanId(choice)}
            machineId={computer?.machineId}
            computer={name}
            edition={gates.edition}
            said={false}
            signingIn={signingIn}
            onKey={onKey}
            onComputer={onComputer}
          />
          {elsewhere && (
            <span>
              <Button size="sm" variant="primary" onClick={onComputer}>
                {t("aiAccounts.connect.addComputer")}
              </Button>
            </span>
          )}
          {elsewhere && mayAddKey && (
            <span>
              <Button size="sm" onClick={onKey}>
                {t("connectAi.wait.useKey")}
              </Button>
            </span>
          )}
          {steps && (
            <AddAccount
              machineId={computer?.machineId ?? ""}
              kind={kindOf(choice)}
              computer={cloud ? t("connectAi.theComputer") : name}
              {...(isPlanId(choice) ? { provider: choice } : {})}
              local={computer?.mine}
              ready={gate.state === "ready"}
              onAdded={(a) => {
                setAdded(a);
                onDone(a);
              }}
              onSigningIn={setSigningIn}
            />
          )}
          {steps && <p className="small muted">{t("connectAi.forNewAgentsHint")}</p>}
        </>
      )}
    </Card>
  );
}

/**
 * A plan's steps, in one card under the provider select ("Conectar outra IA"): its sign-in, or what it waits for (the
 * computer, a gate), for one agent or several in turn. The select above names the plan; who the agents answer is set
 * under the AI select, not here.
 */
export function PlanPanel(props: PlanPanelProps) {
  const { t } = useTranslation();
  const { choice, forWhom, locked } = props;
  const [agent] = forWhom;
  return (
    <Card as="section" className="ai-panel ai-panel--plan" aria-label={planTitle(t, choice)}>
      {locked ? <SettingNote icon="lock">{locked}</SettingNote> : agent ? <PlanSteps {...props} /> : <Spinner />}
    </Card>
  );
}

function PlanSteps({
  choice,
  gates,
  forWhom,
  justReady,
  login,
  toEveryone: everyoneAnswers = false,
  fresh,
  onKey,
  onComputer,
  onDone,
  onStart,
}: PlanPanelProps) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const { view, edition } = gates;
  const gate = gates.gateOf(choice);
  const machines = useMachines(org.id, edition !== null);
  const kind = kindOf(choice);
  const coding = isPlanId(choice);
  const [agent] = forWhom as [PlanSetAgent];
  const everyone = forWhom.length > 1;
  // The agents it moved onto the plan (the login each thinks with), one being moved, one whose move failed.
  const [assigned, setAssigned] = useState<Record<string, MachineAccount>>({});
  // Whom it signs in for, in order: of several, those that weren't on this plan before it moved them.
  const todo = everyone ? forWhom.filter((a) => !a.done || assigned[a.id]) : forWhom;
  const [saving, setSaving] = useState(0);
  const [failed, setFailed] = useState<{ agentId: string; account: MachineAccount } | null>(null);
  const [sent, setSent] = useState(false);
  // Of several, those whose login ended without signing in: none runs for them until the key goes again.
  const [missed, setMissed] = useState<string[]>([]);
  // A sign-in begun here keeps its steps while its computer is offline: they say Reconnecting, and it goes on.
  const [signingIn, setSigningIn] = useState(false);
  // It turns ready while the person watches, or they came because it did: said in place, and again on a way back.
  const waited = gates.waited || justReady === true;
  const { markWaited } = gates;
  useEffect(() => {
    if (gate.state === "preparing") markWaited();
  }, [gate.state, markWaited]);

  const computer =
    edition === "cloud" ? computerName(t, org.name, managedOf(machines.data)) : (view?.computer?.name ?? "");
  const refresh = (agentIds: string[]) => {
    for (const key of [
      ...agentIds.map((id) => keys.agentBrain(org.id, id)),
      keys.agents(org.id),
      keys.machines(org.id),
      keys.aiAccounts(org.id),
      keys.aiStatus(org.id),
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  // A sign-in ended: its agent thinks with that account right away (no confirming click).
  const assign = async (agentId: string, a: MachineAccount) => {
    onStart?.();
    setFailed(null);
    setSaving((n) => n + 1);
    try {
      await api.agents.setBrain(org.id, agentId, {
        brain: a.kind,
        account: a.id,
        ...(everyoneAnswers ? { onlyOwner: false } : {}),
      });
      setAssigned((x) => ({ ...x, [agentId]: a }));
      refresh([agentId]);
    } catch {
      setFailed({ agentId, account: a });
    } finally {
      setSaving((n) => n - 1);
    }
  };
  // One account for every agent (one sign-in for all, or one already there), each in turn.
  const assignAll = async (a: MachineAccount) => {
    for (const x of todo) if (!assigned[x.id]) await assign(x.id, a);
  };
  const account = Object.values(assigned)[0];
  const allDone = todo.length > 0 && todo.every((a) => assigned[a.id]);
  const told = useRef(false);
  useEffect(() => {
    if (!allDone || told.current) return;
    told.current = true;
    onDone(
      todo.map((a) => a.id),
      account ?? null,
    );
  }, [allDone, todo, account, onDone]);

  const ready = gate.state === "ready";
  const current = view?.accounts.find(
    (a) => a.id === view.account && a.kind === kind && providerFitsChoice(a.provider, choice, coding),
  );

  if (gates.failed) return <LoadFailed onRetry={gates.retry} />;
  // Done, or nothing to do: every agent already thought with this plan.
  if (allDone || (everyone && todo.length === 0)) {
    return (
      <SettingNote icon="check" live>
        {everyone
          ? t("connectAi.doneAll", {
              names: namesText(
                t,
                forWhom.map((a) => a.name),
                NAMES_SHOWN,
              ),
              label: account?.label ?? planLabel(t, choice),
            })
          : thinksWithLine(t, view?.scope, agent.name, account?.label ?? "")}
      </SettingNote>
    );
  }
  const retry = failed && (
    <div className="ai-panel__row">
      <SettingNote icon="alert" live>
        {t("connectAi.assignFailed", {
          label: failed.account.label,
          agent: forWhom.find((a) => a.id === failed.agentId)?.name ?? "",
        })}
      </SettingNote>
      <Button size="sm" icon="refresh" onClick={() => void assign(failed.agentId, failed.account)}>
        {t("common.retry")}
      </Button>
    </div>
  );
  // One agent: its sign-in gives way to the move and what came of it.
  if (!everyone && (saving > 0 || failed)) return saving > 0 ? <Spinner /> : retry;

  // The steps stay in view while they wait (their computer actions off); a reason alone otherwise.
  const steps = ready || gate.state === "preparing" || (gate.state === "offline" && signingIn);
  // One sign-in there thinks for all of the person's agents (ADR 0059 §2).
  const once = signsInOnce(choice, gates.row);
  const signedOut = !everyone && !login && current?.status === "signed_out" ? current : undefined;
  // One sign-in per agent, in turn: the agent signing in now, and the account the first one signed in as.
  const turn = everyone && !coding && !once ? todo.find((a) => !assigned[a.id]) : undefined;
  const sameAs = Object.values(assigned).find((a) => a.email)?.email ?? undefined;
  const stateOf = (a: PlanSetAgent) =>
    a.done || assigned[a.id]
      ? "done"
      : !missed.includes(a.id) && (coding || once ? sent : a.id === turn?.id)
        ? "now"
        : "next";
  return (
    <>
      <GateWait
        gate={gate}
        kind={kind}
        machineId={view?.computer?.machineId}
        computer={computer}
        coding={coding}
        edition={edition}
        said={false}
        signingIn={signingIn}
        onKey={onKey}
        onComputer={onComputer}
      />
      {ready && waited && (
        <SettingNote icon="check" live className="ai-panel__ready">
          {t("connectAi.wait.ready")}
        </SettingNote>
      )}
      {everyone && steps && (
        <ul className="ai-panel__who" aria-label={t("connectAi.agentAria")}>
          {forWhom.map((a) => {
            const state = stateOf(a);
            return (
              <li key={a.id} data-state={state}>
                <AgentAvatar name={a.name} initials={a.initials} appearance={a.appearance} size="xs" />
                <span>{a.name}</span>
                {state === "done" ? (
                  <Icon name="check" size={14} label={t("connectAi.who.state.done")} />
                ) : state === "now" ? (
                  <Icon name="spinner" size={14} label={t("connectAi.who.state.now")} />
                ) : (
                  <span className="ac-visually-hidden">{t("connectAi.who.state.next")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {everyone && !coding && steps && (
        <p className="ai-panel__each">
          <span className="ac-hintline">
            <span>{t(once ? "connectAi.once" : "connectAi.each")}</span>
            <InfoHint name={t("common.about", { label: t(once ? "connectAi.once" : "connectAi.each") })}>
              {t(once ? "connectAi.onceHint" : "connectAi.eachHint")}
            </InfoHint>
          </span>
        </p>
      )}
      {retry}
      {steps && (
        <AddAccount
          key={turn?.id ?? login?.from}
          machineId={view?.computer?.machineId ?? ""}
          kind={kind}
          // The Cloud's one computer goes unnamed in the account choice: the sign-in is about the account, not where.
          computer={edition === "cloud" ? t("connectAi.theComputer") : computer}
          {...(coding
            ? { provider: choice }
            : signInProviderOf(signedOut?.provider)
              ? { provider: signInProviderOf(signedOut?.provider) }
              : {})}
          again={login ? login.again : signedOut?.id}
          fresh={fresh}
          email={turn && sameAs ? sameAs : login ? login.email : signedOut?.email}
          local={view?.ownSignIn}
          ready={ready}
          loading={gates.catching}
          {...(turn ? { signInLabel: t("connectAi.signInFor", agentGrammar(turn.name)) } : {})}
          {...(everyone && coding && !once ? { fanOut: todo.map((a) => ({ id: a.id })) } : {})}
          onSent={() => {
            setSent(true);
            setMissed([]);
            onStart?.();
          }}
          onFailed={(id) => setMissed((m) => [...m, id])}
          onAdded={(a, id) => void (everyone && once ? assignAll(a) : assign(id ?? turn?.id ?? agent.id, a))}
          onUse={(a) => void (everyone && once ? assignAll(a) : assign(turn?.id ?? agent.id, a))}
          onSigningIn={setSigningIn}
        />
      )}
    </>
  );
}

/** What an AI's steps read didn't load: said, with Tentar de novo, which asks again. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="ai-panel__row">
      <SettingNote icon="alert" live>
        {t("common.loadFailed")}
      </SettingNote>
      <Button size="sm" icon="refresh" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** The billing hold on this workspace that stops its plans (`planHoldOf`). */
export function usePlanHold() {
  const { org } = useOrg();
  return planHoldOf(computerEdition(useComputerSetup(org.id).data), org.standing);
}

/**
 * A plan a workspace with no agentes.chat plan in force can't use, in place of its steps: why, and the way to that
 * plan for whoever pays (anyone else reads who can). A hold stops the Model Gateway for keys too, so no key is offered
 * as a way around it.
 */
export function PlanHold({ hold }: { hold: BillingHold }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const billingUrl = useAuthConfig().data?.billingUrl;
  const canPay = can(org, "manage_billing") && Boolean(billingUrl);
  return (
    <>
      <SettingNote icon="alert">{t("connectAi.billing")}</SettingNote>
      {canPay ? (
        <span className="ac-acts">
          <BillingLinkButton orgId={org.id} from="hold" size="sm" variant="primary">
            {t(`standing.billing.cta.${hold}`)}
          </BillingLinkButton>
        </span>
      ) : (
        <SettingNote icon="lock">{t("standing.billing.askAdmin")}</SettingNote>
      )}
    </>
  );
}

/**
 * Why a plan's panel waits or can't sign in there (`PlanGate`), with the way on: the computer's wait, a key now, a
 * computer to connect. Nothing once it's ready.
 */
function GateWait({
  gate,
  kind,
  coding,
  machineId,
  computer,
  edition,
  said,
  hostConnecting,
  signingIn,
  onKey,
  onComputer,
}: {
  gate: PlanGate;
  kind: MachineAccountKind;
  coding: boolean;
  /** The computer the gate is about. */
  machineId: string | undefined;
  /** Its name, as the panel says it. */
  computer: string;
  edition: Edition | null;
  said: boolean;
  hostConnecting?: boolean;
  signingIn: boolean;
  onKey: () => void;
  onComputer: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const reader = useWaitReader();
  const machines = useMachines(org.id, edition !== null);
  const preparing = gate.state === "preparing" ? gate.view : null;
  const { eta, email } = useSetupWait(preparing, reader.held);
  const useKey = (
    <span>
      <Button size="sm" onClick={onKey}>
        {t("connectAi.wait.useKey")}
      </Button>
    </span>
  );
  const line = (lead: ReactNode, text: string) => (
    <p className="setup-line ac-iconline" role="status">
      {lead}
      <span>{text}</span>
    </p>
  );
  const hold = holdText(t, org.standing);
  // Offline or unsupported: what's going on there and what comes next (on the Cloud, by itself as events arrive).
  const why = gateLine(t, {
    gate,
    edition,
    kind,
    computer,
    hold,
    machine: machines.data?.find((m) => m.id === machineId),
  });
  let wait: ReactNode = null;
  if (gate.state === "loading") wait = <Spinner />;
  else if (gate.state === "billing") {
    wait = <PlanHold hold={gate.hold} />;
  } else if (gate.state === "preparing") {
    // The computer's wait in one well: how far it is and the time left, or why it waits (not where the rail beside it
    // already says so), then when the step under it turns on, said once (the owner's email line says it for them). A
    // hold decides when anything runs there: it speaks alone. The well's lines start on the panel's text edge, so none
    // leads with an icon. With no view of it yet the well still says what the disabled step under it waits for.
    wait = (
      <div className="ai-panel__wait">
        {hold ? (
          <p className="setup-line" role="status">
            {hold}
          </p>
        ) : (
          <>
            {preparing?.step ? (
              <SetupProgress view={preparing} />
            ) : (
              preparing &&
              !(said && statusRestatesChip(preparing)) && (
                <p className="setup-line" role="status">
                  {t(preparing.textKey)}
                </p>
              )
            )}
            {eta && (
              <p className="setup-eta" aria-live="polite">
                {etaLine(t, eta)}
              </p>
            )}
            <p className="setup-line">
              {t(
                email && reader.owner
                  ? "connectAi.wait.email"
                  : coding
                    ? "connectAi.wait.key"
                    : "connectAi.wait.signIn",
              )}
            </p>
            {preparing?.phase === "problem" && useKey}
          </>
        )}
      </div>
    );
  } else if (gate.state === "offline" && hostConnecting && !signingIn) {
    wait = line(<Spinner size={14} />, t("connectAi.wait.connecting"));
  } else if (why && !(gate.state === "offline" && signingIn)) {
    wait = (
      <>
        <SettingNote icon={why.rechecks ? "clock" : "alert"} live={why.rechecks}>
          {why.text}
        </SettingNote>
        {!hold && useKey}
      </>
    );
  } else if (gate.state === "missing") {
    wait = (
      <>
        <SettingNote icon="computer">{t("aiAccounts.connect.noComputer")}</SettingNote>
        <span>
          <Button size="sm" variant="primary" onClick={onComputer}>
            {t("aiAccounts.connect.addComputer")}
          </Button>
        </span>
      </>
    );
  } else if (gate.state === "locked") {
    const pairer = machines.data?.find((m) => m.id === machineId)?.pairedBy?.name.split(" ")[0];
    wait = (
      <SettingNote icon="lock">
        {gate.who === "computer"
          ? t("connectAi.accountsLocked", { name: pairer ?? "", computer })
          : t("noAi.lockedOwner")}
      </SettingNote>
    );
  }

  return wait;
}

/** The API key being added: its maker and the key. */
export interface KeyDraft {
  /** `custom`: a workspace's own endpoint (ADR 0146), which has a form of its own (`endpoint`). */
  provider: ProviderId | typeof CUSTOM_PROVIDER;
  apiKey: string;
}

/**
 * The API key: who charges for it, where its maker's keys are made (the maker comes from the picker's select), then the
 * key, pasted here. `onSave`: saved right here (the dialog); else the caller saves it with its own button (the setup).
 */
export function KeyPanel({
  draft,
  onDraft,
  locked,
  saved,
  savedNote,
  refused,
  saving,
  onSave,
  endpoint,
}: {
  draft: KeyDraft;
  onDraft: (draft: KeyDraft) => void;
  /** The "Outro provedor" form, shown when it is chosen. */
  endpoint?: ReactNode;
  /** Only an admin adds an API key. */
  locked?: boolean;
  saved?: boolean;
  /** Says what the save came to, in place of the usual line (a check that got no answer, the right hand's words). */
  savedNote?: string;
  /** The provider refused the key on its test call: nothing was kept. */
  refused?: ReturnType<typeof keyRefusal>;
  saving?: boolean;
  onSave?: () => void;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [touched, setTouched] = useState(false);
  const { provider, apiKey } = draft;
  const keyOf = provider === CUSTOM_PROVIDER ? null : provider;
  const maker = keyOf ? providerOf(keyOf) : undefined;
  const hint = maker && keyStepHint(maker);
  const valid = keyOf === null || keyLooksValid(keyOf, apiKey);
  const wrong = touched && apiKey.trim().length > 0 && !valid;
  const site = maker ? new URL(`https://${maker.site}`) : null;
  const pick = (next: ProviderId) => onDraft({ provider: next, apiKey });
  return (
    <Card as="section" className="ai-panel" aria-label={t("connectAi.key.title")}>
      {keyOf && (
        <p className="small muted" style={{ margin: 0 }}>
          {t("connectAi.key.sub")}
        </p>
      )}
      {locked ? (
        <SettingNote icon="lock">{t("connectAi.keyLocked")}</SettingNote>
      ) : saved ? (
        <SettingNote icon="check" live>
          {savedNote ?? t("connectAi.key.saved")}
        </SettingNote>
      ) : provider === CUSTOM_PROVIDER ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {t("endpoint.optionSub")}
          </p>
          {endpoint}
        </>
      ) : keyOf && maker && site ? (
        <>
          <Step
            n={1}
            side={
              <OpenPage href={site.href} primary={!apiKey}>
                {t("aiAccounts.add.openKeys", { site: site.host })}
              </OpenPage>
            }
          >
            <StepTitle title={t("connectAi.key.create", { provider: providerLabel(keyOf) })} hint={hint && t(hint)} />
          </Step>
          <Step n={2}>
            <label htmlFor={fieldId}>
              <b>{t("connectAi.key.paste")}</b>
            </label>
            <span className="agp-addacct__paste">
              <Locked when={Boolean(saving)}>
                <Input
                  id={fieldId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={maker.placeholder}
                  value={apiKey}
                  invalid={wrong}
                  onChange={(e) => onDraft({ provider, apiKey: e.target.value })}
                  onBlur={() => setTouched(true)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !onSave) return;
                    e.preventDefault();
                    setTouched(true);
                    if (valid) onSave();
                  }}
                />
              </Locked>
              {onSave && apiKey.trim() && (
                <Button size="sm" variant="primary" loading={saving} disabled={!valid} onClick={onSave}>
                  {t("settings.saveKey")}
                </Button>
              )}
            </span>
            {wrong && (
              <div className="ac-field__error" role="alert">
                <KeyMismatch provider={keyOf} apiKey={apiKey} onPick={pick} />
              </div>
            )}
            {refused && <KeyRefused refusal={refused} />}
          </Step>
          <SettingNote icon="agent">{t("connectAi.key.forAll")}</SettingNote>
        </>
      ) : null}
    </Card>
  );
}
