import { Button, Chip, Icon } from "@agenteschat/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import {
  type Asked,
  allDone,
  askedIn,
  type Grants,
  MAC_ASKED_PREF,
  MAC_PERMISSIONS,
  type MacPermission,
  readGrants,
  viaSettings,
  withAsked,
} from "../control/permissions";
import { readPref, usePending, writePref } from "../hooks";
import type { Host } from "../host/types";
import { hintFor, PrefCard, PrefRow } from "./settings";
import { useToast } from "./Toast";

/** This Mac's permissions now, nothing asked. */
export async function macGrants(host: Host): Promise<Grants> {
  const { version } = await host.appInfo();
  return readGrants(host, askedIn(readPref<Asked | null>(MAC_ASKED_PREF, null), version));
}

/** A pairing on a Mac goes on to Prepare this Mac while any permission is left to ask. */
export const needsPrepare = async (host: Host) => host.platform === "mac" && !allDone(await macGrants(host));

export interface MacGrants {
  grants: Grants | null;
  pending: MacPermission | null;
  /** Allow (the system's prompt) the first time, System Settings once it was asked, and always for Full Disk Access. */
  ask: (p: MacPermission) => Promise<void>;
}

/** While one is still off, they are read again this often: the person turns them on in System Settings beside it. */
const LIVE_READ_MS = 3000;

/**
 * The permissions, read again whenever the window comes back to the front (from System Settings) and, while one is
 * still off, every few seconds (live, ADR 0265 §7). `beforeQuit`: just before Screen Recording or Full Disk Access is
 * asked, which may end with macOS quitting the app.
 */
export function useMacGrants(beforeQuit?: () => Promise<void>): MacGrants {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [grants, setGrants] = useState<Grants | null>(null);
  const [pending, run] = usePending<MacPermission>();
  const refresh = useCallback(
    () =>
      macGrants(host)
        .then(setGrants)
        .catch(() => {}),
    [host],
  );
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const done = grants !== null && allDone(grants);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => void refresh(), LIVE_READ_MS);
    return () => clearInterval(timer);
  }, [done, refresh]);

  const ask = (p: MacPermission) =>
    run(p, async () => {
      try {
        // Notifications never make macOS quit the app.
        if (p !== "notifications") await beforeQuit?.();
        const { version } = await host.appInfo();
        writePref(MAC_ASKED_PREF, withAsked(readPref<Asked | null>(MAC_ASKED_PREF, null), version, p));
        if (viaSettings(p, grants?.[p] ?? "ask")) await host.openPrivacy(p);
        else if (p === "screen") await host.requestScreenAccess();
        else await host.requestNotifications();
      } catch {
        toast(t("desktop.common.error"), "alert");
      }
      await refresh();
    });
  return { grants, pending, ask };
}

/**
 * The permissions as rows: what each lets agents do, its state, one button. No picture before them: their words run to
 * three lines or more, which a picture's column would squeeze. Under them, once Screen Recording or Full Disk Access
 * was asked and is still off, what to do when macOS asks to quit and reopen the app; `resumed`: it just did, so the
 * line says it took effect. `hinted` (Preferences): what each lets agents do goes behind its ⓘ, only the Full Disk
 * Access fix stays in sight.
 */
export function MacPermissionCard({
  mac,
  resumed = false,
  hinted = false,
}: {
  mac: MacGrants;
  resumed?: boolean;
  hinted?: boolean;
}) {
  const { t } = useTranslation();
  const { grants, pending, ask } = mac;
  // Opened again by macOS: Preferences starts at its top, so the card the person left comes back into view.
  const seen = useCallback(
    (el: HTMLElement | null) => {
      if (resumed) el?.scrollIntoView?.({ block: "nearest" });
    },
    [resumed],
  );
  const reopen = grants?.screen === "off" || grants?.disk === "off";
  const line =
    grants && resumed && !reopen ? (
      <p ref={seen} className="dk-under-card dk-help ac-iconline" aria-live="polite">
        <Icon name="check" size={14} />
        <span>{t("desktop.prepare.tookEffect")}</span>
      </p>
    ) : reopen ? (
      <p ref={seen} className="dk-under-card dk-help">
        {t("desktop.prepare.reopen")}
      </p>
    ) : null;
  return (
    <>
      <PrefCard>
        {MAC_PERMISSIONS.map((p) => {
          const grant = grants?.[p];
          const title = t(`desktop.prepare.${p}`);
          const desc = t(`desktop.prepare.${p}Desc`);
          const more = p === "screen" ? t("desktop.prepare.screenAgain") : null;
          const fix = p === "disk" && grant !== "on" ? t("desktop.prepare.diskHow") : null;
          const under = hinted ? fix : p === "screen" ? more : fix;
          const hint = hinted
            ? hintFor(t, title, more ? t("common.joinSentences", { a: desc, b: more }) : desc)
            : undefined;
          return (
            <PrefRow
              key={p}
              title={title}
              hint={hint}
              desc={hinted ? undefined : desc}
              under={under && <span className="dk-help">{under}</span>}
              end={
                grant === "on" ? (
                  <Chip icon="check" tone="done">
                    {t("desktop.prepare.on")}
                  </Chip>
                ) : grant ? (
                  <Button
                    size="sm"
                    loading={pending === p}
                    disabled={pending !== null && pending !== p}
                    onClick={() => void ask(p)}
                  >
                    {t(viaSettings(p, grant) ? "desktop.prepare.openSettings" : "desktop.pair.allow")}
                  </Button>
                ) : null
              }
            />
          );
        })}
      </PrefCard>
      {line}
    </>
  );
}
