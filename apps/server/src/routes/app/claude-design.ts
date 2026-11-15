import {
  CLAUDE_DESIGN_PILOT_READY,
  cancelClaudeDesignJob,
  decideClaudeDesignConsent,
  getClaudeDesignConsentForOwner,
  getClaudeDesignGrant,
  getClaudeDesignJobForOwner,
  grantScopes,
  recoverClaudeDesignJob,
  setClaudeDesignGrant,
  ValidationError,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Claude Design"];
const AgentParams = OrgParams.extend({ agentId: z.uuid() });
const ConsentParams = OrgParams.extend({ consentId: z.uuid() });
const ConsentView = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  status: z.enum(["pending", "approved", "denied", "consumed", "expired", "canceled"]),
  title: z.string(),
  accountLabel: z.string(),
  remoteUrl: z.url(),
  description: z.string(),
  expiresAt: z.string(),
  canDecide: z.boolean(),
});
const JobParams = OrgParams.extend({ jobId: z.uuid() });
const Grant = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
  accountId: z.uuid().nullable(),
  revision: z.number().int(),
  reason: z.enum(["disabled", "unsupported", "unavailable"]).nullable(),
});
export const ClaudeDesignJob = z.object({
  title: z.string().optional(),
  preview: z
    .object({
      version: z.string(),
      files: z.array(
        z.object({
          artifactId: z.uuid(),
          version: z.number().int().positive(),
          relativePath: z.string(),
          sha256: z.string(),
          size: z.number().int().nonnegative(),
          contentType: z.string(),
        }),
      ),
    })
    .optional(),
  id: z.uuid(),
  state: z.enum(["queued", "running", "published", "succeeded", "failed", "canceled", "unknown"]),
  designId: z.uuid().nullable(),
  revision: z.number().int().nullable(),
  remote: z.object({ id: z.string(), url: z.url(), version: z.string() }).nullable(),
  artifactIds: z.array(z.uuid()),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export function claudeDesignRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const base = () => ({
    db: deps.db,
    enabled: deps.config.CLAUDE_DESIGN_EXPERIMENTAL && CLAUDE_DESIGN_PILOT_READY,
    pubsub: deps.adapters.pubsub,
  });
  const service = () => {
    const hub = deps.extras?.sandbox?.machines?.hub,
      artifacts = deps.extras?.artifacts;
    if (!hub || !artifacts) throw new ValidationError("Claude Design is unavailable");
    return { ...base(), hub, artifacts, publicUrl: deps.config.PUBLIC_URL };
  };
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/claude-design/agents/{agentId}/grant",
      tags,
      security,
      summary: "The caller's Claude Design grant for this agent",
      request: { params: AgentParams, query: z.object({ accountId: z.uuid().optional() }).strict() },
      responses: { 200: json(Grant), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json(
        await getClaudeDesignGrant(base(), c.get("user").id, orgId, agentId, c.req.valid("query").accountId),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/claude-design/agents/{agentId}/grant",
      tags,
      security,
      summary: "Enable or revoke the caller's Design account for this agent",
      request: { params: AgentParams, body: body(z.object({ accountId: z.uuid().nullable() }).strict()) },
      responses: { 200: json(Grant), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param"),
        { accountId } = c.req.valid("json");
      await setClaudeDesignGrant(base(), c.get("user").id, orgId, agentId, accountId);
      if (accountId)
        await grantScopes(deps.db, orgId, agentId, [
          { scope: "claude-design:read", connectionId: null },
          { scope: "claude-design:write", connectionId: null },
        ]);
      const { and, eq, inArray, schema } = await import("@agenteschat/db");
      const canceled = await deps.db
        .select({ id: schema.claudeDesignJobs.id })
        .from(schema.claudeDesignJobs)
        .where(
          and(
            eq(schema.claudeDesignJobs.orgId, orgId),
            eq(schema.claudeDesignJobs.agentId, agentId),
            inArray(schema.claudeDesignJobs.state, ["queued", "running", "published", "unknown"]),
          ),
        );
      for (const job of canceled) await cancelClaudeDesignJob(service(), c.get("user").id, orgId, job.id);
      return c.json(await getClaudeDesignGrant(base(), c.get("user").id, orgId, agentId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/claude-design/jobs/{jobId}",
      tags,
      security,
      summary: "Read a Design job owned by the caller",
      request: { params: JobParams },
      responses: { 200: json(ClaudeDesignJob), ...errors },
    }),
    async (c) => {
      const { orgId, jobId } = c.req.valid("param");
      return c.json(await getClaudeDesignJobForOwner(base(), c.get("user").id, orgId, jobId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/claude-design/jobs/{jobId}/cancel",
      tags,
      security,
      summary: "Cancel a Design job owned by the caller",
      request: { params: JobParams, body: body(z.object({}).strict()) },
      responses: { 200: json(ClaudeDesignJob), ...errors },
    }),
    async (c) => {
      const { orgId, jobId } = c.req.valid("param");
      return c.json(await cancelClaudeDesignJob(service(), c.get("user").id, orgId, jobId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/claude-design/jobs/{jobId}/recovery",
      tags,
      security,
      summary: "Associate an interrupted design with an owner-confirmed reference",
      request: {
        params: JobParams,
        body: body(z.object({ remoteUrl: z.string().max(512), confirmAssociation: z.literal(true) }).strict()),
      },
      responses: { 200: json(ClaudeDesignJob), ...errors },
    }),
    async (c) => {
      const { orgId, jobId } = c.req.valid("param");
      return c.json(
        await recoverClaudeDesignJob(service(), c.get("user").id, orgId, jobId, c.req.valid("json").remoteUrl),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/claude-design/consents/{consentId}",
      tags,
      security,
      summary: "Review one native Design request as the account owner",
      request: { params: ConsentParams },
      responses: { 200: json(ConsentView), ...errors },
    }),
    async (c) => {
      const { orgId, consentId } = c.req.valid("param");
      return c.json(await getClaudeDesignConsentForOwner(base(), c.get("user").id, orgId, consentId), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/claude-design/consents/{consentId}",
      tags,
      security,
      summary: "Decide one reviewed native Design request as its owner",
      request: {
        params: ConsentParams,
        body: body(
          z.discriminatedUnion("decision", [
            z.object({ decision: z.literal("approve"), reviewed: z.literal(true) }).strict(),
            z.object({ decision: z.literal("deny"), reviewed: z.boolean() }).strict(),
          ]),
        ),
      },
      responses: { 200: json(ConsentView), ...errors },
    }),
    async (c) => {
      const { orgId, consentId } = c.req.valid("param");
      return c.json(
        await decideClaudeDesignConsent(base(), c.get("user").id, orgId, consentId, c.req.valid("json")),
        200,
      );
    },
  );
  return app;
}
