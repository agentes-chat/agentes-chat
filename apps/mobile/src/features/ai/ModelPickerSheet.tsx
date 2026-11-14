import type { Agent, AgentBrain, AgentBrainInput } from "@agenteschat/client";
import {
  keys,
  useAgentBrain,
  useAiStatus,
  useApi,
  useCredentials,
  useModels,
  usePlatformKey,
  useUpdateAgent,
} from "@agenteschat/client";
import { agentThinks } from "@agenteschat/client/lib/brain";
import { EFFORT_LEVELS, type EffortLevel } from "@agenteschat/client/lib/brain-advanced";
import {
  mayPickModel,
  modelPickerModels,
  modelPickerSave,
  modelPickerTiles,
  modelPickerUndo,
  type PickerModel,
} from "@agenteschat/client/lib/brain-picker";
import { can } from "@agenteschat/client/lib/permissions";
import { planMeterText } from "@agenteschat/client/lib/plan-usage";
import { modelChoices } from "@agenteschat/client/lib/providers";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import { planLine } from "@agenteschat/ui/plan-state";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Sky } from "@/sky/Sky";
import { GroupedList, GroupedRow, IconButton, ProviderLogo, Text, useToast } from "@/ui";
import { useColors, useDirectory, useMeId } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { type SheetHost, useSheetIfAny } from "../shared/SheetHost";
import { openAgentAi } from "./AgentAiScreen";
import { EffortRamp } from "./EffortRamp";

/*
 * The web's model picker on the phone, as a sheet from the DM's header: the agent's sky, one logo tile per AI (they
 * wrap, never scroll), the AI's account and use, its models (Automático first, the one it runs checked, a refused
 * one dimmed), the effort ramp, and "Mais opções" to the agent's AI screen. A pick saves at once, with Desfazer.
 */

/** Who thinks for the agent (`agentThinks`), from the workspace's directory, models and AI status. */
export function useAgentThinks(agent: Agent | undefined) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const dir = useDirectory();
  const models = useModels();
  const status = useAiStatus(orgId).data;
  if (!agent) return null;
  const owner = agent.ownerUserId ? dir.memberById.get(agent.ownerUserId) : undefined;
  return agentThinks(t, agent, {
    owner: owner?.name.split(" ")[0],
    agents: dir.agents,
    models: models.data?.models ?? [],
    ...(status ? { status } : {}),
  });
}

/**
 * The DM header's button: the agent's AI's logo, opening the picker. Whoever can't change it gets the same logo, and a
 * press says who can.
 *
 * `host`: the conversation's own sheets. The button is drawn in the navigation bar, outside the screen and its sheet
 * host, so it can't find them itself: without them it told admins and owners too that only they change the model.
 */
export function DmModelButton({ agent, host }: { agent: Agent; host?: SheetHost }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const meId = useMeId();
  const here = useSheetIfAny();
  const sheet = host ?? here;
  const toast = useToast();
  const thinks = useAgentThinks(agent);
  if (!thinks?.text || isRightHand(agent)) return null;
  const mark = thinks.mark ? <ProviderLogo id={thinks.mark} size="sm" /> : undefined;
  if (!sheet || !mayPickModel(agent, meId, can(org, "manage_agents")))
    return (
      <IconButton
        icon="sparkle"
        {...(mark ? { mark } : {})}
        label={`${thinks.text}. ${t("brain.picker.readOnly")}`}
        onPress={() => toast({ title: thinks.text, subtitle: t("brain.picker.readOnly"), icon: "lock" })}
      />
    );
  return (
    <IconButton
      icon="sparkle"
      {...(mark ? { mark } : {})}
      label={t("brain.picker.open", { agent: agent.name })}
      onPress={() => sheet.open(<ModelPickerSheet agent={agent} />)}
    />
  );
}

export function ModelPickerSheet({ agent }: { agent: Agent }) {
  const { orgId } = useOrg();
  const c = useColors();
  const brain = useAgentBrain(orgId, agent.id);
  if (!brain.data) return <ActivityIndicator color={c.muted} style={styles.loading} />;
  return <PickerBody agent={agent} view={brain.data} />;
}

function PickerBody({ agent, view }: { agent: Agent; view: AgentBrain }) {
  const { t, i18n } = useTranslation();
  const { orgId, org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const sheet = useSheetIfAny();
  const c = useColors();
  const update = useUpdateAgent(orgId, agent.id);
  const models = useModels();
  const credentials = useCredentials(orgId, can(org, "manage_credentials"));
  const platform = usePlatformKey(orgId);
  const all = models.data?.models ?? [];
  const choices = modelChoices(all, credentials.data ?? view.keys ?? [], platform.data ?? false);
  const tiles = modelPickerTiles(t, view, agent.ownerUserId, choices, agent.model, all);
  const [tileKey, setTileKey] = useState(() => (tiles.find((x) => x.current) ?? tiles[0])?.key);
  const tile = tiles.find((x) => x.key === tileKey) ?? tiles[0];
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const account = tile?.accounts.find((a) => a.id === accountId) ?? tile?.accounts[0];
  const rows = tile ? modelPickerModels(t, i18n.language, view, tile, account, choices, agent.model) : [];
  const [busy, setBusy] = useState(false);
  const checked = rows.find((r) => r.checked);
  const effortOn = Boolean(tile?.current && tile.kind !== "model" && checked && !checked.auto);
  const effort: EffortLevel = (EFFORT_LEVELS as readonly string[]).includes(view.effort ?? "")
    ? (view.effort as EffortLevel)
    : "medium";
  const usage = account?.usage ?? null;
  const meter = usage ? planLine(usage, planMeterText(t, i18n.language)) : null;

  const refresh = () => {
    for (const key of [keys.agentBrain(orgId, agent.id), keys.agents(orgId), keys.aiStatus(orgId)])
      void qc.invalidateQueries({ queryKey: key });
  };
  const apply = async (brainInput: AgentBrainInput | null, model?: string) => {
    if (brainInput) await api.agents.setBrain(orgId, agent.id, brainInput);
    if (model !== undefined) await update.mutateAsync({ model });
  };
  const pick = async (row: PickerModel) => {
    if (!tile || busy || row.checked) return;
    const before = {
      brain: view.brain,
      account: view.account,
      model: view.model,
      effort: view.effort,
      apiModel: agent.model,
    };
    const saving = modelPickerSave(view, tile, account, row.value);
    setBusy(true);
    try {
      await apply(saving.brain, saving.model);
      sheet?.close();
      toast({
        title: t("brain.picker.saved", { agent: agent.name, model: row.label }),
        icon: "check",
        action: {
          label: t("brain.picker.undo"),
          onPress: () => {
            const undo = modelPickerUndo(before, saving);
            void apply(undo.brain, undo.model)
              .catch(() => toast({ title: t("agentPage.work.failed"), icon: "x" }))
              .finally(refresh);
          },
        },
      });
    } catch {
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    // The sheet scrolls and keeps its content 18 from its sides: no scroll view or side padding of its own here (with
    // both, the lists stood 34 in, a narrow column in a wide sheet).
    <View style={styles.in}>
      <View style={styles.sky}>
        <Sky color={agentLook(agent).color} surface="raised" style={StyleSheet.absoluteFill} />
        {tile ? (
          <View style={styles.mark}>
            <ProviderLogo id={tile.mark} size="tile" />
          </View>
        ) : null}
      </View>
      <View style={styles.tiles}>
        {tiles.map((x) => {
          const on = x.key === tile?.key;
          return (
            <Pressable
              key={x.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={x.name}
              onPress={() => {
                setTileKey(x.key);
                setAccountId(undefined);
              }}
              style={[styles.tile, { backgroundColor: on ? c.sunken : c.raised, borderColor: on ? c.ink : c.line2 }]}
            >
              <ProviderLogo id={x.mark} size="sm" />
            </Pressable>
          );
        })}
      </View>
      {tile ? (
        <View style={styles.head}>
          <Text variant="label">{[tile.name, account?.label].filter(Boolean).join(" · ")}</Text>
          {meter?.line ? (
            <Text variant="footnote" tone="muted">
              {[meter.line, meter.alert].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {tile && tile.accounts.length > 1 ? (
        <View style={styles.group}>
          <GroupedList>
            {tile.accounts.map((a) => (
              <GroupedRow
                key={a.id ?? "own"}
                label={a.label}
                checked={(account?.id ?? null) === a.id}
                onPress={() => setAccountId(a.id)}
              />
            ))}
          </GroupedList>
        </View>
      ) : null}
      <View style={styles.group}>
        <GroupedList>
          {rows.map((r) => (
            <GroupedRow
              key={r.value}
              label={r.label}
              sub={
                r.refused
                  ? t("brain.picker.refused")
                  : r.auto
                    ? r.sub
                    : r.textOnly
                      ? t("brain.picker.textOnly")
                      : undefined
              }
              value={r.auto ? t("brain.picker.default") : undefined}
              faint={r.refused}
              checked={r.checked}
              disabled={busy}
              onPress={() => void pick(r)}
            />
          ))}
        </GroupedList>
      </View>
      {effortOn && tile && tile.kind !== "model" ? (
        <View style={styles.group}>
          <EffortRamp
            value={effort}
            color={agentLook(agent).color}
            onChange={(e) =>
              void api.agents
                .setBrain(orgId, agent.id, { brain: tile.kind as AgentBrainInput["brain"], effort: e })
                .catch(() => toast({ title: t("agentPage.work.failed"), icon: "x" }))
                .finally(refresh)
            }
          />
        </View>
      ) : null}
      <Text variant="footnote" tone="muted" style={styles.applies}>
        {t("brain.picker.applies")}
      </Text>
      <GroupedList>
        <GroupedRow
          icon="brain"
          label={t("brain.picker.more")}
          chevron
          onPress={() => {
            sheet?.close();
            openAgentAi(agent.id);
          }}
        />
      </GroupedList>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 32 },
  in: { gap: 12 },
  sky: { height: 96, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  mark: { alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  head: { gap: 2 },
  group: { marginTop: 4 },
  applies: { paddingHorizontal: 4 },
});
