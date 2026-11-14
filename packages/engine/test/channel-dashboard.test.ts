import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { orgTopic } from "@agenteschat/adapters";
import {
  createChannel,
  createDashboard,
  type DashboardDeps,
  deleteDashboard,
  ForbiddenError,
  getOrCreateHome,
  listChannels,
  updateChannel,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
let deps: DashboardDeps;
beforeEach(async () => {
  f = await setup();
  deps = { db: f.db, pubsub: f.pubsub, context: f.context };
});
afterEach(() => f.close());

const board = (actorId: string, over: Partial<Parameters<typeof createDashboard>[3]> = {}) =>
  createDashboard(deps, actorId, f.org.id, { title: "Sales", audience: "workspace", editPolicy: "owner", ...over });

/** The channel as `userId`'s channel list has it. */
const listed = async (userId: string, channelId: string) =>
  (await listChannels(f.db, userId, f.org.id)).find((c) => c.id === channelId);

describe("a channel's dashboard (ADR 0135 §21)", () => {
  test("whoever manages the channel links a board they see; every member reads the link in the channel list", async () => {
    const nina = await addMember(f.db, f.org.id, "member", "nina");
    const sales = await board(f.owner.id);
    const linked = await updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: sales.id });
    expect(linked.dashboardId).toBe(sales.id);
    expect((await listed(nina.id, f.general.id))?.dashboardId).toBe(sales.id);
    const unlinked = await updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: null });
    expect(unlinked.dashboardId).toBeNull();
    expect((await listed(nina.id, f.general.id))?.dashboardId).toBeNull();
  });

  test("the same rule as its name and topic: a member who doesn't manage the channel can't change it", async () => {
    const nina = await addMember(f.db, f.org.id, "member", "nina");
    const sales = await board(nina.id);
    await expect(
      updateChannel(f.db, nina.id, f.org.id, f.general.id, { dashboardId: sales.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Her own channel she manages.
    const mine = await createChannel(f.db, nina.id, f.org.id, { name: "vendas" });
    const linked = await updateChannel(f.db, nina.id, f.org.id, mine.id, { dashboardId: sales.id });
    expect(linked.dashboardId).toBe(sales.id);
  });

  test("a board the manager doesn't see, another workspace's or a home board is refused", async () => {
    const nina = await addMember(f.db, f.org.id, "member", "nina");
    const hers = await board(nina.id, { audience: "private" });
    await expect(
      updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: hers.id }),
    ).rejects.toMatchObject({ code: "dashboard.not_found" });
    await expect(
      updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "dashboard.not_found" });
    const home = await getOrCreateHome(deps, f.owner.id, f.org.id);
    await expect(
      updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: home.id }),
    ).rejects.toMatchObject({ code: "dashboard.home_fixed" });
    expect((await listed(f.owner.id, f.general.id))?.dashboardId).toBeNull();
  });

  test("a private board may be linked: the link shows, the board stays its owner's (§8)", async () => {
    const mine = await board(f.owner.id, { audience: "private" });
    await updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: mine.id });
    const nina = await addMember(f.db, f.org.id, "member", "nina");
    // The id reaches her; the board itself is still a 404 to her (`requireDashboard`), which the apps say.
    expect((await listed(nina.id, f.general.id))?.dashboardId).toBe(mine.id);
  });

  test("a deleted board reads as none", async () => {
    const sales = await board(f.owner.id);
    await updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: sales.id });
    await deleteDashboard(deps, f.owner.id, f.org.id, sales.id);
    expect((await listed(f.owner.id, f.general.id))?.dashboardId).toBeNull();
  });

  test("the other members hear it: `channels.changed` goes out", async () => {
    const sales = await board(f.owner.id);
    const heard: string[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => {
      if (e.type === "org.broadcast") heard.push((e.event as { type: string }).type);
    });
    await updateChannel(f.db, f.owner.id, f.org.id, f.general.id, { dashboardId: sales.id }, { pubsub: f.pubsub });
    expect(heard).toContain("channels.changed");
  });
});
