/**
 * The app layer's routes (ADR 0265): the old Preferences tab names (the popover's menu, older sites) as This
 * computer's settings sections, which sheets show over the site, and when a route names something new to show.
 */
import type { LayerRoute } from "../host/types";

type SettingsRoute = Extract<LayerRoute, { screen: "settings" }>;

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

/** Whether a route shows in a card over the site on a Mac when it is there: This computer's settings and the sheets. */
export const isSheet = (route: LayerRoute) => route.screen !== "firstRun";

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
