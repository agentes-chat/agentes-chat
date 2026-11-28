/**
 * Settings › This computer's sections (ADR 0265 §6): which ones this computer has now, and the one a route opens on.
 * A route names a section, a row (`focus`: the site's and the popover's ways in), or both: a row decides the section
 * it lives in, so an older name ("updates" on the Overview) still lands on its row. Pure, so it is tested without the
 * app.
 */
import type { LayerRoute, LayerSection } from "../../host/types";

type SettingsRoute = Extract<LayerRoute, { screen: "settings" }>;

/** The sections in the list's order. */
export const SECTION_ORDER: readonly LayerSection[] = ["overview", "folders", "server", "activity", "app"];

/** What decides which sections show. */
export interface SectionFacts {
  /** A workspace's agents use this computer (its folders, tools and activity are there to see). */
  works: boolean;
  /** The app runs agentes.chat here, or keeps its data to start it again. */
  server: boolean;
}

/** The sections this computer has now: Overview and App settings always. */
export function sectionsOf(facts: SectionFacts): LayerSection[] {
  return SECTION_ORDER.filter((s) => {
    if (s === "folders" || s === "activity") return facts.works;
    if (s === "server") return facts.server;
    return true;
  });
}

/** The section each row the site and the popover may ask for lives in. */
const FOCUS_SECTION: Record<string, LayerSection> = {
  tools: "folders",
  phone: "folders",
  updates: "app",
  notifications: "app",
  servers: "app",
  telemetry: "app",
  reach: "server",
  backups: "server",
};

/**
 * The section a route opens on among `shown`: its row's section, else the one it names, else the Overview. Reach and
 * backups belong to the server here: without it, reach is App settings' (its switch) and backups the Overview's.
 */
export function sectionFor(
  route: Pick<SettingsRoute, "section" | "focus">,
  shown: readonly LayerSection[],
): LayerSection {
  const byFocus = route.focus ? FOCUS_SECTION[route.focus] : undefined;
  const wanted = byFocus ?? route.section ?? "overview";
  if (shown.includes(wanted)) return wanted;
  if (route.focus === "reach") return "app";
  if (route.section && shown.includes(route.section)) return route.section;
  return "overview";
}
