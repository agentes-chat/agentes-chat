import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrgSummary } from "@agenteschat/client";
import { landsOnRoot } from "../../src/features/links/landing";
import { MANAGE_ROW, MANAGE_ROWS, manageView, middleTabOf, tabHidden } from "../../src/features/manage/logic";
import { visibleSections } from "../../src/features/settings/logic";

// Gestão in Threads' place, a choice of this phone (Você › Preferências).
const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const org = (permissions: string[]) => ({ id: "o", name: "Acme", role: "member", permissions }) as OrgSummary;

describe("the middle tab", () => {
  test('only a saved "manage" changes the bar: nothing saved or an unknown value is Threads', () => {
    expect(middleTabOf("manage")).toBe("manage");
    expect(middleTabOf("threads")).toBe("threads");
    expect(middleTabOf(null)).toBe("threads");
    expect(middleTabOf(undefined)).toBe("threads");
    expect(middleTabOf("Manage")).toBe("threads");
    expect(middleTabOf("")).toBe("threads");
  });

  test("Threads and Gestão take turns; a personal workspace has neither; the other tabs never hide", () => {
    expect(tabHidden("threads", false, "threads")).toBe(false);
    expect(tabHidden("manage", false, "threads")).toBe(true);
    expect(tabHidden("threads", false, "manage")).toBe(true);
    expect(tabHidden("manage", false, "manage")).toBe(false);
    for (const middle of ["threads", "manage"] as const) {
      expect(tabHidden("threads", true, middle)).toBe(true);
      expect(tabHidden("manage", true, middle)).toBe(true);
      for (const name of ["(chats)", "agents", "activity", "search"]) {
        expect(tabHidden(name, false, middle)).toBe(false);
        expect(tabHidden(name, true, middle)).toBe(false);
      }
    }
  });

  test("the bar holds both, hidden the system's way, and Gestão is a tab root", () => {
    const tabs = read("app/(app)/(main)/(tabs)/_layout.tsx");
    expect(tabs).toContain('{ name: "manage", glyph: "manage", label: "mobile.tabs.manage" }');
    expect(tabs).toContain("hidden={tabHidden(tab.name, personal, middle)}");
    expect(landsOnRoot("/manage")).toBe(true);
    expect(landsOnRoot("/threads")).toBe(true);
  });

  test("with Gestão chosen, Threads is still one tap away: its row pushes the same list", () => {
    expect(MANAGE_ROWS[0]).toBe("threads");
    expect(MANAGE_ROW.threads.href).toBe("/conversations/threads");
    const route = read("app/(app)/(main)/conversations/[kind].tsx");
    expect(route).toContain('const noThreadsTab = personal || middle === "manage";');
    expect(route).toContain('if (kind === "threads" && noThreadsTab) return <ThreadsScreen pushed />;');
  });
});

describe("what Gestão shows", () => {
  test("the daily places in order of use, then every settings section this person opens, Uso once", () => {
    const admin = org([
      "read",
      "invite_people",
      "view_audit",
      "view_usage",
      "manage_agents",
      "configure",
      "create_agents",
      "manage_roles",
    ]);
    const view = manageView(admin);
    expect(view.rows).toEqual([
      "threads",
      "approvals",
      "routines",
      "dashboards",
      "wiki",
      "drive",
      "team",
      "usage",
      "memory",
    ]);
    expect(view.sections.map((s) => s.id)).toEqual(
      visibleSections(admin)
        .map((s) => s.id)
        .filter((id) => id !== "usage"),
    );
    expect(view.sections.some((s) => s.id === "general")).toBe(true);
  });

  test("a member sees only what Configurações opens to them", () => {
    const member = org(["read", "post"]);
    expect(manageView(member).sections.map((s) => s.id)).toEqual([
      "members",
      "connectors",
      "skills",
      "vault",
      "apps",
      "computers",
    ]);
    // While the workspace loads, what Configurações shows then: the sections open to everyone.
    expect(manageView(null).sections.map((s) => s.id)).toEqual(["connectors", "apps"]);
  });

  test("the choice lives in Você › Preferências for a team's workspace only, kept on this phone", () => {
    const me = read("src/features/me/MeScreen.tsx");
    expect(me).toContain('label={t("mobile.me.middleTab")}');
    expect(me).toContain("{personal ? null : (");
    expect(read("src/lib/storage.ts")).toContain('middleTab: "middle-tab"');
  });
});
