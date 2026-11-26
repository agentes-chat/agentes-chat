import {
  type OsPermission,
  PERMISSION_TRIGGER_CHARS,
  type PermissionNeed,
} from "@agenteschat/adapters/machine-protocol";

/**
 * What macOS's tools print when TCC refused them, by permission. "Operation not permitted" is EPERM, which macOS
 * returns for a protected folder (Full Disk Access) and for an app's bundle (App Management): the path on the line
 * tells them apart.
 */
const MAC_REFUSALS: [OsPermission, RegExp][] = [
  ["screen", /could not create image from (display|window)/i],
  ["automation", /not authori[sz]ed to send apple events|\(-1743\)/i],
  ["accessibility", /not allowed assistive access|\(-1719\)|\(-25211\)/i],
];
const EPERM_LINE = /^.*operation not permitted.*$/im;
const APP_BUNDLE = /\.app(\/|\b)/i;

/**
 * The OS permission a failed command's output says it lacked, or null: macOS only (Windows prints no refusal of its
 * own a command could be told by). A false alarm costs nothing: the app checks the permission before it asks.
 */
export function permissionOfOutput(text: string, platform: string = process.platform): OsPermission | null {
  if (platform !== "darwin" || !text) return null;
  for (const [permission, refused] of MAC_REFUSALS) if (refused.test(text)) return permission;
  const eperm = EPERM_LINE.exec(text)?.[0];
  if (!eperm) return null;
  return APP_BUNDLE.test(eperm) ? "app_management" : "disk";
}

/**
 * The permissions this computer waits on, one per permission (the first ask names it), in memory: a runner that
 * starts again (the app reopened, as macOS asks after Screen Recording) asks again only if the work does.
 */
export class PermissionNeeds {
  private needs: PermissionNeed[] = [];

  constructor(
    private readonly changed: (needs: PermissionNeed[]) => void,
    private readonly now: () => number = Date.now,
  ) {}

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
    this.changed(this.list());
    return true;
  }

  /** The person allowed it (or the app found it on): whether one was waiting. */
  clear(permission: OsPermission): boolean {
    const before = this.needs.length;
    this.needs = this.needs.filter((n) => n.permission !== permission);
    if (this.needs.length === before) return false;
    this.changed(this.list());
    return true;
  }
}
