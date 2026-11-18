import { ApiError, type Artifact, keys, useApi } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import { useTranslation } from "react-i18next";
import { useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { confirmAction } from "../settings/parts";
import { useOrgId } from "../shared/hooks";
import { successHaptic } from "../shared/parts";

type Target = Pick<Artifact, "id" | "title">;

/** The Drive's Lixeira, pushed from the Drive. */
export const openDriveTrash = () => router.push("/drive-trash");

/**
 * The Drive's trash, as the web's (`useDeleteArtifact` and `DriveTrash`): "Mover para a lixeira" asks first naming the
 * file, then a toast whose Desfazer restores it; Restaurar brings one back (one past its 30 days says so); "Apagar
 * para sempre" asks first and can't be undone. Who may do each is the server's (`canDelete` on the file; the trash
 * lists only what the person may restore).
 */
export function useDriveTrash() {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const orgId = useOrgId();
  const navigation = useNavigation();
  // The trash's own list is under the Drive's key, so one refresh covers both.
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.artifacts(orgId) });

  const restore = async (id: string) => {
    try {
      await api.artifacts.restore(orgId, id);
      successHaptic();
      toast({ title: t("artifacts.restored"), icon: "undo" });
    } catch (err) {
      toast({
        title: err instanceof ApiError && err.status === 409 ? t("artifacts.purged") : errorText(t, err),
        icon: "x",
      });
    }
    refresh();
  };

  /** Asks, moves it to the trash, then `after` (a viewer closes: the file is gone from where it was). */
  const moveToTrash = (target: Target, after?: () => void) =>
    confirmAction({
      title: t("artifacts.deleteTitle", { title: target.title }),
      text: t("artifacts.deleteBody"),
      action: t("artifacts.deleteConfirm"),
      cancel: t("common.cancel"),
      onConfirm: () =>
        void api.artifacts.remove(orgId, target.id).then(
          () => {
            successHaptic();
            refresh();
            toast({
              title: t("artifacts.deleted"),
              icon: "trash",
              action: { label: t("artifacts.undo"), onPress: () => void restore(target.id) },
            });
            // Only from where it was asked: a person who already left the screen isn't taken back a step.
            if (navigation.isFocused()) after?.();
          },
          (err: unknown) =>
            toast({
              title: err instanceof ApiError && err.status === 403 ? t("artifacts.deleteForbidden") : errorText(t, err),
              icon: "x",
            }),
        ),
    });

  const purge = (target: Target) =>
    confirmAction({
      title: t("drive.purgeTitle", { title: target.title }),
      text: t("drive.purgeBody"),
      action: t("drive.purge"),
      cancel: t("common.cancel"),
      onConfirm: () =>
        void api.artifacts.purge(orgId, target.id).then(
          () => {
            refresh();
            toast({ title: t("drive.purged", { title: target.title }), icon: "trash" });
          },
          (err: unknown) => {
            refresh();
            toast({ title: errorText(t, err), icon: "x" });
          },
        ),
    });

  return { moveToTrash, restore, purge };
}
