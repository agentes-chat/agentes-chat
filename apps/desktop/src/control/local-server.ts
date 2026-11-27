/**
 * The server here ("Run agentes.chat on this computer") as the windows see it: `local_server.rs` keeps it and
 * says how it is; this decides what each window shows (the first run's steps and screens, the popover's
 * banners, the cover's line, Preferences' words). Pure, so it is tested without the app.
 */

import { CLOUD_SERVER } from "@agenteschat/client/lib/server";
import type { Platform } from "./platform";

/** `restarting`: it stopped by itself and starts again in a moment (nobody has to start it). */
export type LocalPhase = "off" | "starting" | "updating" | "running" | "stopped" | "restarting" | "failing";

export interface LocalServerStatus {
  /** This build carries the server (Mac and Linux builds do). */
  bundled: boolean;
  /** What `~/.agentes` holds: the app's own server, or one installed from the terminal. */
  installed: "none" | "app" | "terminal";
  /** The app runs it (it starts with the app). */
  run: boolean;
  /** Its owner's account exists. */
  owner: boolean;
  phase: LocalPhase;
  /** Its loopback address (a terminal install's too). */
  url: string | null;
  /** The address the main window on this computer opens: the app's own server's loopback one (ADR 0256 §5). */
  localUrl: string | null;
  /** Its address for people (the phone, the team, links): the Tailscale one or the person's own with reach on, else null. */
  publicUrl: string | null;
  reach: boolean;
  /**
   * How the phone and the team reach it, as saved with it (ADR 0256 §4): kept while reach is off, for turning it on
   * again; null: never chosen.
   */
  way: ReachWay | null;
  /**
   * The port it listens on at loopback (`PORT`), the one a tunnel points at; before any setup, the port the setup would
   * pick now. Null: not known.
   */
  port: number | null;
  /** Reach in one word, for this computer's essentials. */
  reachHealth: ReachHealth;
  /** Usage statistics on (`TELEMETRY`). */
  usage: boolean;
  /** The installed bundle's version, even while the server is stopped or restarting. */
  installedVersion: string | null;
  /** The package version reported by the running local server. */
  serverVersion: string | null;
  dir: string;
  /** The person's name on this computer (the welcome window only). */
  systemName: string | null;
  /** A terminal install's server runs now (the welcome window only). */
  serving: boolean;
  /** A terminal install still waiting for its owner, and running: its claim (the welcome window only). */
  claim: string | null;
  /** An update didn't start and it went back to this version. */
  backTo: string | null;
  /** Stopped by the person to stay stopped: it doesn't start with the app until Start, or until `heldUntil`. */
  held: boolean;
  /** When a stop for a while ends and it starts again by itself (milliseconds since 1970); null: until Start. */
  heldUntil: number | null;
  /** Reach is on, but people can't get here now (Tailscale not connected here, or the person's address down). */
  reachDown: boolean;
  backups: LocalBackups;
  /** This Mac doesn't sleep while it runs (`caffeinate`). */
  awake: boolean;
  /** Where "Erase and start over" moves its folder today (the app's own install only). */
  eraseTo: string | null;
  /** Where an erase moved its folder, until a new setup makes one again. */
  erased: string | null;
}

export interface LocalBackups {
  /** "Back up every night" (at 3:00, local time). */
  nightly: boolean;
  /** "Copy to": each new backup is copied to this folder too. */
  copyTo: string | null;
  /** Its backups, newest first; `at` in milliseconds since 1970. */
  files: { path: string; at: number }[];
  /** The last backup didn't finish, or didn't reach the "Copy to" folder. */
  problem: "backup" | "copy" | null;
}

/** What keeps the server here up after a restart or a power cut; null where the app can't tell (not a Mac, a laptop). */
export interface KeepRunning {
  autoLogin: boolean | null;
  autoRestart: boolean | null;
}

/** `app`: Tailscale's Mac app is there to open, not only its command-line tool (Homebrew's). The system's Tailscale. */
export type Tailnet = { state: "missing" } | { state: "off"; app: boolean } | { state: "on"; device: string };

/**
 * How the phone and the team reach the server here (ADR 0256 §4): the official Tailscale the person installs, or an
 * address of their own (a tunnel or a domain of theirs, running on this computer, that leads to the server here).
 */
export type ReachWay = { kind: "tailscale" } | { kind: "address"; url: string };
/**
 * Why an address of the person's own doesn't lead here: not an https origin, nothing opens there, another server
 * answers there, or it answered with an error (its HTTP status when there was one).
 */
export type AddressProblem = "notHttps" | "unreachable" | "otherServer" | "error";
/** The app's check of an address (`local_server_check_address`): its origin when it leads here. */
export type AddressCheck = { ok: true; url: string } | { ok: false; why: AddressProblem; status?: number };
/**
 * Reach in one word (`reachHealth`): off, on, or what keeps the phone and the team from it now: HTTPS waiting for the
 * Tailscale network's admin (`approve`), Tailscale not connected here (`down`), the person's address not leading here
 * now (`address`).
 */
export type ReachHealth = "on" | "off" | "approve" | "down" | "address";
/** Tailscale's pages the app opens: its Mac app, its official download page, where HTTPS is turned on, its admin. */
export type TailscalePage = "app" | "download" | "https" | "admin";
/** The phone's QR code: the link it opens, its server (the address for people), and seconds left. */
export interface PhoneLink {
  link: string;
  server: string;
  expiresIn: number;
}

/**
 * Where Tailscale gets connected on this system: its app, which the app opens (a Mac with that app), its icon by the
 * clock (Windows: tailscale.com/kb/1022/install-windows), or `sudo tailscale up` in the terminal (Linux, and a Mac
 * with only the command-line tool). `tailnet` not read yet: a Mac's app.
 */
export function tailscaleFrom(platform: Platform, tailnet: Tailnet | null): "app" | "tray" | "terminal" {
  if (platform === "windows") return "tray";
  if (platform === "linux") return "terminal";
  return tailnet?.state === "off" && !tailnet.app ? "terminal" : "app";
}
/**
 * Why reach didn't turn on: HTTPS off in the Tailscale network, Tailscale's permission (Linux), Tailscale missing or
 * refusing, Tailscale installed but not connected here (`app`: its Mac app is there to open), the person stopped
 * waiting for HTTPS, the server didn't answer again at its new address, or the person's own address doesn't lead here
 * (`why`, ADR 0256 §4). `back`: turning it off, the server didn't answer again at this computer's own address.
 */
export type ServeProblem =
  | { reason: "https"; url: string | null }
  | { reason: "operator" }
  | { reason: "serve" }
  | { reason: "notConnected"; app: boolean }
  | { reason: "address"; why: AddressProblem; status?: number }
  | { reason: "stopped" }
  | { reason: "start" }
  | { reason: "back" };
/**
 * What turning reach on or off is doing now (`local-server://reach`): confirming the person's address leads here
 * (`checking`), Tailscale sharing it, Tailscale waiting for HTTPS to be allowed at `url`, the server starting again
 * behind the window with its address for people, and done (that address). The window stays on this computer's own
 * address throughout (ADR 0256 §5).
 */
export type ReachStage =
  | { stage: "checking" | "sharing" | "restarting" }
  | { stage: "approve"; url: string }
  | { stage: "done"; url: string };
export type ReachResult = { ok: true; url: string } | { ok: false; problem: ServeProblem };

/**
 * An address the person typed, by its form only (the app checks where it leads, `checkAddress`): an https origin, with
 * a port or not, and nothing after it but "/" (no path, query, fragment or user). Ok: the origin, lowercased by the
 * URL parser, as the server's `PUBLIC_URL` will be (ADR 0256 §4).
 */
export function addressForm(input: string): { ok: true; url: string } | { ok: false; why: "notHttps" } {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "notHttps" };
  }
  const bare = url.pathname === "/" && !url.search && !url.hash && !raw.endsWith("?") && !raw.endsWith("#");
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || !bare)
    return { ok: false, why: "notHttps" };
  return { ok: true, url: url.origin };
}

/** Where a tunnel on this computer points to reach the server here: its loopback address, by its port. */
export const tunnelTarget = (port: number | null) => (port ? `http://127.0.0.1:${port}` : null);

/** What each address problem says (`desktop.reach.problem.*`; `unreachable` takes `{ target }`, `error` `{ status }`). */
export const ADDRESS_TEXT: Record<AddressProblem, string> = {
  notHttps: "desktop.reach.problem.notHttps",
  unreachable: "desktop.reach.problem.unreachable",
  otherServer: "desktop.reach.problem.otherServer",
  error: "desktop.reach.problem.error",
};
/** The words of an address problem: the key and its values (no status, or no port known: a line without them). */
export function addressWords(
  why: AddressProblem,
  status: number | undefined,
  port: number | null,
): { key: string; values: Record<string, string | number> } {
  if (why === "error")
    return status === undefined
      ? { key: "desktop.reach.problem.errorPlain", values: {} }
      : { key: ADDRESS_TEXT.error, values: { status } };
  if (why === "unreachable") {
    const target = tunnelTarget(port);
    return target
      ? { key: ADDRESS_TEXT.unreachable, values: { target } }
      : { key: "desktop.reach.problem.unreachablePlain", values: {} };
  }
  return { key: ADDRESS_TEXT[why], values: {} };
}

/** Where agentes.chat on this computer will be used: here, the phone and the team, or here only. */
export type LocalPlace = "everywhere" | "here";

/** What Run here asks the app to set up; `place: "everywhere"` carries how people reach it (`way`). */
export interface LocalChoice {
  name?: string;
  email?: string;
  place: LocalPlace;
  way?: ReachWay;
  usage: boolean;
}

export type SetupStep = "database" | "start" | "account" | "computer" | "reach";
export type StepState = "todo" | "active" | "done" | "failed" | "warn";
export interface StepChange {
  step: SetupStep;
  state: Exclude<StepState, "todo">;
  reason?: ServeProblem;
}

/** Nothing set up yet, not running: how the windows start before the app answers. */
export const NO_SERVER: LocalServerStatus = {
  bundled: false,
  installed: "none",
  run: false,
  owner: false,
  phase: "off",
  url: null,
  localUrl: null,
  publicUrl: null,
  reach: false,
  way: null,
  port: null,
  reachHealth: "off",
  usage: true,
  installedVersion: null,
  serverVersion: null,
  dir: "~/.agentes",
  systemName: null,
  serving: false,
  claim: null,
  backTo: null,
  held: false,
  heldUntil: null,
  reachDown: false,
  backups: { nightly: true, copyTo: null, files: [], problem: null },
  awake: false,
  eraseTo: null,
  erased: null,
};

/**
 * "Setting it up", in order; access from the phone and the team only when it will be used there. The window is signed
 * in right after `account`, before `computer` and `reach` (ADR 0256 §3).
 */
export const setupSteps = (place: LocalPlace): SetupStep[] => [
  "database",
  "start",
  "account",
  "computer",
  ...(place === "everywhere" ? (["reach"] as const) : []),
];

/** Each step's state from the changes that arrived; a step not heard of yet is still to do. */
export function stepStates(steps: readonly SetupStep[], changes: readonly StepChange[]): Record<SetupStep, StepState> {
  const out = Object.fromEntries(steps.map((s) => [s, "todo"])) as Record<SetupStep, StepState>;
  for (const c of changes) if (c.step in out) out[c.step] = c.state;
  return out;
}

/**
 * A setup normally ends in under 30 s, so a step under way shows its time from 10 s, and from 30 s it is "taking a
 * little longer than expected". The server here updating says "This can take a minute": it is slow only after two.
 */
export const STEP_TIME_MS = 10_000;
export const STEP_SLOW_MS = 30_000;
export const UPDATE_SLOW_MS = 120_000;
export const stepClock = (ms: number, slowAfter = STEP_SLOW_MS) => ({
  time: ms >= STEP_TIME_MS,
  slow: ms >= slowAfter,
});

/** Where a setup that ended in an error stops: the failed step, else the one under way, else the first not done. */
export function failedStep(steps: readonly SetupStep[], states: Record<SetupStep, StepState>): SetupStep {
  return (
    steps.find((s) => states[s] === "failed") ??
    steps.find((s) => states[s] === "active") ??
    steps.find((s) => states[s] !== "done" && states[s] !== "warn") ??
    (steps[steps.length - 1] as SetupStep)
  );
}

/** What a failed step says (`computer` and `reach` never fail on their own: the general line if they ever do). */
export const FAIL_TEXT: Record<SetupStep, string> = {
  database: "desktop.here.fail.database",
  start: "desktop.here.fail.start",
  account: "desktop.here.fail.account",
  computer: "desktop.common.error",
  reach: "desktop.common.error",
};

/** What "Run agentes.chat on this computer" shows. */
export type HereView =
  /** The form; `ask`: the owner's name and email (no owner yet). */
  | { kind: "form"; ask: boolean }
  /** The app runs it already: open it (at its loopback address, the one this computer opens). */
  | { kind: "running"; server: string }
  /** One already runs on this computer, installed from the terminal: use it (its owner page while it waits). */
  | { kind: "already"; server: string; claim: string | null }
  /** One is installed from the terminal but isn't running: it starts there (the app never runs it). */
  | { kind: "stopped" };

/**
 * The app runs it, but no account is left there (its owner deleted theirs, and nobody else had one): setting it up
 * again over its data, with a name and email, makes the new owner.
 */
export const ownerless = (status: LocalServerStatus) => status.installed === "app" && status.run && !status.owner;

/**
 * `answering`: an agentes.chat server that answered on this computer's loopback (Connect's discovery), when the
 * app doesn't run one itself.
 */
export function hereView(status: LocalServerStatus, answering: string | null): HereView {
  if (ownerless(status)) return { kind: "form", ask: true };
  if (status.run) return { kind: "running", server: status.localUrl ?? status.url ?? "" };
  if (status.installed === "terminal")
    return status.serving && status.url
      ? { kind: "already", server: status.url, claim: status.claim }
      : { kind: "stopped" };
  if (status.installed !== "app" && answering) return { kind: "already", server: answering, claim: null };
  return { kind: "form", ask: !(status.installed === "app" && status.owner) };
}

/** Why reach didn't turn on, in `desktop.here.reason.*`'s words. */
export const REASON_TEXT: Record<ServeProblem["reason"], string> = {
  https: "desktop.here.reason.https",
  operator: "desktop.here.reason.operator",
  serve: "desktop.here.reason.serve",
  notConnected: "desktop.here.reason.notConnected",
  address: "desktop.reach.reason.address",
  stopped: "desktop.here.reason.stopped",
  start: "desktop.here.reason.start",
  back: "desktop.here.reason.back",
};

/** The server here in a few words: "Running · only on this Mac", "Starting", … */
export function hereLine(status: LocalServerStatus): string {
  switch (status.phase) {
    case "running": {
      if (!status.reach) return "desktop.server.onlyHere";
      const down = status.reachDown || status.reachHealth === "down" || status.reachHealth === "address";
      if (status.way?.kind === "address") return down ? "desktop.reach.line.addressDown" : "desktop.reach.line.address";
      return down ? "desktop.server.tailnetDown" : "desktop.server.onTailnet";
    }
    case "starting":
      return "desktop.server.starting";
    case "restarting":
      return "desktop.server.restarting";
    case "updating":
      return "desktop.server.updating";
    case "failing":
      return "desktop.server.failing";
    default:
      return "desktop.server.stopped";
  }
}

/** The popover's banner about the server here: stopped (Start it), not starting (Copy details), or an update that went back. */
export function hereBanner(status: LocalServerStatus): "stopped" | "failing" | "back" | null {
  if (!status.run) return null;
  if (status.phase === "failing") return "failing";
  if (status.phase === "stopped") return "stopped";
  return status.backTo ? "back" : null;
}

/**
 * Where the server here keeps uploaded files: `files` in its folder (`FILES_DIR`, apps/server native.ts), written
 * with the folder's own separator (`C:\Users\ana\.agentes` on Windows).
 */
export const filesFolder = (dir: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}files`;

/** Whether `server` is the server here, at any of its addresses. */
export const isHereServer = (status: LocalServerStatus, server: string | null) =>
  status.run && !!server && (server === status.url || server === status.localUrl || server === status.publicUrl);

/** Where a workspace's server runs: on this computer, on agentes.chat's Cloud, or elsewhere. */
export const serverPlace = (status: LocalServerStatus, server: string | null): "here" | "cloud" | "other" =>
  isHereServer(status, server) ? "here" : server === CLOUD_SERVER ? "cloud" : "other";

/**
 * The main window's cover over the server here: starting, updating, stopped or not starting. The window opens it at
 * its loopback address, never through the tailnet (ADR 0256 §5), so Tailscale being off is no reason for a cover: it is
 * an item of this computer's essentials instead.
 */
export function coverHere(
  status: LocalServerStatus,
  current: string | null,
): "starting" | "migrating" | "stopped" | "failing" | null {
  if (!isHereServer(status, current)) return null;
  // Starting again by itself: the same wait as a start, never "stopped".
  if (status.phase === "starting" || status.phase === "restarting") return "starting";
  if (status.phase === "updating") return "migrating";
  if (status.phase === "failing") return "failing";
  if (status.phase !== "running") return "stopped";
  return null;
}
