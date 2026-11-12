import { randomUUID } from "node:crypto";
import { SSO_REQUIRED_SCOPES, SSO_SCOPE_PATTERN } from "@agenteschat/client/lib/sso";
import { and, eq, ne, schema } from "@agenteschat/db";
import {
  ConflictError,
  ForbiddenError,
  recordAudit,
  requirePermission,
  sealSecret,
  TooManyError,
  ValidationError,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { authUiConfig, signedInLately } from "../../auth";
import { discoverSso, SsoId, SsoInput, ssoAad, ssoForId, ssoHttp, ssoId } from "../../sso";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const PublicProvider = z.object({ id: SsoId, name: z.string() });
const View = z.object({
  provider: PublicProvider.extend({
    issuer: z.string(),
    clientId: z.string(),
    scopes: z.array(z.string()),
    enabled: z.boolean(),
  }).nullable(),
  callbackUrl: z.string(),
  loginUrl: z.string().nullable(),
  linked: z.boolean(),
  canManage: z.boolean(),
});

export function ssoRoutes(deps: AppDeps) {
  const { db, config, auth, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/:orgId/sso", requireSession(auth));
  app.use("/organizations/:orgId/sso/*", requireSession(auth));
  const stored = async (orgId: string) =>
    (await db.select().from(schema.oidcProviders).where(eq(schema.oidcProviders.orgId, orgId)))[0];
  const view = async (orgId: string, userId: string) => {
    const member = await requirePermission(db, userId, orgId, "read");
    const row = await stored(orgId);
    const id = row ? ssoId(row.id) : null;
    const [linked] = id
      ? await db
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, id)))
      : [];
    return {
      provider:
        row && id
          ? { id, name: row.name, issuer: row.issuer, clientId: row.clientId, scopes: row.scopes, enabled: row.enabled }
          : null,
      callbackUrl: `${config.PUBLIC_URL.replace(/\/$/, "")}/api/auth/sso/callback/${id ?? "sso-{provider-id}"}`,
      loginUrl: id ? `${config.PUBLIC_URL.replace(/\/$/, "")}/login?sso=${id}` : null,
      linked: Boolean(linked),
      canManage: member.role === "owner",
    };
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/sso/{providerId}",
      tags: ["Account"],
      summary: "The name on an SSO sign-in link",
      request: { params: z.object({ providerId: SsoId }) },
      responses: { 200: json(PublicProvider), ...errors },
    }),
    async (c) => {
      const row = await ssoForId(db, c.req.valid("param").providerId);
      if (!row) throw new ValidationError("SSO is disabled.", "sso_disabled");
      return c.json({ id: ssoId(row.id), name: row.name }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/sso",
      tags: ["Account"],
      summary: "Workspace SSO settings and your link",
      security,
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => c.json(await view(c.req.valid("param").orgId, c.get("user").id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/sso/discover",
      tags: ["Account"],
      summary: "Check an OIDC provider and list the scopes it advertises (owner)",
      security,
      request: { params: OrgParams, body: body(z.object({ issuer: z.url().max(2048) })) },
      responses: { 200: json(z.object({ issuer: z.string(), scopes: z.array(z.string()) })), ...errors },
    }),
    async (c) => {
      const userId = c.get("user").id;
      const member = await requirePermission(db, userId, c.req.valid("param").orgId, "read");
      if (member.role !== "owner") throw new ForbiddenError("Only the workspace owner can configure SSO.");
      if (!(await adapters.rateLimiter.consume(`sso-discover:${userId}`, { limit: 10, windowMs: 60_000 })).allowed)
        throw new TooManyError("Try again in a minute.");
      const metadata = await discoverSso(c.req.valid("json").issuer, ssoHttp(config, deps.extras?.http));
      const scopes = [...new Set(metadata.scopes_supported ?? [])]
        .filter((scope) => scope.length <= 200 && SSO_SCOPE_PATTERN.test(scope))
        .slice(0, 100);
      return c.json({ issuer: metadata.issuer, scopes }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/sso",
      tags: ["Account"],
      summary: "Configure workspace OIDC (owner, fresh sign-in)",
      security,
      request: { params: OrgParams, body: body(SsoInput) },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      const member = await requirePermission(db, userId, orgId, "read");
      if (member?.role !== "owner") throw new ForbiddenError("Only the workspace owner can configure SSO.");
      if (!(await signedInLately(auth, c.req.raw.headers, userId)))
        throw new ForbiddenError("Sign in again before changing SSO.", "sso_reauth");
      const input = c.req.valid("json");
      const before = await stored(orgId);
      if (!before && !input.clientSecret) throw new ValidationError("Enter the client secret.", "sso_secret");
      if (before && before.issuer !== input.issuer)
        throw new ConflictError(
          "The issuer of an existing connection can't change. Use the same issuer.",
          "sso_issuer",
        );
      if (before?.enabled && !input.enabled) {
        if (config.AUTH_SSO_ONLY && config.AUTH_SSO_PROVIDER_ID === ssoId(before.id))
          throw new ConflictError(
            "Set AUTH_SSO_ONLY=false before disabling this server's sign-in provider.",
            "sso_last_method",
          );
        const methods = await db
          .select({ providerId: schema.accounts.providerId, password: schema.accounts.password })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.userId, userId), ne(schema.accounts.providerId, ssoId(before.id))));
        const social = authUiConfig(config).socialProviders;
        const backup = methods.some((method) =>
          method.providerId === "credential"
            ? Boolean(method.password)
            : (method.providerId === "google" || method.providerId === "github" || method.providerId === "apple") &&
              social[method.providerId],
        );
        if (!backup)
          throw new ConflictError(
            "Add another sign-in method to your account before disabling SSO.",
            "sso_last_method",
          );
      }
      if (!(await adapters.rateLimiter.consume(`sso-config:${userId}`, { limit: 10, windowMs: 60_000 })).allowed)
        throw new ForbiddenError("Try again in a minute.");
      const metadata =
        before && !input.enabled
          ? { issuer: before.issuer }
          : await discoverSso(input.issuer, ssoHttp(config, deps.extras?.http));
      const id = before?.id ?? randomUUID();
      const sealed = input.clientSecret
        ? await sealSecret(adapters.keyWrapper, input.clientSecret, ssoAad(orgId, id))
        : before;
      if (!sealed) throw new ValidationError("Enter the client secret.", "sso_secret");
      const data = {
        name: input.name,
        issuer: metadata.issuer,
        clientId: input.clientId,
        scopes: [...new Set([...SSO_REQUIRED_SCOPES, ...input.scopes])],
        enabled: input.enabled,
        ciphertext: sealed.ciphertext,
        wrappedDataKey: sealed.wrappedDataKey,
        kekId: sealed.kekId,
        providerId: ssoId(id),
        userId,
        oidcConfig: JSON.stringify({
          id,
          orgId,
          config: {
            ...(before ? JSON.parse(before.oidcConfig).config : {}),
            issuer: metadata.issuer,
            clientId: input.clientId,
            scopes: [...new Set([...SSO_REQUIRED_SCOPES, ...input.scopes])],
            pkce: true,
            ...("authorization_endpoint" in metadata
              ? {
                  authorizationEndpoint: metadata.authorization_endpoint,
                  tokenEndpoint: metadata.token_endpoint,
                  jwksEndpoint: metadata.jwks_uri,
                  userInfoEndpoint: metadata.userinfo_endpoint,
                  tokenEndpointAuthentication: metadata.token_endpoint_auth_methods_supported?.includes(
                    "client_secret_basic",
                  )
                    ? "client_secret_basic"
                    : "client_secret_post",
                }
              : {}),
          },
        }),
        updatedAt: new Date(),
      };
      await db.transaction(async (tx) => {
        const [saved] = before
          ? await tx
              .update(schema.oidcProviders)
              .set(data)
              .where(and(eq(schema.oidcProviders.id, id), eq(schema.oidcProviders.updatedAt, before.updatedAt)))
              .returning({ id: schema.oidcProviders.id })
          : await tx
              .insert(schema.oidcProviders)
              .values({ id, orgId, ...data })
              .onConflictDoNothing()
              .returning({ id: schema.oidcProviders.id });
        if (!saved) throw new ConflictError("SSO settings changed. Reload and try again.", "sso_changed");
        await recordAudit(tx, {
          orgId,
          actor: { type: "person", id: userId },
          action: "sso.configured",
          target: { type: "oidc_provider", id },
          details: { enabled: data.enabled },
        });
      });
      return c.json(await view(orgId, userId), 200);
    },
  );
  return app;
}
