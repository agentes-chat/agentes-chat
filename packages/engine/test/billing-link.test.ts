import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, rowsOf, schema, sql } from "@agenteschat/db";
import {
  archiveChannel,
  BILLING_FROM,
  type BillingLinkClaims,
  createAgent,
  createChannel,
  createFileArtifact,
  createIssue,
  createWikiPage,
  deleteArtifact,
  deleteWikiPage,
  insertMessage,
  MONTH_ACTIONS_MAX,
  mintBillingLink,
  openAgentDm,
  openLinkToken,
  openPersonAgentDm,
  saveStorage,
  sayTeamHello,
  sealLinkToken,
  setBillingHold,
  setOrgStanding,
  testStorage,
  updateIssue,
} from "../src";
import { openRoutineRoom } from "../src/routine-room";
import { addMember, addUser, type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
});
afterEach(() => f.close());

// The billing service checks the same vector: the same key, nonce and claims give these exact bytes on both sides.
const SECRET = "test-billing-link-secret-000000000000000";
const VECTOR: BillingLinkClaims = {
  aud: "agentes-billing",
  jti: "00000000-0000-4000-8000-000000000001",
  iat: 1798761600,
  exp: 1798761900,
  orgId: "00000000-0000-4000-8000-0000000000aa",
  orgName: "Acme",
  userId: "user_test_1",
  email: "ana@example.com",
  name: "Ana",
  role: "owner",
  locale: "pt-BR",
  from: "settings",
  return: "/org/00000000-0000-4000-8000-0000000000aa/settings/billing",
  usage: {
    members: 3,
    agents: 6,
    storageBytes: 1073741824,
    messages: 48210,
    channels: 12,
    files: 37,
    wikiPages: 9,
    issues: 54,
    since: 1782864000,
    team: [
      { name: "Caio", role: "Cobrança", look: { color: "amber", eyes: "happy", accessory: "hat" } },
      { name: "Iara", role: "Atendimento", look: { color: "#3f4fd6", eyes: "round", accessory: "flower" } },
      { name: "Nina", role: null, look: { color: "sky", eyes: "round", accessory: null } },
    ],
    routines: 5,
    // December 2026 in São Paulo, on the 31st at 21:00 there (`iat`, 00:00 UTC on New Year's Day).
    month: {
      start: 1796094000,
      days: [
        96, 120, 88, 0, 0, 132, 140, 101, 97, 115, 0, 0, 160, 151, 149, 98, 103, 0, 0, 143, 120, 64, 12, 0, 0, 0, 87,
        90, 102, 110, 33,
      ],
      messages: 2512,
      agentActions: 1307,
      files: 6,
      wikiPages: 2,
      issues: 11,
    },
  },
};
const NONCE = Buffer.from("000102030405060708090a0b", "hex");
const TOKEN =
  "v2.AAECAwQFBgcICQoL.4mXFzaaVtaXxnkAAGO7bTeJrx6CcLnIJVtW5CtprgGzRTOpN1T2QKli761vnU-HRfO9tS4k0Cf1vLZ-xcaOij1eOLsvTajFwDl9qpLvtPv1958CLWxNlChZRt8e5JhzzVq9ikWJ2qK6YRMTKyQ6fywD9I6KRyVmLUmNEGFd5-vbPgyCLr5P4WfCvPCUf5oGr2JnuiQFaLTRVcwDS2wwl752KsC6LTcTMcrtsSs_YM4UWuhYeOevuDYB_FuYpRdJP7K5bQEbZIL38wfPj7P5gftzTnqeB4CypTFTrysDbWwLNAXUsqo-AXK3B0gS3EKUymSehFpyNrMinLHms_FBqswIAgKtQ_9QDmTDU_SGmi5SKLUvG5QuVbqvBPyg4_sB2uXCiaj386abqvzdlZGPbYmpeClfRgKEFP-5bZYwp2MHc46Jzs9NJkRB5K87EWuauxctUBCf5Kn22z-7GoI3mTyYluPLJk1jbL2coOgKUicg122ScIWn7_LEemp4uFNK52uFBHrNtHc5odDiYOURwhH0aoQw0PLxfdH1aLHkn0dPHDrGeZfoxlqfBYJFKSOB5RYF9CZ6bF7tI4u-ScnqoC4iHG-SN8zeVA5EOAlASt3pNC_fJvrtL3QNQev7Kc-xZiU_BQOQnVO_TIYKYb5lOryyOXAs3a95CAkevGtP-b99htq5iW7lA7EfFfpH-ttV7Ctq_QnETtYwlbWzznYCVfFg7Woj66HkI9zqEOPkWnJYidy9w307OD_sUaEeqg74xRFQw5PjZB98ROw_dttkWWFDIx__HX8o0EoWbljXUCZL5lcNJCnNsvrt5HV_WEpukl7bFlsqG4U72FVPrOyu7dLCTqVCnycb8cTYxQtDLxosH710JNlu5bju5_HTsjl9p1MtbKLPsySmIVzKADvaF6liteJexf5FQBp3PtCAb-BwUw0NKQ2ULPHGutZ7e1xIsNCqJZwjPJijjvrZ3zVFAOy00DhHx1BlZVpRtiGtuxukBRymhMvCzfaxknmV1xBJoAoomhYlzVVqiMdUQ4npTmE4o-C7mXW9LzrFvcYYutGnCtpL4NjeGoBp-uVWwklcvC1CQLGtX8vyUs-1vd0u-DAZsw_R1mECeqT6d-k_TIC6Ab_JbyJcYmuS25pp91LUgn0GklxWKOvBXo021nwoZTrmwe2930fIqiu3YptW3O8BCcL4hy2ulzH5tZG8Qg-2ujF-gv-MFPN-RgMWG33N8Fng6MIG3APq-9Q2IfsYFDY1W5Y_4slYA4iCA8h6rSi24QugzpU8-xGr7K6GD0duNnnh9HeUQK6C_tA76ydKTrZoVWglaewdRWHg.QkkQLhwjBM2HlAoWC79CHA";

const NOW = new Date("2027-01-01T00:00:00Z");
const mint = (
  userId: string,
  from: (typeof BILLING_FROM)[number] = "settings",
  baseUrl = "https://billing.example.com",
) => mintBillingLink(f.db, { secret: SECRET, baseUrl, userId, orgId: f.org.id, from, now: NOW });

/** The link's token, opened like the billing service opens it. */
function claimsOf(url: string) {
  return openLinkToken(SECRET, new URL(url).searchParams.get("t") ?? "") as BillingLinkClaims;
}

describe("sealLinkToken", () => {
  test("the shared test vector, byte for byte", () => {
    expect(sealLinkToken(SECRET, VECTOR, NONCE)).toBe(TOKEN);
    expect(openLinkToken(SECRET, TOKEN)).toEqual(VECTOR);
  });

  test("the address carries nothing readable, and each link has its own nonce", () => {
    const decoded = TOKEN.split(".").map((part) => Buffer.from(part, "base64url").toString("latin1"));
    for (const word of ["Acme", "ana@example.com", "agentes-billing", "settings", "Caio", "Cobrança"]) {
      expect([TOKEN, ...decoded].filter((text) => text.includes(word))).toEqual([]);
    }
    expect(sealLinkToken(SECRET, VECTOR)).not.toBe(sealLinkToken(SECRET, VECTOR));
    expect(() => openLinkToken("another-secret-of-thirty-two-characters", TOKEN)).toThrow();
  });
});

describe("mintBillingLink", () => {
  test("an owner's link: who, where, for 5 minutes, in the vector's key order", async () => {
    const link = await mint(f.owner.id);
    expect(link.url.startsWith("https://billing.example.com/link?t=v2.")).toBe(true);
    expect(link.expiresAt).toEqual(new Date(NOW.getTime() + 300_000));
    const [owner] = await f.db.select().from(schema.users).where(eq(schema.users.id, f.owner.id));
    const claims = claimsOf(link.url);
    expect(Object.keys(claims)).toEqual(Object.keys(VECTOR));
    expect(Object.keys(claims.usage)).toEqual(Object.keys(VECTOR.usage));
    expect(Object.keys(claims.usage.month)).toEqual(Object.keys(VECTOR.usage.month));
    expect(claims).toEqual({
      aud: "agentes-billing",
      jti: expect.any(String),
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 300,
      orgId: f.org.id,
      orgName: "Acme",
      userId: f.owner.id,
      email: owner?.email ?? "",
      name: owner?.name ?? "",
      role: "owner",
      locale: "pt-BR",
      from: "settings",
      return: `/org/${f.org.id}/settings/billing`,
      // A new workspace: #general, its owner and @dev in the default look, nothing written yet, on day one of a month
      // in its time zone (UTC: it set none).
      usage: {
        members: 1,
        agents: 1,
        storageBytes: 0,
        messages: 0,
        channels: 1,
        files: 0,
        wikiPages: 0,
        issues: 0,
        since: Math.floor(f.org.createdAt.getTime() / 1000),
        team: [{ name: "Dev", role: "Developer", look: { color: "sky", eyes: "round", accessory: null } }],
        routines: 0,
        month: {
          start: NOW.getTime() / 1000,
          days: [0],
          messages: 0,
          agentActions: 0,
          files: 0,
          wikiPages: 0,
          issues: 0,
        },
      },
    });
    // Single use on the billing side: every link is its own.
    expect(claimsOf((await mint(f.owner.id)).url).jti).not.toBe(claims.jti);
  });

  test("admins too, in their language; back to where each entry point opened it", async () => {
    const admin = await addMember(f.db, f.org.id, "admin");
    await f.db.update(schema.users).set({ locale: "en" }).where(eq(schema.users.id, admin.id));
    const returns = Object.fromEntries(
      await Promise.all(BILLING_FROM.map(async (from) => [from, claimsOf((await mint(admin.id, from)).url).return])),
    );
    const org = `/org/${f.org.id}`;
    expect(returns).toEqual({
      settings: `${org}/settings/billing`,
      hold: org,
      onboarding: `${org}/onboarding`,
      new_workspace: org,
      invite_full: `${org}/members`,
      upload_full: org,
      storage: `${org}/settings/storage`,
    });
    const claims = claimsOf((await mint(admin.id, "hold", "https://billing.example.com/")).url);
    expect(claims).toMatchObject({ role: "admin", locale: "en", usage: { members: 2 } });
  });

  test("the plan picked in the app goes as a claim, untouched; anything not a plan key is left out", async () => {
    const planOf = async (plan: string | undefined) =>
      claimsOf(
        (
          await mintBillingLink(f.db, {
            secret: SECRET,
            baseUrl: "https://billing.example.com",
            userId: f.owner.id,
            orgId: f.org.id,
            from: "onboarding",
            plan,
            now: NOW,
          })
        ).url,
      ).plan;
    expect(await planOf("team")).toBe("team");
    expect(await planOf("pro_yearly")).toBe("pro_yearly");
    expect(await planOf(undefined)).toBeUndefined();
    for (const junk of ["Team", "team plan", "x".repeat(40), "1team", ""]) expect(await planOf(junk)).toBeUndefined();
  });

  test("back to the page it was opened from when that is one of this workspace's; anything else, the default", async () => {
    const org = `/org/${f.org.id}`;
    const back = async (from: (typeof BILLING_FROM)[number], returnTo: string) =>
      claimsOf(
        (
          await mintBillingLink(f.db, {
            secret: SECRET,
            baseUrl: "https://billing.example.com",
            userId: f.owner.id,
            orgId: f.org.id,
            from,
            returnTo,
            now: NOW,
          })
        ).url,
      ).return;
    // The upload that hit the limit, in a channel: back to that channel. The billing service takes a bare path only
    // (it adds `?paid=1`), so the page's search and hash stay behind.
    const channel = `${org}/c/0b6f4c1e-8d2a-4f3b-9c7e-5a1d2e3f4a5b`;
    expect(await back("upload_full", `${channel}?thread=m-1#x`)).toBe(channel);
    expect(await back("hold", `${org}/settings/members`)).toBe(`${org}/settings/members`);
    // Another workspace, another host, the onboarding outside any workspace, or a path that only starts like it.
    expect(await back("upload_full", "/org/someone-else/c/abc")).toBe(org);
    expect(await back("upload_full", "https://evil.example.com/org")).toBe(org);
    expect(await back("upload_full", `//evil.example.com${org}/`)).toBe(org);
    expect(await back("onboarding", "/onboarding")).toBe(`${org}/onboarding`);
    expect(await back("settings", `${org}x/c/abc`)).toBe(`${org}/settings/billing`);
    expect(await back("settings", `${org}/c/a\\b`)).toBe(`${org}/settings/billing`);
    // A shape the billing service would refuse the whole link over: the default instead.
    expect(await back("settings", `${org}/wiki/Café`)).toBe(`${org}/settings/billing`);
    expect(await back("settings", `${org}/c/a b`)).toBe(`${org}/settings/billing`);
  });

  test("usage counts the files on this server's storage; on the workspace's own bucket, none", async () => {
    const owner = { type: "person" as const, userId: f.owner.id };
    await createFileArtifact(f.artifactDeps, owner, f.org.id, { title: "a", name: "a.txt", bytes: new Uint8Array(42) });
    expect(claimsOf((await mint(f.owner.id)).url).usage.storageBytes).toBe(42);
    const bucket = {
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "acme-files",
      prefix: null,
      pathStyle: true,
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret-test-key-123456",
    };
    expect((await testStorage(f.storage, f.owner.id, f.org.id, bucket)).ok).toBe(true);
    await saveStorage(f.storage, f.owner.id, f.org.id, { kind: "s3", s3: bucket });
    expect(claimsOf((await mint(f.owner.id)).url).usage.storageBytes).toBeNull();
  });

  test("usage counts what people can read, live: messages, named channels, Drive files, wiki pages, tasks", async () => {
    const ana = { type: "person" as const, userId: f.owner.id };
    const say = (channelId: string, author: Parameters<typeof insertMessage>[1]["author"] = ana, threadId?: string) =>
      insertMessage(f.db, { orgId: f.org.id, channelId, threadId, author, body: "Oi" });
    const root = await say(f.general.id);
    await say(f.general.id, ana, root.id);
    const old = await createChannel(f.db, f.owner.id, f.org.id, { name: "old" });
    await say(old.id);
    await archiveChannel(f.db, f.owner.id, f.org.id, old.id);
    await say((await openPersonAgentDm(f.db, f.org.id, f.owner.id, f.agent.id)).id);
    // Rooms no person reads: two agents' DM and a routine's room.
    const ops = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Ops", handle: "ops", role: "Ops", instructions: "Watch.", credentialId: f.credential.id },
      { model: "claude-sonnet-5-5" },
    );
    const dev = { type: "agent" as const, agentId: f.agent.id, runId: null, hop: 1, stretchId: null };
    await say((await openAgentDm(f.db, f.org.id, f.agent.id, ops.id)).id, dev);
    await say((await openRoutineRoom(f.db, f.org.id, f.agent.id, crypto.randomUUID())).id, ana);

    const file = (name: string) =>
      createFileArtifact(f.artifactDeps, ana, f.org.id, { title: name, name, bytes: new Uint8Array(1) });
    await file("kept.txt");
    await deleteArtifact(f.artifactDeps, f.owner.id, f.org.id, (await file("trashed.txt")).id);
    const wiki = { db: f.db };
    await createWikiPage(wiki, ana, f.org.id, { title: "Glossário" });
    await deleteWikiPage(wiki, ana, f.org.id, (await createWikiPage(wiki, ana, f.org.id, { title: "Rascunho" })).id);
    const tasks = { db: f.db };
    await createIssue(tasks, ana, f.org.id, { title: "Lançar" });
    const dropped = await createIssue(tasks, ana, f.org.id, { title: "Esquecer" });
    await updateIssue(tasks, ana, f.org.id, dropped.id, { status: "canceled" });

    expect(claimsOf((await mint(f.owner.id)).url).usage).toMatchObject({
      messages: 4,
      channels: 1,
      files: 1,
      wikiPages: 1,
      issues: 1,
    });
  });

  test("the team: five agents at most, oldest first, the right hand left out; names and roles cut, looks as drawn", async () => {
    const g = await setup({ rightHand: true });
    try {
      type Look = { color: string; eyes: string; accessory: string };
      const add = async (name: string, role: string, at: string, appearance?: Look) => {
        const made = await createAgent(
          g.db,
          g.owner.id,
          g.org.id,
          { name, handle: name.slice(0, 8).toLowerCase(), role, instructions: "Help.", credentialId: g.credential.id },
          { model: "claude-sonnet-5-5" },
        );
        await g.db
          .update(schema.agents)
          .set({ createdAt: new Date(at), ...(appearance ? { appearance } : {}) })
          .where(eq(schema.agents.id, made.id));
        return made;
      };
      await g.db
        .update(schema.agents)
        .set({
          createdAt: new Date("2026-11-01T10:00:00Z"),
          appearance: { color: "teal", eyes: "wide", accessory: "headset" },
        })
        .where(eq(schema.agents.id, g.agent.id));
      await add("Caio", "  Cobrança  ", "2026-11-01T11:00:00Z", { color: "amber", eyes: "happy", accessory: "hat" });
      // Archived: not on the team any more.
      const gone = await add("Lia", "Vendas", "2026-11-01T11:30:00Z");
      await g.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, gone.id));
      // A custom color, and glasses the app no longer draws: no accessory.
      await add("Iara", "", "2026-11-01T12:00:00Z", { color: "#3f4fd6", eyes: "dots", accessory: "glasses" });
      await add("N".repeat(100), `${"R".repeat(79)}😀`, "2026-11-01T13:00:00Z", {
        color: "neon",
        eyes: "lasers",
        accessory: "none",
      });
      await add("Ada", "Bugs", "2026-11-01T14:00:00Z");
      await add("Theo", "Sexto", "2026-11-01T15:00:00Z");
      const claims = claimsOf(
        (
          await mintBillingLink(g.db, {
            secret: SECRET,
            baseUrl: "https://billing.example.com",
            userId: g.owner.id,
            orgId: g.org.id,
            from: "settings",
            now: NOW,
          })
        ).url,
      );
      expect(claims.usage.agents).toBe(6);
      expect(claims.usage.team).toEqual([
        { name: "Dev", role: "Developer", look: { color: "teal", eyes: "wide", accessory: "headset" } },
        { name: "Caio", role: "Cobrança", look: { color: "amber", eyes: "happy", accessory: "hat" } },
        { name: "Iara", role: null, look: { color: "#3f4fd6", eyes: "dots", accessory: null } },
        // Cut to 80 UTF-16 units without splitting the emoji: the billing service's limit.
        { name: "N".repeat(80), role: "R".repeat(79), look: { color: "sky", eyes: "round", accessory: null } },
        { name: "Ada", role: "Bugs", look: { color: "sky", eyes: "round", accessory: null } },
      ]);
    } finally {
      await g.close();
    }
  });

  test("routines: the repeating ones that are on, as an agent's cap counts them", async () => {
    const routine = (name: string, extra: Partial<typeof schema.routines.$inferInsert> = {}) =>
      f.db.insert(schema.routines).values({
        orgId: f.org.id,
        agentId: f.agent.id,
        name,
        prompt: "Resumo",
        target: { type: "channel", channelId: f.general.id },
        triggerType: "schedule",
        cron: "0 9 * * *",
        ...extra,
      });
    await routine("daily summary");
    await routine("new issue", { triggerType: "event", event: "issue.created", cron: null });
    await routine("paused", { active: false, pausedReason: "failing" });
    await routine("deleted", { deletedAt: new Date() });
    await routine("one-off", { triggerType: "once", cron: null });
    await routine("reminder", { target: { type: "conversation", reminder: true } });
    await routine("widget", { target: { type: "widget", widgetId: crypto.randomUUID() } });
    expect(claimsOf((await mint(f.owner.id)).url).usage.routines).toBe(2);
  });

  test("the month so far in the workspace's zone: messages per local day, agents' own lines, what was created", async () => {
    // New York leaves daylight time on 1 November 2026: that day has 25 hours, and the 2nd starts at 05:00 UTC.
    await f.db
      .insert(schema.organizationSettings)
      .values({ orgId: f.org.id, timezone: "America/New_York" })
      .onConflictDoUpdate({ target: schema.organizationSettings.orgId, set: { timezone: "America/New_York" } });
    const now = new Date("2026-11-24T17:00:00Z");
    const ana = { type: "person" as const, userId: f.owner.id };
    const dev = { type: "agent" as const, agentId: f.agent.id, runId: null, hop: 1, stretchId: null };
    const say = (
      at: string,
      channelId = f.general.id,
      author: Parameters<typeof insertMessage>[1]["author"] = ana,
      extra: { threadId?: string; meta?: Record<string, unknown> } = {},
    ) => insertMessage(f.db, { orgId: f.org.id, channelId, author, body: "Oi", createdAt: new Date(at), ...extra });

    await say("2026-10-15T12:00:00Z"); // last month
    await say("2026-11-01T03:30:00Z"); // 31 October, 23:30 in New York
    const first = await say("2026-11-01T04:00:00Z"); // the 1st, 00:00
    await say("2026-11-02T04:30:00Z", f.general.id, dev); // still the 1st, 23:30: an agent's own line
    await say("2026-11-03T12:00:00Z", f.general.id, dev, { meta: { bodyCode: "brain_unavailable" } }); // the server's
    const old = await createChannel(f.db, f.owner.id, f.org.id, { name: "old" });
    await say("2026-11-05T15:00:00Z", old.id);
    await archiveChannel(f.db, f.owner.id, f.org.id, old.id);
    const ops = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Ops", handle: "ops", role: "Ops", instructions: "Watch.", credentialId: f.credential.id },
      { model: "claude-sonnet-5-5" },
    );
    // Rooms no person reads.
    await say("2026-11-10T12:00:00Z", (await openAgentDm(f.db, f.org.id, f.agent.id, ops.id)).id, dev);
    await say("2026-11-11T12:00:00Z", (await openRoutineRoom(f.db, f.org.id, f.agent.id, crypto.randomUUID())).id, dev);
    await say("2026-11-24T16:00:00Z", f.general.id, dev, { threadId: first.id }); // today, in a thread

    const placed = (table: "artifacts" | "wiki_pages" | "issues", id: string, at: string) =>
      f.db.execute(sql`update ${sql.identifier(table)} set created_at = ${at}::timestamptz where id = ${id}`);
    const file = (name: string) =>
      createFileArtifact(f.artifactDeps, ana, f.org.id, { title: name, name, bytes: new Uint8Array(1) });
    await placed("artifacts", (await file("this-month.txt")).id, "2026-11-10T12:00:00Z");
    await placed("artifacts", (await file("last-month.txt")).id, "2026-10-30T12:00:00Z");
    const trashed = await file("trashed.txt");
    await placed("artifacts", trashed.id, "2026-11-12T12:00:00Z");
    await deleteArtifact(f.artifactDeps, f.owner.id, f.org.id, trashed.id);
    const wiki = { db: f.db };
    await placed(
      "wiki_pages",
      (await createWikiPage(wiki, ana, f.org.id, { title: "Glossário" })).id,
      "2026-11-05T12:00:00Z",
    );
    const draft = await createWikiPage(wiki, ana, f.org.id, { title: "Rascunho" });
    await placed("wiki_pages", draft.id, "2026-11-06T12:00:00Z");
    await deleteWikiPage(wiki, ana, f.org.id, draft.id);
    const tasks = { db: f.db };
    await placed("issues", (await createIssue(tasks, ana, f.org.id, { title: "Lançar" })).id, "2026-11-06T12:00:00Z");
    await placed("issues", (await createIssue(tasks, ana, f.org.id, { title: "Antes" })).id, "2026-10-20T12:00:00Z");
    const dropped = await createIssue(tasks, ana, f.org.id, { title: "Esquecer" });
    await placed("issues", dropped.id, "2026-11-07T12:00:00Z");
    await updateIssue(tasks, ana, f.org.id, dropped.id, { status: "canceled" });

    const usage = claimsOf(
      (
        await mintBillingLink(f.db, {
          secret: SECRET,
          baseUrl: "https://billing.example.com",
          userId: f.owner.id,
          orgId: f.org.id,
          from: "settings",
          now,
        })
      ).url,
    ).usage;
    const days = Array.from({ length: 24 }, () => 0);
    days[0] = 2;
    days[2] = 1;
    days[4] = 1;
    days[23] = 1;
    expect(usage.month).toEqual({
      start: Date.UTC(2026, 10, 1, 4) / 1000,
      days,
      messages: 5,
      agentActions: 2,
      files: 1,
      wikiPages: 1,
      issues: 1,
    });
    // The same counts in all: every message people can read, the month's among them.
    expect(usage).toMatchObject({ messages: 7, files: 2, wikiPages: 1, issues: 2 });
  });

  test("the lines the server posts as an agent count as messages, never as the team's own: its hello first", async () => {
    const g = await setup({ rightHand: true });
    try {
      // A clinic template's agent beside the right hand: each says hi in #general with no model call (ADR 0162).
      const nina = await createAgent(
        g.db,
        g.owner.id,
        g.org.id,
        { name: "Nina", handle: "nina", role: "Agenda", instructions: "Help.", credentialId: g.credential.id },
        { model: "claude-sonnet-5-5" },
      );
      const [lodi] = await g.db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(eq(schema.agents.orgId, g.org.id), eq(schema.agents.builtin, "right_hand")));
      for (const agentId of [lodi?.id, nina.id])
        await sayTeamHello({ db: g.db }, g.org.id, { agentId, userId: g.owner.id, how: "paid" });
      // Into a month of the past, which nothing else this workspace wrote reaches.
      const hellos = await g.db.execute(
        sql`update messages set created_at = '2026-10-15T12:00:00Z' where org_id = ${g.org.id}
          and meta->>'greeting' = 'true' returning id`,
      );
      expect(rowsOf(hellos)).toHaveLength(2);
      const dev = { type: "agent" as const, agentId: g.agent.id, runId: null, hop: 1, stretchId: null };
      const say = (meta: Record<string, unknown>, at = "2026-10-16T12:00:00Z") =>
        insertMessage(g.db, {
          orgId: g.org.id,
          channelId: g.general.id,
          author: dev,
          body: "Oi",
          meta,
          createdAt: new Date(at),
        });
      // A reminder's line, a device wait's card, a task's and a file's hidden first message, the GIF after a reply.
      for (const meta of [
        { reminder: true },
        { deviceWait: { id: crypto.randomUUID(), state: "waiting" } },
        { taskConversation: { number: 1 } },
        { fileConversation: { kind: "doc" } },
        { mediaAfter: crypto.randomUUID() },
      ])
        await say(meta);
      const monthOf = async () =>
        claimsOf(
          (
            await mintBillingLink(g.db, {
              secret: SECRET,
              baseUrl: "https://billing.example.com",
              userId: g.owner.id,
              orgId: g.org.id,
              from: "settings",
              now: new Date("2026-10-20T12:00:00Z"),
            })
          ).url,
        ).usage.month;
      expect(await monthOf()).toMatchObject({ messages: 7, agentActions: 0 });
      // An agent's own line is the team's work.
      await say({});
      expect(await monthOf()).toMatchObject({ messages: 8, agentActions: 1 });
    } finally {
      await g.close();
    }
  });

  test("the agents' own lines count up to MONTH_ACTIONS_MAX, and the reading stops there; every message still counts", async () => {
    const over = MONTH_ACTIONS_MAX + 1;
    // A month of the past, which nothing else this workspace wrote reaches.
    await f.db.execute(sql`insert into messages (id, org_id, channel_id, author_type, author_agent_id, body, created_at)
      select gen_random_uuid(), ${f.org.id}::uuid, ${f.general.id}::uuid, 'agent'::author_type, ${f.agent.id}::uuid, 'Oi',
        timestamptz '2026-09-10T12:00:00Z' + i * interval '1 second'
      from generate_series(1, ${over}) i`);
    const month = claimsOf(
      (
        await mintBillingLink(f.db, {
          secret: SECRET,
          baseUrl: "https://billing.example.com",
          userId: f.owner.id,
          orgId: f.org.id,
          from: "settings",
          now: new Date("2026-09-20T12:00:00Z"),
        })
      ).url,
    ).usage.month;
    expect(month).toMatchObject({ messages: over, agentActions: MONTH_ACTIONS_MAX });
    expect(month.days[9]).toBe(over);
  });

  test("the link stays short enough for any address bar and proxy, with the longest team and month", async () => {
    await f.db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.agent.id));
    for (const [i, name] of ["Caio", "Iara", "Nina", "Lodi", "Ada"].entries()) {
      const made = await createAgent(
        f.db,
        f.owner.id,
        f.org.id,
        {
          name: `${name} ${"界".repeat(120)}`,
          handle: `${name.toLowerCase()}-${i}`,
          role: "務".repeat(120),
          instructions: "Help.",
          credentialId: f.credential.id,
        },
        { model: "claude-sonnet-5-5" },
      );
      await f.db
        .update(schema.agents)
        .set({ appearance: { color: "#3f4fd6", eyes: "sleepy", accessory: "headphones" } })
        .where(eq(schema.agents.id, made.id));
    }
    const link = await mintBillingLink(f.db, {
      secret: SECRET,
      baseUrl: "https://billing.example.com",
      userId: f.owner.id,
      orgId: f.org.id,
      from: "settings",
      now: new Date("2026-12-31T23:00:00Z"),
    });
    const usage = claimsOf(link.url).usage;
    expect(usage.team).toHaveLength(5);
    expect(usage.team.every((agent) => agent.name.length === 80 && agent.role?.length === 80)).toBe(true);
    expect(usage.month.days).toHaveLength(31);
    // Well under the 8 KB request line most servers and proxies take.
    expect(link.url.length).toBeLessThan(6000);
  });

  test("members and strangers never get one; a held workspace does, a suspended one doesn't", async () => {
    const member = await addMember(f.db, f.org.id, "member");
    await expect(mint(member.id)).rejects.toMatchObject({ code: "forbidden" });
    const stranger = await addUser(f.db, "eve");
    await expect(mint(stranger.id)).rejects.toMatchObject({ code: "forbidden" });

    await setBillingHold({ db: f.db }, f.org.id, "payment");
    expect(claimsOf((await mint(f.owner.id, "hold")).url).from).toBe("hold");
    await setOrgStanding({ db: f.db }, f.org.id, { state: "suspended", reason: "abuse", notice: "shown" });
    await expect(mint(f.owner.id)).rejects.toMatchObject({ code: "org.suspended" });
  });
});
