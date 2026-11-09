import type { AgentBrain, Credential } from "@agenteschat/client";
import {
  keys,
  useAgentBrain,
  useAgentDetail,
  useAiAccounts,
  useAiStatus,
  useApi,
  useCredentials,
  useModels,
  usePlatformKey,
  useSettings,
} from "@agenteschat/client";
import {
  AI_ROW_GROUPS,
  type AiRow,
  aiRowGroupLabel,
  aiRowLine,
  aiRows,
  currentValue,
} from "@agenteschat/client/lib/ai-select";
import { computerNameOf } from "@agenteschat/client/lib/computer";
import { keyRefusal } from "@agenteschat/client/lib/errors";
import { firstName } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { planOfAccount } from "@agenteschat/client/lib/no-ai";
import { can } from "@agenteschat/client/lib/permissions";
import { AUTO, keyRuns } from "@agenteschat/client/lib/providers";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, ProviderLogo, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useColors, useDirectory } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { openConnectAi } from "./NoAiCard";
import { useAiOrg } from "./org";
import { Note, usePlanHold } from "./parts";

/*
 * What an agent thinks with on the phone: the web's AI select as a pushed list ("Quem pensa"), the same rows in the
 * same groups (the viewer's plans, other people's plans, the workspace's API keys), each saying whose it is and how it
 * stands, then "Conectar outra IA". A tap saves at once and goes back, with Desfazer in its toast; a lent plan or a
 * login another agent has asks first.
 */

/** Opens the list of what an agent may think with. */
export const openAgentAiPick = (agentId: string) => router.push(`/agent-ai-pick/${agentId}` as never);

/** The agent's AI rows (`aiRows`), the one it thinks with now, and what the rows are read with. */
export function useAiRowsOf(agentId: string, enabled = true) {
  const { t, i18n } = useTranslation();
  const { orgId, org } = useAiOrg();
  const dir = useDirectory();
  const agent = dir.agentById.get(agentId);
  const brain = useAgentBrain(orgId, agentId, enabled);
  const view = brain.data;
  const detail = useAgentDetail(orgId, agentId, enabled);
  const ai = useAiAccounts(orgId, enabled);
  const listKeys = org ? can(org, "manage_credentials") : false;
  const credentials = useCredentials(orgId, enabled && listKeys);
  const settings = useSettings(orgId);
  const platform = usePlatformKey(orgId);
  const status = useAiStatus(orgId);
  const hold = usePlanHold(orgId, org);
  const computerName = computerNameOf(t, org?.name ?? "", view?.computer?.name ?? "");
  const agentKey = detail.data?.credentialId ?? null;
  const computerRow = ai.data?.computers.find((c) => c.machineId === view?.computer?.machineId);
  const rows = view
    ? aiRows(t, i18n.language, {
        view,
        computer: computerRow,
        computerName,
        agentName: agent?.name ?? "",
        agentOwnerId: agent?.ownerUserId ?? null,
        keys: listKeys ? (credentials.data ?? []) : null,
        defaultKey: settings.data?.defaultCredentialId ?? null,
        serverKey: platform.data === true,
        apiKey: status.data?.apiKey !== false,
        keysAllowed: !hold && view.scope !== "mine" && (view.canUsePlans || (org ? can(org, "manage_agents") : false)),
        agentKey,
      })
    : [];
  const current = view ? rows.find((r) => r.value === currentValue(view, agentKey)) : undefined;
  return {
    agent,
    view,
    rows,
    current,
    loading: brain.isPending,
    computerName,
    hold,
    credentials: credentials.data ?? [],
    defaultKey: settings.data?.defaultCredentialId ?? null,
    agentKey,
    agentModel: detail.data?.model,
    computerRow,
  };
}

/** Line 2 of a row: whose or where, then how it stands. */
export const rowLine = (row: AiRow) => aiRowLine(row) || undefined;

/**
 * Thinks with a row now, said in a toast with Desfazer: a plan's account or the computer's own sign-in, or the API with
 * a workspace key (tried first: "now thinks with it" has to be true).
 */
export function useAiPick(agentId: string) {
  const { t } = useTranslation();
  const { orgId } = useAiOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const models = useModels().data?.models ?? [];
  const { agent, view, credentials, defaultKey, agentKey, agentModel } = useAiRowsOf(agentId);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    for (const key of [
      keys.agentBrain(orgId, agentId),
      keys.agentDetail(orgId, agentId),
      keys.agents(orgId),
      keys.aiAccounts(orgId),
      keys.aiStatus(orgId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  const restore = async (before: AgentBrain, key: string | null, model: string | undefined) => {
    if (before.brain === "model") {
      await api.agents.setBrain(orgId, agentId, { brain: "model" });
      await api.agents.update(orgId, agentId, { credentialId: key, ...(model ? { model } : {}) });
    } else
      await api.agents.setBrain(orgId, agentId, {
        brain: before.brain,
        account: before.account,
        model: before.model,
        onlyOwner: before.onlyOwner,
      });
  };
  const think = async (row: AiRow, move = false): Promise<boolean> => {
    if (!view || !agent) return false;
    const g = agentGrammar(agent.name);
    const before = view;
    setBusy(true);
    try {
      let onlyNow = false;
      if (row.group === "keys") {
        if (row.key) await api.agents.checkCredential(orgId, row.key);
        if (view.brain !== "model") await api.agents.setBrain(orgId, agentId, { brain: "model" });
        const k: Credential | undefined = credentials.find((c) => c.id === (row.key ?? defaultKey));
        const fits = !k || keyRuns(k, agentModel, models);
        await api.agents.update(orgId, agentId, { credentialId: row.key ?? null, ...(fits ? {} : { model: AUTO }) });
      } else {
        const next = await api.agents.setBrain(orgId, agentId, {
          brain: row.kind,
          account: row.account?.id ?? null,
          ...(move ? { moveAccount: true } : {}),
        });
        onlyNow = next.onlyOwner && !view.onlyOwner;
      }
      refresh();
      if (row.group === "keys" && view.brain !== "model" && view.onlyOwner && view.scope !== "mine") {
        // Off the plan it still answers only its owner: one tap lets back in whoever it answered before.
        // "Só algumas pessoas ou papéis" with nobody picked has no one to let back in: no such action.
        const people = (agent.audience?.userIds?.length ?? 0) + (agent.audience?.roleIds?.length ?? 0);
        toast({
          title: t("aiAccounts.share.backOnApi", g),
          icon: "info",
          ...(agent.audience?.mode === "people" && people === 0
            ? {}
            : {
                action: {
                  label: t(people ? "aiAccounts.share.letPeople" : "aiAccounts.share.letEveryone", g),
                  onPress: () =>
                    void api.agents
                      .setBrain(orgId, agentId, { onlyOwner: false })
                      .then(refresh, () => toast({ title: t("agentPage.work.failed"), icon: "x" })),
                },
              }),
        });
        return true;
      }
      toast({
        title: t(onlyNow ? "agentPage.work.saved.brainOwner" : "agentPage.work.saved.brain", {
          ...g,
          brain: row.label,
          owner: view.canUsePlans ? t("common.you") : firstName(row.account?.ownerName ?? ""),
        }),
        icon: "check",
        action: {
          label: t("aiSelect.undo"),
          onPress: () =>
            void restore(before, agentKey, agentModel).then(refresh, () =>
              toast({ title: t("agentPage.work.failed"), icon: "x" }),
            ),
        },
      });
      return true;
    } catch (error) {
      toast({ title: keyRefusal(t, error)?.text ?? t("agentPage.work.failed"), icon: "x" });
      refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };
  /**
   * A tap on a row: a lent plan or a move asks first (its owner hears of it; the other agent stops), a row waiting for a
   * sign-in opens its steps, anything else thinks at once. `done`: it thinks with it now.
   */
  const pick = (row: AiRow, done?: () => void) => {
    if (!agent || !view || row.disabled || busy) return;
    // What it thinks with already: nothing to save.
    if (row.act === "use" && row.value === currentValue(view, agentKey)) return done?.();
    const go = (move = false) => void think(row, move).then((ok) => ok && done?.());
    if (row.act === "signIn") {
      const plan = row.account ? planOfAccount(row.account) : undefined;
      return openConnectAi({
        agentId,
        ...(plan ? { plan } : {}),
        // A signed-out login signs in again as itself; one other agents think with gets one more login.
        ...(row.account?.status === "signed_out" ? { again: row.account.id } : {}),
        ...(row.account?.email ? { email: row.account.email } : {}),
      });
    }
    if (row.act === "lend" && row.owner) {
      return Alert.alert(row.label, t("aiSelect.lent", { owner: row.owner }), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("aiSelect.useLent", { owner: row.owner }), onPress: () => go() },
      ]);
    }
    if (row.act === "move") {
      const other = row.account?.usedBy.find((n) => n !== agent.name) ?? "";
      return Alert.alert(row.label, t("aiSelect.move", { agent: other }), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("aiSelect.moveTo", agentGrammar(agent.name)), onPress: () => go(true) },
      ]);
    }
    go();
  };
  return { pick, busy };
}

/** A row of the list: its logo, its name, line 2, an ⓘ with who else thinks with it, the check on the one it uses. */
export function AiPickRow({
  row,
  checked,
  disabled,
  chevron,
  onPress,
}: {
  row: AiRow;
  checked?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const sub = rowLine(row);
  return (
    <GroupedRow
      leading={<ProviderLogo id={row.mark} size="sm" off={row.disabled} />}
      label={row.label}
      {...(sub ? { sub } : {})}
      {...(row.hint ? { hint: { name: t("common.about", { label: row.label }), text: row.hint } } : {})}
      {...(checked !== undefined ? { checked } : {})}
      {...(chevron ? { chevron } : {})}
      disabled={disabled || row.disabled}
      onPress={onPress}
    />
  );
}

/** The groups of the list, each under its heading, in the select's order. */
export function AiPickGroups({
  rows,
  value,
  disabled,
  onPick,
  onConnect,
}: {
  rows: readonly AiRow[];
  value: string | undefined;
  disabled?: boolean;
  onPick: (row: AiRow) => void;
  onConnect?: () => void;
}) {
  const { t } = useTranslation();
  const groups = AI_ROW_GROUPS.filter((g) => rows.some((r) => r.group === g));
  return (
    <>
      {groups.map((g) => (
        <View key={g}>
          <GroupedHeader>{aiRowGroupLabel(t, g)}</GroupedHeader>
          <GroupedList>
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <AiPickRow
                  key={r.value}
                  row={r}
                  checked={r.value === value}
                  disabled={disabled}
                  onPress={() => onPick(r)}
                />
              ))}
          </GroupedList>
          {g === "others" ? <GroupedFooter>{t("agentPage.work.brain.accountOthers")}</GroupedFooter> : null}
        </View>
      ))}
      {onConnect ? (
        <View style={styles.gap}>
          <GroupedList>
            <GroupedRow
              icon="plus"
              label={t("aiSelect.connect")}
              sub={t("aiSelect.connectLine")}
              chevron
              disabled={disabled}
              onPress={onConnect}
            />
          </GroupedList>
        </View>
      ) : null}
    </>
  );
}

/** "Quem pensa" on the phone: the list, the current one checked; a tap saves and goes back. */
export function AgentAiPickScreen({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { view, rows, current, loading } = useAiRowsOf(agentId);
  const { pick, busy } = useAiPick(agentId);
  const back = () => {
    if (router.canGoBack()) router.back();
  };
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("brain.title")} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.in, { paddingBottom: insets.bottom + 24 }]}
      >
        {loading ? (
          <ActivityIndicator color={c.muted} style={styles.loading} />
        ) : !view ? (
          <Note icon="x">{t("common.loadFailed")}</Note>
        ) : (
          <AiPickGroups
            rows={rows}
            value={current?.value}
            disabled={busy}
            onPick={(r) => (r.value === current?.value ? back() : pick(r, back))}
            onConnect={
              view.canUsePlans || view.canManageAccounts ? () => openConnectAi({ agentId, intent: "other" }) : undefined
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 8 },
  loading: { marginTop: 16 },
  // A list without a header keeps a header's room above it.
  gap: { marginTop: 20 },
});
