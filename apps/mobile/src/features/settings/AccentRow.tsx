import { useSetChatPrefs, useSetOrgAccent } from "@agenteschat/client";
import { DEFAULT_ACCENT } from "@agenteschat/tokens/accent";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { GroupedList, GroupedRow, type IconName, useToast } from "@/ui";
import { ColorSheet } from "../agents/ColorSheet";
import { useColors } from "../shared/hooks";
import { errorHaptic, successHaptic } from "../shared/parts";
import { chooseAction } from "./parts";

/** The swatch: the agent color as the app paints it now, a round dot before the row's mark. */
const SWATCH = 20;

/**
 * Settings › General › "Accent color" (ADR 0193), as on the web: the color shown now, and for who configures the
 * workspace the kit's color sheet to change it, or the default back.
 */
export function AccentRow({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const { org, orgId } = useOrg();
  const save = useSetOrgAccent(orgId);
  const toast = useAccentToast();
  const { row, sheet } = useAccentPicker({
    saved: org?.accent ?? null,
    editable,
    pending: save.isPending,
    resetLabel: t("orgAccent.useDefault"),
    onCommit: (accent) =>
      save.mutate(accent, {
        onSuccess: (r) => toast.saved(r.accent ? "orgAccent.saved" : "orgAccent.reset"),
        onError: toast.failed,
      }),
  });
  return (
    <>
      <GroupedList>{row}</GroupedList>
      {sheet}
    </>
  );
}

/**
 * Você › "Your accent color" (ADR 0193 addendum): every member's own, over the workspace's for them alone, kept with
 * their other choices here (`chatPrefs.accent`). Its row goes in the caller's list, its sheet beside the list.
 */
export function usePersonalAccent() {
  const { t } = useTranslation();
  const { org, orgId } = useOrg();
  const save = useSetChatPrefs(orgId);
  const toast = useAccentToast();
  const theirs = org?.accent ?? null;
  return useAccentPicker({
    saved: org?.chatPrefs?.accent ?? null,
    fallback: theirs,
    editable: true,
    pending: save.isPending,
    icon: "palette",
    label: t("orgAccent.mine"),
    resetLabel: t(theirs ? "orgAccent.useWorkspace" : "orgAccent.useDefault"),
    onCommit: (accent) =>
      save.mutate(
        { accent },
        {
          onSuccess: () =>
            toast.saved(accent ? "orgAccent.saved" : theirs ? "orgAccent.resetWorkspace" : "orgAccent.reset"),
          onError: toast.failed,
        },
      ),
  });
}

function useAccentToast() {
  const { t } = useTranslation();
  const toast = useToast();
  return {
    saved: (key: "orgAccent.saved" | "orgAccent.reset" | "orgAccent.resetWorkspace") => {
      successHaptic();
      toast({ title: t(key) });
    },
    failed: () => {
      errorHaptic();
      toast({ title: t("mobile.app.failed"), icon: "x" });
    },
  };
}

/**
 * The accent's row and its color sheet. `fallback` is what shows when nothing is saved here (null: the default);
 * picking it stores nothing.
 */
function useAccentPicker({
  saved,
  fallback = null,
  editable,
  pending,
  icon,
  label,
  resetLabel,
  onCommit,
}: {
  saved: string | null;
  fallback?: string | null;
  editable: boolean;
  pending: boolean;
  /** The row's tile, as its neighbors' in a list of tiles. */
  icon?: IconName;
  label?: string;
  resetLabel: string;
  onCommit: (accent: string | null) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const title = label ?? t("orgAccent.label");
  const [opens, setOpens] = useState(0);
  const [picking, setPicking] = useState(false);

  const commit = (accent: string | null) => onCommit(accent === (fallback ?? DEFAULT_ACCENT) ? null : accent);
  const pick = () => {
    setOpens((n) => n + 1);
    setPicking(true);
  };
  const choose = () =>
    saved
      ? chooseAction(
          title,
          [
            { icon: "pen", label: t("orgAccent.change"), onPress: pick },
            { icon: "undo", label: resetLabel, onPress: () => onCommit(null) },
          ],
          t("mobile.common.cancel"),
        )
      : pick();

  return {
    row: (
      <GroupedRow
        key="accent"
        {...(icon ? { icon } : {})}
        label={title}
        valueLeading={<View style={[styles.swatch, { backgroundColor: c.agent, borderColor: c.line2 }]} />}
        // A color of its own opens a menu (change it, or go back to the workspace's), as Sons and Aparência do;
        // none yet goes straight to the picker.
        {...(editable ? { menu: Boolean(saved), chevron: !saved, onPress: choose, disabled: pending } : {})}
      />
    ),
    sheet: (
      <ColorSheet
        key={opens}
        open={picking}
        value={saved ?? fallback ?? DEFAULT_ACCENT}
        title={title}
        done={t("orgAccent.save")}
        onChange={() => {}}
        onDone={commit}
        onClose={() => setPicking(false)}
      />
    ),
  };
}

const styles = StyleSheet.create({
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, borderWidth: StyleSheet.hairlineWidth },
});
