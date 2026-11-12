import type { KeyWrapper } from "@agenteschat/adapters";
import { SSO_REQUIRED_SCOPES, SSO_SCOPE_PATTERN } from "@agenteschat/client/lib/sso";
import type { Config } from "@agenteschat/config";
import { and, type Database, eq, gt, isNull, schema } from "@agenteschat/db";
import {
  assertActiveMembership,
  getMembership,
  isAgentesCloud,
  openSecret,
  publicHttpsFetch,
  ValidationError,
} from "@agenteschat/engine";
import type { BetterAuthOptions } from "better-auth";
import { getAuthoritativeSessionFromCtx, getOAuthState } from "better-auth/api";
import {
  authorizationCodeRequest,
  createAuthorizationURL,
  getOAuth2Tokens,
  type OAuthProvider,
} from "better-auth/oauth2";
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";

export const SSO_ID = /^sso-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ssoId = (id: string) => `sso-${id}` as const;
export const SsoId = z.string().regex(SSO_ID);
export const SsoInput = z.object({
  name: z.string().trim().min(1).max(80),
  issuer: z.url().max(2048),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(4096).optional(),
  scopes: z
    .array(z.string().regex(SSO_SCOPE_PATTERN).max(200))
    .max(20)
    .refine((scopes) => new Set([...SSO_REQUIRED_SCOPES, ...scopes]).size <= 20, "Use at most 20 scopes."),
  enabled: z.boolean(),
});
const HttpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const Discovery = z.object({
  issuer: HttpsUrl,
  authorization_endpoint: HttpsUrl,
  token_endpoint: HttpsUrl,
  jwks_uri: HttpsUrl,
  userinfo_endpoint: HttpsUrl.optional(),
  id_token_signing_alg_values_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional().catch(undefined),
});
type SsoDeps = { db: Database; config: Config; keyWrappers: KeyWrapper[]; http?: typeof fetch };

/** Hosted tenants can reach only public HTTPS, including on every token and key request (DNS pinned). */
export const ssoHttp = (config: Config, http?: typeof fetch) =>
  http ?? (isAgentesCloud(config.PUBLIC_URL) || config.ALLOW_SIGNUP ? publicHttpsFetch() : fetch);

async function readJson(http: typeof fetch, url: string, init?: RequestInit) {
  const res = await http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ValidationError("The identity provider didn't answer. Check its settings.", "sso_unavailable");
  // Discovery, keys and tokens have no reason to be larger than this.
  const reader = res.body?.getReader();
  if (!reader) throw new ValidationError("The identity provider returned no data.", "sso_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000)
        throw new ValidationError("The identity provider's response is too large.", "sso_unavailable");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Accept an issuer or its exact discovery URL; the discovered issuer must match the configured one. */
export async function discoverSso(raw: string, http: typeof fetch) {
  const parsed = HttpsUrl.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Use an HTTPS issuer URL without credentials or a fragment.", "sso_issuer");
  const issuer = raw.replace(/\/\.well-known\/openid-configuration\/?$/, "");
  if (new URL(issuer).search) throw new ValidationError("The issuer URL can't have a query.", "sso_issuer");
  let discovered: unknown;
  try {
    discovered = await readJson(http, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  } catch {
    throw new ValidationError("The identity provider didn't answer. Check its discovery URL.", "sso_unavailable");
  }
  const parsedMetadata = Discovery.safeParse(discovered);
  if (!parsedMetadata.success)
    throw new ValidationError("Discovery is missing valid OIDC endpoints or signing algorithms.", "sso_issuer");
  const metadata = parsedMetadata.data;
  if (metadata.issuer !== issuer) throw new ValidationError("Discovery returned a different issuer.", "sso_issuer");
  if (!metadata.id_token_signing_alg_values_supported.some((a) => /^(RS|PS|ES)\d+$|^EdDSA$/.test(a)))
    throw new ValidationError("The provider must support signed ID tokens.", "sso_issuer");
  return metadata;
}

export const ssoAad = (orgId: string, id: string) => `oidc|${orgId}|${id}`;

export async function ssoForId(db: Database, providerId: string) {
  if (!SSO_ID.test(providerId)) return null;
  const [row] = await db
    .select()
    .from(schema.oidcProviders)
    .where(and(eq(schema.oidcProviders.id, providerId.slice(4)), eq(schema.oidcProviders.enabled, true)));
  return row ?? null;
}

/** Resolve only the requested connection, so another tenant's IdP outage never blocks sign-in. */
export async function ssoProvider(deps: SsoDeps, providerId: string): Promise<OAuthProvider | null> {
  const row = await ssoForId(deps.db, providerId);
  if (!row) return null;
  const http = ssoHttp(deps.config, deps.http);
  const metadata = await discoverSso(row.issuer, http);
  const clientSecret = await openSecret(deps.keyWrappers, row, ssoAad(row.orgId, row.id));
  const options = { clientId: row.clientId, clientSecret };
  const algorithms = metadata.id_token_signing_alg_values_supported.filter((a) => /^(RS|PS|ES)\d+$|^EdDSA$/.test(a));
  return {
    id: providerId,
    name: row.name,
    issuer: row.issuer,
    requiresIdTokenNonce: true,
    // OIDC identity never follows an email address, display name, or a different issuer.
    accountSubject: ({ profile }) => JSON.stringify([row.issuer, (profile as { sub: string }).sub]),
    createAuthorizationURL: (data) =>
      createAuthorizationURL({
        id: providerId,
        options,
        authorizationEndpoint: metadata.authorization_endpoint,
        state: data.state,
        codeVerifier: data.codeVerifier,
        nonce: data.idTokenNonce,
        redirectURI: data.redirectURI,
        scopes: [...new Set([...SSO_REQUIRED_SCOPES, ...row.scopes])],
      }),
    validateAuthorizationCode: async (data) => {
      const state = await getOAuthState();
      if (state?.serverContext?.ssoProvider !== providerId)
        throw new Error("SSO provider doesn't match the sign-in request");
      const request = await authorizationCodeRequest({
        ...data,
        options,
        tokenEndpoint: metadata.token_endpoint,
        authentication: metadata.token_endpoint_auth_methods_supported?.includes("client_secret_basic")
          ? "basic"
          : "post",
      });
      return getOAuth2Tokens(
        await readJson(http, metadata.token_endpoint, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        }),
      );
    },
    getUserInfo: async (tokens) => {
      if (!tokens.idToken || !tokens.expectedIdTokenNonce) return null;
      try {
        const jwks = await readJson(http, metadata.jwks_uri);
        const { payload } = await jwtVerify(tokens.idToken, createLocalJWKSet(jwks), {
          issuer: row.issuer,
          audience: row.clientId,
          algorithms,
          requiredClaims: ["sub", "iss", "aud", "exp", "iat", "nonce"],
          clockTolerance: 30,
        });
        if (
          typeof payload.iat !== "number" ||
          payload.iat > Date.now() / 1000 + 30 ||
          payload.nonce !== tokens.expectedIdTokenNonce ||
          typeof payload.sub !== "string" ||
          !payload.sub ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== row.clientId) ||
          (payload.azp !== undefined && payload.azp !== row.clientId)
        )
          return null;
        let profile = payload;
        if (
          (!payload.email || !payload.name || payload.email_verified !== true) &&
          metadata.userinfo_endpoint &&
          tokens.accessToken
        ) {
          const info = await readJson(http, metadata.userinfo_endpoint, {
            headers: { authorization: `Bearer ${tokens.accessToken}` },
          });
          if (info.sub !== payload.sub) return null;
          if (payload.email && info.email && String(payload.email).toLowerCase() !== String(info.email).toLowerCase())
            return null;
          profile = { ...info, ...payload };
        }
        if (!z.email().safeParse(profile.email).success || profile.email_verified !== true) return null;
        return {
          user: {
            email: String(profile.email).toLowerCase(),
            emailVerified: true,
            name: typeof profile.name === "string" ? profile.name : String(profile.email),
          },
          data: profile,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Linking requires a fresh, live session at both ends; matching email alone is never ownership proof. */
type ValidateUser = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;
export async function validateSsoUser(
  deps: SsoDeps,
  data: Parameters<ValidateUser>[0],
  context: Parameters<ValidateUser>[1],
) {
  const id = data.source.oauth?.providerId;
  if (!id || !SSO_ID.test(id)) return;
  const row = await ssoForId(deps.db, id);
  if (!row) return { error: "sso_disabled" };
  if (data.source.action === "link-account") {
    const state = await getOAuthState().catch(() => null);
    const session = await getAuthoritativeSessionFromCtx(context);
    if (
      !state?.link ||
      state.link.userId !== data.user.id ||
      session?.user.id !== data.user.id ||
      state.serverContext?.ssoLinkSession !== session.session.id ||
      Date.now() - new Date(session.session.createdAt).getTime() > 10 * 60_000
    )
      return {
        error: "sso_link_required",
        errorDescription: "Sign in to your existing account, then link SSO in Your account.",
      };
  }
  const email = typeof data.user.email === "string" ? data.user.email.toLowerCase() : "";
  const member = typeof data.user.id === "string" ? await getMembership(deps.db, data.user.id, row.orgId) : null;
  if (member) {
    assertActiveMembership(member);
    return;
  }
  const [invitation] = await deps.db
    .select({ id: schema.organizationInvitations.id })
    .from(schema.organizationInvitations)
    .where(
      and(
        eq(schema.organizationInvitations.orgId, row.orgId),
        eq(schema.organizationInvitations.email, email),
        isNull(schema.organizationInvitations.acceptedAt),
        gt(schema.organizationInvitations.expiresAt, new Date()),
      ),
    );
  if (!invitation)
    return {
      error: "sso_invitation_required",
      errorDescription: "Ask this workspace's owner for an email invitation.",
    };
}
