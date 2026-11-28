/**
 * The Overview's "Always ready" (ADR 0265 §7): this computer's essentials, one row each with what it is, a line, and
 * at the end "On" in the ok colour or its one fix. What needs the person comes first. The three macOS permissions are
 * one row ("macOS permissions"): on when all are, else the ones still off and the fix for the first. Asking for Screen
 * Recording or Full Disk Access keeps Settings to open again when macOS reopens the app.
 */
import { Icon, type IconName, PixelSpinner } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { Essential, EssentialId, EssentialState } from "../../control/essentials";
import type { ReachWay } from "../../control/local-server";
import { MAC_PERMISSIONS } from "../../control/permissions";
import { useLocalServer } from "../../hooks";
import type { Essentials } from "../../ui/essentials";
import { ServerTile } from "../../ui/here";
import { useMacGrants } from "../../ui/permissions";
import { PrefCard, PrefRow } from "../../ui/settings";
import { listNames } from "../../ui/time";
import { essentialLine, FixButton, type FixContext, ReachRows, useReach } from "./fixes";

/** The permissions' one row stands in for its three essentials. */
type RowId = Exclude<EssentialId, "notifications" | "screen" | "disk"> | "permissions";

const ICON: Record<Exclude<RowId, "reach">, IconName> = {
  permissions: "eye",
  launchAtLogin: "power",
  backup: "archiveBox",
  autoUpdate: "download",
  awake: "bolt",
  powerRestart: "refresh",
  autoLogin: "key",
};

const TITLE: Record<RowId, string> = {
  permissions: "desktop.settings.essentials.permissions",
  launchAtLogin: "desktop.settings.essentials.launchAtLogin",
  reach: "desktop.settings.essentials.reach",
  backup: "desktop.settings.essentials.backup",
  autoUpdate: "desktop.settings.essentials.autoUpdate",
  awake: "desktop.settings.essentials.awake",
  powerRestart: "desktop.settings.essentials.powerRestart",
  autoLogin: "desktop.server.keepAutoLogin",
};

/** A row's lead: the essential's icon on a soft tile. */
export function Lead({ icon }: { icon: IconName }) {
  return (
    <span className="dk-logo dk-logo--soft">
      <Icon name={icon} size={16} />
    </span>
  );
}

/** Reach's lead by the way people get here (ADR 0265 §4): Tailscale's own tile, or a link for the person's address. */
export function ReachLead({ way }: { way: ReachWay | null }) {
  return way?.kind === "address" ? <Lead icon="link" /> : <ServerTile kind="tailnet" small />;
}

/** "On" in the ok colour, with its check: a state in words, never a pill. */
export function OnText({ children }: { children: string }) {
  return (
    <span className="dk-sx__on">
      <Icon name="check" size={16} />
      {children}
    </span>
  );
}

interface Row {
  id: RowId;
  state: EssentialState;
  /** The essential that carries the fix (for the permissions, the first one still off). */
  essential: Essential;
  optional: boolean;
}

/** The rows to show, what needs the person first, then what is optional and off, then the rest in their order. */
export function essentialRows(list: readonly Essential[]): Row[] {
  const perms = list.filter((e) => (MAC_PERMISSIONS as readonly string[]).includes(e.id) && e.state !== "na");
  const rows: Row[] = [];
  for (const e of list) {
    if (e.state === "na") continue;
    if ((MAC_PERMISSIONS as readonly string[]).includes(e.id)) {
      if (e !== perms[0]) continue;
      const off = perms.find((p) => p.state === "off");
      const state: EssentialState = off ? "off" : perms.some((p) => p.state === "checking") ? "checking" : "on";
      rows.push({ id: "permissions", state, essential: off ?? e, optional: false });
      continue;
    }
    rows.push({ id: e.id as RowId, state: e.state, essential: e, optional: e.optional === true });
  }
  const rank = (r: Row) => (r.state === "off" ? (r.optional ? 1 : 0) : 2);
  const ranked = rows.map((r, i) => ({ r, i }));
  ranked.sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);
  return ranked.map(({ r }) => r);
}

/**
 * How many rows need the person (off, never optional): what the Overview and its dot say, counting the permissions'
 * one row once.
 */
export const rowsNeedingYou = (list: readonly Essential[]) =>
  essentialRows(list).filter((r) => r.state === "off" && !r.optional).length;

/** `chooseReach`: where turning reach on chooses how people get here (the server here's reach row). */
export function AlwaysOn({ essentials, chooseReach }: { essentials: Essentials; chooseReach?: () => void }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const local = useLocalServer();
  const reach = useReach();
  const mac = host.platform === "mac";
  // Opened again by macOS after Screen Recording or Full Disk Access: says it took effect, once.
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!mac) return;
    host
      .setupState()
      .then((s) => {
        if (s?.step !== "prefs" || !s.resumed) return;
        setResumed(true);
        return host.setSetupState(null);
      })
      .catch(() => {});
  }, [host, mac]);
  const grants = useMacGrants(() => host.setSetupState({ step: "prefs" }).catch(() => {}));
  const ctx: FixContext = { local, reach, mac: mac ? grants : null, reread: essentials.reread, chooseReach };
  const rows = essentialRows(essentials.list);
  if (rows.length === 0) return null;
  const permsOff = MAC_PERMISSIONS.filter((p) => essentials.list.find((e) => e.id === p)?.state === "off");
  const offNames = listNames(
    permsOff.map((p) => t(`desktop.prepare.${p}`)),
    i18n.language,
  );
  const reopen = mac && (grants.grants?.screen === "off" || grants.grants?.disk === "off");

  return (
    <>
      <PrefCard>
        {rows.map(({ id, state, essential, optional }) => {
          const off = state === "off";
          const line =
            id !== "permissions"
              ? essentialLine(t, i18n.language, essential, local)
              : off
                ? t("desktop.settings.essentials.permissionsOff", { names: offNames })
                : null;
          return (
            <PrefRow
              key={id}
              lead={id === "reach" ? <ReachLead way={local.reach ? local.way : null} /> : <Lead icon={ICON[id]} />}
              title={t(TITLE[id])}
              desc={line && (off && !optional ? <span className="dk-sx__warn">{line}</span> : line)}
              end={
                state === "checking" ? (
                  <PixelSpinner size={14} />
                ) : off && essential.fix ? (
                  <FixButton fix={essential.fix} ctx={ctx} />
                ) : state === "on" ? (
                  <OnText>
                    {id === "permissions"
                      ? t("desktop.settings.essentials.allOn")
                      : t("desktop.settings.essentials.on")}
                  </OnText>
                ) : undefined
              }
              under={
                id === "permissions" && (reopen || resumed) ? (
                  <span className="dk-help" aria-live="polite">
                    {reopen ? t("desktop.prepare.reopen") : t("desktop.prepare.tookEffect")}
                  </span>
                ) : id === "reach" && (reach.reaching || reach.problem) ? (
                  <ReachRows control={reach} port={local.port} />
                ) : undefined
              }
            />
          );
        })}
      </PrefCard>
      {reach.dialog}
    </>
  );
}
