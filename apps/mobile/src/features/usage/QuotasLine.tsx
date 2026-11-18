import { useAiAccounts, usePlanUsage } from "@agenteschat/client";
import { groupUsageAccounts } from "@agenteschat/client/lib/plan-usage";
import { quotaSummary, quotaSummaryText } from "@agenteschat/client/lib/quotas";
import { PLAN_TONE } from "@agenteschat/ui/plan-state";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Icon, LIST_AVATAR, ListRow } from "@/ui";
import { useColors } from "../shared/hooks";
import { openQuotas } from "./QuotasScreen";

/**
 * The home's way into Cotas (ADR 0063 addendum 2026-11-17), as the web's line on Início: one row of the list with a
 * meter's tile, "Cotas dos planos" and where the workspace's AI accounts stand ("1 no limite · 2 quase no limite").
 * Nothing while the workspace has no AI account.
 */
export function QuotasLine() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const c = useColors();
  const usage = usePlanUsage(orgId);
  const mine = useAiAccounts(orgId);
  // One seat on two computers is one account, as Cotas lists it.
  const accounts = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : [];
  if (accounts.length === 0) return null;
  const summary = quotaSummary(accounts);
  const sub = quotaSummaryText(t, summary);
  const tone = summary.limited > 0 ? c[PLAN_TONE.limited] : summary.almost > 0 ? c[PLAN_TONE.almost] : c.muted;
  return (
    <ListRow
      leading={
        <View style={[styles.tile, { backgroundColor: c.plate }]}>
          <Icon name="chart" size={22} color={tone} />
        </View>
      }
      title={t("quotas.home")}
      sub={sub}
      subLines={1}
      chevron
      accessibilityRole="button"
      accessibilityLabel={`${t("quotas.home")}, ${sub}`}
      onPress={openQuotas}
    />
  );
}

const styles = StyleSheet.create({
  // The avatar column's tile, a little inside it, as the list's other icon rows.
  tile: {
    width: LIST_AVATAR - 8,
    height: LIST_AVATAR - 8,
    borderRadius: (LIST_AVATAR - 8) * 0.3,
    alignItems: "center",
    justifyContent: "center",
  },
});
