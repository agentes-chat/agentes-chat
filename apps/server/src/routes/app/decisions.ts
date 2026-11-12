import { DECISION_MODEL_ID, decisionSettingsView, NotFoundError, requirePermission } from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const Model = z.string().trim().min(1).max(200).regex(DECISION_MODEL_ID);
const Settings = z.object({ credentialId: z.uuid(), model: Model, visionModel: Model.nullable() });
const View = z.object({ settings: Settings.nullable(), available: z.boolean() });
const path = "/organizations/{orgId}/decisions";

export function decisionRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/:orgId/decisions", requireSession(deps.auth));
  app.openapi(
    createRoute({
      method: "get",
      path,
      tags: ["Organization"],
      security,
      summary: "Decision models on this workspace's own OpenRouter account (credential managers)",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors, 429: errorResponse("Too many tries") },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(deps.db, c.get("user").id, orgId, "manage_credentials");
      return c.json(await decisionSettingsView(deps.db, orgId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path,
      tags: ["Organization"],
      security,
      summary: "Test and save workspace decision models, or reset to the installation defaults",
      request: { params: OrgParams, body: body(z.object({ settings: Settings.nullable() })) },
      responses: { 200: json(View), ...errors, 429: errorResponse("Too many tries") },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const actor = c.get("user").id;
      await requirePermission(deps.db, actor, orgId, "manage_credentials");
      if (
        !(await deps.adapters.rateLimiter.consume(`decisions:${orgId}:${actor}`, { limit: 10, windowMs: 60_000 }))
          .allowed
      )
        return apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");
      if (!deps.extras?.decisions) throw new NotFoundError();
      return c.json(await deps.extras.decisions.save(orgId, actor, c.req.valid("json").settings), 200);
    },
  );
  return app;
}
