import type { SettingsSection } from "./settings-sections";

/** Where each section's words live in the strings: a key's whole subtree, or one key. */
export const SETTINGS_SEARCH_KEYS: Record<SettingsSection, readonly string[]> = {
  account: ["settings.account", "shell.email", "shell.timezone", "shell.profile", "shell.theme", "shell.sounds"],
  notifications: ["noticePrefs", "shell.browserNoticesHint"],
  download: ["appsDownload", "install.page"],
  approvals: ["approvalCover", "rightHandApprovals"],
  apps: ["apps"],
  general: [
    "settings.orgTitle",
    "settings.name",
    "settings.context",
    "settings.contextTitle",
    "settings.contextSubtitle",
    "settings.contextHelp",
    "settings.timezone",
    "settings.timezoneHelp",
    "settings.actionCheck",
    "settings.actionCheckHelp",
    "settings.mode",
    "settings.telemetry",
    "deleteOrg",
  ],
  members: ["members"],
  invites: ["invites", "members.requests", "members.invitations", "members.link"],
  roles: ["rolesPage", "roles"],
  vault: ["vault"],
  audit: ["audit"],
  access: ["access"],
  connectors: ["connectors", "connectFlow", "mail", "database"],
  skills: ["skills"],
  storage: ["storage"],
  devices: ["devices", "computers", "computerSetup"],
  usage: [
    "settings.keysTitle",
    "settings.keysSubtitle",
    "settings.addKey",
    "settings.usageTitle",
    "settings.defaultBudget",
    "settings.defaultBudgetTitle",
    "settings.defaultBudgetHelp",
    "usage",
    "peopleUsage",
    "budget",
    "aiAccounts",
    "limits",
  ],
  billing: ["billing"],
  import: ["settings.import"],
  media: ["settings.media", "media"],
  voice: ["voice"],
  about: ["settings.about"],
};

export interface SettingsHit {
  section: SettingsSection;
  /** The text as the section shows it, its placeholders taken out. */
  text: string;
}

/** A string's words as shown: `{{name}}` and `<b>` out, spaces together. */
export const shownText = (s: string) =>
  s
    .replace(/\{\{[^}]*\}\}/g, "…")
    .replace(/<\/?[a-zA-Z0-9]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

function strings(node: unknown, fallback: unknown, out: string[]) {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (typeof fallback === "string") {
    out.push(fallback);
    return;
  }
  const localized = node && typeof node === "object" ? (node as Record<string, unknown>) : undefined;
  const defaults = fallback && typeof fallback === "object" ? (fallback as Record<string, unknown>) : undefined;
  for (const key of new Set([...Object.keys(localized ?? {}), ...Object.keys(defaults ?? {})])) {
    strings(localized?.[key], defaults?.[key], out);
  }
}

/**
 * Every place the query shows in the sections a person may open, as typed (case aside), the section's own name
 * first: at most `perSection` texts each, `limit` in all.
 */
export function searchSettings(
  query: string,
  sections: readonly { id: SettingsSection; name: string }[],
  resource: (key: string) => unknown,
  {
    perSection = 3,
    limit = 40,
    fallbackResource,
  }: {
    perSection?: number;
    limit?: number;
    fallbackResource?: (key: string) => unknown;
  } = {},
): SettingsHit[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const hits: SettingsHit[] = [];
  for (const { id, name } of sections) {
    const found = new Set<string>();
    if (name.toLocaleLowerCase().includes(q)) found.add(name);
    const all: string[] = [];
    for (const key of SETTINGS_SEARCH_KEYS[id] ?? []) strings(resource(key), fallbackResource?.(key), all);
    for (const s of all) {
      if (found.size >= perSection) break;
      const text = shownText(s);
      if (text.length > 0 && text.toLocaleLowerCase().includes(q)) found.add(text);
    }
    for (const text of found) hits.push({ section: id, text });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

/**
 * On the open section, the first place that shows the pending text, scrolled to and highlighted for a few seconds.
 * Tries again while the section's data comes in; gives up after 3 s.
 */
export function markSettingsText(root: HTMLElement | null, query: string): () => void {
  if (!root || !query) return () => {};
  const q = query.toLocaleLowerCase();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let clear: (() => void) | null = null;
  const tries = Date.now();
  const look = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      const at = text.toLocaleLowerCase().indexOf(q);
      if (at < 0 || at + q.length > text.length) continue;
      const el = n.parentElement;
      if (!el || el.closest("[hidden],[aria-hidden='true']")) continue;
      el.scrollIntoView({
        block: "center",
        behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
      const range = new Range();
      range.setStart(n, at);
      range.setEnd(n, at + q.length);
      const highlights = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
      const H = (globalThis as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
      if (highlights && H) {
        highlights.set("settings-search", new H(range));
        const timer = setTimeout(() => highlights.delete("settings-search"), 4000);
        clear = () => {
          clearTimeout(timer);
          highlights.delete("settings-search");
        };
      } else {
        el.classList.add("settings__found");
        const timer = setTimeout(() => el.classList.remove("settings__found"), 4000);
        clear = () => {
          clearTimeout(timer);
          el.classList.remove("settings__found");
        };
      }
      return;
    }
    if (Date.now() - tries < 3000) retry = setTimeout(look, 150);
  };
  look();
  return () => {
    clearTimeout(retry);
    clear?.();
  };
}
