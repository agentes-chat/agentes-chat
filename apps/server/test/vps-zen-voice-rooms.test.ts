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
  expect(await rooms.json()).toEqual({ enabled: false, rooms: [], voiceChannels: [] });
  const only = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/voice-only`, {
    method: "PUT",
    json: { on: true },
  });
  expect(only.status).toBe(404);
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

test("a channel made voice-only is listed for the workspace, and back to text; not by someone outside", async () => {
  const { owner, stranger, orgId } = await start(LK);
  const made = await owner(`/api/app/organizations/${orgId}/channels`, { json: { name: "sala" } });
  expect(made.status).toBeLessThan(300);
  const sala = (await made.json()) as { channel?: { id: string }; id?: string };
  const id = (sala.channel?.id ?? sala.id) as string;
  const put = (who: typeof owner, on: boolean) =>
    who(`/api/app/organizations/${orgId}/channels/${id}/voice-only`, { method: "PUT", json: { on } });
  const on = await put(owner, true);
  expect(on.status).toBe(200);
  expect(await on.json()).toEqual({ channelId: id, voiceOnly: true });
  const list = (await (await owner(`/api/app/organizations/${orgId}/voice-rooms`)).json()) as {
    voiceChannels: string[];
  };
  expect(list.voiceChannels).toEqual([id]);
  expect((await put(stranger, false)).status).toBeGreaterThanOrEqual(403);
  expect((await put(owner, false)).status).toBe(200);
  const after = (await (await owner(`/api/app/organizations/${orgId}/voice-rooms`)).json()) as {
    voiceChannels: string[];
  };
  expect(after.voiceChannels).toEqual([]);
});
