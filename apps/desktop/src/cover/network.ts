/**
 * The cover over a workspace on a private network (a Tailscale address) that this computer can't reach now: what turns
 * the network on here, from what Tailscale says. The app's own Tailscale, when it is the one chosen (ADR 0256 §5),
 * signs in or starts from the cover; otherwise the system's: its Mac app opens, Windows' sits by the clock, and
 * elsewhere (Linux, a Mac with only the command-line tool) the person turns it on as they set it up. Never a command to
 * type. Null: Tailscale is on, so the network isn't why (the server itself doesn't answer).
 */
import type { Tailnet, TailnetState } from "../control/local-server";
import type { Platform } from "../control/platform";

export type NetworkFix =
  /** The app's own Tailscale signed out or its sign-in expired: its page opens in the browser. */
  | { act: "signIn" }
  /** The app's own Tailscale is signing in: its page waits in the browser. */
  | { act: "signingIn" }
  /** The app's own Tailscale stopped or failing: reading its state starts it again. */
  | { act: "start" }
  /** The tailnet's admin approves new devices and hasn't approved this one yet: its admin page. */
  | { act: "approve" }
  /** The system Tailscale's Mac app, where it is turned on. */
  | { act: "openApp" }
  /** No Tailscale on this computer: its download page. */
  | { act: "download" }
  /** Windows: Tailscale's icon by the clock (nothing to open from here). */
  | { act: "tray" }
  /** Turned on the way it was set up (Linux, a Mac with only the command-line tool): nothing to open from here. */
  | { act: "elsewhere" };

export function networkFix(platform: Platform, system: Tailnet | null, own: TailnetState | null): NetworkFix | null {
  if (own?.mode === "app" && own.state !== "on") {
    if (own.state === "signedOut" || own.state === "expired") return { act: "signIn" };
    if (own.state === "needsApproval") return { act: "approve" };
    if (own.state === "signingIn") return { act: "signingIn" };
    return { act: "start" };
  }
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
    case "approve":
      return { line: "privateApprove", button: "openTailscale" };
    case "signingIn":
      return { line: "privateSigningIn", button: null };
    case "tray":
      return { line: "privateTray", button: null };
    case "elsewhere":
      return { line: "privateElsewhere", button: null };
    default:
      return { line: "privateLine", button: "turnOn" };
  }
}

type CoverKey =
  | "privateLine"
  | "privateMissing"
  | "privateApprove"
  | "privateSigningIn"
  | "privateTray"
  | "privateElsewhere"
  | "getTailscale"
  | "openTailscale"
  | "turnOn";

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
