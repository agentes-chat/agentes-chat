import type { ArtifactDetail } from "@agenteschat/client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View } from "react-native";
import { Button, EmptyState, type HeaderAction, type HeaderMenuItem, SCREEN_X, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { useFileActions } from "../../files/actions";
import { chooseAction } from "../../settings/parts";
import { PushedHeader } from "../../shared/parts";
import { type LiveClosed, liveStatusWord } from "../logic";
import { HereFaces } from "./HereFaces";
import type { LiveDoc } from "./useLiveDoc";

/**
 * A live file's bar on the phone (ADR 0196), the same for a spreadsheet, a presentation and a canvas: the system's
 * back, the file's name with how it stands under it ("Salvo", "Salvando…", "Sem conexão · guardado no celular", "Só
 * leitura") beside the faces of who else is in it, then Compartilhar (who sees it, ADR 0157) and the "…": the screen's
 * own choices first, then Desfazer and Refazer (only this person's changes, never an agent's), Enviar cópia (as the
 * Office file other apps open) and Ver no Drive. On Android the "…" lists the same choices in the app's sheet.
 */
export function LiveBar({
  live,
  fileId,
  title,
  detail,
  menu = [],
}: {
  live: LiveDoc;
  fileId: string;
  title: string;
  /** The file as the Drive knows it (sharing, the copy to send); its buttons wait for it. */
  detail: ArtifactDetail | undefined;
  /** The screen's own choices, first in the "…". */
  menu?: HeaderMenuItem[];
}) {
  const { t } = useTranslation();
  const actions = useFileActions(detail);
  const room = live.room;
  const edit = live.mode === "edit";
  const choices: HeaderMenuItem[] = [
    ...menu,
    ...(room && edit
      ? [
          {
            icon: "undo" as const,
            sf: "arrow.uturn.backward" as const,
            label: t("mobile.live.menu.undo"),
            onPress: () => room.undo.undo(),
          },
          {
            icon: "redo" as const,
            sf: "arrow.uturn.forward" as const,
            label: t("mobile.live.menu.redo"),
            onPress: () => room.undo.redo(),
          },
        ]
      : []),
    ...(detail
      ? [
          {
            icon: "share" as const,
            sf: "square.and.arrow.up" as const,
            label: t("mobile.files.sendCopy"),
            onPress: () => void actions.share(),
          },
          { icon: "drive" as const, sf: "folder" as const, label: t("mobile.files.drive"), onPress: actions.drive },
        ]
      : []),
  ];
  const bar: HeaderAction[] = [
    ...(detail
      ? [
          {
            icon: "person" as const,
            sf: "person.badge.plus" as const,
            label: t("share.button"),
            onPress: actions.shareSheet,
          },
        ]
      : []),
    ...(choices.length > 0
      ? [
          {
            icon: "more" as const,
            sf: "ellipsis" as const,
            label: t("mobile.files.more"),
            disabled: actions.busy !== null,
            menu: choices,
            onPress: () => chooseAction(title, choices, t("mobile.common.cancel")),
          },
        ]
      : []),
  ];
  return <PushedHeader title={<LiveTitle live={live} fileId={fileId} title={title} />} actions={bar} />;
}

/** How long a dropped connection waits before the bar says so (a quick reconnect says nothing). */
const OFFLINE_AFTER_MS = 1200;

/** The name, the status under it, and the faces beside them. */
function LiveTitle({ live, fileId, title }: { live: LiveDoc; fileId: string; title: string }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const word = liveStatusWord(live);
  const down = word === "offline" || word === "offlineKept";
  // A short drop never flashes the warning.
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!down) {
      setLate(false);
      return;
    }
    const id = setTimeout(() => setLate(true), OFFLINE_AFTER_MS);
    return () => clearTimeout(id);
  }, [down]);
  const shown = down && !late ? (live.unsent ? "saving" : "saved") : word;
  return (
    <View style={styles.title}>
      <View style={styles.words}>
        <Text variant="body" numberOfLines={1} style={styles.name}>
          {title}
        </Text>
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color: shown === "offline" || shown === "offlineKept" ? c.warn : c.faint }}
          accessibilityLiveRegion="polite"
        >
          {t(`mobile.live.status.${shown}`)}
        </Text>
      </View>
      <HereFaces room={live.room} fileId={fileId} />
    </View>
  );
}

/**
 * A live file that can't open: gone or never shared with this person, the session over, or a document no app can
 * read. What happened, and the way back to the Drive.
 */
export function LiveUnavailable({ reason }: { reason: LiveClosed }) {
  const { t } = useTranslation();
  return (
    <View style={styles.middle}>
      <EmptyState
        size="page"
        icon="file"
        title={t(`mobile.live.closed.${reason}`)}
        action={
          <Button
            variant="secondary"
            label={t("mobile.live.closed.toDrive")}
            onPress={() => router.replace("/drive")}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  words: { flexShrink: 1, minWidth: 0, alignItems: Platform.OS === "ios" ? "center" : "flex-start" },
  name: { fontWeight: "600" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: SCREEN_X },
});
