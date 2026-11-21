import { describe, expect, test } from "bun:test";
import type { ChannelOverride, OrgRole } from "@agenteschat/client";
import {
  archivesChannel,
  CHANNEL_NAME,
  channelAdminHrefs,
  deletesChannel,
  permStateOf,
  permTargets,
  targetOfKey,
  toChannelName,
  withPermState,
} from "../../src/features/chat/channel-admin";
import { whoSeesStart } from "../../src/features/roles/logic";
import { pushedByDefault } from "../main-stack";

const role = (id: string, kind: OrgRole["kind"] = "custom") => ({ id, kind, name: id, position: 0 }) as OrgRole;
const admin = { permissions: ["manage_channels"] };
const member = { permissions: ["post"] };

describe("who administers a channel, as the web decides", () => {
  test("archiving: whoever manages it (its creator too), never #general", () => {
    const mine = { name: "vendas", isMember: true, createdByUserId: "me" };
    expect(archivesChannel(mine, "me", member)).toBe(true);
    expect(archivesChannel(mine, "other", member)).toBe(false);
    expect(archivesChannel({ ...mine, name: "general" }, "me", admin)).toBe(false);
    // The server's own answer wins over the workspace's keys.
    expect(archivesChannel({ name: "x", can: { post: true, callAgents: true, manage: false } }, "me", admin)).toBe(
      false,
    );
    expect(archivesChannel(undefined, "me", admin)).toBe(false);
  });

  test("deleting: only who may manage every channel, never #general", () => {
    expect(deletesChannel({ name: "vendas" }, admin)).toBe(true);
    expect(deletesChannel({ name: "vendas" }, member)).toBe(false);
    expect(deletesChannel({ name: "general" }, admin)).toBe(false);
  });

  test("a typed name becomes a channel name the server takes", () => {
    expect(toChannelName("Marketing Brasil")).toBe("marketing-brasil");
    expect(toChannelName("Ação #1")).toBe("acao-1");
    expect(CHANNEL_NAME.test(toChannelName("Vendas Q4"))).toBe(true);
    expect(CHANNEL_NAME.test("-x")).toBe(false);
  });
});

describe("advanced permissions", () => {
  const everyone = role("all", "everyone");
  const roles = [role("sup"), role("fin"), everyone];
  const saved: ChannelOverride[] = [
    { target: { type: "person", id: "u1" }, allow: ["post"], deny: [] },
    { target: { type: "role", id: "fin" }, allow: [], deny: ["talk_to_agents"] },
  ];

  test("Todos first, then roles with an exception in the roles' order, people, and the ones just added", () => {
    expect(
      permTargets(roles, saved, [
        { type: "role", id: "sup" },
        { type: "person", id: "u1" },
      ]),
    ).toEqual([
      { type: "role", id: "all" },
      { type: "role", id: "fin" },
      { type: "person", id: "u1" },
      { type: "role", id: "sup" },
    ]);
  });

  test("one key changes, the others stay; Padrão takes it off both lists", () => {
    const fin = saved[1];
    expect(permStateOf(fin, "talk_to_agents")).toBe("deny");
    expect(permStateOf(fin, "post")).toBe("inherit");
    expect(withPermState(fin, { type: "role", id: "fin" }, "post", "allow")).toEqual({
      target: { type: "role", id: "fin" },
      allow: ["post"],
      deny: ["talk_to_agents"],
    });
    expect(withPermState(fin, { type: "role", id: "fin" }, "talk_to_agents", "inherit")).toEqual({
      target: { type: "role", id: "fin" },
      allow: [],
      deny: [],
    });
    expect(withPermState(undefined, { type: "person", id: "u2" }, "manage_channels", "deny").deny).toEqual([
      "manage_channels",
    ]);
  });

  test("a picked option's key is read back as its target", () => {
    expect(targetOfKey("role:r1")).toEqual({ type: "role", id: "r1" });
    expect(targetOfKey("person:u:1")).toEqual({ type: "person", id: "u:1" });
    expect(targetOfKey("agent:a1")).toBeNull();
    expect(targetOfKey("role:")).toBeNull();
  });
});

describe("the screens", () => {
  test("each has its address by the channel's id, pushed with the stack's bar", () => {
    expect(channelAdminHrefs.settings("c1")).toBe("/channel-settings?channelId=c1");
    expect(channelAdminHrefs.permissions("c1")).toBe("/channel-permissions?channelId=c1");
    expect(channelAdminHrefs.remove("c1")).toBe("/channel-delete?channelId=c1");
    for (const name of ["channel-settings", "channel-permissions", "channel-delete"])
      expect({ name, pushed: pushedByDefault(name) }).toEqual({ name, pushed: true });
  });

  test("who joins, opened from the channel itself, starts as the channel is", () => {
    const channel = { visibility: "public", audienceRoleIds: [] } as never;
    expect(whoSeesStart([role("sup")], channel).mode).toBe("public");
    expect(whoSeesStart([role("sup"), role("fin")], channel, role("sup")).roleIds).toEqual(new Set(["fin"]));
  });
});
