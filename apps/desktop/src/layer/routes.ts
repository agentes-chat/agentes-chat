/**
 * The app layer's routes (ADR 0256) against the screens they still show today: This computer's settings sections on
 * the tabs of the settings screen, and the old Preferences tab names (the popover's menu, older sites) as sections.
 */
import type { LayerRoute, LayerSection } from "../host/types";
import type { PrefTab } from "../windows/Prefs";

type SettingsRoute = Extract<LayerRoute, { screen: "settings" }>;

/** The settings screen's tab for a settings route: its row (`focus`) first, else its section. */
export function prefsTabOf(route: Pick<SettingsRoute, "section" | "focus">): PrefTab {
  if (route.focus === "updates") return "updates";
  if (route.focus === "tools") return "tools";
  // The phones are with this computer's workspaces on today's General tab.
  if (route.focus === "phone") return "general";
  if (route.focus === "servers" || route.focus === "reach" || route.focus === "backups" || route.focus === "telemetry")
    return "servers";
  const bySection: Record<LayerSection, PrefTab> = {
    overview: "general",
    folders: "folders",
    server: "servers",
    activity: "activity",
    app: "general",
  };
  return route.section ? bySection[route.section] : "general";
}

/** The settings route for an old Preferences tab name (the popover's menu actions, `useOpenPrefs`, older sites). */
export function settingsRouteOf(tab?: string | null): SettingsRoute {
  switch (tab) {
    case "folders":
      return { screen: "settings", section: "folders" };
    case "tools":
      return { screen: "settings", section: "folders", focus: "tools" };
    case "updates":
      return { screen: "settings", section: "overview", focus: "updates" };
    case "servers":
      return { screen: "settings", section: "app", focus: "servers" };
    case "server":
      return { screen: "settings", section: "server" };
    case "activity":
      return { screen: "settings", section: "activity" };
    case "advanced":
      return { screen: "settings", section: "app" };
    case "general":
    case "thisMac":
      return { screen: "settings", section: "overview" };
    default:
      return { screen: "settings" };
  }
}

/** Whether a route is one of the sheets (shown over the site on a Mac when it is there). */
export const isSheet = (route: LayerRoute) => route.screen !== "firstRun" && route.screen !== "settings";

/** A key that changes when the route names another thing to show (a new workspace offered, another link). */
export function routeKey(route: LayerRoute): string {
  switch (route.screen) {
    case "pairOffer":
      return `pairOffer ${route.target.server} ${route.target.orgId}`;
    case "prepare":
      return `prepare ${route.server} ${route.org}`;
    case "pairLink":
      return `pairLink ${route.server} ${route.code}`;
    case "firstRun":
      return `firstRun ${route.mode ?? ""}`;
    default:
      return route.screen;
  }
}
