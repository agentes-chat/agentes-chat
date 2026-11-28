import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type OsPermission,
  PERMISSION_TRIGGER_CHARS,
  type PermissionNeed,
  parsePermissionNeeds,
} from "@agenteschat/adapters/machine-protocol";

/**
 * What macOS's tools print when TCC refused them, by permission. "Operation not permitted" is EPERM, which macOS
 * returns for a protected folder (Full Disk Access) and for an app's bundle (App Management): the path on the line
 * tells them apart.
 */
const MAC_REFUSALS: [OsPermission, RegExp][] = [
  ["screen", /could not create image from (display|window)/i],
  ["automation", /not authori[sz]ed to send apple events|\(-1743\)/i],
  // Not a bare -1719: it is also AppleScript's "Invalid index".
  ["accessibility", /not allowed assistive access|\(-25211\)/i],
];
const EPERM_LINE = /^.*operation not permitted.*$/im;
const APP_BUNDLE = /\.app(\/|\b)/i;

const TCC_DB = "Library/Application Support/com.apple.TCC/TCC.db";

/**
 * Whether this process has Full Disk Access: macOS's privacy database opens only with it (the user's copy, else the
 * system's), the same read as the app's own (`prepare.rs` `disk_access`).
 */
export function fullDiskAccess(home: string = os.homedir()): boolean {
  for (const file of [path.join(home, TCC_DB), path.join("/", TCC_DB)]) {
    try {
      closeSync(openSync(file, "r"));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  return false;
}

let preflight: (() => boolean) | null | undefined;

/**
 * Whether macOS lets the app record the screen, read without a prompt (`CGPreflightScreenCaptureAccess`: macOS answers
 * for the process responsible for this one, the agentes.chat app that started the runner); null off macOS or unread.
 */
export async function screenAllowed(platform: string = process.platform): Promise<boolean | null> {
  if (platform !== "darwin") return null;
  try {
    if (preflight === undefined) {
      const { dlopen, FFIType } = await import("bun:ffi");
      const { symbols } = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
        CGPreflightScreenCaptureAccess: { args: [], returns: FFIType.bool },
      });
      preflight = () => symbols.CGPreflightScreenCaptureAccess();
    }
    return preflight ? preflight() : null;
  } catch {
    preflight = null;
    return null;
  }
}

/** What the stand-in `screencapture` says: the words `MAC_REFUSALS` reads as Screen Recording. */
export const SCREEN_REFUSAL =
  "screencapture: could not create image from display (Screen Recording is off for agentes.chat; the agentes.chat app is asking the person)";

/**
 * A folder with a stand-in `screencapture`, first on a command's PATH while Screen Recording is off: the real one
 * would raise macOS's own prompt each time, before the app could say who asks and why. It refuses at once, and the
 * refusal opens the app's dialog, whose button asks macOS once.
 */
export function screenShimDir(home: string): string {
  const dir = path.join(home, "permission-shims");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "screencapture");
  writeFileSync(file, `#!/bin/sh\necho '${SCREEN_REFUSAL}' >&2\nexit 1\n`);
  chmodSync(file, 0o755);
  return dir;
}

/** Whether a command's output is the Screen Recording refusal, read even when the command went on and ended well. */
export const screenRefused = (text: string) => MAC_REFUSALS.some(([p, re]) => p === "screen" && re.test(text));

/**
 * The OS permission a failed command's output says it lacked, or null: macOS only (Windows prints no refusal of its
 * own a command could be told by). EPERM with Full Disk Access already on is something else (SIP, another user's
 * process, a file's owner), which no permission fixes.
 */
export function permissionOfOutput(
  text: string,
  platform: string = process.platform,
  diskOn: () => boolean = fullDiskAccess,
): OsPermission | null {
  if (platform !== "darwin" || !text) return null;
  for (const [permission, refused] of MAC_REFUSALS) if (refused.test(text)) return permission;
  const eperm = EPERM_LINE.exec(text)?.[0];
  if (!eperm) return null;
  if (APP_BUNDLE.test(eperm)) return "app_management";
  return diskOn() ? null : "disk";
}

/** The waits, in the runner's folder. */
export const PERMISSION_NEEDS_FILE = "permission-needs.json";
/** A wait older than this was left, not interrupted by the app reopening: it isn't kept. */
const KEPT_MS = 24 * 3600_000;
/** How often a wait macOS can be asked about (Screen Recording, Full Disk Access) is read again. */
const READ_EVERY_MS = 3000;

export interface PermissionNeedsOptions {
  now?: () => number;
  /**
   * Where the waits are kept, so a runner that starts again (the app reopened, as macOS asks after Screen Recording)
   * still knows who waited, and wakes them once it is on.
   */
  file?: string;
  /** Whether the permission is on, where macOS says so without asking; null where it can't. */
  isOn?: (permission: OsPermission) => Promise<boolean | null> | boolean | null;
  readEveryMs?: number;
}

/**
 * The permissions this computer waits on, one per permission (the first ask names it). `changed` hears the whole list
 * each time, with the permissions that ended because the person allowed them and weren't told yet (`changed` says
 * whether it reached the server; `flush` tells them again once connected). A wait macOS can be asked about ends by
 * itself once on, read from `start` on.
 */
export class PermissionNeeds {
  private needs: PermissionNeed[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly unsent = new Set<OsPermission>();
  private readonly now: () => number;

  constructor(
    private readonly changed: (needs: PermissionNeed[], allowed: OsPermission[]) => boolean | undefined,
    private readonly opts: PermissionNeedsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    if (opts.file) {
      try {
        const since = this.now() - KEPT_MS;
        this.needs = parsePermissionNeeds(JSON.parse(readFileSync(opts.file, "utf8"))).filter(
          (n) => Date.parse(n.since) >= since,
        );
      } catch {}
    }
  }

  list(): PermissionNeed[] {
    return this.needs.map((n) => ({ ...n }));
  }

  /** Whether it is new: an ask already waiting keeps its first trigger. */
  add(permission: OsPermission, trigger: string, agentId?: string): boolean {
    if (this.needs.some((n) => n.permission === permission)) return false;
    this.needs.push({
      permission,
      trigger: trigger.trim().slice(0, PERMISSION_TRIGGER_CHARS),
      ...(agentId ? { agentId } : {}),
      since: new Date(this.now()).toISOString(),
    });
    this.tell();
    this.watch();
    return true;
  }

  /** The person allowed it (or the app found it on): whether one was waiting. */
  clear(permission: OsPermission): boolean {
    const before = this.needs.length;
    this.needs = this.needs.filter((n) => n.permission !== permission);
    if (this.needs.length === before) return false;
    this.unsent.add(permission);
    this.tell();
    return true;
  }

  /** Connected: the allowed ones not told yet are told now. */
  flush() {
    if (this.unsent.size) this.tell();
  }

  /** Reads the waits macOS can say about from now on (connected: what ends is told at once). */
  start() {
    this.started = true;
    this.watch();
  }

  /** Reads each wait macOS can say about once; the ones on end. */
  async check(): Promise<void> {
    const isOn = this.opts.isOn;
    if (!isOn) return;
    for (const n of this.list()) {
      if ((await Promise.resolve(isOn(n.permission)).catch(() => null)) === true) this.clear(n.permission);
    }
    if (!this.needs.length) this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private watch() {
    if (!this.started || this.timer || !this.opts.isOn || !this.needs.length) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.opts.readEveryMs ?? READ_EVERY_MS);
    this.timer.unref?.();
  }

  private tell() {
    if (this.opts.file) {
      try {
        writeFileSync(this.opts.file, JSON.stringify(this.needs));
      } catch {}
    }
    if (this.changed(this.list(), [...this.unsent]) !== false) this.unsent.clear();
  }
}
