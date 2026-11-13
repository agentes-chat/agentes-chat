import type { Agent, AgentBrain, AgentBrainInput } from "@agenteschat/client";
import {
  agentStateIn,
  keys,
  useAgentBrain,
  useApi,
  useCredentials,
  useModels,
  usePlatformKey,
  useUpdateAgent,
} from "@agenteschat/client";
import { EFFORT_LEVELS, type EffortLevel, effortLevel } from "@agenteschat/client/lib/brain-advanced";
import { modelInput, modelRowOptions, modelRows } from "@agenteschat/client/lib/brain-picker";
import { errorText } from "@agenteschat/client/lib/errors";
import { shortModel } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import { brainPlan } from "@agenteschat/client/lib/plans";
import { AUTO, isAuto, modelChoices } from "@agenteschat/client/lib/providers";
import { Icon, Popover, ProviderLogo, Segmented } from "@agenteschat/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelSelect, modelOptions } from "@/components/AgentFields";
import { useOrg } from "@/components/org-context";
import { useAgentThinks } from "@/hooks/useAgentThinks";
import { useToast } from "@/lib/toast";
import { useStreams } from "@/realtime/context";

/*
 * The model and the effort right in a DM's side panel (ADR 0032 §5, addendum 2026-11-12): what the agent page's
 * "Quem pensa" keeps a few screens deep, one control each, saved as soon as it is picked. Only for whoever may change
 * the agent (an admin, its owner) and only where its brain says so (`canEdit`), under the "Pensa com" line everyone
 * reads. The account, the computer and the rest stay on the agent's page.
 */

/**
 * The agent's brain when the viewer may change it here, else null: only an admin or the agent's owner loads it (as
 * the agent's page does), and the server's `canEdit` has the last word.
 */
export function useEditableBrain(agent: Agent): AgentBrain | null {
  const { org, me } = useOrg();
  const may = can(org, "manage_agents") || agent.ownerUserId === me.user.id;
  const view = useAgentBrain(org.id, agent.id, may).data;
  return may && view?.canEdit ? view : null;
}

export function ThinksPicker({ agent, view }: { agent: Agent; view: AgentBrain }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useUpdateAgent(org.id, agent.id);
  const models = useModels();
  const credentials = useCredentials(org.id, can(org, "manage_credentials"));
  const platform = usePlatformKey(org.id);
  const busy = useStreams((s) => agentStateIn(s, agent.id) !== "idle");
  const [saving, setSaving] = useState(false);
  // What was just picked, shown until the saved brain comes back with it.
  const [picked, setPicked] = useState<{ model?: string; effort?: EffortLevel }>({});

  const refresh = () =>
    Promise.all(
      [keys.agentBrain(org.id, agent.id), keys.agents(org.id), keys.aiStatus(org.id)].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
  const failed = (e: unknown) => {
    setPicked({});
    toast.show(errorText(t, e), "error");
  };
  const setBrain = (input: AgentBrainInput, shown: typeof picked) => {
    setPicked(shown);
    setSaving(true);
    void api.agents
      .setBrain(org.id, agent.id, input)
      .then((next) => {
        qc.setQueryData(keys.agentBrain(org.id, agent.id), next);
        return refresh();
      })
      .then(() => setPicked({}))
      .catch(failed)
      .finally(() => setSaving(false));
  };

  const throughKey = view.brain === "model";
  let model: ReactNode;
  if (throughKey) {
    // Through a key: the workspace's models, Automático first, the one it has kept where the list lacks it.
    const list = modelOptions(
      t,
      i18n.language,
      modelChoices(models.data?.models ?? [], credentials.data ?? [], platform.data ?? false),
    );
    const value = picked.model ?? agent.model;
    model = (
      <ModelSelect
        className="dm-side__pick-model"
        aria-label={t("agentPage.work.brain.planModel")}
        value={value}
        disabled={saving}
        onChange={(next) => {
          if (next === agent.model) return;
          setPicked({ model: next });
          setSaving(true);
          update.mutate(
            { model: next },
            {
              onSuccess: () => void refresh().then(() => setPicked({})),
              onError: failed,
              onSettled: () => setSaving(false),
            },
          );
        }}
        options={[
          { value: AUTO, label: t("brain.auto.label"), description: t("brain.auto.hint") },
          ...(isAuto(agent.model) || list.some((o) => o.value === agent.model)
            ? []
            : [{ value: agent.model, label: agent.model }]),
          ...list,
        ]}
      />
    );
  } else {
    // A plan on a computer: its brain's models (the plan's, with what each is sold as), as on the agent's page.
    const rows = modelRows(t, view, brainPlan(view));
    const chosen = rows.find((r) => r.checked)?.value ?? AUTO;
    model = (
      <ModelSelect
        className="dm-side__pick-model"
        aria-label={t("agentPage.work.brain.planModel")}
        value={picked.model ?? chosen}
        disabled={saving}
        onChange={(next) => next !== chosen && setBrain(modelInput(next, view), { model: next })}
        options={modelRowOptions(rows)}
      />
    );
  }
  // The effort is the plan's ramp: none through a key, and "Automático" picks it too.
  const modelNow = picked.model ?? (throughKey ? agent.model : (view.effectiveModel ?? ""));
  const effortShown = !throughKey && !isAuto(modelNow);
  const effort = picked.effort ?? effortLevel(view.effort);
  return (
    <div className="dm-side__pick">
      <span className="dm-side__pick-label">{t("agentPage.work.brain.planModel")}</span>
      {model}
      {effortShown && (
        <>
          <span className="dm-side__pick-label">{t("agentPage.work.brain.effort")}</span>
          <Segmented
            size="sm"
            label={t("agentPage.work.brain.effort")}
            value={effort}
            onValueChange={(next) => next !== effort && setBrain({ effort: next }, { ...picked, effort: next })}
            options={EFFORT_LEVELS.map((e) => ({ value: e, label: t(`agentPage.work.brain.efforts.${e}`) }))}
          />
        </>
      )}
      {busy && <p className="dm-side__pick-note">{t("agentSide.pickNextRun")}</p>}
    </div>
  );
}

/*
 * VPS Zen: the same picker from the composer of a DM with the agent (or of a draft that names it). The chip says
 * what thinks now (the provider's mark, the model's short name and the effort); a click opens `ThinksPicker`.
 * Only for whoever may change the agent, as in the side panel; nobody else sees a chip.
 */
export function ComposerBrainChip({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const view = useEditableBrain(agent);
  const thinks = useAgentThinks(agent);
  const [open, setOpen] = useState(false);
  if (!view) return null;
  const model = view.brain === "model" ? (thinks?.text ?? agent.model) : (view.effectiveModel ?? thinks?.text ?? "");
  const short = shortModel(model.replace(/^claude-/i, "").replace(/-\d{8}$/, ""));
  const auto = isAuto(view.brain === "model" ? agent.model : (view.model ?? ""));
  const effort = view.brain !== "model" && !auto ? effortLevel(view.effort) : null;
  const mark = thinks?.mark ?? view.brain;
  return (
    <Popover
      label={t("agentPage.work.brain.planModel")}
      side="top"
      align="start"
      className="composer-brain__pop"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="ac-composer__pill composer-brain"
          aria-label={`${t("agentPage.work.brain.planModel")}: ${short}${effort ? `, ${t(`agentPage.work.brain.efforts.${effort}`)}` : ""}`}
        >
          <ProviderLogo id={mark} size="xs" />
          <span className="ac-composer__pill-text">{auto ? t("brain.auto.label") : short}</span>
          {effort && <span className="composer-brain__effort">{t(`agentPage.work.brain.effortsLower.${effort}`)}</span>}
          <Icon name="chevronDown" size={14} />
        </button>
      }
    >
      <div className="composer-brain__body dm-side">
        <ThinksPicker agent={agent} view={view} />
      </div>
    </Popover>
  );
}
