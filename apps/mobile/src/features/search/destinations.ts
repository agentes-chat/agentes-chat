import type { OrgSummary, WikiPageSummary } from "@agenteschat/client";
import type { TFunction } from "i18next";
import type { IconName } from "@/ui";
import { visibleSections } from "../settings/logic";
import { fold } from "./logic";

/**
 * Busca as a way to go anywhere, as the web's ⌘K (`apps/web/src/components/CommandMenu.tsx`): the app's own screens,
 * each settings section this person opens (`visibleSections`, the same rule as Configurações) and the wiki's pages,
 * found by their name or by words of what they hold. Agents and conversations are Busca's own results already.
 */

export interface Destination {
  key: string;
  icon: IconName;
  label: string;
  /** What it is, under its name ("página", "Configurações"). */
  sub: string;
  /** More words that find it: its id, its usual name, what it holds. */
  keywords: string;
  href: string;
  /** A tab of the app: gone to, never pushed over Busca. */
  tab?: boolean;
}

/** The screens every member reaches from Você and Agentes (none of them is gated there). */
const PAGES = [
  { key: "agents", icon: "agent", label: "mobile.agents.title", href: "/agents" },
  { key: "issues", icon: "checkc", label: "mobile.me.issues", href: "/issues" },
  { key: "proposals", icon: "flag", label: "shell.proposals", href: "/proposals" },
  { key: "routines", icon: "clock", label: "routines.title", href: "/routines" },
  { key: "wiki", icon: "file", label: "wiki.title", href: "/wiki" },
  { key: "drive", icon: "doc", label: "mobile.me.drive", href: "/drive" },
  { key: "dashboards", icon: "chart", label: "mobile.me.dashboards", href: "/dashboards" },
  { key: "memory", icon: "brain", label: "mobile.memory.title", href: "/memory" },
  { key: "team", icon: "members", label: "team.title", href: "/team" },
  { key: "tasks", icon: "list", label: "taskManager.title", href: "/task-manager" },
  { key: "approvals", icon: "shield", label: "settings.section.approvals", href: "/me/approvals" },
  { key: "settings", icon: "home", label: "settings.title", href: "/settings" },
] as const satisfies readonly { key: string; icon: IconName; label: string; href: string }[];

/** A section whose phone screen goes by another name than the web's. */
const SECTION_NAME: Partial<Record<string, string>> = { computers: "mobile.devices.title" };

/** Every place Busca can go to for this membership, in the person's language. */
export function destinations(
  t: TFunction,
  org: OrgSummary | null | undefined,
  wiki: readonly Pick<WikiPageSummary, "slug" | "title" | "folder" | "tags">[] = [],
): Destination[] {
  const page = t("palette.page");
  const settings = t("palette.settingsGroup");
  const wikiPage = t("palette.wikiPage");
  return [
    ...PAGES.map((p) => ({
      key: `g:${p.key}`,
      icon: p.icon,
      label: t(p.label),
      sub: page,
      keywords: p.key === "settings" ? `${p.key} ${t("palette.settingsKeywords")}` : p.key,
      href: p.href,
      ...(p.key === "agents" ? { tab: true } : {}),
    })),
    ...visibleSections(org).map((s) => ({
      key: `s:${s.id}`,
      icon: s.icon,
      label: t(SECTION_NAME[s.id] ?? `settings.section.${s.id}`),
      sub: settings,
      keywords: [
        s.id,
        t(`settings.section.${s.id}`),
        t(`settings.sectionText.${s.id}`, { defaultValue: "" }),
        t("palette.settingsKeywords"),
        s.id === "usage" ? `${t("palette.keysKeywords")} ${t("mobile.find.usageKeywords")}` : "",
      ].join(" "),
      href: s.href,
    })),
    ...wiki.map((w) => ({
      key: `w:${w.slug}`,
      icon: "file" as const,
      label: w.title,
      sub: w.folder ? `${wikiPage} · ${w.folder}` : wikiPage,
      keywords: [w.folder, ...w.tags].join(" "),
      href: `/wiki/${encodeURIComponent(w.slug)}`,
    })),
  ];
}

/** At most this many places under the results: the conversations and messages stay in sight. */
export const DESTINATIONS_SHOWN = 6;

/**
 * The places `q` finds: every word of it in the name or the keywords, ignoring case and accents; those whose name has
 * them first, in their order. No words, none.
 */
export function findDestinations(q: string, list: readonly Destination[], limit = DESTINATIONS_SHOWN): Destination[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const byName: Destination[] = [];
  const byKeyword: Destination[] = [];
  for (const d of list) {
    const name = fold(d.label);
    if (words.every((w) => name.includes(w))) byName.push(d);
    else {
      const all = `${name} ${fold(d.keywords)}`;
      if (words.every((w) => all.includes(w))) byKeyword.push(d);
    }
  }
  return [...byName, ...byKeyword].slice(0, limit);
}
