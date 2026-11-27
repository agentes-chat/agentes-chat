import {
  listAgentProxies,
  removeAgentProxy,
  saveProxyFromCard,
  setAgentProxy,
  testAgentProxy,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Agent proxies"];

const ProxyView = z
  .object({
    label: z.string().openapi({ description: "`socks5://host:1080`: never its user or password." }),
    scheme: z.enum(["http", "https", "socks5"]),
    host: z.string(),
    port: z.number().int(),
    hasAuth: z.boolean(),
    updatedAt: z.string(),
  })
  .openapi("AgentProxy");

const ProxyTest = z
  .union([
    z.object({ ok: z.literal(true), ip: z.string(), country: z.string().nullable() }),
    z.object({ ok: z.literal(false), reason: z.enum(["unreachable", "auth", "refused"]) }),
  ])
  .openapi("AgentProxyTest");

const Where = z.object({
  machineId: z.uuid().nullable().openapi({ description: "One computer's; null: the workspace's, every computer's." }),
});

/** Tests reach a host a person typed: a few an hour each, so the server is no port scanner. */
const TESTS_PER_HOUR = { limit: 30, windowMs: 3600_000 };

/**
 * Proxies for agents (ADR 0262): the workspace's and each computer's own. The address (user and password included) is
 * sealed and never comes back; only its scheme, host and port do. A computer's own wins there; either comes before a
 * person's lent internet and the usual way, with no fallback to them.
 */
export function agentProxyRoutes(deps: AppDeps) {
  const { db, adapters } = deps;
  const proxies = {
    db,
    keyWrappers: [adapters.keyWrapper, ...adapters.legacyKeyWrappers],
    pubsub: adapters.pubsub,
    hub: deps.extras?.sandbox?.machines?.hub,
    resolveHost: deps.extras?.resolveHost,
  };
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const tested = async (userId: string) =>
    (await adapters.rateLimiter.consume(`proxy-test:${userId}`, TESTS_PER_HOUR)).allowed;

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/agent-proxies",
      tags,
      security,
      summary: "The workspace's proxy for agents and each computer's own",
      request: { params: OrgParams },
      responses: {
        200: json(z.object({ workspace: ProxyView.nullable(), computers: z.record(z.string(), ProxyView) })),
        ...errors,
      },
    }),
    async (c) => c.json(await listAgentProxies(db, c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/agent-proxies",
      tags,
      security,
      summary: "Set the workspace's proxy for agents, or one computer's",
      description:
        "The workspace's: `configure`. A computer's: who connected it, or `configure`. 400 `proxy.invalid` for an address that isn't http(s):// or socks5://; `url.internal` for a host on a private network.",
      request: { params: OrgParams, body: body(Where.extend({ url: z.string().min(8).max(1200) })) },
      responses: { 200: json(ProxyView), ...errors },
    }),
    async (c) =>
      c.json(await setAgentProxy(proxies, c.get("user").id, c.req.valid("param").orgId, c.req.valid("json")), 200),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/agent-proxies",
      tags,
      security,
      summary: "Remove the workspace's proxy, or one computer's",
      request: { params: OrgParams, body: body(Where) },
      responses: { 200: json(z.object({ ok: z.literal(true) })), ...errors },
    }),
    async (c) => {
      await removeAgentProxy(proxies, c.get("user").id, c.req.valid("param").orgId, c.req.valid("json").machineId);
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/agent-proxies/test",
      tags,
      security,
      summary: "Where agents come out through a proxy: the typed one, or the saved one",
      description: "One request from this server through the proxy to a public address echo. 429 past 30 an hour.",
      request: { params: OrgParams, body: body(Where.extend({ url: z.string().min(8).max(1200).optional() })) },
      responses: { 200: json(ProxyTest), ...errors, 429: errorResponse("Too many tests") },
    }),
    async (c) => {
      const userId = c.get("user").id;
      if (!(await tested(userId))) return apiError(c, 429, "rate_limited", "Too many tests. Try again later.");
      return c.json(await testAgentProxy(proxies, userId, c.req.valid("param").orgId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/agent-proxies/from-card",
      tags,
      security,
      summary: "Save the proxy an agent's card offers (`offer_proxy`), then test it",
      description:
        "Read from the person's message again, which then loses its password, as do the conversation's run transcripts. 409 `proxy.card_saved`, `proxy.card_source_gone`.",
      request: { params: OrgParams, body: body(z.object({ messageId: z.uuid() })) },
      responses: {
        200: json(z.object({ proxy: ProxyView, test: ProxyTest })),
        ...errors,
        429: errorResponse("Too many tests"),
      },
    }),
    async (c) => {
      const userId = c.get("user").id;
      if (!(await tested(userId))) return apiError(c, 429, "rate_limited", "Too many tests. Try again later.");
      const { orgId } = c.req.valid("param");
      return c.json(await saveProxyFromCard(proxies, userId, orgId, c.req.valid("json").messageId), 200);
    },
  );

  return app;
}
