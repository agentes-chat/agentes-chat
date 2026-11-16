import {
  ForbiddenError,
  forgetVoiceRooms,
  listVoiceRooms,
  NotFoundError,
  requireChannelAccess,
  requirePermission,
  setVoiceChannel,
  voiceChannelIds,
  voiceJoinToken,
  voiceRoomsConfig,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

/*
 * VPS Zen: voice channels (`packages/engine/src/voice-rooms.ts`). Two routes: who is in each room of the channels a
 * person is in, and a token to join one channel's room. Both 404 `voice.off` while this server has no LiveKit.
 */

const tags = ["Voice channels"];
const ChannelParams = OrgParams.extend({ channelId: z.uuid() });

const Participant = z
  .object({
    userId: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    muted: z.boolean(),
    camera: z.boolean(),
    screen: z.boolean(),
    joinedAt: z.string().nullable(),
  })
  .openapi("VoiceParticipant");

const Rooms = z
  .object({
    enabled: z.boolean().openapi({ description: "False: this server has no LiveKit, so no voice anywhere." }),
    rooms: z.array(z.object({ channelId: z.uuid(), participants: z.array(Participant) })),
    voiceChannels: z
      .array(z.uuid())
      .openapi({ description: "The workspace's voice-only channels: drawn with a speaker, their page is the room." }),
  })
  .openapi("VoiceRooms");

const Join = z
  .object({
    url: z.string().openapi({ description: "The LiveKit server's `wss://` address." }),
    token: z.string().openapi({ description: "Good for 6 hours, for this channel's room only." }),
    room: z.string(),
  })
  .openapi("VoiceJoin");

export function voiceRoomRoutes(deps: AppDeps) {
  const { db, config, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const lk = voiceRoomsConfig(config);

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/voice-rooms",
      tags,
      summary: "Who is in the voice room of each channel the person is in",
      security,
      request: { params: OrgParams },
      responses: { 200: json(Rooms), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const user = c.get("user");
      await requirePermission(db, user.id, orgId, "read");
      if (!lk) return c.json({ enabled: false, rooms: [], voiceChannels: [] }, 200);
      const voiceChannels = await voiceChannelIds(db, orgId);
      try {
        return c.json(
          { enabled: true, rooms: await listVoiceRooms(db, lk, { orgId, userId: user.id }), voiceChannels },
          200,
        );
      } catch {
        // LiveKit out of reach: the sidebar just shows nobody for now; joining still tells the person.
        return c.json({ enabled: true, rooms: [], voiceChannels }, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/channels/{channelId}/voice-token",
      tags,
      summary: "A token to join this channel's voice room",
      description: "For a member of the channel or DM (never a task's conversation). 404 `voice.off` without LiveKit.",
      security,
      request: { params: ChannelParams },
      responses: { 200: json(Join), 401: errors[401], 403: errors[403], 404: errors[404] },
    }),
    async (c) => {
      const { orgId, channelId } = c.req.valid("param");
      const user = c.get("user");
      if (!lk) throw new NotFoundError("Voice is off on this server", "voice.off");
      const { channel } = await requireChannelAccess(db, user.id, orgId, channelId);
      if (channel.kind === "task") throw new ForbiddenError("A task's conversation has no voice room");
      forgetVoiceRooms(orgId);
      const join = voiceJoinToken(lk, {
        orgId,
        channelId,
        userId: user.id,
        name: user.name,
        image: user.image ?? null,
      });
      return c.json(join, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/channels/{channelId}/voice-only",
      tags,
      summary: "Make a channel voice-only, or a text channel again",
      description: "Who manages the channel (its creator or an admin). 404 `voice.off` without LiveKit.",
      security,
      request: { params: ChannelParams, body: body(z.object({ on: z.boolean() })) },
      responses: {
        200: json(z.object({ channelId: z.uuid(), voiceOnly: z.boolean() })),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
      },
    }),
    async (c) => {
      const { orgId, channelId } = c.req.valid("param");
      if (!lk) throw new NotFoundError("Voice is off on this server", "voice.off");
      const r = await setVoiceChannel(db, c.get("user").id, orgId, channelId, c.req.valid("json").on, {
        pubsub: adapters.pubsub,
      });
      return c.json(r, 200);
    },
  );

  return app;
}
