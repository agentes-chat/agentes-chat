import type { Href } from "expo-router";
import { openOwnPage } from "@/features/ai/parts";
import { appLinkFromUrl, appPathOf } from "@/features/links/app-links";
import { workspaceOnScreen } from "@/features/links/on-screen";
import { rememberLink } from "@/features/links/pending";
import { appLockHolds, whenUnlocked } from "@/features/lock/store";
import { SHARE_ROUTE } from "@/features/share/inbox";
import { router } from "@/ui/navigation";

/**
 * Every URL the system opens the app with (a universal link / App Link to the website, or `agenteschat://`), before
 * expo-router reads it: the website's address becomes the app's screen (`appLinkFromUrl`), and a page the app has no
 * screen for opens in the browser, the app staying where it was (on its start at launch). A screen of the workspace on
 * screen opens straight away; another workspace's, or one that needs a lookup, goes through `/link`. What another app
 * shared through the system's share sheet opens "Compartilhar com…".
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  // Where the app stays when the link opens nothing now: its start at launch, else where it was.
  const stay = initial ? "/" : "";
  try {
    // Behind the app lock (ADR 0195) the app stays where it is, and what the link opens waits until the lock opens.
    const holding = appLockHolds();
    // The share extension opens the app with `agenteschat://dataUrl=…` (expo-share-intent): "Compartilhar com…"
    // (held by `ShareInbox` behind the lock).
    if (path.includes("dataUrl=")) return holding ? stay : SHARE_ROUTE;
    const link = appLinkFromUrl(path, workspaceOnScreen());
    if (!link) {
      // The app's own path, never the URL: navigating to `agenteschat://…` would open the app with it again, and the
      // lock covers the app as it does, so the link would wait and be opened again, round and round.
      const own = appPathOf(path);
      if (!holding || own === "/") return path;
      whenUnlocked(() => router.navigate(own as Href));
      return stay;
    }
    if ("web" in link) {
      whenUnlocked(() => openOwnPage(path));
      return stay;
    }
    // Signed out, the sign-in comes first; the link is opened right after it.
    if (link.href.startsWith("/link?")) rememberLink(link.href);
    if (!holding) return link.href;
    const { href } = link;
    whenUnlocked(() => router.navigate(href as Href));
    return stay;
  } catch {
    return initial ? "/" : path;
  }
}
