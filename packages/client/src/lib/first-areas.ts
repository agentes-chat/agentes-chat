import type { TFunction } from "i18next";
import type { RoutineInput } from "../api/types";
import { firstName } from "./format";
import { ROUTINE_TEMPLATES, type TemplateRule, templateRule } from "./routine-templates";

/**
 * The onboarding's first agent by the work it does (ADR 0260, addendum of 2026-11-27): a team's areas and a personal
 * workspace's (ADR 0159), each one agent with its own name and look, the apps it works in (connecting one brings its
 * routine, ADR 0242) and, for work that needs no app, the routine it starts with. Their words are
 * `onboarding.areas.list.<id>` in every language; the names are names, the same everywhere.
 */
export const TEAM_AREAS = ["support", "sales", "finance", "marketing", "day", "tech"] as const;
export const PERSONAL_AREAS = ["life", "freelance", "study", "travel", "home", "health"] as const;
export type FirstArea = (typeof TEAM_AREAS)[number] | (typeof PERSONAL_AREAS)[number];

export interface FirstAreaLook {
  color: string;
  eyes: string;
  accessory: string;
}

export interface FirstAreaDef {
  id: FirstArea;
  /** The agent's name. */
  name: string;
  /** Never the right hand's headset. */
  look: FirstAreaLook;
  /** Catalog connector ids, or `gmail` for the person's mailbox (ADR 0038), in the order the rows show them. */
  apps: readonly string[];
  /**
   * Work that starts without an app (the internet is enough): Continue works with nothing connected, and the agent is
   * made with this routine template on its own schedule, as connecting an app would bring one.
   */
  open?: { template: (typeof ROUTINE_TEMPLATES)[number]["key"]; rule: TemplateRule };
}

const weekdaysAt = (...times: string[]): TemplateRule => ({
  freq: "daily",
  interval: 1,
  byWeekday: ["MO", "TU", "WE", "TH", "FR"],
  times,
});

export const FIRST_AREAS: Record<FirstArea, FirstAreaDef> = {
  support: {
    id: "support",
    name: "Iara",
    look: { color: "violet", eyes: "happy", accessory: "bow" },
    apps: ["gmail", "zendesk", "intercom"],
  },
  sales: {
    id: "sales",
    name: "Theo",
    look: { color: "indigo", eyes: "round", accessory: "cap" },
    apps: ["hubspot", "gmail", "linkedin"],
  },
  finance: {
    id: "finance",
    name: "Caio",
    look: { color: "rose", eyes: "round", accessory: "hat" },
    apps: ["stripe", "google-sheets"],
  },
  marketing: {
    id: "marketing",
    name: "Gabi",
    look: { color: "amber", eyes: "wide", accessory: "beanie" },
    apps: ["instagram", "linkedin", "x"],
    open: { template: "mentions", rule: weekdaysAt("09:00") },
  },
  day: {
    id: "day",
    name: "Clara",
    look: { color: "sky", eyes: "happy", accessory: "scarf" },
    apps: ["gmail", "google-calendar", "notion"],
  },
  tech: {
    id: "tech",
    name: "Ada",
    look: { color: "green", eyes: "wide", accessory: "headphones" },
    apps: ["github", "sentry", "linear"],
  },
  life: {
    id: "life",
    name: "Nina",
    look: { color: "green", eyes: "dots", accessory: "flower" },
    apps: ["gmail", "google-calendar", "drive"],
  },
  freelance: {
    id: "freelance",
    name: "Rui",
    look: { color: "graphite", eyes: "round", accessory: "hat" },
    apps: ["gmail", "stripe", "google-calendar"],
  },
  study: {
    id: "study",
    name: "Lia",
    look: { color: "rose", eyes: "dots", accessory: "crown" },
    apps: ["notion", "google-docs", "drive"],
  },
  travel: {
    id: "travel",
    name: "Vic",
    look: { color: "sky", eyes: "wide", accessory: "antenna" },
    apps: ["gmail", "google-calendar"],
  },
  home: {
    id: "home",
    name: "Rosa",
    look: { color: "teal", eyes: "happy", accessory: "flower" },
    apps: ["google-sheets", "google-calendar"],
  },
  health: {
    id: "health",
    name: "Duda",
    look: { color: "amber", eyes: "round", accessory: "party" },
    apps: ["google-calendar"],
  },
};

/** The look of an agent the person makes on "Other": one of its own, none of the areas'. */
export const CUSTOM_LOOK: FirstAreaLook = { color: "indigo", eyes: "round", accessory: "party" };

/** The area key of "Other" (`area=custom`), kept on the first delivery so a reload comes back to the same step. */
export const CUSTOM_AREA = "custom";

export const isFirstArea = (v: unknown): v is FirstArea => typeof v === "string" && Object.hasOwn(FIRST_AREAS, v);

/** The areas a workspace's mode offers, in their order. */
export const areasFor = (personal: boolean): readonly FirstArea[] => (personal ? PERSONAL_AREAS : TEAM_AREAS);

/**
 * The places the next agents could take around the first one on the plan's band, and the "Later:" line under it: four
 * other areas of the same list (never the first one's).
 */
export function nextAreas(personal: boolean, first: string | null): FirstArea[] {
  const list = personal ? PERSONAL_AREAS.slice(1) : (["sales", "finance", "marketing", "tech", "support"] as const);
  return list.filter((a) => a !== first).slice(0, 4);
}

/** The mailbox among an area's apps: connected through the mail flow (ADR 0038), not the catalog's. */
export const MAILBOX_APP = "gmail";

/** What `POST …/first-agents/start` takes for an area, in the person's language. */
export function areaAgentInput(t: TFunction, area: FirstArea, org: string) {
  const def = FIRST_AREAS[area];
  const words = (key: "role" | "instructions" | "task") =>
    t(`onboarding.areas.list.${area}.${key}`, { org, name: def.name });
  return {
    area,
    name: def.name,
    role: words("role"),
    instructions: words("instructions"),
    appearance: def.look,
    task: words("task"),
    apps: def.apps.filter((a) => a !== MAILBOX_APP),
  };
}

/**
 * The routine an area that needs no app starts with (`open`): its template's words, in the person's DM with the agent,
 * on the area's schedule from today in `timezone` (`today`: YYYY-MM-DD), reporting as its template does.
 */
export function openAreaRoutine(
  t: TFunction,
  area: FirstArea,
  pick: { agentId: string; timezone: string; today: string },
): RoutineInput | null {
  const open = FIRST_AREAS[area].open;
  if (!open) return null;
  const template = ROUTINE_TEMPLATES.find((x) => x.key === open.template);
  const rule = templateRule({ rule: open.rule }, { start: pick.today, timezone: pick.timezone });
  return {
    name: t(`routines.presets.${open.template}.name`),
    agentId: pick.agentId,
    prompt: t(`routines.presets.${open.template}.prompt`),
    target: { type: "dm" },
    trigger: {
      type: "schedule",
      rule: {
        freq: rule.freq,
        interval: rule.interval,
        times: rule.times,
        timezone: rule.timezone,
        start: rule.start,
        until: null,
        count: null,
        ...(rule.byWeekday?.length ? { byWeekday: [...rule.byWeekday] } : {}),
      },
    },
    report: template && "report" in template ? template.report : "when_new",
  };
}

/** Mail services where an address names a person, not a company: the workspace takes the person's first name. */
const WEBMAIL = new Set([
  "gmail",
  "googlemail",
  "outlook",
  "hotmail",
  "live",
  "msn",
  "yahoo",
  "ymail",
  "icloud",
  "me",
  "mac",
  "aol",
  "proton",
  "protonmail",
  "pm",
  "gmx",
  "web",
  "mail",
  "yandex",
  "zoho",
  "qq",
  "163",
  "126",
  "naver",
  "daum",
  "uol",
  "bol",
  "terra",
  "ig",
  "globo",
  "libero",
  "orange",
  "free",
  "laposte",
  "wanadoo",
  "t-online",
  "freenet",
  "seznam",
  "wp",
  "o2",
  "interia",
  "fastmail",
  "hey",
  "tutanota",
  "tuta",
]);

/** Second-level labels that are a country's, not a company's ("acme.com.br", "acme.co.uk"). */
const SECOND_LEVEL = new Set(["com", "co", "net", "org", "gov", "edu", "ac", "ne", "or", "go"]);

/**
 * The workspace's name, read from the work e-mail's domain ("ana@acme.com.br" → "Acme"), or the person's first name
 * for a webmail address (ADR 0162, the name step folded into the work step's footer). Empty when neither says one.
 */
export function workspaceNameOf(email: string, personName: string): string {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  const labels = domain.split(".").filter(Boolean);
  // The registrable label: the one before the public suffix ("acme" in mail.acme.com.br).
  while (labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2] ?? "")) labels.pop();
  const company = labels.length >= 2 ? (labels[labels.length - 2] ?? "") : "";
  if (company && !WEBMAIL.has(company)) {
    const words = company.split(/[-_]+/).filter(Boolean);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return firstName(personName);
}
