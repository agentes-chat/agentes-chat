import type { PlanAccountUsage } from "@agenteschat/client";
import { useAiAccounts, useApi, usePlanUsage } from "@agenteschat/client";
import { computerNameOf } from "@agenteschat/client/lib/computer";
import { groupUsageAccounts } from "@agenteschat/client/lib/plan-usage";
import { noQuotaText, quotaSections, recentLines } from "@agenteschat/client/lib/quotas";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import { GROUPED_ROW, GroupedFooter, GroupedHeader, GroupedList, SkeletonList, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { LoadFailed } from "../shared/FirstUse";
import { useColors, usePullRefresh } from "../shared/hooks";
import { PushedHeader } from "../shared/parts";
import { AccountHead, PlanMeter, PlanModels } from "./parts";

/*
 * Cotas (ADR 0063 addendum 2026-11-17), as the web's Uso › Cotas: every AI account the person sees, a list per maker,
 * each account with all its windows open (a model group's under its own heading) and when each renews, or, where the
 * provider reports no limits, its use over the last day, week and month. Pushed from the ring's sheet on the home.
 */

export const openQuotas = () => router.push("/quotas");

export function QuotasScreen() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const usage = usePlanUsage(orgId);
  const mine = useAiAccounts(orgId);
  // Looking at the quotas: they are read again (they come back as `machine.updated`).
  useEffect(() => {
    void api.machines.refreshAccountUsage(orgId).catch(() => undefined);
  }, [api, orgId]);
  const pull = usePullRefresh(() => {
    void api.machines.refreshAccountUsage(orgId).catch(() => undefined);
    return Promise.allSettled([usage.refetch(), mine.refetch()]);
  });
  const accounts = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : null;
  const several = new Set(accounts?.map((a) => a.machineId)).size > 1;
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("quotas.title")} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={[styles.in, { paddingBottom: insets.bottom + 24 }]}
      >
        {usage.isLoading ? (
          <SkeletonList rows={3} />
        ) : !accounts ? (
          <LoadFailed onRetry={() => void usage.refetch()} />
        ) : accounts.length === 0 ? (
          <GroupedFooter>{`${t("quotas.empty")} ${t("usageViews.accounts.empty")}`}</GroupedFooter>
        ) : (
          <>
            <GroupedFooter>{t("quotas.lead")}</GroupedFooter>
            {quotaSections(accounts).map((s) => (
              <View key={s.maker}>
                <GroupedHeader>{s.name}</GroupedHeader>
                <GroupedList>
                  {s.accounts.map((a, i) => (
                    <QuotaAccount key={a.key} account={a} several={several} divider={i > 0} />
                  ))}
                </GroupedList>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** One account: its head, then its meters, or why it has none and its recent use. */
function QuotaAccount({
  account,
  several,
  divider,
}: {
  account: PlanAccountUsage;
  several: boolean;
  divider: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const c = useColors();
  const known = account.usage && (account.usage.windows.length > 0 || account.usage.limited === true);
  const recent = recentLines(t, i18n.language, account.recent);
  const computer = several ? computerNameOf(t, org?.name ?? "", account.machineName, isPersonal(org)) : null;
  return (
    <View style={[styles.account, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <AccountHead account={account} extra={computer} />
      {known && account.usage ? (
        <>
          <PlanMeter usage={account.usage} />
          <PlanModels usage={account.usage} provider={account.provider} />
        </>
      ) : (
        <>
          <Text variant="footnote" tone="muted">
            {noQuotaText(t, account)}
          </Text>
          {recent.map((r) => (
            <View key={r.period} style={styles.period}>
              <Text variant="small" tone="muted">
                {r.label}
              </Text>
              <Text variant="small" tone="ink2">
                {r.value}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  in: { paddingHorizontal: 16, paddingTop: 8 },
  // An account in a grouped list, on its edges: the head, then its bars or its recent use.
  account: { paddingHorizontal: GROUPED_ROW.padX, paddingVertical: 12, gap: 10 },
  period: { gap: 2 },
});
