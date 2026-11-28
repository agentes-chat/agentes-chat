/**
 * This computer's essentials (ADR 0265 §7): what keeps agents working here and the server here reachable without
 * anyone looking. Each one is on, off (with the one action that turns it on again), still being read, or not one for
 * this computer. Opening at login, the macOS permissions agents need, reach, the nightly backup, installing updates at
 * night and staying awake while serving are on by default, so one that is off needs the person; starting after a
 * power failure and signing in by itself after a restart are macOS's own settings, shown with their way there but
 * never counted (automatic login is impossible with FileVault, and a laptop has no power-failure setting).
 * Pure: the popover keeps the tray, the notifications and the site's count with it, the app layer draws the list.
 */

import type { KeepRunning, LocalServerStatus } from "./local-server";
import type { MacPermission } from "./permissions";
import type { Platform } from "./platform";
import { isPaired, type TrayInput } from "./tray";

/** The app's notifications as macOS has them (`notify_permission`); always `granted` off a Mac. */
export type NotifyPermission = "granted" | "denied" | "notDetermined";

/** What only the system says about this computer (`health_get`, again on `health://changed`). */
export interface Health {
  /** Opens at login. */
  autostart: boolean;
  /** Screen Recording (true off a Mac). */
  screen: boolean;
  /** Full Disk Access (true off a Mac). */
  disk: boolean;
  notifications: NotifyPermission;
  keepRunning: KeepRunning;
  /** `caffeinate` keeps this Mac awake for the server here now; null off a Mac. */
  awake: boolean | null;
}

export type EssentialId =
  | "launchAtLogin"
  | "notifications"
  | "screen"
  | "disk"
  | "reach"
  | "backup"
  | "autoUpdate"
  | "awake"
  | "powerRestart"
  | "autoLogin";

/** The list's order: what the person sees first in the Overview. */
export const ESSENTIAL_IDS: readonly EssentialId[] = [
  "launchAtLogin",
  "notifications",
  "screen",
  "disk",
  "reach",
  "backup",
  "autoUpdate",
  "awake",
  "powerRestart",
  "autoLogin",
];

/** `checking`: not read yet; `na`: not one for this computer now (not a Mac, no server here, no agents here). */
export type EssentialState = "on" | "off" | "checking" | "na";

/** The one action that turns an essential on again; each screen does it its own way. */
export type EssentialFix =
  /** `setAutostart(true)`. */
  | { kind: "autostart" }
  /** Prepare's way: the system's prompt while it was never asked, else System Settings on its list. */
  | { kind: "permission"; permission: MacPermission }
  /** Reach was left off (only this computer): turning it on chooses how people get here (ADR 0265 §4). */
  | { kind: "reach" }
  /** HTTPS waits for one click in the Tailscale network's admin page: that page. */
  | { kind: "tailscaleHttps" }
  /** The system's Tailscale isn't connected on this computer now: what connects it here. */
  | { kind: "tailscaleStart" }
  /** The person's own address doesn't lead here now: check it again (`setLocalReach(true)`). */
  | { kind: "reachCheck" }
  /** The nightly backup's switch (`setLocalBackups(true, copyTo)`). */
  | { kind: "backups" }
  /** The last backup didn't finish or didn't reach its copy: back up now. */
  | { kind: "backupNow" }
  /** Installing updates at night (`AUTO_UPDATE_PREF`). */
  | { kind: "autoUpdate" }
  /** This version can't keep working: install the newer one. */
  | { kind: "update" }
  /** The server here runs without keeping this Mac awake: restarting it starts `caffeinate` with it. */
  | { kind: "restartServer" }
  /** macOS's own setting: System Settings at Energy (power failure) or Users & Groups (automatic login). */
  | { kind: "systemSettings"; page: "users" | "energy" };

/** Why an essential is off, when there is more than one way it falls (each its own words). */
export type EssentialReason =
  /** Reach: the person chose only this computer. */
  | "chosen"
  /** Reach: HTTPS waits for the Tailscale network's admin. */
  | "approve"
  /** Reach: Tailscale isn't connected on this computer. */
  | "down"
  /** Reach: the person's own address doesn't lead here now. */
  | "address"
  /** Nightly backup switched off. */
  | "off"
  /** The last backup didn't finish. */
  | "backup"
  /** The last backup didn't reach its "Copy to" folder. */
  | "copy"
  /** Updates: this version can't keep working. */
  | "required";

export interface Essential {
  id: EssentialId;
  state: EssentialState;
  /** What turns it on again; null unless it is off. */
  fix: EssentialFix | null;
  reason?: EssentialReason;
  /** Shown with its fix, never counted in `needsYou` nor told in a notification (the person's or macOS's choice). */
  optional?: boolean;
}

export interface EssentialsInput {
  /** Null until the first read answers. */
  health: Health | null;
  local: LocalServerStatus;
  /** Installing updates at night (`autoUpdateOn(readPref(AUTO_UPDATE_PREF))`). */
  autoUpdate: boolean;
  update: { available: boolean; required: boolean };
  /** This computer's organization homes: agents work here once one is paired. */
  homes: readonly TrayInput[];
  platform: Platform;
}

const item = (
  id: EssentialId,
  state: EssentialState,
  fix: EssentialFix | null = null,
  extra: Pick<Essential, "reason" | "optional"> = {},
): Essential => ({ id, state, fix: state === "off" ? fix : null, ...(state === "off" ? extra : {}) });

const onOff = (id: EssentialId, on: boolean | null | undefined, fix: EssentialFix): Essential =>
  on === undefined ? item(id, "checking") : on === null ? item(id, "na") : item(id, on ? "on" : "off", fix);

/**
 * Why reach needs the person, from what the server here's status says (`reachHealth`, ADR 0265 §4): HTTPS waiting for
 * the Tailscale network's admin, Tailscale not connected here, or the person's own address not leading here now; null
 * while it works. Each has one fix.
 */
function reachProblem(local: LocalServerStatus): Essential | null {
  const off = (reason: EssentialReason, fix: EssentialFix) => item("reach", "off", fix, { reason });
  switch (local.reachHealth) {
    case "approve":
      return off("approve", { kind: "tailscaleHttps" });
    case "down":
      return off("down", { kind: "tailscaleStart" });
    case "address":
      return off("address", { kind: "reachCheck" });
    default:
      return null;
  }
}

/** Every essential, in `ESSENTIAL_IDS`' order. */
export function essentialsOf(input: EssentialsInput): Essential[] {
  const { health, local, platform, update } = input;
  const mac = platform === "mac";
  const here = local.run;
  // This computer was made ready for agents (a workspace paired it) or runs the server: it has to stay ready.
  const used = here || input.homes.some(isPaired);
  const read = <T>(pick: (h: Health) => T) => (health ? pick(health) : undefined);
  const list: Essential[] = [];

  const login = read((h) => h.autostart);
  list.push(used ? onOff("launchAtLogin", login, { kind: "autostart" }) : item("launchAtLogin", "na"));

  const permission = (id: MacPermission, on: boolean | undefined) =>
    mac && used ? onOff(id, on, { kind: "permission", permission: id }) : item(id, "na");
  list.push(
    permission(
      "notifications",
      read((h) => h.notifications === "granted"),
    ),
  );
  list.push(
    permission(
      "screen",
      read((h) => h.screen),
    ),
  );
  list.push(
    permission(
      "disk",
      read((h) => h.disk),
    ),
  );

  if (!here) {
    list.push(item("reach", "na"));
  } else if (!local.reach || local.reachHealth === "off") {
    list.push(item("reach", "off", { kind: "reach" }, { reason: "chosen", optional: true }));
  } else {
    list.push(reachProblem(local) ?? item("reach", "on"));
  }

  if (!here) {
    list.push(item("backup", "na"));
  } else if (!local.backups.nightly) {
    list.push(item("backup", "off", { kind: "backups" }, { reason: "off" }));
  } else if (local.backups.problem) {
    list.push(item("backup", "off", { kind: "backupNow" }, { reason: local.backups.problem }));
  } else {
    list.push(item("backup", "on"));
  }

  if (update.required) {
    list.push(item("autoUpdate", "off", { kind: "update" }, { reason: "required" }));
  } else {
    list.push(item("autoUpdate", input.autoUpdate ? "on" : "off", { kind: "autoUpdate" }));
  }

  // Staying awake is the server's while it serves: stopped or starting, it isn't one now.
  const awake = health?.awake ?? local.awake;
  const serving = mac && here && local.phase === "running";
  list.push(serving ? item("awake", awake ? "on" : "off", { kind: "restartServer" }) : item("awake", "na"));

  const keep = (id: "powerRestart" | "autoLogin", on: boolean | null | undefined, page: "users" | "energy") => {
    if (!mac || !here) return item(id, "na");
    if (on === undefined) return item(id, "checking");
    if (on === null) return item(id, "na");
    return item(id, on ? "on" : "off", { kind: "systemSettings", page }, { optional: true });
  };
  list.push(
    keep(
      "powerRestart",
      read((h) => h.keepRunning.autoRestart),
      "energy",
    ),
  );
  list.push(
    keep(
      "autoLogin",
      read((h) => h.keepRunning.autoLogin),
      "users",
    ),
  );
  return list;
}

/** Off and on by default: what "N things need you" counts, and what turns the tray to `attention`. */
export const needsYou = (list: readonly Essential[]) => list.filter((e) => e.state === "off" && !e.optional).length;

/**
 * Whether an essential that is off fell by itself (macOS took a permission back, reach or a backup failed, the server
 * runs without keeping this Mac awake, this version can't keep working), never by a switch the person turned off in
 * the app: only those are told in a notification.
 */
export function fellByItself(e: Essential): boolean {
  if (e.id === "screen" || e.id === "disk" || e.id === "awake") return true;
  if (e.id === "reach") return e.reason !== "chosen";
  if (e.id === "backup") return e.reason === "backup" || e.reason === "copy";
  return e.id === "autoUpdate" && e.reason === "required";
}

/**
 * What the popover last saw on (`essentialsNotified`, kept across openings so a permission macOS took back while the
 * app was closed is told at the next opening).
 */
export const ESSENTIALS_NOTIFIED_PREF = "essentialsNotified";
export interface EssentialsSeen {
  on: EssentialId[];
}

/**
 * The essentials that fell by themselves since `seen`: on then, off now and counted (`fellByItself`). Each is told
 * once: it leaves `on` as it falls, and only coming back on lets it be told again. One never seen on (skipped at
 * Prepare, off before this version) is the Overview's and the tray's to say, never a notification. Still being read or
 * not one now: `on` keeps it as it was.
 */
export function fallenSince(
  list: readonly Essential[],
  seen: EssentialsSeen | null,
): { fallen: EssentialId[]; seen: EssentialsSeen } {
  const before = new Set(seen?.on ?? []);
  const fallen = list
    .filter((e) => e.state === "off" && !e.optional && fellByItself(e) && before.has(e.id))
    .map((e) => e.id);
  const on = ESSENTIAL_IDS.filter((id) => {
    const e = list.find((x) => x.id === id);
    if (!e) return before.has(id);
    if (e.state === "on") return true;
    if (e.state === "off") return false;
    return before.has(id);
  });
  return { fallen, seen: { on } };
}
