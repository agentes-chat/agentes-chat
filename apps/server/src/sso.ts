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
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { type OIDCConfig, type SSOOptions, sso } from "@better-auth/sso";
import { getAuthoritativeSessionFromCtx, getOAuthState } from "better-auth/api";
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

/** Every plugin request keeps the app's HTTPS, DNS-pinning, redirect, timeout and response-size policy. */
export function ssoHttp(config: Config, http?: typeof fetch): typeof fetch {
  const request = http ?? (isAgentesCloud(config.PUBLIC_URL) || config.ALLOW_SIGNUP ? publicHttpsFetch() : fetch);
  return (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!HttpsUrl.safeParse(url).success)
      throw new ValidationError("Use an HTTPS identity provider URL.", "sso_issuer");
    const res = await request(input, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]),
    });
    if (res.status >= 300 && res.status < 400)
      throw new ValidationError("Identity provider redirects aren't supported.", "sso_issuer");
    const reader = res.body?.getReader();
    if (!reader) return res;
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
    return new Response(Buffer.concat(chunks), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }) as typeof fetch;
}

async function readJson(http: typeof fetch, url: string) {
  const res = await http(url);
  if (!res.ok) throw new ValidationError("The identity provider didn't answer. Check its settings.", "sso_unavailable");
  return res.json();
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

type StoredSsoConfig = { id: string; orgId: string; config: OIDCConfig };

/** Better Auth owns OIDC; the app owns provider administration, encryption and admission. */
export function ssoPlugin(deps: SsoDeps) {
  const plugin = sso({
    providersLimit: 0,
    fetch: ssoHttp(deps.config, deps.http),
    organizationProvisioning: { disabled: true },
    guardProviderMutation: () => {
      throw new Error("Manage SSO in workspace settings");
    },
    fields: { organizationId: "orgId" },
    schema: {
      ssoProvider: {
        additionalFields: {
          enabled: { type: "boolean", input: false, returned: false },
          name: { type: "string", required: true, input: false, returned: false },
          clientId: { type: "string", required: true, input: false, returned: false },
          scopes: { type: "string[]", required: true, input: false, returned: false },
          ciphertext: { type: "string", required: true, input: false, returned: false },
          wrappedDataKey: { type: "string", required: true, input: false, returned: false },
          kekId: { type: "string", required: true, input: false, returned: false },
        },
      },
    },
    resolveUser: (input, context) => resolveSsoUser(deps, input, context),
  });
  const field = plugin.schema.ssoProvider.fields.oidcConfig;
  if (!field) throw new Error("Better Auth SSO is missing its OIDC configuration field");
  field.transform = {
    output: async (value) => {
      const stored = JSON.parse(String(value)) as StoredSsoConfig;
      const row = await ssoForId(deps.db, ssoId(stored.id));
      if (!row || row.orgId !== stored.orgId) throw new Error("SSO is disabled");
      const clientSecret = await openSecret(deps.keyWrappers, row, ssoAad(row.orgId, row.id));
      return JSON.stringify({ ...stored.config, clientSecret });
    },
  };
  // Provider management stays behind workspace-owner permissions and encrypted storage.
  return { ...plugin, endpoints: { signInSSO: plugin.endpoints.signInSSO, callbackSSO: plugin.endpoints.callbackSSO } };
}

type ResolveUser = NonNullable<SSOOptions["resolveUser"]>;
async function resolveSsoUser(
  deps: SsoDeps,
  input: Parameters<ResolveUser>[0],
  context: Parameters<ResolveUser>[1],
): Promise<Awaited<ReturnType<ResolveUser>>> {
  const reject = (code: string) => ({ action: "reject" as const, code });
  if (input.protocol !== "oidc" || !SSO_ID.test(input.providerId)) return reject("sso_disabled");
  const row = await ssoForId(deps.db, input.providerId);
  if (!row || row.issuer !== input.accountKey.issuer) return reject("sso_disabled");
  const state = await getOAuthState();
  const claims = input.verifiedIdTokenClaims;
  const profile = input.providerClaims;
  const email = input.providerUser.email.toLowerCase();
  if (
    !state?.idTokenNonce ||
    claims.nonce !== state.idTokenNonce ||
    typeof claims.iat !== "number" ||
    claims.iat > Date.now() / 1000 + 30 ||
    typeof claims.exp !== "number" ||
    !z.email().safeParse(email).success ||
    claims.email_verified === false ||
    (typeof claims.email === "string" && claims.email.toLowerCase() !== email) ||
    !(
      profile.email_verified === true ||
      (claims.email_verified === true && typeof claims.email === "string" && claims.email.toLowerCase() === email)
    )
  )
    return reject("sso_identity");
  const existing = await context.database.findOne<{ userId: string }>({
    model: "account",
    where: [
      { field: "providerId", value: input.providerId },
      { field: "accountId", value: input.accountKey.accountId },
    ],
  });
  let userId = existing?.userId;
  if (state.serverContext?.ssoLinkSession) {
    const session = await getAuthoritativeSessionFromCtx(
      getCurrentAuthEndpointContext() as Parameters<typeof getAuthoritativeSessionFromCtx>[0],
    );
    if (
      !session ||
      session.session.id !== state.serverContext.ssoLinkSession ||
      session.user.id !== state.serverContext.ssoLinkUser ||
      session.user.email.toLowerCase() !== email ||
      Date.now() - new Date(session.session.createdAt).getTime() > 10 * 60_000 ||
      (userId && userId !== session.user.id)
    )
      return reject("sso_link_required");
    userId = session.user.id;
  } else if (!userId) {
    const local = await context.database.findOne({ model: "user", where: [{ field: "email", value: email }] });
    if (local) return reject("sso_link_required");
  }
  const member = userId ? await getMembership(deps.db, userId, row.orgId) : null;
  if (member) assertActiveMembership(member);
  else {
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
    if (!invitation) return reject("sso_invitation_required");
  }
  return userId ? { action: "link", userId, profile: "preserve" } : { action: "continue" };
}
