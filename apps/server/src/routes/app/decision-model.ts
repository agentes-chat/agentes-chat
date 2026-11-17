import { isAgentesCloud, NotFoundError, pinnedOwner, ValidationError } from "@agenteschat/engine";
import {
  DECISION_PROVIDER_IDS,
  DECISION_PROVIDERS,
  type DecisionProviderId,
  listDecisionModels,
} from "@agenteschat/providers";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, requireSession, security } from "./context";

const tags = ["System"];

const Install = z.object({
  state: z.enum([
    "idle",
    "queued",
    "checking",
    "deleting",
    "downloading",
    "configuring",
    "ready",
    "failed",
    "cancelled",
  ]),
  model: z.string().nullable(),
  progress: z.number().int(),
  detail: z.string().nullable(),
  error: z.string().nullable(),
});

const DecisionModel = z
  .object({
    source: z.enum(["settings"]).nullable(),
    enabled: z.boolean(),
    provider: z.enum(["openai", "gemini", "local"]).nullable(),
    model: z.string().nullable(),
    baseURL: z.string().nullable(),
    runtime: z.enum(["ollama", "llamacpp", "lmstudio", "custom"]).nullable(),
    hint: z.string().nullable(),
    state: z.enum(["off", "ok", "invalid", "no_credit", "unreachable"]),
    capabilities: z.object({ inputs: z.array(z.string()) }),
    timeoutMs: z.number().int(),
    install: Install.nullable(),
  })
  .openapi("DecisionModel");

const Input = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["openai", "gemini", "local"]).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(512).optional(),
  timeoutMs: z.number().int().min(500).max(30_000).optional(),
});

const WRITES = { limit: 10, windowMs: 60_000 };
const notFound = "404 for everyone but the installation's pinned owner, and on agentes.chat itself.";

/** The installation's optional decision model (ADR 0195): only its owner, and never on agentes.chat's own servers. */
export function decisionModelRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const app = createAppRouter(deps);
  app.use("/decision-model", requireSession(deps.auth));
  app.use("/decision-model/*", requireSession(deps.auth));

  const owner = async (userId: string) => {
    const model = deps.extras?.decisionModel;
    if (!model || isAgentesCloud(config.PUBLIC_URL) || (await pinnedOwner(db)) !== userId) throw new NotFoundError();
    return model;
  };
  const allowed = async (userId: string) =>
    (await deps.adapters.rateLimiter.consume(`decision-model:${userId}`, WRITES)).allowed;
  const busy = (c: Parameters<typeof apiError>[0]) =>
    apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");

  app.openapi(
    createRoute({
      method: "get",
      path: "/decision-model",
      tags,
      security,
      summary: "The installation's optional decision model: switch, provider, model, install state",
      description: notFound,
      responses: { 200: json(DecisionModel), 401: errors[401], 404: errors[404] },
    }),
    async (c) => c.json(await (await owner(c.get("user").id)).view(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/decision-model/host",
      tags,
      security,
      summary: "This server's CPUs, memory and disk, and the local model that fits them",
      description: notFound,
      responses: { 200: json(z.record(z.string(), z.unknown())), 401: errors[401], 404: errors[404] },
    }),
    async (c) => c.json(await (await owner(c.get("user").id)).host(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/decision-model/providers",
      tags,
      security,
      summary: "The decision providers this build offers",
      description: notFound,
      responses: {
        200: json(z.object({ providers: z.array(z.record(z.string(), z.unknown())) })),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      await owner(c.get("user").id);
      return c.json({ providers: DECISION_PROVIDER_IDS.map((id) => ({ id, ...DECISION_PROVIDERS[id] })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/decision-model/models",
      tags,
      security,
      summary: "The models a decision provider offers (the local runtime is asked)",
      description: notFound,
      request: {
        body: body(
          z.object({
            provider: z.enum(["openai", "gemini", "local"]),
            baseURL: z.string().max(500).optional(),
            apiKey: z.string().max(512).optional(),
          }),
        ),
      },
      responses: { 200: json(z.record(z.string(), z.unknown())), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      await owner(c.get("user").id);
      const input = c.req.valid("json");
      const listed = await listDecisionModels({
        provider: input.provider as DecisionProviderId,
        baseURL: input.baseURL,
        apiKey: input.apiKey,
        http: deps.extras?.http,
      });
      return c.json(listed, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/decision-model",
      tags,
      security,
      summary: "Turn the switch on or off, or change the provider, model or key",
      description: `${notFound} Saving enqueues the background install (job decision.model.install) and answers at once; the right hand tells the owner how it ended.`,
      request: { body: body(Input) },
      responses: {
        200: json(DecisionModel),
        ...errors,
        422: errorResponse("The provider, model or key can't be used (`decision_model_*`)"),
        429: errorResponse("Too many tries (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const model = await owner(user.id);
      if (!(await allowed(user.id))) return busy(c);
      const input = c.req.valid("json");
      try {
        const view = await model.save(input, user.id);
        return c.json(view, 200);
      } catch (error) {
        if (error instanceof ValidationError) return apiError(c, 422, error.code, error.message);
        throw error;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/decision-model/check",
      tags,
      security,
      summary: "Check the decision model now",
      description: notFound,
      responses: {
        200: json(DecisionModel),
        ...errors,
        429: errorResponse("Too many tries (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const model = await owner(user.id);
      if (!(await allowed(user.id))) return busy(c);
      return c.json(await model.check(), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/decision-model/install",
      tags,
      security,
      summary: "Prepare the configured model again",
      description: notFound,
      responses: {
        200: json(DecisionModel),
        ...errors,
        429: errorResponse("Too many tries (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const model = await owner(user.id);
      if (!(await allowed(user.id))) return busy(c);
      return c.json(await model.save({}, user.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/decision-model/install",
      tags,
      security,
      summary: "Cancel a running install",
      description: notFound,
      responses: { 200: json(DecisionModel), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const model = await owner(c.get("user").id);
      await model.cancel();
      return c.json(await model.view(), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/decision-model",
      tags,
      security,
      summary: "Turn the switch off and forget the model",
      description: notFound,
      responses: { 200: json(DecisionModel), 401: errors[401], 404: errors[404] },
    }),
    async (c) => c.json(await (await owner(c.get("user").id)).remove(c.get("user").id), 200),
  );

  return app;
}
