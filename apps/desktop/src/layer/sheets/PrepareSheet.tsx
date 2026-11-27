/**
 * "macOS asks three things, once" (route `prepare`, ADR 0256 §7): right after this Mac was made ready, the
 * permissions agents need, asked now so nothing stops them later. Each row reads its state live (`useMacGrants`: when
 * the window comes back to the front, and every few seconds while one is off): "On" in the ok colour, or Allow. Allow
 * raises the system's prompt the first time and opens System Settings after that (always for Full Disk Access); the
 * row being turned on there says so under it, with the pixel spinner, until macOS says it is on.
 *
 * Kept by the app from the start (`setSetupState`), so when macOS quits it for Screen Recording or Full Disk Access
 * it opens here again (`resumed`, every state read fresh). Do it later and Continue both end it: being ready never
 * depends on it.
 */
import { Button, Icon, type IconName } from "@agenteschat/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { allDone, type Grants, MAC_PERMISSIONS, type MacPermission, viaSettings } from "../../control/permissions";
import { useMacGrants } from "../../ui/permissions";
import { PrefRow } from "../../ui/settings";
import { Sheet, SheetWaiting } from "./SheetFrame";

const ICONS: Record<MacPermission, IconName> = { notifications: "bell", screen: "eye", disk: "drive" };

/**
 * The permission the person is turning on in System Settings: the one they just sent there, else (after macOS
 * reopened the app, or a prompt that sends there by itself) Screen Recording or Full Disk Access asked and still off.
 */
export function waitingOn(grants: Grants | null, sent: MacPermission | null): MacPermission | null {
  if (!grants) return null;
  if (sent && grants[sent] !== "on") return sent;
  return (["screen", "disk"] as const).find((p) => grants[p] === "off") ?? null;
}

export function PrepareSheet({
  server,
  org,
  resumed = false,
  onClose,
}: {
  org: string;
  server: string;
  resumed?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const keep = useCallback(
    () => host.setSetupState({ step: "prepare", org, server }).catch(() => {}),
    [host, org, server],
  );
  // Left without Continue or Do it later (Esc, another route): forgotten too. A quit never unmounts it.
  useEffect(() => {
    void keep();
    return () => void host.setSetupState(null).catch(() => {});
  }, [keep, host]);
  const { grants, pending, ask } = useMacGrants(keep);
  const [sent, setSent] = useState<MacPermission | null>(null);
  const waiting = waitingOn(grants, sent);
  const finish = () => {
    void host.setSetupState(null).catch(() => {});
    onClose();
  };
  const allow = (p: MacPermission, grant: Grants[MacPermission]) => {
    // Sent to System Settings (or to the prompt that leads there): the row says what to do there.
    if (viaSettings(p, grant) || p === "screen") setSent(p);
    void ask(p);
  };
  // Opened again by macOS with the ones it quits for on: it says so where the help line was.
  const tookEffect = resumed && grants !== null && grants.screen !== "off" && grants.disk !== "off";

  return (
    <Sheet
      screen="prepare"
      step={t("desktop.sheets.step", { at: 2, total: 2 })}
      title={t("desktop.sheets.prepare.title")}
      lead={t("desktop.sheets.prepare.lead")}
      help={
        tookEffect ? (
          <span className="dk-sh__took" aria-live="polite">
            <Icon name="check" size={14} />
            <span>{t("desktop.prepare.tookEffect")}</span>
          </span>
        ) : (
          t("desktop.sheets.prepare.help")
        )
      }
      acts={
        <>
          {!(grants && allDone(grants)) && (
            <Button variant="ghost" onClick={finish}>
              {t("desktop.sheets.prepare.later")}
            </Button>
          )}
          <Button variant="primary" onClick={finish}>
            {t("desktop.common.continue")}
          </Button>
        </>
      }
    >
      <div className="dk-sh__rows">
        {MAC_PERMISSIONS.map((p) => {
          const grant = grants?.[p];
          const title = p === "notifications" ? t("desktop.sheets.prepare.notifications") : t(`desktop.prepare.${p}`);
          const there =
            p === "notifications"
              ? t("desktop.sheets.prepare.waitNotifications")
              : t("desktop.sheets.prepare.waitList");
          return (
            <PrefRow
              key={p}
              lead={
                <span className="dk-logo dk-logo--soft">
                  <Icon name={ICONS[p]} size={16} />
                </span>
              }
              title={title}
              desc={t(`desktop.sheets.prepare.${p}Desc`)}
              top={waiting === p}
              end={
                grant === "on" ? (
                  <span className="dk-sh__on">
                    <Icon name="check" size={16} />
                    {t("desktop.prepare.on")}
                  </span>
                ) : grant ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={pending === p}
                    disabled={pending !== null && pending !== p}
                    onClick={() => allow(p, grant)}
                  >
                    {t("desktop.pair.allow")}
                  </Button>
                ) : null
              }
              under={
                waiting === p && (
                  <SheetWaiting>
                    {there}
                    {/* Screen Recording and Full Disk Access take effect once the app opens again. */}
                    {p !== "notifications" && <small>{t("desktop.prepare.reopen")}</small>}
                  </SheetWaiting>
                )
              }
            />
          );
        })}
      </div>
    </Sheet>
  );
}
