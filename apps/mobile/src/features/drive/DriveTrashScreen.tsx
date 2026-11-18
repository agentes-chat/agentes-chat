import { type TrashedArtifact, useArtifactTrash } from "@agenteschat/client";
import { relativeTime } from "@agenteschat/client/lib/format";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet } from "react-native";
import { EmptyState, LIST_AVATAR, ListRow, SCREEN_X, SkeletonList, Text } from "@/ui";
import { chooseAction } from "../settings/parts";
import { LoadFailed } from "../shared/FirstUse";
import { useColors, useDirectory, useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { Tile } from "../shared/parts";
import { KIND_ICON } from "./DriveCard";
import { kindKey, trashLeft } from "./logic";
import { useDriveTrash } from "./useDriveTrash";

/**
 * The Drive's Lixeira, as the web's: files deleted in the last 30 days, who made each and when it was deleted, the
 * days left (in the attention color at 3 or fewer). A tap offers Restaurar and Apagar para sempre, which asks first.
 */
export function DriveTrashScreen() {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const dir = useDirectory();
  const c = useColors();
  const trash = useArtifactTrash(orgId);
  const pull = usePullRefresh(trash.refetch);
  const actions = useDriveTrash();
  const list = trash.data ?? [];
  const deleted = (a: TrashedArtifact) => relativeTime(t, i18n.language, a.deletedAt);
  const choose = (a: TrashedArtifact) =>
    chooseAction(
      a.title,
      [
        { icon: "undo", label: t("artifacts.restore"), onPress: () => void actions.restore(a.id) },
        { icon: "trash", label: t("drive.purge"), destructive: true, onPress: () => actions.purge(a) },
      ],
      t("common.cancel"),
    );
  return (
    <PushedLargeTitle
      title={t("artifacts.trashTitle")}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <Text variant="subhead" tone="muted" style={styles.lead}>
        {`${t("drive.trashNote")} ${t("drive.trashStorage")}`}
      </Text>
      {/* Loading: the rows' own shape; failed: what happened and the way to ask again; empty: says so. */}
      {trash.isLoading ? <SkeletonList rows={4} /> : null}
      {trash.isError && !trash.data ? <LoadFailed onRetry={() => void trash.refetch()} /> : null}
      {trash.isSuccess && list.length === 0 ? (
        <EmptyState size="panel" icon="trash" title={t("artifacts.trashEmpty")} />
      ) : null}
      {list.map((a, i) => {
        const left = trashLeft(a.purgeAt);
        return (
          <ListRow
            key={a.id}
            divider={i > 0}
            leading={<Tile icon={KIND_ICON[kindKey(a)]} size={LIST_AVATAR} />}
            title={a.title}
            sub={
              dir.nameOf(a.createdBy)
                ? t("drive.trashBy", { name: dir.nameOf(a.createdBy), when: deleted(a) })
                : deleted(a)
            }
            subLines={1}
            trailing={
              <Text variant="footnote" style={{ color: left.soon ? c.amber : c.faint }}>
                {t(left.key, { count: left.count })}
              </Text>
            }
            accessibilityRole="button"
            onPress={() => choose(a)}
          />
        );
      })}
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: SCREEN_X, paddingBottom: 8 },
});
