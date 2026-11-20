import { agentChats, agentPhotoFile, removeAgentPhoto, setAgentPhoto } from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { imageFile } from "../../http/image-file";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  noContent,
  OrgParams,
  requireSession,
  security,
} from "./context";

/*
 * VPS Zen: an agent's photo (`packages/engine/src/agent-photo.ts`) and the sidebar's list of each agent's recent
 * chats (`packages/engine/src/agent-chats.ts`).
 */

const tags = ["Agents"];
const AgentParams = OrgParams.extend({ agentId: z.uuid() });

const AgentChat = z
  .object({
    agentId: z.uuid(),
    channelId: z.uuid(),
    kind: z.string(),
    name: z.string(),
    lastAt: z.string(),
    preview: z.string(),
  })
  .openapi("AgentChat");

export function agentPhotoRoutes(deps: AppDeps) {
  const { db, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  app.use("/agent-photos/*", requireSession(deps.auth));
  const blobs = adapters.platformBlobs;

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/agents/{agentId}/photo",
      tags,
      security,
      summary: "Set an agent's photo (JPEG, PNG or WebP up to 2 MB; metadata is removed). Its owner or who manages it.",
      request: {
        params: AgentParams,
        body: body(
          z.object({
            imageBase64: z.string().min(1).max(3_000_000),
            contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
          }),
        ),
      },
      responses: {
        200: json(z.object({ photo: z.string() })),
        429: errorResponse("Too many photo changes"),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get("user");
      const { orgId, agentId } = c.req.valid("param");
      const limit = await adapters.rateLimiter.consume(`agent-photo:${agentId}`, { limit: 20, windowMs: 3600_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many photo changes. Try again later.");
      return c.json(
        await setAgentPhoto({ db, blobs, pubsub: adapters.pubsub }, user.id, orgId, agentId, c.req.valid("json")),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/agents/{agentId}/photo",
      tags,
      security,
      summary: "Remove an agent's photo (back to its drawn face)",
      request: { params: AgentParams },
      responses: { ...noContent, ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      await removeAgentPhoto({ db, blobs, pubsub: adapters.pubsub }, c.get("user").id, orgId, agentId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/agent-chats",
      tags,
      security,
      summary: "Each agent's recent conversations you are in (last 14 days), latest first, with its last line in each",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ chats: z.array(AgentChat) })), ...errors },
    }),
    async (c) => c.json({ chats: await agentChats(db, c.get("user").id, c.req.valid("param").orgId) }, 200),
  );

  // The photo file, for the workspace's members. Named by a content hash: a new photo gets a new address.
  app.get("/agent-photos/:orgId/:agentId/:file", async (c) =>
    imageFile(
      await agentPhotoFile(
        { db, blobs },
        c.get("user").id,
        c.req.param("orgId"),
        c.req.param("agentId"),
        c.req.param("file"),
      ),
    ),
  );

  return app;
}
