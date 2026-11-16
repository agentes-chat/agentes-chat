// VPS Zen: the voice channels' two routes (`routes/app/voice-rooms.ts`): off without LiveKit, a token for members only.
import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const LK = {
  LIVEKIT_URL: "wss://lk.example",
  LIVEKIT_API_KEY: "APIkey",
  LIVEKIT_API_SECRET: "s3cret-s3cret-s3cret-s3cret-s3cret",
};

async function start(env: Record<string, string> = {}) {
  const server = await createTestServer({ env: { ALLOW_SIGNUP: "true", ...env } });
  t = server;
  const owner = browser(server);
  await signUp(owner, "owner@example.com");
  const stranger = browser(server);
  await signUp(stranger, "stranger@example.com");
  const created = (await (await owner("/api/app/organizations", { json: { name: "Acme" } })).json()) as {
    organization: { id: string };
    generalChannelId: string;
  };
  return { owner, stranger, orgId: created.organization.id, channelId: created.generalChannelId };
}

test("without LiveKit, voice is off: no rooms and no token", async () => {
  const { owner, orgId, channelId } = await start();
  const rooms = await owner(`/api/app/organizations/${orgId}/voice-rooms`);
  expect(rooms.status).toBe(200);
  expect(await rooms.json()).toEqual({ enabled: false, rooms: [] });
  const join = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/voice-token`, { json: {} });
  expect(join.status).toBe(404);
  expect(((await join.json()) as { error: { code: string } }).error.code).toBe("voice.off");
});

test("a member gets a token for that channel's room; someone outside the workspace doesn't", async () => {
  const { owner, stranger, orgId, channelId } = await start(LK);
  const join = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/voice-token`, { json: {} });
  expect(join.status).toBe(200);
  const body = (await join.json()) as { url: string; token: string; room: string };
  expect(body.url).toBe(LK.LIVEKIT_URL);
  expect(body.room).toBe(`agentes_${orgId}_${channelId}`);
  const [h, p, sig] = body.token.split(".") as [string, string, string];
  expect(createHmac("sha256", LK.LIVEKIT_API_SECRET).update(`${h}.${p}`).digest("base64url")).toBe(sig);
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  expect(claims.sub).toStartWith("u:");
  expect(claims.video.room).toBe(body.room);

  const denied = await stranger(`/api/app/organizations/${orgId}/channels/${channelId}/voice-token`, { json: {} });
  expect([403, 404]).toContain(denied.status);
  expect((await stranger(`/api/app/organizations/${orgId}/voice-rooms`)).status).toBeGreaterThanOrEqual(403);
});
