import { TrueSheet, TrueSheetOverlay } from "@lodev09/react-native-true-sheet";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button } from "@/ui/Button";
import { LogoMark } from "@/ui/LogoMark";
import { useTheme } from "@/ui/theme";
import { onAppLocked, unlock, useAppLock, watchAppLock } from "./store";

const LOGO = 72;

/**
 * The app lock over everything (ADR 0195): the mark and Desbloquear, on the app's background so nothing of the app
 * shows under it. Out of sight it covers alone; Desbloquear appears once proof is needed. Mounted once, at the root.
 * It is drawn in TrueSheet's overlay, a native layer the library keeps above every sheet it presents (the app's sheets
 * are all TrueSheet), and mounted only while it shows, so it lands on top of whatever is presented then (a screen
 * presented whole, the splash included).
 */
export function LockScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lock = useAppLock();
  const [busy, setBusy] = useState(false);
  useEffect(() => watchAppLock(), []);
  // Locking closes every open sheet, the route sheets and the screens' own (each hears it as a swipe down): a screen
  // reader still reached a sheet left under the lock.
  useEffect(() => onAppLocked(() => void TrueSheet.dismissAll(false).catch(() => {})), []);
  if (!lock.locked && !lock.covered) return null;
  const open = () => {
    setBusy(true);
    void unlock(t("mobile.lock.prompt")).finally(() => setBusy(false));
  };
  return (
    <TrueSheetOverlay>
      <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
        <LogoMark size={LOGO} />
        {lock.locked ? (
          <View style={styles.action}>
            <Button
              variant="primary"
              wide
              label={t("mobile.lock.unlock")}
              loading={busy}
              disabled={busy}
              onPress={open}
            />
          </View>
        ) : null}
      </View>
    </TrueSheetOverlay>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 32, paddingHorizontal: 32 },
  action: { width: "100%", maxWidth: 360 },
});
