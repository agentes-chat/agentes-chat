// VPS Zen: voice channels on LiveKit (`voice-rooms.ts`): tokens, and who is in each room of the channels a person sees.
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { archiveChannel, createChannel } from "../src/channels";
import { ForbiddenError, NotFoundError } from "../src/errors";
import {
  forgetVoiceRooms,
  listVoiceRooms,
  participantOf,
  setVoiceChannel,
  voiceChannelIds,
  voiceJoinToken,
  voiceRoomName,
  voiceRoomsConfig,
} from "../src/voice-rooms";
import { addMember, type Fixture, setup } from "./fixtures";

const lk = { url: "wss://lk.example", apiKey: "APIkey", apiSecret: "s3cret-s3cret-s3cret-s3cret-s3cret" };
let f: Fixture | null = null;
afterEach(async () => {
  await f?.close();
  f = null;
});

const claimsOf = (token: string) => {
  const [h, p, sig] = token.split(".");
  expect(createHmac("sha256", lk.apiSecret).update(`${h}.${p}`).digest("base64url")).toBe(sig as string);
  return JSON.parse(Buffer.from(p as string, "base64url").toString());
};

describe("voice rooms", () => {
  test("off unless the address and the key pair are all set", () => {
    expect(voiceRoomsConfig({})).toBeNull();
    expect(voiceRoomsConfig({ LIVEKIT_URL: lk.url, LIVEKIT_API_KEY: lk.apiKey })).toBeNull();
    expect(voiceRoomsConfig({ LIVEKIT_URL: lk.url, LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" })).toEqual({
      url: lk.url,
      apiKey: "k",
      apiSecret: "s",
    });
  });

  test("a join token is signed for that channel's room only, as the person", () => {
    const now = Date.UTC(2026, 10, 16);
    const join = voiceJoinToken(lk, { orgId: "o1", channelId: "c1", userId: "u1", name: "Ana", image: null }, now);
    expect(join.url).toBe(lk.url);
    expect(join.room).toBe(voiceRoomName("o1", "c1"));
    const claims = claimsOf(join.token);
    expect(claims.iss).toBe(lk.apiKey);
    expect(claims.sub).toBe("u:u1");
    expect(claims.name).toBe("Ana");
    expect(claims.exp - claims.iat).toBe(6 * 3600);
    expect(claims.video).toMatchObject({ room: "agentes_o1_c1", roomJoin: true, canPublish: true });
    expect(claims.video.roomAdmin).toBeUndefined();
  });

  test("a participant's mic, camera and screen from its tracks, by name or by number", () => {
    expect(participantOf({ identity: "agent-bot" })).toBeNull();
    expect(participantOf({ identity: "u:x", state: "DISCONNECTED" })).toBeNull();
    expect(participantOf({ identity: "u:x", tracks: [] })).toMatchObject({ userId: "x", muted: true, screen: false });
    expect(
      participantOf({
        identity: "u:x",
        joined_at: "1794790698",
        tracks: [
          { source: "MICROPHONE", muted: false },
          { source: "SCREEN_SHARE", muted: false },
          { source: 1, muted: true },
        ],
      }),
    ).toMatchObject({ muted: false, screen: true, camera: false, joinedAt: "2026-11-16T00:58:18.000Z" });
  });

  test("lists only the rooms of this workspace's channels the person is a member of", async () => {
    f = await setup();
    const { db, org, owner, general } = f;
    const other = await addMember(db, org.id, "member", "Bia");
    const calls: string[] = [];
    const send = async (url: string, init: RequestInit) => {
      calls.push(url.split("/").pop() as string);
      expect(url.startsWith("https://lk.example/twirp/livekit.RoomService/")).toBe(true);
      expect(String((init.headers as Record<string, string>).authorization)).toStartWith("Bearer ");
      if (url.endsWith("ListRooms"))
        return Response.json({
          rooms: [
            { name: voiceRoomName(org.id, general.id) },
            { name: voiceRoomName(org.id, "0193eeee-0000-4000-8000-000000000099") },
            { name: "hub-call-123" },
            { name: voiceRoomName("another-org", general.id) },
          ],
        });
      const room = JSON.parse(String(init.body)).room as string;
      return Response.json({
        participants:
          room === voiceRoomName(org.id, general.id)
            ? [
                { identity: `u:${other.id}`, name: "token name", joined_at: "20", tracks: [] },
                { identity: `u:${owner.id}`, joined_at: "10", tracks: [{ source: "MICROPHONE", muted: false }] },
              ]
            : [{ identity: "u:ghost" }],
      });
    };
    forgetVoiceRooms(org.id);
    const rooms = await listVoiceRooms(db, lk, { orgId: org.id, userId: owner.id }, send);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.channelId).toBe(general.id);
    expect(rooms[0]?.participants.map((p) => p.userId)).toEqual([owner.id, other.id]);
    expect(rooms[0]?.participants[1]?.name).toBe("Bia");
    expect(rooms[0]?.participants[0]?.muted).toBe(false);
    // Read once, then from the cache for 2.5 s.
    const before = calls.length;
    await listVoiceRooms(db, lk, { orgId: org.id, userId: owner.id }, send);
    expect(calls.length).toBe(before);
    // Bia isn't a member of #general here: she sees nothing.
    expect(await listVoiceRooms(db, lk, { orgId: org.id, userId: other.id }, send)).toEqual([]);
  });

  test("a voice-only channel: made by who manages it, listed per workspace, undone, gone when archived", async () => {
    f = await setup();
    const { db, org, owner } = f;
    const bia = await addMember(db, org.id, "member", "Bia");
    const sala = await createChannel(db, owner.id, org.id, { name: "sala" });
    expect(await voiceChannelIds(db, org.id)).toEqual([]);
    expect(await setVoiceChannel(db, owner.id, org.id, sala.id, true)).toEqual({ channelId: sala.id, voiceOnly: true });
    // Twice is the same.
    await setVoiceChannel(db, owner.id, org.id, sala.id, true);
    expect(await voiceChannelIds(db, org.id)).toEqual([sala.id]);
    // Only its creator or an admin changes it.
    await expect(setVoiceChannel(db, bia.id, org.id, sala.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setVoiceChannel(db, owner.id, org.id, "0193eeee-0000-4000-8000-000000000099", true),
    ).rejects.toBeInstanceOf(NotFoundError);
    await setVoiceChannel(db, owner.id, org.id, sala.id, false);
    expect(await voiceChannelIds(db, org.id)).toEqual([]);
    await setVoiceChannel(db, owner.id, org.id, sala.id, true);
    await archiveChannel(db, owner.id, org.id, sala.id);
    await expect(setVoiceChannel(db, owner.id, org.id, sala.id, false)).rejects.toBeInstanceOf(NotFoundError);
  });
});
