import { useOverview, useWorkspaceUsesApi } from "@agenteschat/client";
import { formatPercent } from "@agenteschat/client/lib/format";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { GroupedList, GroupedRow, LargeTitleScreen, SCREEN_X } from "@/ui";
import { router } from "@/ui/navigation";
import { Gap } from "../settings/parts";
import { SectionGroups } from "../settings/WorkspaceScreen";
import { useUnreadThreads, useWaitingCount } from "../shared/queries";
import { useTabHeader } from "../shared/tabHeader";
import { MANAGE_ROW, type ManageRow, manageView } from "./logic";

/**
 * Gestão, the tab a person may put in Threads' place on this phone (Você › Preferências): what a team's admin opens
 * every day in one list, by how often (Threads first, its tab gave its place, then what waits on you, routines,
 * dashboards, the wiki, the Drive, the team, usage and memory), then the workspace's settings in their groups, the
 * same rows as Configurações, without one more screen between. Only what this person may open (`manageView`, the
 * rules Você and Configurações use). Deleting the workspace stays in Configurações, never a tap away here. Under the
 * native large title with Você and "+" in the bar, as every tab.
 */
export function ManageScreen() {
  const { t, i18n } = useTranslation();
  const header = useTabHeader();
  const { org, orgId } = useOrg();
  const view = manageView(org);
  const waiting = useWaitingCount();
  const unreadThreads = useUnreadThreads();
  const counts: Partial<Record<ManageRow, number>> = { approvals: waiting, threads: unreadThreads };
  // Uso says its budget as Configurações does (`areaValues`): only where the workspace uses the API.
  const overview = useOverview(orgId).data;
  const usesApi = useWorkspaceUsesApi(orgId);
  const values: Partial<Record<ManageRow, string>> =
    overview && usesApi ? { usage: formatPercent(i18n.language, overview.budgetUsedPercent) } : {};
  return (
    <LargeTitleScreen title={t("mobile.manage.title")} left={header.left} actions={header.actions} grouped>
      <View style={styles.body}>
        <Gap />
        <GroupedList>
          {view.rows.map((row) => {
            const { icon, href, label } = MANAGE_ROW[row];
            const count = counts[row] ?? 0;
            const value = count > 0 ? String(count) : values[row];
            return (
              <GroupedRow
                key={row}
                icon={icon}
                label={t(label)}
                {...(value ? { value } : {})}
                chevron
                onPress={() => router.push(href as never)}
              />
            );
          })}
        </GroupedList>
        <SectionGroups areas={view.sections} />
      </View>
    </LargeTitleScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SCREEN_X, paddingTop: 4 },
});
