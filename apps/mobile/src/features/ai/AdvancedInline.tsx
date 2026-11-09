import type { AgentBrain, AgentBrainInput, BrainSpeed } from "@agenteschat/client";
import { keys, useApi, useModels } from "@agenteschat/client";
import {
  type Advanced,
  advancedDefaults,
  advancedSummary,
  EFFORT_RAMP_MAX,
  effortLevel,
  effortLevels,
  isAdvancedDefault,
  SPEEDS,
  shownEffort,
  viewSpeedFits,
} from "@agenteschat/client/lib/brain-advanced";
import { type ContextLimit, contextChoices, contextSize, isContextLimit } from "@agenteschat/client/lib/context-limits";
import { isAuto } from "@agenteschat/client/lib/providers";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { GroupedHeader, GroupedList, GroupedRow, useToast } from "@/ui";
import { useDirectory } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { EffortRamp, useBrainChoice, useEffortChoice } from "./EffortRamp";

/*
 * An agent's "Configuração avançada" on the phone (ADR 0086), in place under "Pensa com" as on the web: a row that
 * says what differs from the defaults and opens under itself how it thinks (the model's own effort levels: a ramp up
 * to `EFFORT_RAMP_MAX` of them, a list past that, or the line that says "Automático" picks it; Velocidade where it
 * applies; the context window, any brain) and "Voltar ao padrão". Each choice saves at once.
 */

/** What the agent's view says for the advanced settings (a limit past its model's window reads as none). */
export const advancedOf = (view: AgentBrain, options?: readonly ContextLimit[]): Advanced => {
  const tokens = isContextLimit(view.contextTokens) ? view.contextTokens : null;
  return {
    effort: effortLevel(view.effort),
    speed: viewSpeedFits(view) ? view.speed : "standard",
    contextTokens: tokens !== null && (!options || options.includes(tokens)) ? tokens : null,
  };
};

/** `model`: the agent's API model, on the API brain. */
export function AdvancedInline({ agentId, view, model }: { agentId: string; view: AgentBrain; model?: string }) {
  const { t, i18n } = useTranslation();
  const { orgId } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const dir = useDirectory();
  const agent = dir.agentById.get(agentId);
  const models = useModels();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const apiModel = model ?? agent?.model;
  const autoModel = view.brain === "model" ? isAuto(apiModel) : isAuto(view.effectiveModel);
  const levels = view.brain === "model" ? [] : effortLevels(view.brain, view.effectiveModel);
  // The sizes under the window of the model it thinks with ("Automático": any of its line).
  const options =
    view.brain === "model"
      ? contextChoices(autoModel ? undefined : models.data?.models.find((m) => m.id === apiModel))
      : contextChoices(
          autoModel
            ? undefined
            : view.options.find((o) => o.kind === view.brain)?.models.find((m) => m.value === view.effectiveModel),
        );
  const now = advancedOf(view, options);
  const may = !busy && view.canEdit;
  const effort = useEffortChoice(agentId, shownEffort(view.effort, levels));
  const speed = useBrainChoice<BrainSpeed>(agentId, now.speed, (value) => ({ speed: value }));
  const summary = advancedSummary(t, i18n.language, { kind: view.brain, autoModel, now });

  /** Saves at once and says what the row will say now. */
  const save = async (input: AgentBrainInput) => {
    setBusy(true);
    try {
      const next = await api.agents.setBrain(orgId, agentId, input);
      qc.setQueryData(keys.agentBrain(orgId, agentId), next);
      toast({
        title: advancedSummary(t, i18n.language, { kind: next.brain, autoModel, now: advancedOf(next, options) }),
        icon: "check",
      });
    } catch {
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    } finally {
      for (const key of [keys.agentBrain(orgId, agentId), keys.agents(orgId)])
        void qc.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  };
  const putBack = () => {
    const to = advancedDefaults(view.brain, now);
    void save({
      contextTokens: to.contextTokens,
      ...(view.brain === "model"
        ? {}
        : { ...(autoModel ? {} : { effort: to.effort }), ...(to.speed !== now.speed ? { speed: to.speed } : {}) }),
    });
  };
  const computer = view.brain !== "model";
  const ramp = computer && !autoModel && levels.length > 0 && levels.length <= EFFORT_RAMP_MAX;
  const list = computer && !autoModel && levels.length > EFFORT_RAMP_MAX;

  return (
    <View style={styles.gap}>
      <GroupedList>
        <GroupedRow
          label={t("agentPage.work.brain.advanced.title")}
          sub={summary}
          subLines={2}
          menu
          onPress={() => setOpen((o) => !o)}
        />
        {open && computer && autoModel ? (
          // "Automático" picks the effort too: said where the effort would be.
          <GroupedRow
            label={t("agentPage.work.brain.effort")}
            sub={t("agentPage.work.brain.effortText.auto")}
            subLines={2}
          />
        ) : null}
        {open && ramp ? (
          <View style={styles.ramp}>
            <EffortRamp
              value={effort.value}
              onChange={effort.change}
              levels={levels}
              color={agentLook(agent).color}
              disabled={!view.canEdit}
            />
          </View>
        ) : null}
      </GroupedList>
      {open && list ? (
        <>
          <GroupedHeader>{t("agentPage.work.brain.effort")}</GroupedHeader>
          <GroupedList>
            {levels.map((e) => (
              <GroupedRow
                key={e}
                label={t(`agentPage.work.brain.efforts.${e}`)}
                sub={t(`agentPage.work.brain.effortText.${e}`)}
                subLines={2}
                checked={effort.value === e}
                disabled={!view.canEdit}
                onPress={() => e !== effort.value && effort.change(e)}
              />
            ))}
          </GroupedList>
        </>
      ) : null}
      {open && viewSpeedFits(view) ? (
        <>
          <GroupedHeader
            hint={{
              name: t("common.about", { label: t("agentPage.work.brain.speed") }),
              text: t("agentPage.work.brain.speedText"),
            }}
          >
            {t("agentPage.work.brain.speed")}
          </GroupedHeader>
          <GroupedList>
            {SPEEDS.map((s) => (
              <GroupedRow
                key={s}
                label={t(`agentPage.work.brain.speeds.${s}`)}
                checked={speed.value === s}
                disabled={!view.canEdit}
                onPress={() => s !== speed.value && speed.change(s)}
              />
            ))}
          </GroupedList>
        </>
      ) : null}
      {open ? (
        <>
          <GroupedHeader>{t("agentPage.work.brain.context")}</GroupedHeader>
          <GroupedList>
            <GroupedRow
              label={t("brain.auto.label")}
              sub={t("agentPage.work.brain.contextText.auto")}
              checked={now.contextTokens === null}
              disabled={!may}
              onPress={() => now.contextTokens !== null && void save({ contextTokens: null })}
            />
            {options.map((n) => (
              <GroupedRow
                key={n}
                label={contextSize(n)}
                sub={t(`agentPage.work.brain.contextText.${n}`)}
                subLines={2}
                checked={now.contextTokens === n}
                disabled={!may}
                onPress={() => n !== now.contextTokens && void save({ contextTokens: n })}
              />
            ))}
          </GroupedList>
          <View style={styles.gap}>
            <GroupedList>
              <GroupedRow
                label={t("agentPage.work.brain.advanced.defaults")}
                disabled={!may || isAdvancedDefault(view.brain, now)}
                onPress={putBack}
              />
            </GroupedList>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A list without a header keeps a header's room above it.
  gap: { marginTop: 20 },
  // On the rows' 14 pt edge.
  ramp: { paddingHorizontal: 14, paddingVertical: 12 },
});
