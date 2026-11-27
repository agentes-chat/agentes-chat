import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { channelSteps, movesChannel, sectorHref, stepBefore } from "../../src/features/channel-sectors/logic";

const src = (file: string) => readFileSync(join(import.meta.dir, "../../src", file), "utf8");

describe("a channel's sector on the phone (ADR 0240)", () => {
  test("moving one step up or down says what it then sits before", () => {
    const ids = ["a", "b", "c"];
    expect(stepBefore(ids, "c", -1)).toBe("b");
    expect(stepBefore(ids, "a", 1)).toBe("c");
    expect(stepBefore(ids, "b", 1)).toBeNull();
    expect(stepBefore(ids, "a", -1)).toBeUndefined();
    expect(stepBefore(ids, "c", 1)).toBeUndefined();
  });

  test("a channel moves one step among the ones of its sector, or the ones in none", () => {
    const list = [
      { id: "general", groupId: null },
      { id: "bugs", groupId: "sup" },
      { id: "avisos" },
      { id: "tech", groupId: "sup" },
      { id: "vendas", groupId: null },
    ];
    expect(channelSteps(list, "avisos")).toEqual({
      at: 1,
      count: 3,
      up: { channelId: "avisos", groupId: null, beforeChannelId: "general" },
      down: { channelId: "avisos", groupId: null, beforeChannelId: null },
    });
    expect(channelSteps(list, "tech")).toEqual({
      at: 1,
      count: 2,
      up: { channelId: "tech", groupId: "sup", beforeChannelId: "bugs" },
      down: undefined,
    });
  });

  test("a channel's creator still in it, or who manages channels, may move it", () => {
    const member = { role: "member" as const, permissions: ["read", "post"] };
    const manager = { role: "member" as const, permissions: ["read", "manage_channels"] };
    expect(movesChannel({ isMember: true, createdByUserId: "u1" }, "u1", member)).toBe(true);
    expect(movesChannel({ createdByUserId: "u2" }, "u1", member)).toBe(false);
    expect(movesChannel({ createdByUserId: "u2" }, "u1", manager)).toBe(true);
  });

  test("the long press and the ⋯ sheet open Setor; it moves the channel, and makes a sector with it", () => {
    expect(sectorHref("c 1")).toBe("/channel-sector?channelId=c%201");
    const menus = src("features/channel-sectors/menus.tsx");
    expect(menus).toContain('label: t("sidebarAgents.changeGroup"),');
    expect(menus).toContain("run: () => router.push(sectorHref(channel.id)),");
    expect(src("features/chat/sheets.tsx")).toContain("router.push(sectorHref(channelId));");
    const pick = src("features/channel-sectors/PickSectorScreen.tsx");
    expect(pick).toContain("{ channelId, groupId },");
    expect(pick).toContain('{can(org, "manage_agents") && channel ? (');
    expect(pick).toContain("router.push(`/sector-new?channelId=${encodeURIComponent(channelId)}`)");
    expect(src("features/team/NewSectorScreen.tsx")).toContain("...(channelId ? { channelIds: [channelId] } : {})");
  });

  test("Conversas' Setores: a closed sector keeps its live rows and counts its DMs and channels as one", () => {
    const home = src("features/chats/ChatsScreen.tsx");
    expect(home).toContain("kept: section.rows.filter(keptWhenClosed).map((r, i) => rowOf(r, i, true)),");
    expect(home).toContain("count: unread,");
    expect(home).toContain("i === section.lineAt ? <SectorLine /> : null");
    // The workspace's order inside a sector (ADR 0240 amendment of 2026-11-26).
    expect(home).toContain("sectorSections(visible, groups ?? [], channelsFirst)");
  });
});
