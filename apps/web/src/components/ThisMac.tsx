import { useConfirmDevice, useMe } from "@agenteschat/client";
import { Alert, Button, Icon, type IconName, SettingNote } from "@agenteschat/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  desktopHasSettingsLayer,
  desktopPlatform,
  desktopRevealsFiles,
  inDesktopApp,
  openThisDeviceSettings,
  THIS_DEVICE_SECTIONS,
  type ThisDeviceFocus,
  type ThisDeviceSection,
  thisMac,
} from "@/lib/desktop";
import { useToast } from "@/lib/toast";
import "./this-device-settings.css";

/**
 * This computer, in the agentes.chat desktop app (ADR 0036, ADR 0066): the site knows which of its
 * organizations the computer it runs on works for, pairs it in one click (the app asks the person in its
 * own dialog, then hands the runner's code to the site, which confirms it with the person's session; no code
 * to read) and opens This {{device}}'s settings, the app's own (ADR 0265), where access is granted. agentes.chat
 * included (ADR 0165). Outside the app, and where this computer is set up with a server of its own (a loopback
 * address, the server the app runs here), nothing.
 */
const THIS_MAC_KEY = ["desktop", "thisMac"] as const;
/** Ask again this often while the runner picks up its token after the site confirmed. */
const CONNECTING_POLL_MS = 2000;

/** This Mac in `orgId`: its machine there, or null when it isn't connected to it. Off outside the app. */
export function useThisMac(orgId: string, connecting = false) {
  return useQuery({
    queryKey: THIS_MAC_KEY,
    queryFn: thisMac.status,
    enabled: inDesktopApp(),
    refetchInterval: connecting ? CONNECTING_POLL_MS : false,
    refetchOnWindowFocus: true,
    select: (s) => s.orgs.find((o) => o.orgId === orgId && o.connection !== "refused") ?? null,
    meta: { quiet: true },
  });
}

/** Is `machineId` the Mac this app runs on? */
export function useIsThisMac(orgId: string, machineId: string) {
  return useThisMac(orgId).data?.machineId === machineId;
}

/**
 * Whether agents may work on this computer for this server, agentes.chat included; false until the app says so
 * (apps from before it said nothing, and allowed it everywhere).
 */
export function useAgentsHere(): boolean {
  const here = useQuery({
    queryKey: THIS_MAC_KEY,
    queryFn: thisMac.status,
    enabled: inDesktopApp(),
    select: (s) => s.agentsHere !== false,
    meta: { quiet: true },
  });
  return inDesktopApp() && here.data === true;
}

/** Is the page the server this app runs on this computer (its Server on this {{device}})? False outside the app. */
export function useLocalServerHere(): boolean {
  const local = useQuery({
    queryKey: THIS_MAC_KEY,
    queryFn: thisMac.status,
    enabled: inDesktopApp(),
    select: (s) => s.local === true,
    meta: { quiet: true },
  });
  return inDesktopApp() && local.data === true;
}

/** "Show the folder": in an app that opens it (`desktopRevealsFiles`), on the server it runs on this computer. */
export function useRevealsFiles(): boolean {
  const here = useLocalServerHere();
  return desktopRevealsFiles() && here;
}

/** An organization's name, for the app's own dialog before it pairs this computer. */
export function useOrgName(orgId: string): string | undefined {
  return useMe().data?.organizations.find((o) => o.id === orgId)?.name;
}

/**
 * "Usar este Mac" (one click), or, once connected, "Pastas deste Mac" (`folders: false` hides it).
 * `canPair`: may connect a computer. `onConnected`: the new machine, e.g. to pick it right away.
 */
export function ThisMacButton({
  orgId,
  canPair,
  primary = false,
  folders = true,
  onConnected,
}: {
  orgId: string;
  canPair: boolean;
  primary?: boolean;
  folders?: boolean;
  onConnected?: (machineId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirmDevice();
  const [connecting, setConnecting] = useState(false);
  const mine = useThisMac(orgId, connecting);
  const agentsHere = useAgentsHere();
  const orgName = useOrgName(orgId);
  const connected = Boolean(mine.data);

  const machineId = mine.data?.machineId ?? null;
  useEffect(() => {
    if (!connecting || !connected) return;
    setConnecting(false);
    toast.show(t("machines.thisMac.connected"));
    if (machineId) onConnected?.(machineId);
  }, [connecting, connected, machineId, onConnected, toast, t]);

  if (!agentsHere || mine.isLoading) return null;
  if (connected) {
    if (!folders) return null;
    return (
      <Button size="sm" icon="drive" onClick={() => void openThisDeviceSettings("folders").catch(() => {})}>
        {t("machines.thisMac.folders")}
      </Button>
    );
  }
  if (!canPair) return null;

  const start = async () => {
    setConnecting(true);
    try {
      const { userCode } = await thisMac.connect(orgId, orgName);
      if (userCode) await confirm.mutateAsync({ orgId, userCode });
      void qc.invalidateQueries({ queryKey: THIS_MAC_KEY });
    } catch {
      setConnecting(false);
      toast.show(t("machines.thisMac.failed"), "error");
    }
  };
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "default"}
      icon="computer"
      loading={connecting}
      onClick={() => void start()}
    >
      {t("machines.thisMac.connect")}
    </Button>
  );
}

/**
 * This {{device}}'s settings on `section`, scrolled to `focus`, for what is decided on this computer itself (folders,
 * tools, updates, the server here): the app's own layer (ADR 0265), or an older app's Preferences on the matching tab.
 */
export function OpenThisMacButton({
  section,
  focus,
  children,
}: {
  section: ThisDeviceSection;
  focus?: ThisDeviceFocus;
  children: string;
}) {
  return (
    <Button
      size="sm"
      icon={focus === "updates" ? "download" : "settings"}
      onClick={() => void openThisDeviceSettings(section, focus).catch(() => {})}
    >
      {children}
    </Button>
  );
}

const THIS_DEVICE_HEALTH_KEY = ["desktop", "thisDeviceHealth"] as const;
/** Asked again this often while the settings list is on screen, as well as whenever the window comes back. */
const THIS_DEVICE_HEALTH_POLL_MS = 60_000;

/** How many things need the person on this computer, and whether the server runs here (ADR 0265 §2); off elsewhere. */
export function useThisDeviceHealth() {
  return useQuery({
    queryKey: THIS_DEVICE_HEALTH_KEY,
    queryFn: thisMac.health,
    enabled: desktopHasSettingsLayer(),
    // Never fresh for long: macOS takes a permission back while the window is away, and coming back shows it.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: THIS_DEVICE_HEALTH_POLL_MS,
    retry: false,
    meta: { quiet: true },
  });
}

const SECTION_ICONS: Record<Exclude<ThisDeviceSection, "overview">, IconName> = {
  folders: "drive",
  server: "globe",
  activity: "list",
  app: "cog",
};

/**
 * Settings › This {{device}} in the desktop app with its own settings layer (ADR 0265 §2): Overview, Folders and tools,
 * Server on this {{device}} (only while the server runs here), Activity and App settings, each opening that section in
 * the app. Overview carries a dot in the warning colour while something on this computer needs the person. Nothing
 * until the app answers, nothing outside it or in an app without the layer: the group sits at the list's end, so
 * nothing above it moves when it comes in.
 */
export function ThisDeviceSettingsGroup() {
  const { t } = useTranslation();
  const titleId = useId();
  const health = useThisDeviceHealth().data;
  if (!desktopHasSettingsLayer() || !health) return null;
  const sections = THIS_DEVICE_SECTIONS.filter((id) => id !== "server" || health.server);
  const icon = (id: ThisDeviceSection): IconName =>
    id === "overview" ? (desktopPlatform() === "mac" ? "computerMac" : "computer") : SECTION_ICONS[id];
  return (
    <div className="settings__group">
      <h2 className="settings__group-title" id={titleId}>
        {t("settings.thisDevice.title")}
      </h2>
      <ul aria-labelledby={titleId}>
        {sections.map((id) => (
          <li key={id}>
            <button
              type="button"
              className="settings__link"
              onClick={() => void thisMac.openSettings(id).catch(() => {})}
            >
              <Icon name={icon(id)} size={18} />
              {t(`settings.thisDevice.section.${id}`)}
              {id === "overview" && health.needs > 0 && (
                <span
                  className="settings__needs"
                  role="img"
                  aria-label={t("settings.thisDevice.needs", { count: health.needs })}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A server only its own computer opens (the desktop app's, with access from other devices off): what that stops, and
 * the way to turn that access on, from the app itself in one click, or said for the computer it runs on.
 */
export function LocalOnlyNote({ text, here, how }: { text: string; here: string; how: string }) {
  const { t } = useTranslation();
  return (
    <div className="stack-4" style={{ gap: 12 }}>
      <Alert>{text}</Alert>
      {inDesktopApp() ? (
        <div className="ac-actline">
          <span className="small muted">{here}</span>
          <OpenThisMacButton section="server" focus="reach">
            {t("machines.thisMac.openServers")}
          </OpenThisMacButton>
        </div>
      ) : (
        <span className="small muted">{how}</span>
      )}
    </div>
  );
}

/** A tool switched off in this very computer's Folders and tools, and the way there to turn it on. */
export function ToolsOffHereNote() {
  const { t } = useTranslation();
  return (
    <SettingNote icon="settings">
      {t("machines.thisMac.toolsOff")}
      <span style={{ display: "block", marginTop: "var(--space-2)" }}>
        <OpenThisMacButton section="folders" focus="tools">
          {t("machines.thisMac.openTools")}
        </OpenThisMacButton>
      </span>
    </SettingNote>
  );
}

/** "Reconectar": this Mac's connection to `orgId` again (the menu bar's "Reconectar"). */
export function ReconnectThisMacButton({ orgId, primary = false }: { orgId: string; primary?: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const reconnect = async () => {
    setBusy(true);
    try {
      await thisMac.reconnect(orgId);
      toast.show(t("machines.thisMac.reconnecting"));
      void qc.invalidateQueries({ queryKey: THIS_MAC_KEY });
    } catch {
      toast.show(t("machines.thisMac.failed"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "default"}
      icon="refresh"
      loading={busy}
      onClick={() => void reconnect()}
    >
      {t("machines.thisMac.reconnect")}
    </Button>
  );
}

/** "Ver no app": the menu bar's popover, where this Mac answers access requests. */
export function ShowRequestsButton() {
  const { t } = useTranslation();
  return (
    <Button size="sm" icon="computer" onClick={() => void thisMac.showRequests().catch(() => {})}>
      {t("machines.thisMac.seeRequest")}
    </Button>
  );
}
