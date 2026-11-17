import type { OrgSummary } from "@agenteschat/client";
import type { IconName } from "@/ui";
import { type SettingsEntry, visibleSections } from "../settings/logic";

/*
 * Gestão (Manage) on the phone: a tab a person may put in Threads' place, on this phone only, holding what a team's
 * admin opens every day (approvals, routines, dashboards, the wiki, the Drive, the team, usage, memory) and the
 * workspace's settings in one list, one tap from anywhere. Pure, so it is unit-tested; `ManageScreen` draws it.
 */

/** What the tab bar's second place holds on this phone: Threads (everyone's default) or Gestão. */
export type MiddleTab = "threads" | "manage";

/** The saved choice read back: only "manage" changes the bar, anything else (nothing saved, an old value) is Threads. */
export const middleTabOf = (saved: string | null | undefined): MiddleTab => (saved === "manage" ? "manage" : "threads");

/** The tabs that only show in that place for the choice that names them. */
const SLOT_OF: Partial<Record<string, MiddleTab>> = { threads: "threads", manage: "manage" };

/**
 * Whether a tab is left out of the bar: a personal workspace (ADR 0159) has no second tab at all, and Threads and
 * Gestão take turns in it by the phone's choice. A tab left out stays a route (a link to it still opens).
 */
export function tabHidden(name: string, personal: boolean, middle: MiddleTab): boolean {
  const slot = SLOT_OF[name];
  if (slot === undefined) return false;
  return personal || slot !== middle;
}

/** A row of Gestão's first list. */
export type ManageRow =
  | "threads"
  | "approvals"
  | "routines"
  | "dashboards"
  | "wiki"
  | "drive"
  | "team"
  | "usage"
  | "memory";

/**
 * The first list, by how often a team's admin opens each: Threads first (its tab gave its place), then what waits on
 * you, then the rest of the day's work.
 */
export const MANAGE_ROWS: readonly ManageRow[] = [
  "threads",
  "approvals",
  "routines",
  "dashboards",
  "wiki",
  "drive",
  "team",
  "usage",
  "memory",
];

/** Each row's icon (the ones Você and Configurações use) and its screen. */
export const MANAGE_ROW: Record<ManageRow, { icon: IconName; href: string; label: string }> = {
  threads: { icon: "reply", href: "/conversations/threads", label: "mobile.threads.title" },
  // What waits on you is in Atividade (`agenteschat://approvals` lands there too).
  approvals: { icon: "shield", href: "/activity", label: "mobile.manage.approvals" },
  routines: { icon: "clock", href: "/routines", label: "routines.title" },
  dashboards: { icon: "chart", href: "/dashboards", label: "mobile.me.dashboards" },
  wiki: { icon: "file", href: "/wiki", label: "wiki.title" },
  drive: { icon: "doc", href: "/drive", label: "mobile.me.drive" },
  team: { icon: "members", href: "/team", label: "team.title" },
  usage: { icon: "wallet", href: "/usage", label: "mobile.manage.usage" },
  memory: { icon: "brain", href: "/memory", label: "mobile.memory.title" },
};

export interface ManageView {
  rows: ManageRow[];
  /** The settings sections this person opens (`visibleSections`), shown in their groups under the rows. */
  sections: SettingsEntry[];
}

/**
 * What Gestão shows this membership: the same rule as Você and Configurações, nothing more. The work rows are
 * everyone's (as in Você › Work); Uso e cotas only while its settings section is open to them, and then not again among
 * the settings below.
 */
export function manageView(org: OrgSummary | null | undefined): ManageView {
  const open = visibleSections(org);
  const usage = open.some((s) => s.id === "usage");
  return {
    rows: MANAGE_ROWS.filter((row) => row !== "usage" || usage),
    sections: open.filter((s) => s.id !== "usage"),
  };
}
