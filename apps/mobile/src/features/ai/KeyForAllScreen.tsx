import type { AgentSetup } from "@agenteschat/client";
import { keys, useAiAccounts, useApi, useSetupPreview } from "@agenteschat/client";
import { setupOutcome, takers } from "@agenteschat/client/lib/agent-setup";
import { type KeyModel, keyModelFirst, keyModelGroups } from "@agenteschat/client/lib/brain-picker";
import { planOf } from "@agenteschat/client/lib/plans";
import { providerLabel } from "@agenteschat/client/lib/providers";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import { Button, GroupedHeader, GroupedList, GroupedRow, ProviderLogo, Text, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useColors, useDirectory } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { Note } from "./parts";

/*
 * "Usar em todos os agentes" on the phone, the web's dialog on a coding plan key's row as a screen of its own: the
 * key's models in runs by what the key did with each (`keyModelGroups`), the one picked checked, then every agent that
 * may take it (the server's preview). "Usar" saves it like "Usar em outros agentes" (`applySetup`).
 */

/** Opens "Usar em todos os agentes" for a coding plan key account, on `model` when the key may run it. */
export const openKeyForAll = (machineId: string, accountId: string, model?: string) =>
  router.push(
    `/key-for-all/${accountId}?machineId=${encodeURIComponent(machineId)}${model ? `&model=${encodeURIComponent(model)}` : ""}` as never,
  );

export function KeyForAllScreen({
  accountId,
  machineId,
  model: preferred,
}: {
  accountId: string;
  machineId: string;
  model?: string | undefined;
}) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const dir = useDirectory();
  const ai = useAiAccounts(orgId);
  const account = ai.data?.accounts.find((a) => a.id === accountId && a.machineId === machineId);
  const plan = planOf(account?.provider);
  const groups = plan ? keyModelGroups(plan, account?.usage) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const usable = groups ? [...groups.works, ...groups.untested] : [];
  const model = picked ?? (groups ? keyModelFirst(groups, preferred) : "");
  const chosen = usable.find((m) => m.value === model);
  const setup: AgentSetup | null = account
    ? { brain: account.kind, machineId: account.machineId, account: account.id, model: model || null }
    : null;
  const preview = useSetupPreview(
    orgId,
    model ? setup : null,
    dir.agents.map((a) => a.id),
  );
  const can = takers(preview.data ?? []);
  const maker = plan?.maker ?? "";
  const row = (m: KeyModel, sub: string) => (
    <GroupedRow
      key={m.value}
      label={m.label}
      sub={m.textOnly ? `${sub} · ${t("aiAccounts.page.textOnly")}` : sub}
      checked={!m.refused && m.value === model}
      disabled={busy || Boolean(m.refused)}
      faint={Boolean(m.refused)}
      onPress={() => setPicked(m.value)}
    />
  );
  const use = async () => {
    if (!setup || !chosen || can.length === 0) return;
    setBusy(true);
    try {
      const results = await api.agents.applySetup(orgId, { setup, agentIds: can });
      const { done, missed } = setupOutcome(results, can.length);
      if (done > 0)
        toast({ title: t("aiAccounts.page.useAllDone", { count: done, model: chosen.label }), icon: "check" });
      if (missed > 0) toast({ title: t("aiAccounts.page.useAllMissed", { count: missed }), icon: "x" });
      router.back();
    } catch {
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    } finally {
      for (const key of [keys.agents(orgId), keys.aiStatus(orgId), keys.aiAccounts(orgId), keys.newAgentSetup(orgId)])
        void qc.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  };
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("aiAccounts.page.useAll")} solid={false} grouped />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.in}>
        {ai.isPending ? (
          <ActivityIndicator color={c.muted} style={styles.loading} />
        ) : !account || !plan || !groups ? (
          <Note icon="x">{t("common.loadFailed")}</Note>
        ) : (
          <>
            <View style={styles.lead}>
              <ProviderLogo id={account.provider ?? ""} size="tile" />
              <View style={styles.leadText}>
                <Text variant="label">{t("aiAccounts.page.useAllTitle", { plan: plan.label })}</Text>
                <Text variant="footnote" tone="muted">
                  {t("aiAccounts.page.useAllSub")}
                </Text>
              </View>
            </View>
            {groups.works.length > 0 ? (
              <View style={styles.group}>
                <GroupedHeader>{t("aiAccounts.page.useAllWorks")}</GroupedHeader>
                <GroupedList>{groups.works.map((m) => row(m, t("aiAccounts.page.useAllAnswered")))}</GroupedList>
              </View>
            ) : null}
            {groups.refused.length > 0 ? (
              <View style={styles.group}>
                <GroupedHeader>{t("aiAccounts.page.useAllRefused")}</GroupedHeader>
                <GroupedList>
                  {groups.refused.map((m) =>
                    row(
                      m,
                      m.refused === "region"
                        ? t("aiAccounts.page.useAllRegion", { maker })
                        : t("aiAccounts.page.useAllOff", { maker }),
                    ),
                  )}
                </GroupedList>
              </View>
            ) : null}
            {groups.untested.length > 0 ? (
              <View style={styles.group}>
                <GroupedList>
                  <GroupedRow
                    label={t("aiAccounts.page.useAllUntested", { count: groups.untested.length })}
                    chevron
                    onPress={() => setMoreOpen((o) => !o)}
                  />
                </GroupedList>
                {moreOpen || groups.works.length === 0 || groups.untested.some((m) => m.value === model) ? (
                  <View style={styles.gap}>
                    <GroupedList>
                      {groups.untested.map((m) => row(m, m.maker ? providerLabel(m.maker) : maker))}
                    </GroupedList>
                  </View>
                ) : null}
              </View>
            ) : null}
            {chosen?.textOnly ? (
              <Note icon="info">{t("aiAccounts.page.useAllTextOnly", { model: chosen.label })}</Note>
            ) : null}
            <View style={styles.group}>
              <GroupedList>
                <GroupedRow
                  icon="members"
                  label={t("aiAccounts.page.useAllAgents")}
                  sub={
                    preview.isPending
                      ? undefined
                      : can.length === 0
                        ? t("aiAccounts.page.useAllNone")
                        : t("aiAccounts.page.useAllAgentsLine", { count: can.length })
                  }
                  subLines={2}
                  checked={can.length > 0}
                  disabled
                />
              </GroupedList>
            </View>
          </>
        )}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button
          variant="primary"
          wide
          label={chosen ? t("aiAccounts.page.useAllGo", { count: can.length }) : t("aiAccounts.page.useAllPick")}
          disabled={busy || !chosen || can.length === 0}
          onPress={() => void use()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  loading: { marginTop: 16 },
  lead: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 4, paddingBottom: 16 },
  leadText: { flex: 1, gap: 2 },
  group: { marginBottom: 20 },
  gap: { marginTop: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
