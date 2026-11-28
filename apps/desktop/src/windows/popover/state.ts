/**
 * The menu bar popover's choices, from this computer's state (ADR 0265 §7): the line under its name, the one
 * essential its banner shows with the action that turns it on again, the server here's state in a word, and "Now" as
 * one row per agent. Pure: `Popover.tsx` and its pieces draw them.
 */
import type { ControlJob } from "@agenteschat/adapters/runner-control";
import type { IconName } from "@agenteschat/ui";
import type { Essential, EssentialFix, EssentialId } from "../../control/essentials";
import type { LocalServerStatus } from "../../control/local-server";
import type { LayerRoute } from "../../host/types";

/** A state's colour: state is coloured text, never a pill. */
export type Tone = "warn" | "ok" | "muted" | "danger";

/**
 * The line under this computer's name: how many things need the person (essentials off, folder requests, permissions
 * an agent's work waits on), else paused, else every workspace out of reach, else all set.
 */
export type HeadLine =
  | { kind: "needs"; count: number }
  | { kind: "paused"; until: string | null }
  | { kind: "offline" }
  | { kind: "allSet" };

export function headLine(input: {
  needs: number;
  pause: { until?: string | null } | null;
  offline: boolean;
}): HeadLine {
  if (input.needs > 0) return { kind: "needs", count: input.needs };
  if (input.pause) return { kind: "paused", until: input.pause.until ?? null };
  if (input.offline) return { kind: "offline" };
  return { kind: "allSet" };
}

export const HEAD_TONE: Record<HeadLine["kind"], Tone> = {
  needs: "warn",
  paused: "muted",
  offline: "danger",
  allSet: "ok",
};

/** An essential's words on the banner: its title and the line under it (i18n keys). */
export interface EssentialWords {
  title: string;
  body: string;
}

const E = "desktop.tray.essential";
const N = "desktop.essentials.notify";

/** Each essential the banner can show, by why it is off where that changes the words. */
export function essentialWords(e: Essential): EssentialWords | null {
  switch (e.id) {
    case "launchAtLogin":
      return { title: `${E}.launchAtLogin.title`, body: `${E}.launchAtLogin.body` };
    case "notifications":
      return { title: `${E}.notifications.title`, body: `${E}.notifications.body` };
    case "screen":
      return { title: `${N}.screen.title`, body: `${E}.screen.body` };
    case "disk":
      return { title: `${N}.disk.title`, body: `${E}.disk.body` };
    case "reach": {
      // HTTPS waiting for the Tailscale network's admin, the person's own address not leading here, else Tailscale off.
      const why = e.reason === "approve" || e.reason === "address" ? e.reason : "down";
      return { title: `${E}.reach.${why}.title`, body: `${E}.reach.${why}.body` };
    }
    case "backup":
      if (e.reason === "backup") return { title: `${N}.backup.title`, body: `${E}.backup.backup.body` };
      if (e.reason === "copy") return { title: `${E}.backup.copy.title`, body: `${E}.backup.copy.body` };
      return { title: `${E}.backup.off.title`, body: `${E}.backup.off.body` };
    case "autoUpdate":
      return { title: `${E}.autoUpdate.title`, body: `${E}.autoUpdate.body` };
    case "awake":
      return { title: `${N}.awake.title`, body: `${N}.awake.body` };
    default:
      // Starting after a power failure and signing in by itself are macOS's own settings, never counted.
      return null;
  }
}

/** The banner's icon for each essential. */
export const ESSENTIAL_ICON: Record<EssentialId, IconName> = {
  launchAtLogin: "power",
  notifications: "bell",
  screen: "eye",
  disk: "drive",
  reach: "globe",
  backup: "archiveBox",
  autoUpdate: "download",
  awake: "computer",
  powerRestart: "power",
  autoLogin: "power",
};

/** The banner's icon for this essential: reach through the person's own address shows a link, as its row does. */
export const essentialIcon = (e: Essential): IconName =>
  e.id === "reach" && e.reason === "address" ? "link" : ESSENTIAL_ICON[e.id];

/**
 * The essential the popover's banner shows: the first one off that counts ("N things need you"), in the Overview's
 * order. A version that can't keep working has its own banner ("Update to keep going"), so it isn't said twice.
 */
export const bannerEssential = (list: readonly Essential[]): Essential | null =>
  list.find(
    (e) => e.state === "off" && !e.optional && e.fix !== null && e.fix.kind !== "update" && !!essentialWords(e),
  ) ?? null;

/**
 * What the banner's one button does. The popover turns on what it can by itself (opening at login, the notification
 * prompt, the macOS permission's own list in System Settings, installing updates at night, restarting the server
 * here); what needs a screen of its own (reach, backups) opens This computer's settings on it.
 */
export type FixPlan =
  | { kind: "autostart" }
  /** The system's prompt; once it was answered no, This computer's settings show the way (`notifications`). */
  | { kind: "notifications" }
  | { kind: "privacy"; pane: "screen" | "disk" }
  | { kind: "autoUpdate" }
  | { kind: "restart" }
  | { kind: "layer"; route: LayerRoute };

const overview = (focus: string): LayerRoute => ({ screen: "settings", section: "overview", focus });
/** Reach's row in Settings › Server on this computer, where its way, its problem and its fix are (ADR 0265 §4). */
const REACH_ROUTE: LayerRoute = { screen: "settings", section: "server", focus: "reach" };

export function fixPlan(fix: EssentialFix): FixPlan {
  switch (fix.kind) {
    case "autostart":
      return { kind: "autostart" };
    case "permission":
      return fix.permission === "notifications" ? { kind: "notifications" } : { kind: "privacy", pane: fix.permission };
    case "autoUpdate":
      return { kind: "autoUpdate" };
    case "restartServer":
      return { kind: "restart" };
    case "update":
      return { kind: "layer", route: overview("updates") };
    case "backups":
    case "backupNow":
      return { kind: "layer", route: { screen: "settings", section: "server", focus: "backups" } };
    case "systemSettings":
      return { kind: "layer", route: { screen: "settings", section: "overview" } };
    default:
      // Reach, either way: its fix lives on the server here's reach row.
      return { kind: "layer", route: REACH_ROUTE };
  }
}

/** The button's words for each plan (i18n keys); `backupNow` says what the screen it opens is for. */
export function fixLabel(fix: EssentialFix): string {
  const plan = fixPlan(fix);
  if (plan.kind === "restart") return "desktop.server.restart";
  if (plan.kind === "privacy" && plan.pane === "screen") return `${E}.turnOnAgain`;
  if (plan.kind === "layer") return fix.kind === "backupNow" ? "desktop.server.backup" : `${E}.fix`;
  return `${E}.turnOn`;
}

/** The server here's state in a word, in its colour, and whether it is on its way somewhere (it shimmers). */
export function hereState(local: LocalServerStatus): { key: string; tone: Tone; busy: boolean } {
  switch (local.phase) {
    case "running":
      return { key: "desktop.server.running", tone: "ok", busy: false };
    case "starting":
      return { key: "desktop.server.starting", tone: "muted", busy: true };
    case "restarting":
      return { key: "desktop.server.restarting", tone: "muted", busy: true };
    case "updating":
      return { key: "desktop.server.updating", tone: "muted", busy: true };
    case "failing":
      return { key: "desktop.server.failing", tone: "danger", busy: false };
    default:
      return { key: "desktop.server.stopped", tone: "warn", busy: false };
  }
}

/** One row of "Now": an agent (or the computer's own work) with its latest job, and how many it has going. */
export interface AgentRow<H> {
  key: string;
  home: H;
  agent: { id: string; name: string } | null;
  job: ControlJob;
  jobs: number;
}

/**
 * "Now" as one row per agent of each workspace, the most recent first within it: its latest job says what it does.
 * A job with no agent (the computer's own) is a row of its own. `skip`: jobs shown elsewhere (an agent's thinking
 * while it drives its browser shows as its browser row).
 */
export function agentRows<H extends { homeId: string; jobs: readonly ControlJob[] }>(
  homes: readonly H[],
  skip: (home: H, job: ControlJob) => boolean = () => false,
): AgentRow<H>[] {
  const rows: AgentRow<H>[] = [];
  for (const home of homes) {
    const byAgent = new Map<string, AgentRow<H>>();
    for (const job of home.jobs) {
      if (skip(home, job)) continue;
      const key = job.agent ? `${home.homeId}:${job.agent.id}` : `${home.homeId}:job:${job.id}`;
      const row = byAgent.get(key);
      if (!row) {
        byAgent.set(key, { key, home, agent: job.agent ?? null, job, jobs: 1 });
        continue;
      }
      row.jobs += 1;
      if (Date.parse(job.startedAt) > Date.parse(row.job.startedAt)) row.job = job;
    }
    rows.push(...[...byAgent.values()].sort((a, b) => Date.parse(b.job.startedAt) - Date.parse(a.job.startedAt)));
  }
  return rows;
}
