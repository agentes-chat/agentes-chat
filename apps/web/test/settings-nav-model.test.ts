import { describe, expect, test } from "bun:test";
import type { AuthConfig, OrgSummary } from "@agenteschat/client";
import { TEAM_SETTINGS } from "@agenteschat/client/lib/settings-nav";
import { createI18n } from "@/i18n";
import { SETTINGS_SECTIONS, settingsNavModel } from "@/pages/settings-sections";

/**
 * The settings list as one pure model (ADR 0265 §2): the settings page draws it, and the desktop app's layer shows it
 * above This Mac, so both list the same lines with the same words, icons and addresses.
 */

const t = createI18n("pt-BR").t;
const ALL = [
  "read",
  "configure",
  "invite_people",
  "manage_roles",
  "manage_billing",
  "manage_connectors",
  "manage_agents",
  "create_agents",
  "view_audit",
];
const team: OrgSummary = { id: "org-1", name: "Acme", role: "owner", permissions: ALL };
const member: OrgSummary = { id: "org-1", name: "Acme", role: "member", permissions: ["read"] };
const selfHosted = { socialProviders: {}, signupOpen: true, firstRun: false } as unknown as AuthConfig;
const cloud = { ...selfHosted, cloud: true } as AuthConfig;
/** The address shape the desktop app accepts for a line (`settingsNav` in main_window.rs). */
const PATH = /^\/org\/[A-Za-z0-9_-]{1,64}\/settings(\/[a-z_]{1,32})?$/;

describe("settingsNavModel", () => {
  test("a team's owner: the entries in order, then Advanced, each with its words, icon and address", () => {
    const nav = settingsNavModel(t, team, selfHosted);
    expect(nav.main.map((s) => s.id)).toEqual([...TEAM_SETTINGS]);
    const label = (id: string) => [...nav.main, ...nav.advanced].find((s) => s.id === id)?.label;
    // A team's Workspace, People and Connectors hold more than the section they open on.
    expect(label("account")).toBe("Sua conta");
    expect(label("general")).toBe("Workspace");
    expect(label("members")).toBe("Pessoas");
    expect(label("connectors")).toBe("Conectores");
    for (const s of [...nav.main, ...nav.advanced]) {
      expect(s.path).toBe(`/org/org-1/settings/${s.id}`);
      expect(s.path).toMatch(PATH);
      expect(s.icon as string).toBe(SETTINGS_SECTIONS.find((x) => x.id === s.id)?.icon as string);
      expect(s.label.length).toBeGreaterThan(0);
    }
    // Sections another entry's page holds as a tab are no line of their own.
    const ids = [...nav.main, ...nav.advanced].map((s) => s.id);
    expect(ids).not.toContain("notifications");
    expect(ids).not.toContain("invites");
    expect(ids).toContain("devices");
    expect(nav.advanced.map((s) => s.id)).toContain("devices");
  });

  test("on agentes.chat Cloud, Devices is an entry of the short list", () => {
    const nav = settingsNavModel(t, team, cloud);
    expect(nav.main.map((s) => s.id)).toEqual([...TEAM_SETTINGS, "devices"]);
    expect(nav.advanced.map((s) => s.id)).not.toContain("devices");
  });

  test("a member: only what their role opens", () => {
    const nav = settingsNavModel(t, member, selfHosted);
    const ids = [...nav.main, ...nav.advanced].map((s) => s.id);
    expect(ids).toContain("account");
    expect(ids).not.toContain("general");
    expect(ids).not.toContain("roles");
    expect(ids).not.toContain("audit");
  });

  test("a personal workspace names its own sections in its own words", () => {
    const nav = settingsNavModel(t, { ...team, mode: "personal" }, selfHosted, 0);
    expect(nav.main.find((s) => s.id === "general")?.label).toBe("Sobre você");
  });

  test("in English, the same lines in the page's language", () => {
    const nav = settingsNavModel(createI18n("en").t, team, selfHosted);
    expect(nav.main.find((s) => s.id === "account")?.label).toBe("Your account");
  });
});
