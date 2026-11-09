import type { AgentBrain, AgentBrainInput, BrainEffortSetting, BrainKind, Credential } from "@agenteschat/client";
import {
  keys,
  useAddCredential,
  useAgentBrain,
  useAiAccounts,
  useAiStatus,
  useApi,
  useComputerSetup,
  useCredentials,
  useMachines,
  useModels,
  usePlatformKey,
  useSettings,
} from "@agenteschat/client";
import { signInPlan } from "@agenteschat/client/lib/ai-accounts";
import { type AiRow, aiNote, aiRowGroupLabel, aiRows, currentValue } from "@agenteschat/client/lib/ai-select";
import { EVERYONE_AUDIENCE, opensOthersPlan, widenQuestion } from "@agenteschat/client/lib/audience";
import {
  type Advanced,
  advancedDefaults,
  advancedSummary,
  EFFORT_RAMP_MAX,
  type EffortLevel,
  effortLevels,
  isAdvancedDefault,
  SPEEDS,
  shownEffort,
  viewSpeedFits,
} from "@agenteschat/client/lib/brain-advanced";
import { brainModelLine } from "@agenteschat/client/lib/brain-picker";
import { computerNameOf, setupView } from "@agenteschat/client/lib/computer";
import { type ContextLimit, contextChoices, contextSize, isContextLimit } from "@agenteschat/client/lib/context-limits";
import { CUSTOM_PROVIDER } from "@agenteschat/client/lib/endpoints";
import { errorText, keyRefusal } from "@agenteschat/client/lib/errors";
import { firstName, NAMES_SHOWN, namesText } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import {
  agentAi,
  agentPlan,
  aiChoiceOf,
  aiStateOf,
  defaultChoice,
  type ExistingSignIn,
  gateLine,
  PLAN_CHOICES,
  type PlanChoice,
  type PlanGate,
  planLabel,
  planMark,
  planOfAccount,
  planPickText,
  unsupportedGate,
} from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { modelLimitText } from "@agenteschat/client/lib/plan-usage";
import {
  brainModelChoice,
  brainModelChoices,
  geminiPersonal,
  isPlanId,
  planFreeHint,
  planOf,
  planReplies,
} from "@agenteschat/client/lib/plans";
import {
  AUTO,
  isAuto,
  keyRuns,
  modelChoices,
  PROVIDERS,
  type ProviderId,
  providerLabel,
} from "@agenteschat/client/lib/providers";
import {
  type AgentColor,
  Avatar,
  AvatarStack,
  Button,
  cx,
  EffortPixels,
  Icon,
  Locked,
  PlanMeter,
  ProviderLogo,
  SearchSelect,
  Segmented,
  Select,
  type SelectOption,
  SettingNote,
  SettingRow,
  Spinner,
} from "@agenteschat/ui";
import { matchesWords } from "@agenteschat/ui/search";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { modelOptions as apiModelOptions, ModelSelect } from "@/components/AgentFields";
import { useOrg } from "@/components/org-context";
import { OpenPrefsButton, ReconnectThisMacButton, useIsThisMac } from "@/components/ThisMac";
import { useComputerEdition } from "@/components/WorkspaceComputer";
import { useDirectory } from "@/hooks/useDirectory";
import { lookOf } from "@/lib/look";
import { planMeterText } from "@/lib/plan-usage";
import { type ToastAction, useToast } from "@/lib/toast";
import { OpenPage } from "./AddAccountFlow";
import {
  type KeyDraft,
  KeyPanel,
  LoadFailed,
  PlanHold,
  PlanPanel,
  PlanWithoutAgent,
  useGatesWithoutAgent,
  usePlanGates,
  usePlanHold,
} from "./ConnectAiSteps";
import { EndpointForm } from "./EndpointForm";
import { PlanReplies } from "./PlanReplies";

/*
 * What an agent thinks with, one select wherever it is chosen (Quem pensa, Conectar uma IA, Criar agente): the
 * viewer's plans, other people's plans they may use, the workspace's API keys, then "Conectar outra IA", which opens
 * its steps in the same dialog. A pick saves at once, with Desfazer in its toast; a pick that lends someone's plan or
 * takes a login from another agent asks first, in the note under the select, with one button. Under it only what
 * applies to what it thinks with: the model, "Atende outras pessoas" on a plan, and "Configuração avançada" in place.
 */

/** The agent an AI is chosen for. `model` and `key`: its API model and key (null: the workspace's default). */
export interface AiAgent {
  id: string;
  name: string;
  ownerUserId: string | null;
  model?: string;
  key?: string | null;
}

/** Where Connect an AI opens: the steps on a plan or a key (a card's plan, a key pasted, the computer just ready). */
export interface AiStart {
  plan?: PlanChoice;
  key?: boolean;
  provider?: string;
  apiKey?: string;
  ready?: boolean;
  /** A new AI to connect (Settings, the banner): the providers at once, the select one step back. */
  other?: boolean;
}

/** The select's last row: it opens the steps, never a value. */
const CONNECT = "__connect";

/** The AI select's rows for one agent, from its brain view, its computer's own sign-ins and the workspace's keys. */
export function useAiRows(agent: AiAgent, enabled = true) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const brain = useAgentBrain(org.id, agent.id, enabled);
  const view = brain.data;
  const ai = useAiAccounts(org.id, enabled);
  const listKeys = can(org, "manage_credentials");
  const credentials = useCredentials(org.id, enabled && listKeys);
  const settings = useSettings(org.id);
  const platform = usePlatformKey(org.id);
  const status = useAiStatus(org.id);
  const edition = useComputerEdition(org.id);
  const hold = usePlanHold();
  const computerName = computerNameOf(t, org.name, view?.computer?.name ?? "");
  const machines = useMachines(org.id);
  const machine = machines.data?.find((m) => m.id === view?.computer?.machineId);
  const setupQ = useComputerSetup(org.id);
  const setup = setupView(setupQ.data, setupQ.dataUpdatedAt);
  // The words a plan's steps would say for a CLI that can't think there (installing, turned off, missing).
  const reasonOf = (kind: BrainKind) => {
    const reason = view?.options.find((o) => o.kind === kind)?.reason;
    if (!reason || kind === "model") return null;
    return (
      gateLine(t, {
        gate: unsupportedGate(reason, edition, setup),
        edition,
        kind,
        computer: computerName,
        machine,
      })?.text ?? null
    );
  };
  const computerRow = ai.data?.computers.find((c) => c.machineId === view?.computer?.machineId);
  const rows = view
    ? aiRows(t, i18n.language, {
        view,
        computer: computerRow,
        computerName,
        agentName: agent.name,
        agentOwnerId: agent.ownerUserId,
        keys: listKeys ? (credentials.data ?? []) : null,
        defaultKey: settings.data?.defaultCredentialId ?? null,
        serverKey: platform.data === true,
        apiKey: status.data?.apiKey !== false,
        // A key is the workspace's, never the person's own AI for the team's right hand, and no way past a hold.
        keysAllowed: !hold && view.scope !== "mine" && (view.canUsePlans || can(org, "manage_agents")),
        agentKey: agent.key ?? null,
        reasonOf,
      })
    : [];
  return {
    view,
    rows,
    computerRow,
    loading: brain.isPending,
    // Its view didn't load, with nothing to show: said, with a retry (a poll that fails keeps the last view).
    failed: brain.isError && !view,
    retry: brain.refetch,
    computerName,
    cloud: edition === "cloud",
    hold,
    credentials: credentials.data ?? [],
    defaultKey: settings.data?.defaultCredentialId ?? null,
  };
}

/** What it says of a row on its second line: whose or where, then how it stands (its tone colors the state). */
function RowLine({ row }: { row: AiRow }) {
  return (
    <>
      {row.owner && <Avatar kind="person" name={row.owner} size="xs" className="ai-sel__face" />}
      {row.who}
      {row.who && row.state ? " · " : ""}
      {row.state && (
        <span className="ai-sel__state" data-tone={row.tone ?? undefined}>
          {row.state}
        </span>
      )}
    </>
  );
}

/**
 * The AI select: the rows in their groups, then "Conectar outra IA" (`onConnect`) after a hairline. The trigger names
 * the AI with its logo, your email or whose plan it is; `strip` hangs under it in the same outline (the plan's usage, a
 * key's pay line).
 */
export function AiSelect({
  rows,
  value,
  onPick,
  onConnect,
  strip,
  disabled,
  label,
}: {
  rows: readonly AiRow[];
  value: string | null;
  onPick: (row: AiRow) => void;
  onConnect?: () => void;
  strip?: ReactNode;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const options: SelectOption[] = rows.map((r) => ({
    value: r.value,
    label: r.label,
    group: aiRowGroupLabel(t, r.group),
    leading: <ProviderLogo id={r.mark} size="sm" off={r.disabled} />,
    description: <RowLine row={r} />,
    ...(r.hint ? { hint: r.hint } : {}),
    disabled: r.disabled,
  }));
  if (onConnect)
    options.push({
      value: CONNECT,
      label: t("aiSelect.connect"),
      description: t("aiSelect.connectLine"),
      leading: (
        <span className="ai-sel__plus">
          <Icon name="plus" size={16} />
        </span>
      ),
      action: true,
    });
  const chosen = rows.find((r) => r.value === value);
  return (
    <div className={cx("agp-acct", strip ? "agp-acct--use" : null)}>
      <Select
        className="ai-sel"
        aria-label={label}
        value={chosen ? chosen.value : ""}
        placeholder={t("aiSelect.placeholder")}
        disabled={disabled}
        options={options}
        onValueChange={(v) => {
          if (v === CONNECT) return onConnect?.();
          const row = rows.find((r) => r.value === v);
          if (row) onPick(row);
        }}
        // The kit's lead and text, side by side in the value as its own chosen option's are.
        renderValue={() =>
          chosen && (
            <>
              <span className="ac-select__lead" aria-hidden="true">
                <ProviderLogo id={chosen.mark} size="xs" />
              </span>
              <span className="ac-select__text ai-sel__text">
                <span className="ai-sel__label">{chosen.label}</span>
                {chosen.account && chosen.who && <span className="ai-sel__who">&nbsp;· {chosen.who}</span>}
              </span>
            </>
          )
        }
      />
      {strip}
    </div>
  );
}

/** The plan's usage, or what a key costs, under the trigger: nothing for an AI with no usage known. */
function stripOf(t: TFunction, language: string, row: AiRow | undefined, view: AgentBrain, agentName: string) {
  if (!row) return null;
  if (row.group === "keys")
    return <p className="ai-sel__strip">{t("agentPage.work.brain.modelText", agentGrammar(agentName))}</p>;
  const usage = row.account ? row.account.usage : row.kind === "model" ? null : view.ownUsage[row.kind];
  if (!usage) return null;
  return <PlanMeter usage={usage} text={planMeterText(t, language)} compact />;
}

/** What a save's toast says: its words, or its words with the ways on beside Desfazer. */
type Said = string | { text: string; tone?: "info"; actions: ToastAction[] } | null;

/** A save of the agent's AI with its toast and Desfazer, the controls off while it runs (`busy`). */
function useAiSave(agent: AiAgent, onThinks?: () => void) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    for (const key of [
      keys.agentBrain(org.id, agent.id),
      keys.agentDetail(org.id, agent.id),
      keys.aiStatus(org.id),
      keys.agents(org.id),
      keys.aiAccounts(org.id),
      keys.machines(org.id),
      // What it thinks with now is what new agents start with.
      keys.newAgentSetup(org.id),
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  const run = async (work: () => Promise<Said>, undo?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const said = await work();
      refresh();
      onThinks?.();
      if (said) {
        const { text, tone = "success", actions = [] } = typeof said === "string" ? { text: said } : said;
        const back = undo
          ? [
              {
                label: t("aiSelect.undo"),
                run: () =>
                  void undo().then(refresh, (e) => toast.show(keyRefusal(t, e)?.text ?? errorText(t, e), "error")),
              },
            ]
          : [];
        toast.show(text, tone, [...actions, ...back]);
      }
      return true;
    } catch (e) {
      toast.show(keyRefusal(t, e)?.text ?? t("agentPage.work.failed"), "error");
      refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const setBrain = (input: AgentBrainInput) => api.agents.setBrain(org.id, agent.id, input);
  return { busy, run, setBrain, api, refresh };
}

type Flow =
  /** `fresh`: from the select's "Conectar outra IA", past the accounts it lists. */
  | { kind: "new"; plan?: PlanChoice; key?: ProviderId | typeof CUSTOM_PROVIDER; fresh?: boolean }
  | { kind: "again" | "for" | "newKey"; row: AiRow };

/**
 * One agent's AI: the select, its strip and note, and under them what applies (`edit`: Quem pensa, with the model and
 * "Configuração avançada"; `connect`: an agent with no AI yet, with only "Atende outras pessoas"). With nothing to
 * pick, the steps to connect one show at once.
 */
export function AgentAiForm({
  agent,
  mode,
  start,
  color,
  onThinks,
  onComputer,
}: {
  agent: AiAgent;
  mode: "edit" | "connect";
  start?: AiStart;
  /** The agent's color, for the effort's bars. */
  color?: AgentColor;
  /** It thinks with something now (Connect then answers the message that asked). */
  onThinks?: () => void;
  /** Where "Conectar um computador" goes (Connect a new tab over Criar agente); Settings › Computadores by default. */
  onComputer?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const g = agentGrammar(agent.name);
  const { view, rows, computerRow, loading, failed, retry, computerName, cloud, hold, credentials, defaultKey } =
    useAiRows(agent);
  const models = useModels().data?.models ?? [];
  const save = useAiSave(agent, onThinks);
  const dir = useDirectory(org.id);
  const toast = useToast();
  const thisMac = useIsThisMac(org.id, view?.computer?.machineId ?? "");
  const toolOffHere = thisMac && (view?.options ?? []).some((o) => o.reason === "tool_off");
  // A pick that waits: someone else's plan or a login another agent has (they ask first), or one to sign in again.
  const [picked, setPicked] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(() =>
    start?.plan
      ? { kind: "new", plan: start.plan }
      : start?.key
        ? { kind: "new", key: keyOf(start.provider) }
        : start?.other
          ? { kind: "new" }
          : null,
  );
  // Opening it is looking at the plans: their usage is looked up again (it comes back as `machine.updated`). Codex's
  // own sign-in is known only by such a read, so this is also how a computer's own ChatGPT sign-in shows before any
  // turn ran.
  const { api } = save;
  useEffect(() => {
    void api.machines.refreshAccountUsage(org.id).catch(() => undefined);
  }, [api, org.id]);
  if (hold) return <PlanHold hold={hold} />;
  if (failed) return <LoadFailed onRetry={() => void retry()} />;
  if (loading || !view) return <Spinner />;
  const current = currentValue(view, agent.key ?? null);
  const shownValue = picked ?? current;
  const row = rows.find((r) => r.value === shownValue);
  const mayConnect = view.canUsePlans || can(org, "manage_credentials");
  // A new AI starts on the plan its brain is on (ChatGPT for Codex), where it thinks with none of its rows.
  const choiceNow = aiChoiceOf(view);
  const ownPlan = agentPlan(dir.agentById.get(agent.id)) ?? (choiceNow === "key" ? null : choiceNow);
  // Nothing to pick: the steps at once, with no way back to an empty list.
  const empty = rows.length === 0 && mayConnect;
  /** Thinks with `r` now; `confirmed`: the person said yes to a lent plan or a move. */
  const pick = (r: AiRow, confirmed = false) => {
    if (r.disabled) return;
    // Back on what it thinks with: whatever waited is dropped, nothing saved.
    if (r.value === current) return setPicked(null);
    if (r.act === "signIn" || ((r.act === "lend" || r.act === "move") && !confirmed)) return setPicked(r.value);
    setPicked(null);
    if (r.group === "keys") return void pickKey(r.key ?? null);
    const before = snapshot(view, agent);
    void save.run(
      async () => {
        const next = await save.setBrain({
          brain: r.kind,
          account: r.account?.id ?? null,
          ...(r.act === "move" ? { moveAccount: true } : {}),
        });
        // Onto a plan it answers only its owner from now on (ADR 0059 §5): said, since it stops answering others.
        const onlyNow = next.onlyOwner && !view.onlyOwner;
        return t(onlyNow ? "agentPage.work.saved.brainOwner" : "agentPage.work.saved.brain", {
          ...g,
          brain: r.label,
          owner: view.canUsePlans ? t("common.you") : firstName(r.account?.ownerName ?? ""),
        });
      },
      () => restore(before),
    );
  };
  /** The API with a workspace key (null: the default), tried first: "now thinks with it" has to be true. */
  const pickKey = async (key: string | null, fresh?: Credential) => {
    const before = snapshot(view, agent);
    const k = fresh ?? credentials.find((c) => c.id === (key ?? defaultKey));
    await save.run(
      async (): Promise<Said> => {
        if (key) await save.api.agents.checkCredential(org.id, key);
        if (view.brain !== "model") await save.setBrain({ brain: "model" });
        const fits = !k || keyRuns(k, agent.model, models);
        await save.api.agents.update(org.id, agent.id, { credentialId: key, ...(fits ? {} : { model: AUTO }) });
        if (view.brain === "model" || !view.onlyOwner || view.scope === "mine")
          return t("agentPage.work.saved.brain", { ...g, brain: k?.label ?? t("agentPage.work.brain.model") });
        // Off the plan it still answers only its owner: one click lets back in whoever it answered before.
        // "Só algumas pessoas ou papéis" with nobody picked has no one to let back in: no such action.
        const audience = dir.agentById.get(agent.id)?.audience;
        const people = (audience?.userIds?.length ?? 0) + (audience?.roleIds?.length ?? 0);
        return {
          text: t("aiAccounts.share.backOnApi", g),
          tone: "info",
          actions:
            audience?.mode === "people" && people === 0
              ? []
              : [
                  {
                    label: t(people ? "aiAccounts.share.letPeople" : "aiAccounts.share.letEveryone", g),
                    run: () =>
                      void save
                        .setBrain({ onlyOwner: false })
                        .then(save.refresh, () => toast.show(t("agentPage.work.failed"), "error")),
                  },
                ],
        };
      },
      () => restore(before),
    );
  };
  const restore = async (before: Snapshot) => {
    if (before.brain === "model") {
      await save.setBrain({ brain: "model" });
      await save.api.agents.update(org.id, agent.id, {
        credentialId: before.key,
        ...(before.apiModel ? { model: before.apiModel } : {}),
      });
    } else
      await save.setBrain({
        brain: before.brain,
        account: before.account,
        model: before.model,
        onlyOwner: before.onlyOwner,
      });
  };

  if (flow || empty) {
    return (
      <AiFlow
        agent={agent}
        view={view}
        flow={flow ?? { kind: "new", ...(ownPlan ? { plan: ownPlan } : {}) }}
        start={start}
        onBack={empty ? undefined : () => setFlow(null)}
        {...(onComputer ? { onComputer } : {})}
        onDone={(label) => {
          setFlow(null);
          setPicked(null);
          save.refresh();
          onThinks?.();
          if (label) toast.show(t("agentPage.work.saved.brain", { ...g, brain: label }), "success");
        }}
        onPickKey={async (key) => {
          setFlow(null);
          await pickKey(key.id, key);
        }}
      />
    );
  }

  const note = row ? aiNote(t, i18n.language, row, { rows, agentName: agent.name, computerName, cloud }) : null;
  const act = (n: NonNullable<typeof note>["action"]) => {
    if (!n || !row) return;
    if (n.kind === "confirm") return pick(row, true);
    if (n.kind === "use") {
      const offer = rows.find((r) => r.value === n.value);
      if (offer) pick(offer);
      return;
    }
    setFlow({ kind: n.kind === "signIn" ? "again" : n.kind === "newKey" ? "newKey" : "for", row });
  };
  // Whose plan it is, to anyone but its owner: someone else's plan's owner, else (to an admin) the agent's owner.
  const agentOwner = agent.ownerUserId ? dir.memberById.get(agent.ownerUserId)?.name : undefined;
  const ownerFirst = row?.owner ?? (view.canUsePlans || !agentOwner ? undefined : firstName(agentOwner));
  // An admin who may not use other people's plans, on someone else's agent: only its owner's accounts, locked.
  const lockedAccounts = !view.canUsePlans && view.canUseOthersPlans !== true && view.accounts.length > 0;
  const plan = row && row.group !== "keys" ? row : undefined;
  const geminiWarn = row?.kind === "antigravity" && geminiPersonal(row.account);
  return (
    <Locked when={save.busy}>
      <div className="ai-form">
        <AiSelect
          label={t("brain.title")}
          rows={rows}
          value={shownValue}
          onPick={(r) => pick(r)}
          onConnect={
            mayConnect
              ? () =>
                  setFlow({ kind: "new", plan: plan ? planOfAccountRow(plan) : (ownPlan ?? undefined), fresh: true })
              : undefined
          }
          strip={stripOf(t, i18n.language, row, view, agent.name)}
          disabled={save.busy}
        />
        {note && (
          <SettingNote icon={note.icon} live>
            {note.text}
            {note.action && (
              <span className="ai-note__act">
                <Button
                  size="sm"
                  variant={note.action.kind === "confirm" ? "primary" : "default"}
                  disabled={save.busy}
                  onClick={() => act(note.action)}
                >
                  {note.action.label}
                </Button>
              </span>
            )}
            {thisMac && row?.state === t("brain.foot.offline", { computer: computerName }) && (
              <span className="ai-note__act">
                <ReconnectThisMacButton orgId={org.id} />
              </span>
            )}
          </SettingNote>
        )}
        {lockedAccounts && (
          <SettingNote icon="lock">
            {t("agentPage.work.brain.accountWho", {
              ...g,
              owner: firstName(view.accounts[0]?.ownerName ?? ""),
            })}
          </SettingNote>
        )}
        {geminiWarn && <SettingNote icon="alert">{t("connectAi.plan.gemini.warning")}</SettingNote>}
        {toolOffHere && (
          <SettingNote icon="settings">
            {t("machines.thisMac.toolsOff")}
            <span className="ai-note__act">
              <OpenPrefsButton tab="tools">{t("machines.thisMac.openTools")}</OpenPrefsButton>
            </span>
          </SettingNote>
        )}
        {row && !picked && (
          <AiSettings
            agent={agent}
            view={view}
            row={row}
            mode={mode}
            color={color}
            save={save}
            ownerFirst={ownerFirst}
            computerRow={computerRow}
          />
        )}
      </div>
    </Locked>
  );
}

interface Snapshot {
  brain: AgentBrain["brain"];
  account: string | null;
  model: string | null;
  onlyOwner: boolean;
  key: string | null;
  apiModel?: string;
}
const snapshot = (view: AgentBrain, agent: AiAgent): Snapshot => ({
  brain: view.brain,
  account: view.account,
  model: view.model,
  onlyOwner: view.onlyOwner,
  key: agent.key ?? null,
  ...(agent.model ? { apiModel: agent.model } : {}),
});

const planOfAccountRow = (row: AiRow) =>
  row.account ? planOfAccount(row.account) : planOfAccount({ kind: row.kind as never, provider: null });

/** A key maker from a provider named by a message or a card (Claude's by default). */
const keyOf = (provider?: string): ProviderId | typeof CUSTOM_PROVIDER =>
  provider === CUSTOM_PROVIDER
    ? CUSTOM_PROVIDER
    : (PROVIDERS.find((p) => p.id === provider || p.label === provider)?.id ?? "anthropic");

/**
 * Under the select, what applies to what it thinks with, each saved at once: the model (`edit`), "Atende outras pessoas"
 * on a plan, and "Configuração avançada", which opens in place (`edit`).
 */
function AiSettings({
  agent,
  view,
  row,
  mode,
  color,
  save,
  ownerFirst,
  computerRow,
}: {
  agent: AiAgent;
  view: AgentBrain;
  row: AiRow;
  mode: "edit" | "connect";
  color?: AgentColor;
  save: ReturnType<typeof useAiSave>;
  ownerFirst?: string;
  /** The agent's computer's row of the AI accounts: its own sign-ins' plans. */
  computerRow?: ReturnType<typeof useAiRows>["computerRow"];
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const g = agentGrammar(agent.name);
  const models = useModels().data?.models ?? [];
  const credentials = useCredentials(org.id, can(org, "manage_credentials"));
  const platform = usePlatformKey(org.id);
  const [open, setOpen] = useState(false);
  const modelId = useId();
  const onKey = view.brain === "model";
  const kind = view.brain;
  const choice = aiChoiceOf(view);
  const plan = isPlanId(choice) ? planOf(choice) : undefined;
  const option = view.options.find((o) => o.kind === kind);
  const account = view.accounts.find((a) => a.id === view.account);
  const planModels = onKey ? [] : brainModelChoices(plan, option?.models ?? [], account?.provider);
  // Cursor (ADR 0114): the models its plan includes, and where the CLI said so, the rest at API prices.
  const cursorPlanSays = kind === "cursor" && planModels.some((m) => m.inPlan);
  const shownModel = onKey
    ? (agent.model ?? AUTO)
    : brainModelChoice(kind, plan, view.effectiveModel ?? option?.defaultModel ?? "");
  const autoModel = isAuto(onKey ? agent.model : view.effectiveModel);
  const mayModel = onKey ? can(org, "manage_agents") : view.canEdit;
  // A row that waits for a sign-in thinks with nothing yet: its model waits too.
  const showModel = mode === "edit" && row.act !== "signIn";
  const saved = (text: string) => t("agentPage.work.saved.brain", { ...g, brain: text });
  const changeModel = (value: string) => {
    if (value === shownModel) return;
    if (onKey) {
      const was = agent.model;
      return void save.run(
        async () => {
          await save.api.agents.update(org.id, agent.id, { model: value });
          return saved(isAuto(value) ? t("brain.auto.label") : (models.find((m) => m.id === value)?.label ?? value));
        },
        was ? () => save.api.agents.update(org.id, agent.id, { model: was }) : undefined,
      );
    }
    const before = { model: view.model, effort: view.effort };
    // An automatic model picks the effort too; a fixed one after it starts on the default effort.
    const effort: BrainEffortSetting | undefined = isAuto(value) ? AUTO : isAuto(view.effort) ? "medium" : undefined;
    void save.run(
      async () => {
        await save.setBrain({
          model: value === option?.defaultModel ? null : value,
          ...(effort ? { effort } : {}),
        });
        return saved(
          isAuto(value) ? t("brain.auto.label") : (planModels.find((m) => m.value === value)?.label ?? value),
        );
      },
      () => save.setBrain(before),
    );
  };
  const modelLine = (() => {
    if (onKey) return mayModel ? null : t("agentPage.work.brain.copy.reasons.admins_only");
    if (isAuto(shownModel)) return t("brain.auto.hint");
    const m = planModels.find((x) => x.value === shownModel);
    return m ? (brainModelLine(t, kind, plan, m, cursorPlanSays) ?? null) : null;
  })();
  const autoOption = {
    value: AUTO,
    label: t("brain.auto.label"),
    description: t("brain.auto.hint"),
    leading: (
      <span className="newag__ib">
        <Icon name="bulb" size={16} />
      </span>
    ),
  };
  const modelControl = onKey ? (
    <ModelSelect
      size="sm"
      align="end"
      aria-label={t("agentPage.work.brain.planModel")}
      value={shownModel}
      disabled={!mayModel}
      onChange={changeModel}
      options={[
        autoOption,
        ...apiModelOptions(t, i18n.language, modelChoices(models, credentials.data ?? [], platform.data ?? false)),
      ]}
    />
  ) : (
    <Select
      id={modelId}
      size="sm"
      align="end"
      aria-label={t("agentPage.work.brain.planModel")}
      value={shownModel}
      disabled={!mayModel}
      onValueChange={changeModel}
      options={[
        autoOption,
        // Several makers' models grouped by maker, each beside its logo; the others beside their plan's.
        ...planModels.map((m) => {
          const line = brainModelLine(t, kind, plan, m, cursorPlanSays);
          return {
            value: m.value,
            label: m.label,
            ...(line ? { description: line } : {}),
            ...(m.needs ? { hint: t(`brain.modelNeeds.${m.needs}`) } : {}),
            ...(m.maker
              ? { group: providerLabel(m.maker), leading: <ProviderLogo id={m.maker} size="sm" /> }
              : { leading: <ProviderLogo id={row.mark} size="sm" /> }),
          };
        }),
      ]}
    />
  );
  // The model's own limit on its plan, which the account's meter doesn't show; a free tier's note.
  const modelLimit = modelLimitText(t, i18n.language, account?.usage, account?.provider, view.effectiveModel);
  const freeHint = planFreeHint(t, plan);
  // Once chosen, what a model needs from its plan's account is the note under it, with where to give it.
  const needs = planModels.find((m) => m.value === shownModel)?.needs;
  // "Atende outras pessoas" on a plan (never a key, never the right hand's own AI for one person).
  const onPlan = !onKey && row.group !== "keys" && view.scope !== "mine";
  const whose =
    (account && !account.mine && account.ownerId !== agent.ownerUserId) || !view.canUsePlans ? ownerFirst : undefined;
  return (
    <>
      {modelLimit && showModel && <SettingNote icon="alert">{modelLimit}</SettingNote>}
      {freeHint && showModel && <SettingNote icon="info">{freeHint}</SettingNote>}
      {needs && plan && showModel && (
        <SettingNote icon="info" live>
          {t(`brain.modelHow.${needs}`)}
          <span className="ai-note__act">
            <OpenPage href={plan.site}>{t("aiAccounts.add.openKeys", { site: new URL(plan.site).host })}</OpenPage>
          </span>
        </SettingNote>
      )}
      {(showModel || onPlan || mode === "edit") && (
        <div className="ac-setlist ai-set">
          {showModel && (
            <div className="ac-setlist__row ac-setlist__row--pad">
              <SettingRow
                title={t("agentPage.work.brain.planModel")}
                htmlFor={onKey ? undefined : modelId}
                status={
                  modelLine &&
                  (onKey && !mayModel ? (
                    <span className="ac-iconline">
                      <Icon name="lock" size={14} />
                      <span>{modelLine}</span>
                    </span>
                  ) : (
                    modelLine
                  ))
                }
              >
                {modelControl}
              </SettingRow>
            </div>
          )}
          {onPlan && (
            <div className="ac-setlist__row ac-setlist__row--pad">
              <Replies
                agent={agent}
                view={view}
                row={row}
                save={save}
                owner={whose}
                plan={row.kind === "model" ? null : signInPlan(view, computerRow, row.kind)}
              />
            </div>
          )}
          {mode === "edit" && (
            <AdvancedSaved
              agent={agent}
              view={view}
              open={open}
              onOpen={setOpen}
              color={color}
              save={save}
              autoModel={autoModel}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * "Atende outras pessoas" for one agent on a plan: saved at once. Turned on over someone else's plan, it asks first in
 * a note under it, with one button (its owner gets an email, as `widenQuestion` says).
 */
function Replies({
  agent,
  view,
  row,
  save,
  owner,
  plan,
}: {
  agent: AiAgent;
  view: AgentBrain;
  row: AiRow;
  save: ReturnType<typeof useAiSave>;
  /** Whose plan it is, to anyone but its owner (an admin, or on someone else's plan). */
  owner?: string;
  /** The plan as the CLI says it (`max`, `team`…), the computer's own sign-in's too: a seat has its own words. */
  plan: string | null;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const toast = useToast();
  const g = agentGrammar(agent.name);
  const [asking, setAsking] = useState<{ text: string; owner: string } | null>(null);
  const full = dir.agentById.get(agent.id);
  const ask = (on: boolean) => {
    if (on && full && opensOthersPlan(full, EVERYONE_AUDIENCE, me.user.id)) {
      const planOwner = dir.memberById.get(full.ownerUserId ?? "")?.name ?? t("channel.unknownPerson");
      const question = widenQuestion(t, full, planOwner, []);
      if (question) return setAsking({ text: question.description, owner: planOwner });
    }
    setAsking(null);
    flip(on);
  };
  const flip = (on: boolean) =>
    void save.run(
      async () => {
        const next = await save.setBrain({ onlyOwner: !on });
        // "Só algumas pessoas" with nobody picked keeps it as it is: said, with where to pick them.
        if (on && next.onlyOwner) {
          toast.show(t("aiAccounts.share.pickPeople", g), "info");
          return null;
        }
        return t(on ? "aiAccounts.share.savedEveryone" : "aiAccounts.share.savedOwner", g);
      },
      () => save.setBrain({ onlyOwner: on }),
    );
  return (
    <>
      <PlanReplies
        agent={agent.name}
        {...(owner ? { owner } : {})}
        on={!view.onlyOwner}
        onChange={ask}
        brain={row.kind === "model" ? "claude_code" : row.kind}
        plan={plan}
        coding={planOf(row.account?.provider)}
        disabled={save.busy}
      />
      {asking && (
        <SettingNote icon="info" live>
          {asking.text}
          <span className="ai-note__act">
            <Button
              size="sm"
              variant="primary"
              disabled={save.busy}
              onClick={() => {
                setAsking(null);
                flip(true);
              }}
            >
              {t("aiSelect.useLent", { owner: asking.owner })}
            </Button>
          </span>
        </SettingNote>
      )}
    </>
  );
}

/**
 * Quem pensa's "Configuração avançada": the agent's values, each change saved at once with its toast (what the row says
 * now) and Desfazer.
 */
function AdvancedSaved({
  agent,
  view,
  open,
  onOpen,
  color,
  save,
  autoModel,
}: {
  agent: AiAgent;
  view: AgentBrain;
  open: boolean;
  onOpen: (open: boolean) => void;
  color?: AgentColor;
  save: ReturnType<typeof useAiSave>;
  autoModel: boolean;
}) {
  const { t, i18n } = useTranslation();
  const models = useModels().data?.models ?? [];
  const kind = view.brain;
  const onKey = kind === "model";
  const speedOn = viewSpeedFits(view);
  const levels = onKey ? [] : effortLevels(kind, view.effectiveModel);
  const contextNow = isContextLimit(view.contextTokens) ? view.contextTokens : null;
  const now: Advanced = {
    effort: shownEffort(view.effort, levels),
    speed: speedOn ? view.speed : "standard",
    contextTokens: contextNow,
  };
  const contextOptions = contextChoices(
    onKey
      ? isAuto(agent.model)
        ? undefined
        : models.find((m) => m.id === agent.model)
      : autoModel
        ? undefined
        : view.options.find((o) => o.kind === kind)?.models.find((m) => m.value === view.effectiveModel),
  );
  return (
    <AdvancedSection
      kind={kind}
      levels={levels}
      autoModel={autoModel}
      speedOn={speedOn}
      value={now}
      contextOptions={contextOptions}
      open={open}
      onOpen={onOpen}
      color={color}
      disabled={save.busy}
      onChange={(next) => {
        const input: AgentBrainInput = {
          ...(next.effort !== undefined && !onKey ? { effort: autoModel ? AUTO : next.effort } : {}),
          ...(next.speed !== undefined && !onKey ? { speed: next.speed } : {}),
          ...(next.contextTokens !== undefined ? { contextTokens: next.contextTokens } : {}),
        };
        void save.run(
          async () => {
            await save.setBrain(input);
            return advancedSummary(t, i18n.language, { kind, autoModel, now: { ...now, ...next } });
          },
          () => save.setBrain({ effort: view.effort, speed: view.speed, contextTokens: contextNow }),
        );
      }}
    />
  );
}

/**
 * "Configuração avançada", in place, the same wherever an agent's AI is set: its row says what differs from the
 * defaults and opens under itself the effort (the model's own levels: bars up to `EFFORT_RAMP_MAX`, a select past
 * that), the speed where it applies, the context window and "Voltar ao padrão". On a key, only the context window.
 */
export function AdvancedSection({
  kind,
  levels,
  autoModel,
  speedOn,
  value,
  contextOptions,
  open,
  onOpen,
  onChange,
  color,
  disabled,
}: {
  kind: AgentBrain["brain"];
  levels: readonly EffortLevel[];
  autoModel: boolean;
  speedOn: boolean;
  value: Advanced;
  contextOptions: readonly ContextLimit[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (next: Partial<Advanced>) => void;
  color?: AgentColor;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const bodyId = useId();
  const contextId = useId();
  const effortId = useId();
  const onKey = kind === "model";
  const shownContext =
    value.contextTokens !== null && contextOptions.includes(value.contextTokens) ? value.contextTokens : null;
  const summary = advancedSummary(t, i18n.language, { kind, autoModel, now: value });
  const effortLabel = t("agentPage.work.brain.effort");
  return (
    <div className="ac-setlist__row ai-adv" data-open={open || undefined}>
      <button
        type="button"
        className="ai-adv__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onOpen(!open)}
      >
        <span className="ai-adv__text">
          <b>{t("agentPage.work.brain.advanced.title")}</b>
          <small>{summary}</small>
        </span>
        <Icon name="chevronDown" size={16} className="ai-adv__chev" />
      </button>
      <div className="ai-adv__body" id={bodyId} hidden={!open}>
        {!onKey &&
          (autoModel ? (
            // "Automático" picks the effort too: said where the effort would be.
            <SettingRow title={effortLabel} status={t("agentPage.work.brain.effortText.auto")} />
          ) : levels.length === 0 ? null : levels.length <= EFFORT_RAMP_MAX ? (
            <EffortPixels
              label={effortLabel}
              value={value.effort}
              disabled={disabled}
              onValueChange={(effort) => onChange({ effort })}
              color={color}
              steps={levels.map((e) => ({ value: e, label: t(`agentPage.work.brain.efforts.${e}`) }))}
              hint={(e) => t(`agentPage.work.brain.effortText.${e}`)}
            />
          ) : (
            <SettingRow
              title={effortLabel}
              htmlFor={effortId}
              status={t(`agentPage.work.brain.effortText.${value.effort}`)}
            >
              <Select
                id={effortId}
                size="sm"
                align="end"
                value={value.effort}
                disabled={disabled}
                onValueChange={(effort) => onChange({ effort })}
                options={levels.map((e) => ({ value: e, label: t(`agentPage.work.brain.efforts.${e}`) }))}
              />
            </SettingRow>
          ))}
        {!onKey && speedOn && (
          <SettingRow
            title={t("agentPage.work.brain.speed")}
            hint={{
              name: t("common.about", { label: t("agentPage.work.brain.speed") }),
              text: t("agentPage.work.brain.speedText"),
            }}
          >
            <Segmented
              label={t("agentPage.work.brain.speed")}
              value={value.speed}
              disabled={disabled}
              onValueChange={(speed) => onChange({ speed })}
              options={SPEEDS.map((s) => ({ value: s, label: t(`agentPage.work.brain.speeds.${s}`) }))}
            />
          </SettingRow>
        )}
        <SettingRow
          title={t("agentPage.work.brain.context")}
          htmlFor={contextId}
          status={t(`agentPage.work.brain.contextText.${shownContext ?? "auto"}`)}
        >
          <Select
            id={contextId}
            size="sm"
            align="end"
            value={shownContext === null ? AUTO : String(shownContext)}
            disabled={disabled}
            onValueChange={(v) =>
              onChange({ contextTokens: v === AUTO ? null : (contextOptions.find((n) => String(n) === v) ?? null) })
            }
            options={[
              { value: AUTO, label: t("brain.auto.label") },
              ...contextOptions.map((n) => ({ value: String(n), label: contextSize(n) })),
            ]}
          />
        </SettingRow>
        <Button
          size="sm"
          variant="ghost"
          className="ac-btn--under"
          disabled={isAdvancedDefault(kind, value) || disabled}
          onClick={() => onChange(advancedDefaults(kind, value))}
        >
          {t("agentPage.work.brain.advanced.defaults")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Conectar outra IA" inside the dialog: its head with the way back, the provider (a plan, or a key to pay as you go),
 * then its steps. A plan's sign-in makes the agent think with the new account; a key saved, with the key. The fixed
 * variants sign one account in again, in once more for this agent, or give a coding plan's account a new key.
 */
function AiFlow({
  agent,
  view,
  flow,
  start,
  onBack,
  onComputer,
  onDone,
  onPickKey,
}: {
  agent: AiAgent;
  view: AgentBrain;
  flow: Flow;
  start?: AiStart;
  onBack?: () => void;
  onComputer?: () => void;
  /** It thinks with what was connected here (`label`: the account a sign-in made). */
  onDone: (label?: string) => void;
  onPickKey: (key: Credential) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const dir = useDirectory(org.id);
  const gates = usePlanGates(org.id, agent.id);
  const g = agentGrammar(agent.name);
  const mayAddKey = can(org, "manage_credentials");
  // What it opens on, until the person picks: what was asked, else Claude, else (no computer for a plan) the key.
  const [picked, setChosen] = useState<string | null>(null);
  const opening = defaultChoice({
    asked: flow.kind !== "new" ? planOfAccountRow(flow.row) : flow.key ? "key" : flow.plan,
    mayAddKey,
    claudeGate: gates.gateOf("claude"),
  });
  const chosen =
    picked ?? (opening === "key" ? `key:${(flow.kind === "new" && flow.key) || "anthropic"}` : `plan:${opening}`);
  // A key saving holds the provider where it is.
  const [busy, setBusy] = useState(false);
  const fixed = flow.kind !== "new" ? flow.row : null;
  const head =
    flow.kind === "again"
      ? t("aiSelect.signInAgain", { label: flow.row.label })
      : flow.kind === "for"
        ? t("connectAi.signInFor", g)
        : flow.kind === "newKey"
          ? t("aiAccounts.page.newKey")
          : t("aiSelect.connect");
  const choice = chosen.startsWith("plan:") ? (chosen.slice(5) as PlanChoice) : null;
  const login: ExistingSignIn | undefined = fixed?.account
    ? {
        choice: planOfAccountRow(fixed),
        from: fixed.account.id,
        ...(flow.kind === "for" ? {} : { again: fixed.account.id }),
        email: fixed.account.email,
      }
    : undefined;
  const look = dir.agentById.get(agent.id);
  const forWhom = [
    {
      id: agent.id,
      name: agent.name,
      ...(look ? { appearance: lookOf(look), initials: dir.agentInitials(agent.id) } : {}),
    },
  ];
  const owner = agent.ownerUserId ? dir.memberById.get(agent.ownerUserId)?.name : undefined;
  const toComputers =
    onComputer ??
    (() => void navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section: "computers" } }));
  return (
    <div className="ai-flow">
      {onBack && (
        <div className="agp-addacct__head ai-flow__head">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="chevronLeft"
            aria-label={t("common.back")}
            onClick={onBack}
          />
          <b>{head}</b>
        </div>
      )}
      {!fixed && (
        <ProviderPicker
          value={chosen}
          gates={gates}
          mayAddKey={mayAddKey}
          onPick={setChosen}
          label={t("aiSelect.connect")}
          disabled={busy}
        />
      )}
      {choice ? (
        <PlanPanel
          key={`${choice}:${flow.kind}`}
          choice={choice}
          gates={gates}
          forWhom={forWhom}
          justReady={start?.ready}
          fresh={flow.kind === "new" && flow.fresh === true}
          {...(login ? { login } : {})}
          locked={
            view.canUsePlans
              ? undefined
              : owner
                ? t("noAi.locked", { name: agent.name, owner: firstName(owner) })
                : t("noAi.lockedAdmins")
          }
          onKey={() => setChosen("key:anthropic")}
          onComputer={toComputers}
          onDone={(_ids, account) => onDone(account?.label)}
        />
      ) : (
        <KeySteps
          provider={chosen.slice(4) as ProviderId | typeof CUSTOM_PROVIDER}
          apiKey={start?.apiKey}
          locked={!mayAddKey}
          onSaved={onPickKey}
          onEndpoint={() => onDone()}
          onBusy={setBusy}
        />
      )}
    </div>
  );
}

/** A key pasted and saved after a real test call, for whoever adds keys: then the agent thinks with it (`onSaved`). */
function KeySteps({
  provider,
  apiKey,
  locked,
  onSaved,
  onEndpoint,
  onBusy,
}: {
  provider: ProviderId | typeof CUSTOM_PROVIDER;
  apiKey?: string;
  locked: boolean;
  onSaved: (key: Credential) => void | Promise<void>;
  onEndpoint: () => void;
  /** Whether the key is saving, for the controls around it. */
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const add = useAddCredential(org.id, true);
  const [draft, setDraft] = useState<KeyDraft>({ provider, apiKey: apiKey ?? "" });
  const [refused, setRefused] = useState<ReturnType<typeof keyRefusal>>(null);
  // The select above picks the maker.
  useEffect(() => setDraft((d) => (d.provider === provider ? d : { provider, apiKey: d.apiKey })), [provider]);
  useEffect(() => onBusy?.(add.isPending), [onBusy, add.isPending]);
  const save = () => {
    if (draft.provider === CUSTOM_PROVIDER) return;
    setRefused(null);
    const label = providerLabel(draft.provider);
    add.mutate(
      { provider: draft.provider, label, apiKey: draft.apiKey.trim() },
      {
        onError: (error) => {
          setRefused(keyRefusal(t, error));
          if (!keyRefusal(t, error)) toast.show(errorText(t, error), "error");
        },
        onSuccess: (key) => {
          if (key.check === "unchecked") toast.show(t("connectAi.key.savedUnchecked", { provider: label }), "info");
          void onSaved(key);
        },
      },
    );
  };
  return (
    <KeyPanel
      draft={draft}
      onDraft={setDraft}
      locked={locked}
      refused={refused}
      saving={add.isPending}
      onSave={save}
      endpoint={<EndpointForm orgId={org.id} onDone={onEndpoint} />}
    />
  );
}

/**
 * The provider of "Conectar outra IA": the plans first ("Seu plano de IA", each with its tiers, a plan that can't sign
 * in there dimmed with why), then the keys to pay as you go ("Ou pague pelo uso") and another provider's endpoint.
 */
function ProviderPicker({
  value,
  gates,
  mayAddKey,
  onPick,
  label,
  disabled,
}: {
  value: string;
  gates: { gateOf: (c: PlanChoice) => PlanGate; edition: string | null };
  mayAddKey: boolean;
  onPick: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const tiers = (c: PlanChoice) =>
    c === "gemini"
      ? t("aiSelect.geminiTiers")
      : c === "cursor"
        ? t("aiSelect.cursorTiers")
        : t(`connectAi.plan.${c}.tiers`);
  const why = (gate: PlanGate) =>
    gate.state === "missing"
      ? t("brain.foot.noComputer")
      : gate.state === "preparing"
        ? t("aiSelect.preparing")
        : gate.state === "unsupported"
          ? t("brain.foot.unavailable")
          : null;
  const plans = t("aiSelect.plans");
  const payGo = t("connectAi.orPayGo");
  const options: SelectOption[] = [
    ...PLAN_CHOICES.map((c) => {
      const gate = gates.gateOf(c);
      const dim = gate.state === "missing" || gate.state === "unsupported";
      return {
        value: `plan:${c}`,
        label: planLabel(t, c),
        description: why(gate) ?? tiers(c),
        group: plans,
        leading: <ProviderLogo id={planMark(c)} size="sm" off={dim} />,
      };
    }),
    ...(mayAddKey
      ? [
          ...PROVIDERS.map((p) => ({
            value: `key:${p.id}`,
            label: p.label,
            description: t("connectAi.key.title"),
            group: payGo,
            leading: <ProviderLogo id={p.id} size="sm" />,
          })),
          {
            value: `key:${CUSTOM_PROVIDER}`,
            label: t("endpoint.option"),
            description: t("aiSelect.endpointLine"),
            group: payGo,
            leading: <ProviderLogo id="custom" size="sm" />,
          },
        ]
      : [
          {
            value: "key:locked",
            label: t("connectAi.key.title"),
            description: t("aiSelect.keyLocked"),
            group: payGo,
            leading: (
              <span className="newag__ib">
                <Icon name="key" size={16} />
              </span>
            ),
            disabled: true,
          },
        ]),
  ];
  return (
    <SearchSelect
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={onPick}
      options={options}
      matches={(o, q) =>
        matchesWords(
          o.value.startsWith("plan:") ? planPickText(t, o.value.slice(5) as PlanChoice) : `${o.label} ${o.value}`,
          q,
        )
      }
      labels={{
        search: t("connectAi.pick.search"),
        searchPlaceholder: t("connectAi.pick.searchPlaceholder"),
        noResults: t("connectAi.pick.noResults"),
        list: t("connectAi.pick.list"),
      }}
    />
  );
}

/**
 * Several agents at once (the composer's banner, the first run, agents created with no AI): who it's for in one line
 * with their faces, the same select (only what can think for all of them: a plan's sign-in made for all of their
 * owner's agents, the computer's own, a key), saved for each at once, and "Atendem outras pessoas".
 */
export function TeamAi({
  agents,
  start,
  onThinks,
  onComputer,
}: {
  agents: AiAgent[];
  start?: AiStart;
  onThinks?: () => void;
  onComputer: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const dir = useDirectory(org.id);
  const [first] = agents as [AiAgent];
  const { view, rows, loading, failed, retry, hold, credentials, defaultKey } = useAiRows(first);
  const models = useModels().data?.models ?? [];
  const [picked, setPicked] = useState<AiRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [everyone, setEveryone] = useState(false);
  // "Conectar outra IA": its providers (opened at once for a new AI, a plan or a key asked for), then the steps.
  // `fresh`: from the select's row, past the accounts it lists.
  const [flow, setFlow] = useState<"asked" | "fresh" | null>(
    start?.other || start?.plan || start?.key ? "asked" : null,
  );
  const [pickedProvider, setProvider] = useState<string | null>(null);
  const mayAddKey = can(org, "manage_credentials");
  const gates = usePlanGates(org.id, first.id);
  // Opening it is looking at the plans, as for one agent (`AgentAiForm`): their usage is looked up again.
  useEffect(() => {
    void api.machines.refreshAccountUsage(org.id).catch(() => undefined);
  }, [api, org.id]);
  const opening = defaultChoice({
    asked: start?.key ? "key" : start?.plan,
    mayAddKey,
    claudeGate: gates.gateOf("claude"),
  });
  const provider = pickedProvider ?? (opening === "key" ? `key:${keyOf(start?.provider)}` : `plan:${opening}`);
  const status = useAiStatus(org.id);
  if (hold) return <PlanHold hold={hold} />;
  if (failed) return <LoadFailed onRetry={() => void retry()} />;
  if (loading || !view) return <Spinner />;
  const names = namesText(
    t,
    agents.map((a) => a.name),
    NAMES_SHOWN,
  );
  const fits = rows.map((r) => ({
    ...r,
    disabled: r.disabled || r.act !== "use" || (r.account !== undefined && r.account.shared !== true),
  }));
  const refresh = () => {
    for (const key of [keys.agents(org.id), keys.aiStatus(org.id), keys.aiAccounts(org.id)])
      void qc.invalidateQueries({ queryKey: key });
    for (const a of agents) void qc.invalidateQueries({ queryKey: keys.agentBrain(org.id, a.id) });
  };
  const forAll = async (each: (a: AiAgent) => Promise<unknown>, done: string) => {
    setBusy(true);
    let missed = 0;
    for (const a of agents) await each(a).catch(() => (missed += 1));
    setBusy(false);
    refresh();
    onThinks?.();
    toast.show(missed ? t("agentPage.work.brain.copy.missed", { count: missed }) : done, missed ? "error" : "success");
  };
  const pick = (r: AiRow) => {
    setPicked(r);
    const k = r.group === "keys" ? credentials.find((c) => c.id === (r.key ?? defaultKey)) : undefined;
    void forAll(
      async (a) => {
        if (r.group !== "keys")
          return api.agents.setBrain(org.id, a.id, {
            brain: r.kind,
            account: r.account?.id ?? null,
            ...(everyone ? { onlyOwner: false } : {}),
          });
        await api.agents.setBrain(org.id, a.id, { brain: "model" });
        const fit = !k || keyRuns(k, a.model, models);
        return api.agents.update(org.id, a.id, { credentialId: r.key ?? null, ...(fit ? {} : { model: AUTO }) });
      },
      t("connectAi.doneAll", { names, label: r.label }),
    );
  };
  const faces = (
    <AvatarStack>
      {agents.slice(0, 3).map((a) => {
        const row = dir.agentById.get(a.id);
        return (
          <AgentAvatar
            key={a.id}
            name={a.name}
            initials={dir.agentInitials(a.id)}
            {...(row ? { appearance: lookOf(row) } : {})}
            size="xs"
          />
        );
      })}
    </AvatarStack>
  );
  // Whom a plan's steps sign in for: those with no AI yet, and those on this plan already (done there). One on the API
  // key or on another plan keeps it, since a plan makes an agent answer only its owner; with none left, all of them.
  const planChoice = provider.startsWith("plan:") ? (provider.slice(5) as PlanChoice) : null;
  const aiNow = (id: string) => agentAi(dir.agentById.get(id), aiStateOf(status.data, id));
  const open = agents.filter((a) => {
    const ai = aiNow(a.id);
    return ai === null || ai === planChoice;
  });
  const forWhom = (open.length > 0 ? open : agents).map((a) => {
    const row = dir.agentById.get(a.id);
    const ready = (aiStateOf(status.data, a.id) ?? "no_ai") !== "no_ai";
    return {
      id: a.id,
      name: a.name,
      done: planChoice !== null && ready && aiNow(a.id) === planChoice,
      ...(row ? { appearance: lookOf(row), initials: dir.agentInitials(a.id) } : {}),
    };
  });
  return (
    <Locked when={busy}>
      <div className="ai-form">
        <p className="ai-for ac-iconline">
          {faces}
          <span>{t("aiSelect.for", { names })}</span>
        </p>
        {flow ? (
          <div className="ai-flow">
            <div className="agp-addacct__head ai-flow__head">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="chevronLeft"
                aria-label={t("common.back")}
                onClick={() => setFlow(null)}
              />
              <b>{t("aiSelect.connect")}</b>
            </div>
            <ProviderPicker
              value={provider}
              gates={gates}
              mayAddKey={mayAddKey}
              onPick={setProvider}
              label={t("aiSelect.connect")}
              disabled={busy}
            />
            {provider.startsWith("plan:") ? (
              <PlanPanel
                key={provider}
                choice={provider.slice(5) as PlanChoice}
                gates={gates}
                forWhom={forWhom}
                toEveryone={everyone}
                fresh={flow === "fresh"}
                onKey={() => setProvider("key:anthropic")}
                onComputer={onComputer}
                onDone={(ids, account) => {
                  setFlow(null);
                  refresh();
                  onThinks?.();
                  toast.show(
                    t("connectAi.doneAll", {
                      names: namesText(
                        t,
                        ids.map((id) => agents.find((a) => a.id === id)?.name ?? ""),
                        NAMES_SHOWN,
                      ),
                      label: account?.label ?? planLabel(t, provider.slice(5) as PlanChoice),
                    }),
                    "success",
                  );
                }}
              />
            ) : (
              <KeySteps
                provider={provider.slice(4) as ProviderId | typeof CUSTOM_PROVIDER}
                apiKey={start?.apiKey}
                locked={!mayAddKey}
                onSaved={(key) => {
                  setFlow(null);
                  void forAll(
                    async (a) => {
                      await api.agents.setBrain(org.id, a.id, { brain: "model" });
                      const fit = keyRuns(key, a.model, models);
                      return api.agents.update(org.id, a.id, { credentialId: key.id, ...(fit ? {} : { model: AUTO }) });
                    },
                    t("connectAi.doneAll", { names, label: key.label }),
                  );
                }}
                onEndpoint={() => {
                  setFlow(null);
                  refresh();
                  onThinks?.();
                }}
                onBusy={setBusy}
              />
            )}
          </div>
        ) : (
          <>
            <AiSelect
              label={t("brain.title")}
              rows={fits}
              value={picked?.value ?? null}
              onPick={pick}
              onConnect={view.canUsePlans ? () => setFlow("fresh") : undefined}
              disabled={busy}
            />
            {picked && picked.group !== "keys" && view.scope !== "mine" && (
              <div className="ac-setlist ai-set">
                <div className="ac-setlist__row ac-setlist__row--pad">
                  <PlanReplies
                    agent={null}
                    on={everyone}
                    onChange={(on) => {
                      setEveryone(on);
                      void forAll(
                        (a) => api.agents.setBrain(org.id, a.id, { onlyOwner: !on }),
                        planReplies(t, {
                          on,
                          agent: null,
                          brain: picked.kind === "model" ? "claude_code" : picked.kind,
                          plan: picked.account?.plan ?? null,
                          coding: planOf(picked.account?.provider),
                        }).line,
                      );
                    }}
                    brain={picked.kind === "model" ? "claude_code" : picked.kind}
                    plan={picked.account?.plan ?? null}
                    coding={planOf(picked.account?.provider)}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Locked>
  );
}

/**
 * Connect an AI for someone with no agent of theirs (Settings, Orçamento e uso): the provider and its steps alone. A
 * plan signs in for the agents they create; a key thinks for every agent without a plan.
 */
export function LoneAiFlow({
  start,
  onDone,
  onComputer,
}: {
  start?: AiStart;
  onDone: () => void;
  onComputer: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const qc = useQueryClient();
  const gates = useGatesWithoutAgent(org.id, true);
  const mayAddKey = can(org, "manage_credentials");
  const [picked, setChosen] = useState<string | null>(null);
  // What it opens on, until the person picks: what was asked, else Claude, else (no computer for a plan) the key.
  const opening = defaultChoice({
    asked: start?.key ? "key" : start?.plan,
    mayAddKey,
    claudeGate: gates.at("claude").gate,
  });
  const chosen = picked ?? (opening === "key" ? `key:${keyOf(start?.provider)}` : `plan:${opening}`);
  const [saved, setSaved] = useState(false);
  const choice = chosen.startsWith("plan:") ? (chosen.slice(5) as PlanChoice) : null;
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.aiAccounts(org.id) });
    void qc.invalidateQueries({ queryKey: keys.aiStatus(org.id) });
    onDone();
  };
  return (
    <div className="ai-flow">
      <ProviderPicker
        value={chosen}
        gates={{ gateOf: (c) => gates.at(c).gate, edition: gates.edition }}
        mayAddKey={mayAddKey}
        onPick={(v) => {
          setChosen(v);
          setSaved(false);
        }}
        label={t("aiSelect.connect")}
      />
      {choice ? (
        <PlanWithoutAgent
          key={choice}
          choice={choice}
          gates={gates}
          mayAddKey={mayAddKey}
          onKey={() => setChosen("key:anthropic")}
          onComputer={onComputer}
          onDone={done}
        />
      ) : saved ? (
        <SettingNote icon="check" live>
          {t("connectAi.key.saved")}
        </SettingNote>
      ) : (
        <KeySteps
          provider={chosen.slice(4) as ProviderId | typeof CUSTOM_PROVIDER}
          apiKey={start?.apiKey}
          locked={!mayAddKey}
          onSaved={() => {
            setSaved(true);
            done();
          }}
          onEndpoint={done}
        />
      )}
    </div>
  );
}
