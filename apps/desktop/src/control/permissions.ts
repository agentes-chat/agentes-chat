/**
 * The macOS permissions agents need on this computer (ADR 0165 "Prepare this Mac", ADR 0256 §7): notifications, so
 * the app can say when agents finish or need the person and when an essential falls, Screen Recording, for the
 * screenshots their commands take, and Full Disk Access, so no folder prompt stops them mid-task. The app asks for them
 * and its runners inherit them. macOS says whether each is allowed without asking. Notifications and Screen Recording
 * have a prompt the first time; Full Disk Access has none: people turn the app on in System Settings. An ad-hoc signed
 * app loses every grant when it updates. Local Network (Android phones over Wi-Fi) is no longer one of them: it has no
 * state to read, so it is asked just in time, when an Android phone pairs over Wi-Fi (the site's `localNetwork`).
 */
import type { OsPermission, PermissionNeed } from "@agenteschat/adapters/machine-protocol";
import type { Host } from "../host/types";
import type { Home } from "./store";

export const MAC_PERMISSIONS = ["notifications", "screen", "disk"] as const;
export type MacPermission = (typeof MAC_PERMISSIONS)[number];

/** What the app remembers asking for in a version: Prepare's permissions, and Local Network (asked just in time). */
export type AskedPermission = MacPermission | "network";

/**
 * `ask`: never asked (notifications), or not asked in this version yet (Screen Recording); `off`: asked and not
 * allowed, or not allowed with no prompt to ask (Full Disk Access): the way out is System Settings.
 */
export type Grant = "on" | "off" | "ask";
export type Grants = Record<MacPermission, Grant>;

/** The permissions asked for in a version of the app. */
export const MAC_ASKED_PREF = "macAsked";
export interface Asked {
  version: string;
  asked: AskedPermission[];
}

export const askedIn = (saved: Asked | null, version: string): AskedPermission[] =>
  saved?.version === version ? saved.asked : [];

export const withAsked = (saved: Asked | null, version: string, p: AskedPermission): Asked => {
  const asked = askedIn(saved, version);
  return { version, asked: asked.includes(p) ? asked : [...asked, p] };
};

/** Local Network is a permission from macOS 15 on (`system`: macOS's version). Unread, it is asked. */
export const hasLocalNetwork = (system?: string | null) => !system || Number.parseInt(system, 10) >= 15;

/**
 * Each permission's state, without raising a prompt. Notifications say themselves whether they were ever asked
 * (macOS keeps that); Screen Recording is `ask` until asked in this version (`asked`), since an update may take it
 * back; Full Disk Access is `ask` until on (its button is always System Settings).
 */
export async function readGrants(host: Host, asked: readonly AskedPermission[]): Promise<Grants> {
  const [notifications, screen, disk] = await Promise.all([
    host.notificationPermission(),
    host.screenAccess(),
    host.diskAccess(),
  ]);
  const state = (p: MacPermission, on: boolean): Grant => (on ? "on" : asked.includes(p) ? "off" : "ask");
  return {
    notifications: notifications === "granted" ? "on" : notifications === "denied" ? "off" : "ask",
    screen: state("screen", screen),
    disk: state("disk", disk),
  };
}

/** Nothing left to ask: each permission on. */
export const allDone = (grants: Grants) => MAC_PERMISSIONS.every((p) => grants[p] === "on");

/**
 * Its button opens System Settings: Full Disk Access always (no prompt asks for it), the others once asked (macOS
 * prompts only once).
 */
export const viaSettings = (p: MacPermission, grant: Grant) => p === "disk" || grant === "off";

/**
 * A setup macOS may quit the app in the middle of (the "Quit & Reopen" after Screen Recording or Full Disk Access),
 * kept in the app's data folder (`prepare.rs`) so the app reopens it: the pairing window's Prepare step for `org`, or
 * Preferences. `resumed`: the app reopened it at launch.
 */
export type SetupState = ({ step: "prepare"; org: string; server: string } | { step: "prefs" }) & {
  resumed?: boolean;
};

/**
 * An OS permission a runner of this app waits on (an agent's command macOS refused): the dialog asks the person, and
 * the web, the phone and the agent see "waiting for permission" until it ends here (`permission.clear`).
 */
export interface PermissionAsk {
  homeId: string;
  need: PermissionNeed;
  /** The asking agent's name, when the runner knows it. */
  agent?: string;
}

/** Every wait of every paired home, in the homes' order. */
export const permissionAsks = (homes: readonly Home[]): PermissionAsk[] =>
  homes.flatMap((h) =>
    (h.status?.permissions ?? []).map((need) => {
      const agent = need.agentId ? h.status?.agents.find((a) => a.id === need.agentId)?.name : undefined;
      return { homeId: h.homeId, need, ...(agent ? { agent } : {}) };
    }),
  );

export const askKey = (a: PermissionAsk) => `${a.homeId}:${a.need.permission}`;

/**
 * Whether the permission is on, where macOS says so without asking (Screen Recording, Full Disk Access); null where
 * only the person knows (App Management, Accessibility, Automation and the rest have no read the app may make).
 */
export async function permissionOn(host: Host, p: OsPermission): Promise<boolean | null> {
  if (p === "screen") return host.screenAccess();
  if (p === "disk") return host.diskAccess();
  return null;
}
