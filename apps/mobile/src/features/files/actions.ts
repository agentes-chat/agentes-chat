import { type ArtifactDetail, useApi } from "@agenteschat/client";
import { relativeDay } from "@agenteschat/client/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import { useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useDriveTrash } from "../drive/useDriveTrash";
import { useOrgId, useWhen } from "../shared/hooks";
import { whenKind } from "../shared/logic";
import { successHaptic } from "../shared/parts";
import { openInDrive, saveToPhotos, shareFile } from "./source";

/**
 * Compartilhar (who sees it and its link, ADR 0157), Enviar cópia (the system's share sheet with the file), Salvar
 * em Fotos, Ver no Drive and Mover para a lixeira (only who may delete it, `canDelete`, as on the web) for one file,
 * with their toasts; one at a time. The file screen and the picture viewer both use these, under the same words and
 * icons.
 */
export function useFileActions(detail: ArtifactDetail | undefined) {
  const { t } = useTranslation();
  const api = useApi();
  const orgId = useOrgId();
  const toast = useToast();
  const [busy, setBusy] = useState<"share" | "photos" | null>(null);
  const driveTrash = useDriveTrash();

  const share = async () => {
    if (!detail || busy) return;
    setBusy("share");
    try {
      await shareFile(api, orgId, detail);
    } catch {
      toast({ title: t("mobile.files.shareFailed"), icon: "x" });
    } finally {
      setBusy(null);
    }
  };

  const savePhotos = async () => {
    if (!detail || busy) return;
    setBusy("photos");
    try {
      if (await saveToPhotos(api, orgId, detail)) {
        successHaptic();
        toast({ title: t("mobile.files.saved"), icon: "photos" });
      } else
        toast({
          title: t("mobile.files.photosDenied"),
          subtitle: t("mobile.files.photosDeniedSub"),
          icon: "x",
          action: { label: t("mobile.common.openSettings"), onPress: () => void Linking.openSettings() },
        });
    } catch {
      toast({ title: t("mobile.files.saveFailed"), icon: "x" });
    } finally {
      setBusy(null);
    }
  };

  const drive = () => {
    if (!detail) return;
    openInDrive(orgId, detail).catch(() => toast({ title: t("mobile.files.loadFailed"), icon: "x" }));
  };

  const shareSheet = () => {
    if (detail) router.push({ pathname: "/file-share", params: { id: detail.id } });
  };

  /** Asks, moves it to the trash, then `after` (the viewer closes: the file is gone). */
  const trash = (after: () => void) => {
    if (detail?.canDelete) driveTrash.moveToTrash(detail, after);
  };
  const mayTrash = Boolean(detail?.canDelete);

  return { share, shareSheet, savePhotos, drive, trash, mayTrash, busy };
}

/** "hoje 10:03", "ontem 18:20", "12 de out. 09:15": when the file was saved. */
export function useSavedWhen() {
  const when = useWhen();
  return (iso: string) => {
    const kind = whenKind(iso);
    const day =
      kind === "time" || kind === "yesterday" ? relativeDay(when.locale, kind === "time" ? 0 : -1) : when.short(iso);
    return `${day} ${when.time(iso)}`;
  };
}

/** The version shown was saved at… (a new version's time is the artifact's update). */
export const savedAt = (a: Pick<ArtifactDetail, "shownVersion" | "version" | "createdAt" | "updatedAt">) =>
  a.shownVersion === a.version ? a.updatedAt : a.createdAt;
