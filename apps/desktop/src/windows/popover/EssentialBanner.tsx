/**
 * The first of this computer's essentials that needs the person (ADR 0256 §7), as a banner with its one fix: the
 * popover does what it can itself (opening at login, the notification prompt, the permission's list in System
 * Settings, installing updates at night, restarting the server here) and opens This computer's settings on the rest.
 */
import { Button } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { Essential } from "../../control/essentials";
import { AUTO_UPDATE_PREF } from "../../control/version";
import { writePref } from "../../hooks";
import { Banner } from "../../ui/bits";
import { useToast } from "../../ui/Toast";
import { essentialIcon, essentialWords, fixLabel, fixPlan } from "./state";

/** `reread`: the system's side read again once the fix ran (the list then says it's on). */
export function EssentialBanner({ essential, reread }: { essential: Essential; reread: () => void }) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const words = essentialWords(essential);
  const fix = essential.fix;
  if (!words || !fix) return null;
  const plan = fixPlan(fix);
  const run = async () => {
    setBusy(true);
    try {
      switch (plan.kind) {
        case "autostart":
          await host.setAutostart(true);
          break;
        case "notifications": {
          // macOS asks only once: answered no before, This computer's settings show where to turn them on.
          const now = await host.requestNotifications();
          if (now !== "granted") {
            await host.showLayer({ screen: "settings", section: "overview", focus: "notifications" });
          }
          break;
        }
        case "privacy":
          await host.openPrivacy(plan.pane);
          break;
        case "autoUpdate":
          writePref(AUTO_UPDATE_PREF, true);
          // This web view's own change: `storage` fires only in the others, so its readers hear it here.
          window.dispatchEvent(new Event("storage"));
          break;
        case "restart":
          await host.restartLocalServer();
          break;
        case "layer":
          await host.showLayer(plan.route);
          break;
      }
      reread();
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Banner
      icon={essentialIcon(essential)}
      title={t(words.title)}
      actions={
        <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void run()}>
          {t(fixLabel(fix))}
        </Button>
      }
    >
      {t(words.body)}
    </Banner>
  );
}
