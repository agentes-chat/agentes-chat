import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq, schema } from "@agenteschat/db";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { type Browser, browser, createTestServer, ORIGIN, seedOrg, signUp, type TestServer } from "./harness";

const issuer = "https://id.example.com";
const keys = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256", use: "sig" };
let t: TestServer;
afterEach(async () => {
  await t?.close();
});

function identityProvider() {
  let available = true;
  let userinfo: Record<string, unknown> | undefined;
  let profile: Record<string, unknown> = {};
  const codes = new Map<string, { jwt: string; challenge: string; callback: string }>();
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!available) throw new TypeError("IdP unavailable");
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
        userinfo_endpoint: `${issuer}/userinfo`,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        scopes_supported: ["openid", "profile", "email", "groups", "groups", "bad scope", ""],
      });
    if (url === `${issuer}/keys`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/userinfo`) return Response.json(userinfo ?? profile);
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(init?.body));
      const record = codes.get(body.get("code") ?? "");
      if (!record) return Response.json({ error: "invalid_grant" }, { status: 400 });
      codes.delete(body.get("code") ?? "");
      expect(body.get("client_id")).toBe("client");
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("redirect_uri")).toBe(record.callback);
      expect(
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url"),
      ).toBe(record.challenge);
      return Response.json({ id_token: record.jwt, access_token: "access", token_type: "Bearer", expires_in: 3600 });
    }
    throw new Error(`Unexpected IdP request: ${url}`);
  }) as typeof fetch;
  const authorize = async (url: URL, claims: Record<string, unknown> = {}, wrongKey = false) => {
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    const code = crypto.randomUUID();
    const signingKey = wrongKey ? (await generateKeyPair("RS256")).privateKey : keys.privateKey;
    const jwt = await new SignJWT({
      iss: issuer,
      aud: "client",
      sub: "owner-subject",
      email: "owner@example.com",
      name: "Owner",
      email_verified: true,
      nonce: url.searchParams.get("nonce"),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(signingKey);
    codes.set(code, {
      jwt,
      challenge: url.searchParams.get("code_challenge") ?? "",
      callback: url.searchParams.get("redirect_uri") ?? "",
    });
    profile = decodeJwt(jwt);
    return `${new URL(url.searchParams.get("redirect_uri") ?? "").pathname}?${new URLSearchParams({ code, state: url.searchParams.get("state") ?? "" })}`;
  };
  return {
    http,
    authorize,
    userInfo: (profile: Record<string, unknown>) => {
      userinfo = profile;
    },
    offline: () => {
      available = false;
    },
  };
}

async function setup(env: Record<string, string> = {}) {
  const idp = identityProvider();
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true", ...env }, http: idp.http, ssoFetch: idp.http });
  const makeBrowser = () => {
    const at = browser(t);
    return Object.assign(
      (path: string, init: Parameters<Browser>[1] = {}) =>
        at(path, { ...init, origin: init.origin === null ? null : (env.PUBLIC_URL ?? ORIGIN) }),
      { cookie: at.cookie },
    );
  };
  const owner = makeBrowser();
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const configPath = `/api/app/organizations/${orgId}/sso`;
  const configured = await owner(configPath, {
    method: "PUT",
    json: {
      name: "Company SSO",
      issuer,
      clientId: "client",
      clientSecret: "secret",
      scopes: ["openid", "email", "profile"],
      enabled: true,
    },
  });
  expect(configured.status).toBe(200);
  const view = (await configured.json()) as { provider: { id: string }; callbackUrl: string; loginUrl: string };
  const provider = view.provider.id;
  const start = async (at: Browser, link = false, callbackURL = "/", headers?: Record<string, string>) => {
    const response = await at("/api/auth/sign-in/sso", {
      json: { providerId: provider, callbackURL, errorCallbackURL: "/login" },
      headers: { ...headers, ...(link ? { "x-agentes-sso-link": "1" } : {}) },
    });
    if (response.status !== 200) throw new Error(`start: ${response.status} ${await response.text()}`);
    return new URL(((await response.json()) as { url: string }).url);
  };
  const finish = async (at: Browser, link = false, claims: Record<string, unknown> = {}, wrongKey = false) =>
    at(await idp.authorize(await start(at, link), claims, wrongKey), { origin: null });
  return { ...idp, owner, orgId, configPath, provider, view, start, finish, makeBrowser };
}

test("owner configures SSO through UI API; secrets are sealed, read-only to members, and retained on edits", async () => {
  const s = await setup();
  expect(s.view.callbackUrl).toBe(`${ORIGIN}/api/auth/sso/callback/${s.provider}`);
  expect(s.view.loginUrl).toBe(`${ORIGIN}/login?sso=${s.provider}`);
  expect((await s.owner("/api/auth/sso/register", { json: {} })).status).toBe(404);
  expect((await s.owner(`/api/auth/sso/get-provider?providerId=${s.provider}`)).status).toBe(404);
  expect(JSON.stringify(s.view)).not.toContain('"secret"');
  const [stored] = await t.db.select().from(schema.oidcProviders);
  expect(stored?.ciphertext).not.toContain("secret");
  const edited = await s.owner(s.configPath, {
    method: "PUT",
    json: { name: "Work SSO", issuer, clientId: "client", scopes: ["openid"], enabled: true },
  });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ provider: { scopes: ["openid"] } });
  expect((await s.start(s.owner)).searchParams.get("scope")).toBe("openid");
  expect((await t.db.select().from(schema.oidcProviders))[0]?.ciphertext).toBe(stored?.ciphertext);
  expect(
    (
      await s.owner(s.configPath, {
        method: "PUT",
        json: {
          name: "Work SSO",
          issuer,
          clientId: "client",
          scopes: Array.from({ length: 20 }, (_, i) => `extra:${i}`),
          enabled: true,
        },
      })
    ).status,
  ).toBe(400);
  const stranger = browser(t);
  await signUp(stranger, "stranger@example.com");
  expect((await stranger(s.configPath)).status).toBe(403);
  expect(
    (
      await stranger(s.configPath, {
        method: "PUT",
        json: { name: "Bad", issuer, clientId: "client", scopes: [], enabled: true },
      })
    ).status,
  ).toBe(403);
  expect((await browser(t)(`/api/app/sso/${s.provider}`)).status).toBe(200);
});

test("provider discovery gives owners a safe, deduplicated scope list without saving configuration", async () => {
  const s = await setup();
  const before = await t.db.select().from(schema.oidcProviders);
  const result = await s.owner(`${s.configPath}/discover`, {
    json: { issuer: `${issuer}/.well-known/openid-configuration` },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ issuer, scopes: ["openid", "profile", "email", "groups"] });
  expect(await t.db.select().from(schema.oidcProviders)).toEqual(before);
  expect((await browser(t)(`${s.configPath}/discover`, { json: { issuer } })).status).toBe(401);
  const outsider = browser(t);
  await signUp(outsider, "outsider@example.com");
  expect((await outsider(`${s.configPath}/discover`, { json: { issuer } })).status).toBe(403);
  expect((await s.owner(`${s.configPath}/discover`, { json: { issuer: "http://localhost" } })).status).toBe(400);
});

test("provider discovery is rate limited before contacting the identity provider", async () => {
  const s = await setup();
  for (let i = 0; i < 10; i++)
    expect((await s.owner(`${s.configPath}/discover`, { json: { issuer } })).status).toBe(200);
  expect((await s.owner(`${s.configPath}/discover`, { json: { issuer } })).status).toBe(429);
});

test("migrated connections without cached endpoints use plugin discovery through the guarded transport", async () => {
  const s = await setup();
  const [row] = await t.db.select().from(schema.oidcProviders);
  if (!row) throw new Error("missing connection");
  await t.db.update(schema.oidcProviders).set({
    oidcConfig: JSON.stringify({
      id: row.id,
      orgId: row.orgId,
      config: { issuer, clientId: row.clientId, scopes: row.scopes, pkce: true },
    }),
  });
  expect((await s.finish(s.owner, true)).headers.get("location")).toBe("/");
});

test("explicit linking preserves account, memberships and roles; later OIDC login and local logout work", async () => {
  const s = await setup();
  const before = await t.db.select().from(schema.organizationMembers);
  const linked = await s.finish(s.owner, true);
  expect(linked.headers.get("location")).toBe("/");
  const [account] = await t.db.select().from(schema.accounts).where(eq(schema.accounts.providerId, s.provider));
  expect(account?.accountId).toBe("owner-subject");
  expect(await t.db.select().from(schema.organizationMembers)).toEqual(before);
  expect((await t.db.select().from(schema.users)).length).toBe(1);
  const at = browser(t);
  expect((await s.finish(at)).headers.get("location")).toBe("/");
  expect((await at("/api/app/me")).status).toBe(200);
  expect((await at("/api/auth/sign-out", { json: {} })).status).toBe(200);
  expect((await at("/api/app/me")).status).toBe(401);
});

test("matching verified email never implicitly links an existing account", async () => {
  const s = await setup();
  await t.db.update(schema.users).set({ emailVerified: true });
  const at = browser(t);
  const result = await s.finish(at);
  expect(new URL(result.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe("sso_link_required");
  expect((await at("/api/app/me")).status).toBe(401);
  expect((await t.db.select().from(schema.accounts)).length).toBe(1);
});

test("rejects invalid signatures, issuer, audience, nonce, expiry, unverified email and different linking email", async () => {
  const s = await setup();
  for (const claims of [
    { iss: "https://other.example" },
    { aud: "other-client" },
    { nonce: "wrong" },
    { exp: 1 },
    { email_verified: false },
    { sub: "" },
    { email: "other@example.com" },
    { azp: "other-client" },
  ]) {
    const res = await s.finish(s.owner, true, claims);
    expect(new URL(res.headers.get("location") ?? "", ORIGIN).searchParams.has("error")).toBe(true);
  }
  const bad = await s.finish(s.owner, true, {}, true);
  expect(new URL(bad.headers.get("location") ?? "", ORIGIN).searchParams.has("error")).toBe(true);
  expect((await t.db.select().from(schema.accounts)).length).toBe(1);
});

test("an uninvited identity cannot bypass admission, even with requestSignUp", async () => {
  const s = await setup();
  const at = browser(t);
  const result = await s.finish(at, false, { sub: "outsider", email: "outsider@example.com" });
  expect(new URL(result.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe(
    "sso_invitation_required",
  );
  expect((await t.db.select().from(schema.users)).length).toBe(1);
  const forced = await at("/api/auth/sign-in/sso", {
    json: { providerId: s.provider, callbackURL: "/", errorCallbackURL: "/login", requestSignUp: true },
  });
  expect(forced.status).toBe(200);
  const forcedUrl = new URL(((await forced.json()) as { url: string }).url);
  const refused = await at(await s.authorize(forcedUrl, { sub: "outsider", email: "outsider@example.com" }), {
    origin: null,
  });
  expect(new URL(refused.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe(
    "sso_invitation_required",
  );
  expect((await t.db.select().from(schema.users)).length).toBe(1);
});

test("linking needs the same fresh live session; state is single-use and bound to its provider", async () => {
  const s = await setup();
  const url = await s.start(s.owner, true);
  const back = await s.authorize(url);
  await s.owner("/api/auth/sign-out", { json: {} });
  const expired = await s.owner(back, { origin: null });
  expect(new URL(expired.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe("sso_link_required");
  expect((await s.owner(back, { origin: null })).status).toBe(302);
  expect((await t.db.select().from(schema.accounts)).length).toBe(1);
});

test("discovery rejects a different issuer and HTTPS is required", async () => {
  const s = await setup();
  const settings = {
    name: "SSO",
    issuer: "http://localhost",
    clientId: "client",
    clientSecret: "secret",
    scopes: [],
    enabled: true,
  };
  // A different issuer is refused before it replaces a saved connection.
  expect((await s.owner(s.configPath, { method: "PUT", json: settings })).status).toBe(409);
  const { discoverSso } = await import("../src/sso");
  await expect(discoverSso("http://localhost", s.http)).rejects.toThrow();
  await expect(
    discoverSso(issuer, (async (_input: string | URL | Request) =>
      Response.json({
        issuer: "https://wrong.example",
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
      })) as typeof fetch),
  ).rejects.toThrow();
});

test("the same UI configuration and explicit login work on agentes.chat Cloud", async () => {
  const s = await setup({ PUBLIC_URL: "https://app.agentes.chat" });
  const edited = await s.owner(s.configPath, {
    method: "PUT",
    json: { name: "Company SSO", issuer, clientId: "client", scopes: [], enabled: true },
  });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ provider: { scopes: ["openid"] } });
  expect((await s.start(s.owner)).searchParams.get("scope")).toBe("openid");
  expect((await s.finish(s.owner, true)).headers.get("location")).toBe("/");
  const at = s.makeBrowser();
  expect((await s.finish(at)).headers.get("location")).toBe("/");
  expect((await at("/api/app/me")).status).toBe(200);
});

test("a closed server admits an invited OIDC identity, but grants membership only after accepting that workspace's invitation", async () => {
  const s = await setup({ ALLOW_SIGNUP: "false" });
  const invited = await s.owner(`/api/app/organizations/${s.orgId}/invitations`, {
    json: { email: "new@example.com", roleIds: [] },
  });
  expect(invited.status).toBe(201);
  const token = ((await invited.json()) as { url: string }).url.split("/invite/")[1];
  const at = browser(t);
  const options = await at("/api/app/sign-in-options", { json: { email: "new@example.com" } });
  expect(await options.json()).toMatchObject({ account: false, canSignUp: true, providers: [s.provider] });
  const result = await s.finish(at, false, { email: "new@example.com", sub: "new-subject", name: undefined });
  expect(result.headers.get("location")).toBe("/");
  const [user] = await t.db.select().from(schema.users).where(eq(schema.users.email, "new@example.com"));
  expect(user?.name).toBe("new@example.com");
  const members = await t.db
    .select()
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, user?.id ?? ""));
  expect(members).toEqual([]);
  expect((await at(`/api/app/invitations/${token}/accept`, { json: {} })).status).toBe(200);
  expect(
    (
      await t.db
        .select()
        .from(schema.organizationMembers)
        .where(eq(schema.organizationMembers.userId, user?.id ?? ""))
    ).length,
  ).toBe(1);
});

test("an invitation to another workspace cannot provision an account through this connection", async () => {
  const s = await setup({ ALLOW_SIGNUP: "false" });
  await t.db
    .update(schema.organizations)
    .set({ onboardingStep: "done", onboardedAt: new Date() })
    .where(eq(schema.organizations.id, s.orgId));
  const other = await s.owner("/api/app/organizations", { json: { name: "Other workspace", finished: true } });
  expect(other.status).toBe(201);
  const otherId = ((await other.json()) as { organization: { id: string } }).organization.id;
  expect(
    (
      await s.owner(`/api/app/organizations/${otherId}/invitations`, {
        json: { email: "new@example.com", roleIds: [] },
      })
    ).status,
  ).toBe(201);
  const result = await s.finish(browser(t), false, { email: "new@example.com", sub: "new-subject" });
  expect(new URL(result.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe(
    "sso_invitation_required",
  );
  expect((await t.db.select().from(schema.users)).length).toBe(1);
});

test("mobile uses its browser challenge handoff without leaving a session in the browser", async () => {
  const s = await setup();
  await s.finish(s.owner, true);
  const app = browser(t);
  const verifier = "v".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const started = await app("/api/auth/sign-in/sso", {
    origin: null,
    headers: { "expo-origin": "agenteschat://", "x-agentes-client": "mobile", "x-agentes-phone-challenge": challenge },
    json: { providerId: s.provider, callbackURL: "agenteschat:///" },
  });
  expect(started.status).toBe(200);
  const authorization = ((await started.json()) as { url: string }).url;
  const at = browser(t);
  const proxy = await at(
    `/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: authorization })}`,
    { origin: null },
  );
  expect(proxy.status).toBe(302);
  const back = await at(await s.authorize(new URL(authorization)), { origin: null });
  expect(back.headers.get("set-cookie")).toBeNull();
  const location = new URL(back.headers.get("location") ?? "");
  expect(location.protocol).toBe("agenteschat:");
  const cookie = location.searchParams.get("cookie")?.split(";")[0] ?? "";
  expect(cookie).toContain("phone_code=");
  const redeemer = browser(t);
  const redeemed = await redeemer("/api/auth/phone/redeem", {
    origin: null,
    headers: { "x-agentes-client": "mobile", cookie },
    json: { verifier },
  });
  expect(await redeemed.json()).toEqual({ signedIn: true });
  expect((await redeemer("/api/app/me")).status).toBe(200);
  expect((await at("/api/app/me")).status).toBe(401);
});

test("desktop SSO signs in through the existing confirmation-code handoff", async () => {
  const s = await setup();
  await s.finish(s.owner, true);
  const window = browser(t);
  const verifier = "v".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const opened = await window("/api/auth/desktop/open", { json: { challenge } });
  const { requestId } = (await opened.json()) as { requestId: string };
  const at = browser(t);
  const callback = `/desktop/sign-in?provider=${s.provider}&request=${requestId}&done=1`;
  const back = await at(await s.authorize(await s.start(at, false, callback)), { origin: null });
  expect(back.headers.get("location")).toBe(callback);
  expect(await (await at("/api/auth/desktop/handoff", { json: { requestId } })).json()).toEqual({ ok: true });
  expect(await (await window("/api/auth/desktop/redeem", { json: { verifier } })).json()).toEqual({ signedIn: true });
  expect((await window("/api/app/me")).status).toBe(200);
});

test("an owner can disable an unavailable IdP, but cannot remove their last usable sign-in method", async () => {
  const s = await setup();
  await s.finish(s.owner, true);
  const settings = { name: "Company SSO", issuer, clientId: "client", scopes: ["openid"], enabled: false };
  await t.db.delete(schema.accounts).where(eq(schema.accounts.providerId, "credential"));
  expect((await s.owner(s.configPath, { method: "PUT", json: settings })).status).toBe(409);
  const [user] = await t.db.select().from(schema.users);
  await t.db.insert(schema.accounts).values({
    id: "backup",
    accountId: user?.id ?? "",
    providerId: "credential",
    userId: user?.id ?? "",
    password: "synthetic-password-hash",
  });
  s.offline();
  expect((await s.owner(s.configPath, { method: "PUT", json: settings })).status).toBe(200);
  expect((await browser(t)(`/api/app/sso/${s.provider}`)).status).toBe(400);
});

test("a callback cannot switch the provider bound to its state", async () => {
  const s = await setup();
  const { db } = t;
  const [first] = await db.select().from(schema.oidcProviders);
  if (!first) throw new Error("missing provider");
  const { sealSecret } = await import("@agenteschat/engine");
  const { ssoAad } = await import("../src/sso");
  const id = crypto.randomUUID();
  const otherOrgId = crypto.randomUUID();
  await db.insert(schema.organizations).values({ id: otherOrgId, name: "Other" });
  const sealed = await sealSecret(t.adapters.keyWrapper, "secret", ssoAad(otherOrgId, id));
  await db.insert(schema.oidcProviders).values({
    ...first,
    ...sealed,
    id,
    orgId: otherOrgId,
    providerId: `sso-${id}`,
    oidcConfig: JSON.stringify({ id, orgId: otherOrgId, ...sealed, config: JSON.parse(first.oidcConfig).config }),
  });
  const at = browser(t);
  const back = await s.authorize(await s.start(at));
  const result = await at(back.replace(s.provider, `sso-${id}`), { origin: null });
  expect(new URL(result.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe("invalid_state");
  expect((await at("/api/app/me")).status).toBe(401);
});

test("UserInfo can supply email verification only for the same subject and email", async () => {
  const s = await setup();
  for (const info of [
    { sub: "other-subject", email: "owner@example.com", email_verified: true },
    { sub: "owner-subject", email: "other@example.com", email_verified: true },
  ]) {
    s.userInfo(info);
    const result = await s.finish(s.owner, true, { email_verified: undefined });
    expect(new URL(result.headers.get("location") ?? "", ORIGIN).searchParams.has("error")).toBe(true);
  }
  s.userInfo({ sub: "owner-subject", email: "owner@example.com", email_verified: true });
  expect((await s.finish(s.owner, true, { email_verified: undefined })).headers.get("location")).toBe("/");
});

test("SSO-only rejects password and social logins while linked desktop SSO still works", async () => {
  const s = await setup();
  await s.finish(s.owner, true);
  const accounts = await t.db
    .select({
      id: schema.accounts.id,
      accountId: schema.accounts.accountId,
      providerId: schema.accounts.providerId,
      userId: schema.accounts.userId,
      password: schema.accounts.password,
    })
    .from(schema.accounts);
  t.config.AUTH_SSO_PROVIDER_ID = s.provider;
  t.config.AUTH_SSO_ONLY = true;
  const window = browser(t);
  for (const [path, json] of [
    ["/sign-in/email", { email: "owner@example.com", password: "password123" }],
    ["/sign-up/email", { name: "Other", email: "other@example.com", password: "password123" }],
    ["/sign-in/social", { provider: "google", callbackURL: "/" }],
    ["/request-password-reset", { email: "owner@example.com" }],
    ["/owner-key", { key: "x".repeat(43) }],
  ] as const) {
    const refused = await window(`/api/auth${path}`, { json });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("sso_required");
  }
  const config = await (await window("/api/app/auth-config")).json();
  expect(config).toMatchObject({
    ssoOnly: true,
    ssoProviderId: s.provider,
    signupOpen: false,
    passwordReset: false,
    socialProviders: { google: false, github: false, apple: false },
  });
  const options = await (await window("/api/app/sign-in-options", { json: { email: "owner@example.com" } })).json();
  expect(options).toMatchObject({ password: false, canSignUp: false, providers: [s.provider] });
  const verifier = "v".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { requestId } = (await (await window("/api/auth/desktop/open", { json: { challenge } })).json()) as {
    requestId: string;
  };
  const at = browser(t);
  const callback = `/desktop/sign-in?provider=${s.provider}&request=${requestId}&done=1`;
  const back = await at(await s.authorize(await s.start(at, false, callback)), { origin: null });
  expect(back.headers.get("location")).toBe(callback);
  expect(await (await at("/api/auth/desktop/handoff", { json: { requestId } })).json()).toEqual({ ok: true });
  expect(await (await window("/api/auth/desktop/redeem", { json: { verifier } })).json()).toEqual({ signedIn: true });
  expect((await window("/api/app/me")).status).toBe(200);
  expect(
    await t.db
      .select({
        id: schema.accounts.id,
        accountId: schema.accounts.accountId,
        providerId: schema.accounts.providerId,
        userId: schema.accounts.userId,
        password: schema.accounts.password,
      })
      .from(schema.accounts),
  ).toEqual(accounts);
  const disabled = await s.owner(s.configPath, {
    method: "PUT",
    json: { name: "Company SSO", issuer, clientId: "client", scopes: ["openid", "email", "profile"], enabled: false },
  });
  expect(disabled.status).toBe(409);
});
