/**
 * The cover over a workspace on a private network (a Tailscale address) that this computer can't reach now: what turns
 * the network on here, from what the system's Tailscale says (the official app the person installs; the app never
 * carries Tailscale itself, ADR 0256 §4). Its Mac app opens, a missing one is downloaded from its official page,
 * Windows' sits by the clock, and elsewhere (Linux, a Mac with only the command-line tool) the person turns it on as
 * they set it up. Never a command to type. Null: Tailscale is on, so the network isn't why (the server itself doesn't
 * answer).
 */
import type { Tailnet } from "../control/local-server";
import type { Platform } from "../control/platform";

export type NetworkFix =
  /** The system Tailscale's Mac app, where it is turned on. */
  | { act: "openApp" }
  /** No Tailscale on this computer: its official download page. */
  | { act: "download" }
  /** Windows: Tailscale's icon by the clock (nothing to open from here). */
  | { act: "tray" }
  /** Turned on the way it was set up (Linux, a Mac with only the command-line tool): nothing to open from here. */
  | { act: "elsewhere" };

export function networkFix(platform: Platform, system: Tailnet | null): NetworkFix | null {
  if (system?.state === "on") return null;
  if (system?.state === "missing") return { act: "download" };
  if (platform === "windows") return { act: "tray" };
  if (platform === "linux") return { act: "elsewhere" };
  // A Mac: its app, unless only the command-line tool is there. Not read yet: its app.
  return system?.state === "off" && !system.app ? { act: "elsewhere" } : { act: "openApp" };
}

/** The cover's words for a fix (keys of `cover`): the line under the title, and the main button's (none: no button). */
export function networkWords(fix: NetworkFix): { line: CoverKey; button: CoverKey | null } {
  switch (fix.act) {
    case "download":
      return { line: "privateMissing", button: "getTailscale" };
    case "tray":
      return { line: "privateTray", button: null };
    case "elsewhere":
      return { line: "privateElsewhere", button: null };
    default:
      return { line: "privateLine", button: "openTailscale" };
  }
}

type CoverKey =
  | "privateLine"
  | "privateMissing"
  | "privateTray"
  | "privateElsewhere"
  | "getTailscale"
  | "openTailscale";

/**
 * The cover's title: the workspace by name when the server has one for this account, else the server's words alone
 * (several workspaces, or none read yet).
 */
export function privateTitle(orgs: readonly { name: string }[] | null | undefined): {
  key: "privateTitle" | "privateTitleAny";
  org?: string;
} {
  const only = orgs?.length === 1 ? orgs[0]?.name : undefined;
  return only ? { key: "privateTitle", org: only } : { key: "privateTitleAny" };
}
