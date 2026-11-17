import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedRow } from "@/ui";
import { pickOne } from "../shared/PickerSheet";
import { LOCK_AFTER_CHOICES, type LockAfter } from "./logic";
import { setLockAfter, turnAppLock, useAppLock, useLockAvailability } from "./store";

/**
 * Você › Preferências: "Bloquear com biometria", for this phone only (ADR 0195). Offered where the phone has
 * biometrics or a screen lock; turning it on asks for that proof once.
 */
export function AppLockRow() {
  const { t } = useTranslation();
  const { enabled } = useAppLock();
  const availability = useLockAvailability();
  const [busy, setBusy] = useState(false);
  const missing = availability === "none" && !enabled;
  const flip = () => {
    if (busy) return;
    setBusy(true);
    void turnAppLock(!enabled, t("mobile.lock.confirm")).finally(() => setBusy(false));
  };
  return (
    <GroupedRow
      icon="lock"
      label={t("mobile.lock.setting")}
      labelLines={0}
      {...(missing ? { sub: t("mobile.lock.unavailable"), subLines: 0 } : {})}
      toggle={enabled}
      disabled={busy || availability === null || missing}
      onPress={flip}
    />
  );
}

const AFTER_KEY: Record<LockAfter, string> = {
  0: "mobile.lock.afterNow",
  60000: "mobile.lock.after1m",
  300000: "mobile.lock.after5m",
  1800000: "mobile.lock.after30m",
  3600000: "mobile.lock.after1h",
};

/** Under the lock, while on: how long away before it asks again, so a quick trip out doesn't ask each time. */
export function AppLockAfterRow() {
  const { t } = useTranslation();
  const { after } = useAppLock();
  const pick = () =>
    void pickOne({
      title: t("mobile.lock.after"),
      value: String(after),
      options: LOCK_AFTER_CHOICES.map((choice) => ({ key: String(choice), label: t(AFTER_KEY[choice]) })),
    }).then((key) => {
      if (key !== null && key !== undefined) setLockAfter(Number(key) as LockAfter);
    });
  return <GroupedRow icon="clock" label={t("mobile.lock.after")} value={t(AFTER_KEY[after])} menu onPress={pick} />;
}
