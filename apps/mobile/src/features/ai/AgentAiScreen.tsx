import type { AgentBrain, AgentBrainInput, MachineAccountKind } from "@agenteschat/client";
import { keys, useAgentBrain, useApi, useModels } from "@agenteschat/client";
import { signInPlan } from "@agenteschat/client/lib/ai-accounts";
import { type AiNote, aiNote } from "@agenteschat/client/lib/ai-select";
import { EVERYONE_AUDIENCE } from "@agenteschat/client/lib/audience";
import { brainLine, thinksWith } from "@agenteschat/client/lib/brain";
import { EFFORT_RAMP_MAX, effortLevels } from "@agenteschat/client/lib/brain-advanced";
import { firstName } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { aiChoiceOf, planOfAccount } from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { modelLimitText } from "@agenteschat/client/lib/plan-usage";
import { brainPlan, geminiPersonal, planFreeHint, planOf } from "@agenteschat/client/lib/plans";
import { apiProviderOf, isAuto, providerLabel } from "@agenteschat/client/lib/providers";
import { limitOffers, planState } from "@agenteschat/ui/plan-state";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import {
  Glass,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  type IconName,
  ProviderLogo,
  Text,
  useReducedMotion,
  useTheme,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { useWidenAsk } from "../chat/ReachLines";
import { useColors, useDirectory, useMeId } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { PushedHeader } from "../shared/parts";
import { PlanMeter } from "../usage/parts";
import { AdvancedInline, advancedOf } from "./AdvancedInline";
import { openAgentAiPick, rowLine, useAiPick, useAiRowsOf } from "./AiPick";
import { EffortRamp, useEffortChoice } from "./EffortRamp";
import { modelInput, modelRows, modelSections } from "./logic";
import { openConnectAi } from "./NoAiCard";
import { Note, PlanHoldNote, PlanReplies } from "./parts";

/*
 * An agent's AI on the phone (the web's "Quem pensa", ADR 0059), from "Pensa com" on its profile, under what thinks in
 * one sentence ("DeepSeek V4.1 Flash pelo OpenCode Go"): one row for what it thinks with (the web's AI select's
 * trigger), which pushes the list of what it may think with; the note it waits on, with its one way out; then the
 * model, "Atende outras pessoas" on a plan, the plan's usage (at its limit, the account with the most room, picked in
 * one tap) and "Configuração avançada" in place. Each choice saves at once. Its owner and admins open it.
 */

/** Opens an agent's AI. */
export const openAgentAi = (agentId: string) => router.push(`/agent-ai/${agentId}` as never);

/** Opens an agent's model, from its AI. */
const openAgentModel = (agentId: string) => router.push(`/agent-model/${agentId}` as never);

/** Saves a change to the agent's AI at once and says so (or that it failed). */
function useSaveBrain(agentId: string) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (input: AgentBrainInput, done: string | ((saved: AgentBrain) => string)) => {
    setBusy(true);
    try {
      const saved = await api.agents.setBrain(orgId, agentId, input);
      qc.setQueryData(keys.agentBrain(orgId, agentId), saved);
      toast({ title: typeof done === "string" ? done : done(saved), icon: "check" });
    } catch {
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    } finally {
      for (const key of [
        keys.agentBrain(orgId, agentId),
        keys.agents(orgId),
        keys.aiAccounts(orgId),
        keys.aiStatus(orgId),
      ])
        void qc.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  };
  return { busy, save };
}

export function AgentAiScreen({ agentId }: { agentId: string }) {
  const { t, i18n } = useTranslation();
  const { orgId, org } = useOrg();
  const api = useApi();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const meId = useMeId();
  const agent = dir.agentById.get(agentId);
  const ask = useWidenAsk(agent);
  const name = agent?.name ?? "";
  const g = agentGrammar(name);
  // As on the web: its owner and admins load it, members don't.
  const allowed = (meId !== null && agent?.ownerUserId === meId) || (org ? can(org, "manage_agents") : false);
  const { view, rows, current, loading, computerName, hold, agentModel, computerRow } = useAiRowsOf(agentId, allowed);
  const { pick, busy: picking } = useAiPick(agentId);
  const { busy, save } = useSaveBrain(agentId);
  // Looking at the plan: its usage is looked up again (it comes back as `machine.updated`).
  useEffect(() => {
    void api.machines.refreshAccountUsage(orgId).catch(() => undefined);
  }, [api, orgId]);

  const thinks = brainLine(t, agent?.brain, t("brain.model"), { agents: dir.agents });
  // Through the API: its maker's mark.
  const models = useModels().data?.models;
  const thinksMark = thinks.mark ?? apiProviderOf(agent?.model, models ?? []);
  const onPlan = view !== undefined && view.brain !== "model";
  const model = view && onPlan ? modelRows(t, view, brainPlan(view)).find((r) => r.checked) : undefined;
  const account = current?.account;
  const note = current
    ? aiNote(t, i18n.language, current, { rows, agentName: name, computerName, cloud: false })
    : null;
  const usage = onPlan && view ? (account ? account.usage : view.ownUsage[view.brain as never]) : undefined;
  const limited = usage ? planState(usage).state === "limited" : false;
  // At the limit, one way out: the viewer's other account of that plan with the most room, picked in one tap.
  const offer =
    limited && account
      ? limitOffers(
          rows.flatMap((r) => (r.account && !r.disabled ? [r.account] : [])),
          account.kind,
          account.id,
        )[0]
      : undefined;
  const modelLimit = modelLimitText(t, i18n.language, usage, account?.provider, model?.value);
  // Whose plan it is, to anyone but its owner: someone else's plan's owner, else (to an admin) the agent's owner.
  const agentOwner = agent?.ownerUserId ? dir.memberById.get(agent.ownerUserId)?.name : undefined;
  const whose =
    account && !account.mine && account.ownerId !== agent?.ownerUserId
      ? firstName(account.ownerName ?? "")
      : !view?.canUsePlans && agentOwner
        ? firstName(agentOwner)
        : undefined;
  // A row that waits for a sign-in: the plan's steps for it, on that plan's page; a signed-out login as itself.
  const signIn = () =>
    openConnectAi({
      agentId,
      ...(account ? { plan: planOfAccount(account) } : {}),
      ...(account && note?.action?.kind !== "signInFor" ? { again: account.id } : {}),
      ...(account?.email ? { email: account.email } : {}),
    });

  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("mobile.intentAgents.thinks")} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.in, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.hero}>
          {thinksMark ? <ProviderLogo id={thinksMark} size="hero" /> : null}
          <Text variant="title2" tone="ink" style={styles.center}>
            {thinks.text}
          </Text>
        </View>
        {hold ? <PlanHoldNote org={org} /> : null}
        {!allowed ? (
          <Note icon="lock">{t("agentPage.lock.admins")}</Note>
        ) : loading ? (
          <ActivityIndicator color={c.muted} style={styles.loading} />
        ) : !view ? (
          <Note icon="x">{t("common.loadFailed")}</Note>
        ) : (
          <>
            {/* What it thinks with, as the web's select says it: a tap opens the list of what it may think with. */}
            <GroupedList>
              {current ? (
                <GroupedRow
                  leading={<ProviderLogo id={current.mark} size="sm" />}
                  label={current.label}
                  {...(rowLine(current) ? { sub: rowLine(current) } : {})}
                  chevron
                  disabled={picking}
                  onPress={() => openAgentAiPick(agentId)}
                />
              ) : (
                <GroupedRow
                  icon="sparkle"
                  label={t("aiSelect.placeholder")}
                  chevron
                  onPress={() => openAgentAiPick(agentId)}
                />
              )}
            </GroupedList>
            {note && note.action?.kind !== "confirm" ? (
              <>
                <Note icon={NOTE_ICONS[note.icon]}>{note.text}</Note>
                {note.action?.kind === "signIn" ||
                note.action?.kind === "newKey" ||
                note.action?.kind === "signInFor" ? (
                  <GroupedList>
                    <GroupedRow icon="plus" label={note.action.label} chevron onPress={signIn} />
                  </GroupedList>
                ) : null}
              </>
            ) : null}
            {current?.kind === "antigravity" && geminiPersonal(account) ? (
              <Note icon="info">{t("connectAi.plan.gemini.warning")}</Note>
            ) : null}
            {onPlan ? (
              <>
                <GroupedHeader>{t("agentPage.work.brain.planModel")}</GroupedHeader>
                <GroupedList>
                  <GroupedRow
                    label={model?.label ?? view.effectiveModel ?? ""}
                    {...(model?.sub ? { sub: model.sub } : {})}
                    {...(model?.needs ? { belowText: t(`brain.modelHow.${model.needs}`) } : {})}
                    chevron
                    onPress={() => openAgentModel(agentId)}
                  />
                </GroupedList>
                {modelLimit ? <GroupedFooter>{modelLimit}</GroupedFooter> : null}
              </>
            ) : null}
            {onPlan && view.scope !== "mine" ? (
              <View style={styles.gap}>
                <PlanReplies
                  agent={name}
                  {...(whose ? { owner: whose } : {})}
                  on={!view.onlyOwner}
                  onChange={async (on) => {
                    // Opening someone else's plan to more people asks first (its owner gets an email).
                    if (on && !(await ask(EVERYONE_AUDIENCE)([]))) return;
                    void save(
                      { onlyOwner: !on },
                      t(on ? "aiAccounts.share.savedEveryone" : "aiAccounts.share.savedOwner", g),
                    );
                  }}
                  brain={view.brain as "claude_code"}
                  plan={signInPlan(view, computerRow, view.brain as MachineAccountKind)}
                  coding={planOf(account?.provider)}
                  disabled={busy}
                />
              </View>
            ) : null}
            {usage ? (
              <>
                <GroupedHeader>{t("agentPage.tabs.usage")}</GroupedHeader>
                <GroupedList>
                  <View style={styles.meter}>
                    <PlanMeter usage={usage} />
                  </View>
                  {offer ? (
                    <GroupedRow
                      leading={<ProviderLogo id={offer.account.provider ?? offer.account.kind} size="sm" />}
                      label={
                        offer.used === null
                          ? t("aiAccounts.usage.offer.useUnknown", { label: offer.account.label })
                          : t("aiAccounts.usage.offer.use", { label: offer.account.label, pct: offer.used })
                      }
                      disabled={picking}
                      onPress={() => {
                        const row = rows.find((r) => r.value === offer.account.id);
                        if (row) pick(row);
                      }}
                    />
                  ) : null}
                </GroupedList>
              </>
            ) : null}
            <AdvancedInline agentId={agentId} view={view} {...(agentModel ? { model: agentModel } : {})} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** How far the dock travels to leave the screen, past its own height. */
const DOCK_OUT = 28;
const DOCK_SPRING = { stiffness: 240, damping: 26, mass: 1 };

/**
 * The effort, floating over the model list in the thumb's reach, whatever is scrolled under it. It slides away with
 * "Automático", which picks the effort too.
 */
function EffortDock({ agentId, shown, onHeight }: { agentId: string; shown: boolean; onHeight: (h: number) => void }) {
  const { colors, shadows } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const { orgId } = useOrg();
  const view = useAgentBrain(orgId, agentId).data;
  const levels = view && view.brain !== "model" ? effortLevels(view.brain, view.effectiveModel) : [];
  const saved = view ? advancedOf(view).effort : undefined;
  const effort = useEffortChoice(agentId, saved && levels.includes(saved) ? saved : undefined);
  const out = useSharedValue(shown ? 0 : 1);
  const height = useSharedValue(0);
  useEffect(() => {
    out.value = reduced ? (shown ? 0 : 1) : withSpring(shown ? 0 : 1, DOCK_SPRING);
  }, [shown, reduced, out]);
  const slid = useAnimatedStyle(() => ({
    transform: [{ translateY: out.value * (height.value + insets.bottom + DOCK_OUT) }],
  }));
  return (
    <Animated.View
      pointerEvents={shown ? "auto" : "none"}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      onLayout={(e) => {
        height.value = e.nativeEvent.layout.height;
        onHeight(e.nativeEvent.layout.height);
      }}
      style={[styles.dock, { bottom: insets.bottom + 8, boxShadow: shadows.e2 }, slid]}
    >
      <Glass liquid intensity={70} style={[styles.dockGlass, { borderColor: colors.line2 }]}>
        <EffortRamp
          value={effort.value}
          onChange={effort.change}
          levels={levels}
          color={agentLook(dir.agentById.get(agentId)).color}
          disabled={view?.canEdit !== true}
        />
      </Glass>
    </Animated.View>
  );
}

/**
 * The agent's model, pushed from its AI ("Modelo"): Automático, or one of its brain's models (every model of its
 * coding plan, with what each is sold as), and with a fixed model how hard it thinks. A tap saves at once.
 */
export function AgentModelScreen({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const g = agentGrammar(dir.agentById.get(agentId)?.name ?? "");
  const brain = useAgentBrain(orgId, agentId);
  const { busy, save } = useSaveBrain(agentId);
  // Opened straight from a link too: the plans' lists come with it.
  useModels();
  const view = brain.data;
  const plan = view ? brainPlan(view) : undefined;
  const rows = view ? modelRows(t, view, plan) : [];
  const freeHint = planFreeHint(t, plan);
  // A model without a maker of its own wears its plan's mark, else its brain's.
  const mark = (plan && view?.accounts.find((a) => a.id === view.account)?.provider) || (view?.brain ?? "");
  const hasModels = view !== undefined && view.brain !== "model";
  // The ramp floats over the list for a model with a few levels; more, and they are a list in Configuração avançada.
  const levels = hasModels ? effortLevels(view.brain, view.effectiveModel) : [];
  const fixed = hasModels && !isAuto(view.effectiveModel) && levels.length > 0 && levels.length <= EFFORT_RAMP_MAX;
  const [dock, setDock] = useState(0);
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("agentPage.work.brain.planModel")} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.in, { paddingBottom: insets.bottom + 24 + (fixed ? dock : 0) }]}
      >
        {brain.isPending ? (
          <ActivityIndicator color={c.muted} style={styles.loading} />
        ) : !view || view.brain === "model" ? (
          <Note icon="x">{t("common.loadFailed")}</Note>
        ) : (
          modelSections(rows).map((s) => (
            <Fragment key={s.maker ?? ""}>
              {s.maker ? <GroupedHeader>{providerLabel(s.maker)}</GroupedHeader> : null}
              <GroupedList>
                {s.rows.map((r) => (
                  <GroupedRow
                    key={r.value}
                    label={r.label}
                    {...(r.sub ? { sub: r.sub } : {})}
                    {...(r.note ? { hint: { name: t("common.about", { label: r.label }), text: r.note } } : {})}
                    {...(isAuto(r.value)
                      ? { icon: "sparkle" as const }
                      : { leading: <ProviderLogo id={r.maker ?? mark} size="sm" /> })}
                    checked={r.checked}
                    disabled={busy || !view.canEdit}
                    onPress={() => {
                      if (r.checked) return;
                      const ai = aiChoiceOf(view);
                      const done = t("agentPage.work.saved.brain", {
                        ...g,
                        brain: ai === "key" ? r.label : thinksWith(t, ai, r.label),
                      });
                      void save(modelInput(r.value, view), done);
                    }}
                  />
                ))}
              </GroupedList>
            </Fragment>
          ))
        )}
        {view && freeHint ? <Note icon="info">{freeHint}</Note> : null}
      </ScrollView>
      {hasModels ? <EffortDock agentId={agentId} shown={fixed} onHeight={setDock} /> : null}
    </View>
  );
}

/** The note's icon, as the web's says it, in the phone's set. */
const NOTE_ICONS: Record<AiNote["icon"], IconName> = {
  alert: "x",
  info: "info",
  clock: "clock",
  computer: "laptop",
  lock: "lock",
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 8 },
  hero: { alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 4 },
  center: { textAlign: "center" },
  loading: { marginTop: 16 },
  meter: { paddingHorizontal: 14, paddingVertical: 12 },
  // A list without a header keeps a header's room above it.
  gap: { marginTop: 20 },
  dock: { position: "absolute", left: 10, right: 10, borderRadius: 28 },
  dockGlass: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
