import { createHmac } from "node:crypto";
import { and, type Database, eq, inArray, isNull, schema } from "@agenteschat/db";

const { channelMembers, channels, users } = schema;

/*
 * VPS Zen: voice channels. Every channel (and DM) of a workspace has a voice room on a LiveKit server, where people
 * talk, turn on the camera and share their screen, like a Discord voice channel. This server only signs the room
 * tokens (the key pair never leaves it) and reads who is in each room; audio and video go between the browsers and
 * LiveKit. Off unless `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are all set.
 */

export interface VoiceRoomsConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface VoiceParticipant {
  userId: string;
  name: string;
  image: string | null;
  /** Microphone off (or never turned on). */
  muted: boolean;
  camera: boolean;
  screen: boolean;
  joinedAt: string | null;
}

export interface VoiceRoom {
  channelId: string;
  participants: VoiceParticipant[];
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function voiceRoomsConfig(env: {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}): VoiceRoomsConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

/** The room of a channel: one namespace per workspace, so a shared LiveKit project never mixes workspaces. */
export const voiceRoomName = (orgId: string, channelId: string) => `agentes_${orgId}_${channelId}`;
const roomPrefix = (orgId: string) => `agentes_${orgId}_`;
/** A person's identity in a room (never an agent's: only people join a call). */
export const voiceIdentity = (userId: string) => `u:${userId}`;
const userOfIdentity = (identity: string) => (identity.startsWith("u:") ? identity.slice(2) : null);

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** An HS256 JWT in LiveKit's access-token format. */
export function signLiveKitToken(
  config: VoiceRoomsConfig,
  claims: { sub?: string; name?: string; metadata?: string; video: Record<string, unknown> },
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const payload: Record<string, unknown> = { iss: config.apiKey, nbf: iat - 10, iat, exp: iat + ttlSeconds, ...claims };
  const head = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${head}.${createHmac("sha256", config.apiSecret).update(head).digest("base64url")}`;
}

/** What a browser needs to join a channel's room: the server's address and a token good for 6 hours. */
export function voiceJoinToken(
  config: VoiceRoomsConfig,
  input: { orgId: string; channelId: string; userId: string; name: string; image: string | null },
  now = Date.now(),
) {
  const room = voiceRoomName(input.orgId, input.channelId);
  const token = signLiveKitToken(
    config,
    {
      sub: voiceIdentity(input.userId),
      name: input.name,
      metadata: JSON.stringify({ image: input.image }),
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: ["microphone", "camera", "screen_share", "screen_share_audio"],
      },
    },
    6 * 60 * 60,
    now,
  );
  return { url: config.url, token, room };
}

const httpBase = (url: string) => url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");

async function twirp<T>(
  config: VoiceRoomsConfig,
  method: string,
  body: unknown,
  video: Record<string, unknown>,
  send: Fetch,
) {
  const token = signLiveKitToken(config, { video }, 60);
  const res = await send(`${httpBase(config.url)}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`LiveKit ${method}: ${res.status}`);
  return (await res.json()) as T;
}

interface LkTrack {
  type?: string | number;
  source?: string | number;
  muted?: boolean;
}
interface LkParticipant {
  identity?: string;
  name?: string;
  metadata?: string;
  state?: string | number;
  joined_at?: string | number;
  joinedAt?: string | number;
  tracks?: LkTrack[];
}

/** LiveKit answers enums by name or by number depending on the version: both count. */
const sourceIs = (t: LkTrack, name: string, num: number) => t.source === name || t.source === num;

export function participantOf(p: LkParticipant): (Omit<VoiceParticipant, "image"> & { name: string }) | null {
  const userId = userOfIdentity(p.identity ?? "");
  if (!userId) return null;
  // DISCONNECTED (3) still listed for a moment after leaving.
  if (p.state === "DISCONNECTED" || p.state === 3) return null;
  const tracks = p.tracks ?? [];
  const mic = tracks.find((t) => sourceIs(t, "MICROPHONE", 2));
  const joined = Number(p.joinedAt ?? p.joined_at ?? 0);
  return {
    userId,
    name: p.name ?? "",
    muted: !mic || mic.muted === true,
    camera: tracks.some((t) => sourceIs(t, "CAMERA", 1) && !t.muted),
    screen: tracks.some((t) => sourceIs(t, "SCREEN_SHARE", 3) && !t.muted),
    joinedAt: joined ? new Date(joined * 1000).toISOString() : null,
  };
}

const cache = new Map<string, { at: number; rooms: Promise<Map<string, ReturnType<typeof participantOf>[]>> }>();
const CACHE_MS = 2500;

/** Who is in each of a workspace's rooms, read from LiveKit (at most once every 2.5 s per workspace). */
async function roomsOf(config: VoiceRoomsConfig, orgId: string, send: Fetch) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rooms;
  const rooms = (async () => {
    const out = new Map<string, ReturnType<typeof participantOf>[]>();
    const list = await twirp<{ rooms?: { name?: string; num_participants?: number; numParticipants?: number }[] }>(
      config,
      "ListRooms",
      {},
      { roomList: true },
      send,
    );
    const prefix = roomPrefix(orgId);
    const mine = (list.rooms ?? []).filter((r) => r.name?.startsWith(prefix));
    await Promise.all(
      mine.map(async (r) => {
        const room = r.name as string;
        const { participants } = await twirp<{ participants?: LkParticipant[] }>(
          config,
          "ListParticipants",
          { room },
          { roomAdmin: true, room },
          send,
        );
        const people = (participants ?? []).map(participantOf).filter((p) => p !== null);
        if (people.length) out.set(room.slice(prefix.length), people);
      }),
    );
    return out;
  })();
  cache.set(orgId, { at: Date.now(), rooms });
  rooms.catch(() => cache.delete(orgId));
  return rooms;
}

/** Forgets what was read for a workspace, so the next read sees a join or a leave at once. */
export const forgetVoiceRooms = (orgId: string) => cache.delete(orgId);

/**
 * The rooms with someone in them among the channels this person is a member of (what their sidebar lists), with
 * each person's name and photo from this server, not from the token.
 */
export async function listVoiceRooms(
  db: Database,
  config: VoiceRoomsConfig,
  input: { orgId: string; userId: string },
  send: Fetch = (url, init) => fetch(url, init),
): Promise<VoiceRoom[]> {
  const rooms = await roomsOf(config, input.orgId, send);
  if (rooms.size === 0) return [];
  const ids = [...rooms.keys()].filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (ids.length === 0) return [];
  const seen = await db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .innerJoin(channels, and(eq(channels.id, channelMembers.channelId), eq(channels.orgId, channelMembers.orgId)))
    .where(
      and(
        eq(channelMembers.orgId, input.orgId),
        eq(channelMembers.userId, input.userId),
        inArray(channelMembers.channelId, ids),
        isNull(channels.archivedAt),
      ),
    );
  const visible = new Set(seen.map((r) => r.id));
  const userIds = [...new Set([...rooms.values()].flatMap((ps) => ps.map((p) => p?.userId ?? "")))].filter(Boolean);
  const people = userIds.length
    ? await db
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: VoiceRoom[] = [];
  for (const [channelId, ps] of rooms) {
    if (!visible.has(channelId)) continue;
    out.push({
      channelId,
      participants: ps
        .filter((p) => p !== null)
        .map((p) => ({
          ...p,
          name: byId.get(p.userId)?.name || p.name,
          image: byId.get(p.userId)?.image ?? null,
        }))
        .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "")),
    });
  }
  return out;
}
