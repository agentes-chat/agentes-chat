# 0171. UI-configured OIDC through Better Auth's SSO plugin

- Status: Accepted
- Date: 2026-11-12
- Extends: ADR 0006 (auth and tenancy), ADR 0007 (encrypted provider credentials), ADR 0035 (mobile), ADR 0036 (desktop), ADR 0068 (invitations)

## Decision

Use the official `@better-auth/sso` server plugin and `ssoClient` on web and mobile, following its [SSO](https://better-auth.com/docs/plugins/sso), [OIDC](https://better-auth.com/docs/plugins/sso/oidc) and [user resolution](https://better-auth.com/docs/plugins/sso/provisioning) documentation. The plugin owns OIDC and account/session creation. Do not inject a custom social provider or implement token exchange and signature verification in the application.

Map the plugin's `ssoProvider` model to the existing workspace-owned `oidc_providers` table. The workspace-owner API manages its nonsecret configuration and sealed client secret. The OIDC field's server-side output transform reads and opens that secret using the installation's key wrapper and the connection's org/id binding. No plaintext secret is persisted in plugin JSON or returned to a client. Only the plugin's OIDC sign-in and per-provider callback endpoints are exposed; its registration, management and SAML endpoints are absent.

The plugin's transaction-scoped `resolveUser` checks the verified identity, the state-bound nonce, the provider's verified email and the workspace's existing membership or email invitation. Existing subjects resolve to their exact account. A new subject can link to an existing user only after the user explicitly starts linking from a fresh local session, returns with that same live session and presents the same verified email. Preserve the local profile. Leave domain verification, automatic email linking and organization provisioning off. Better Auth retains its default email-verification policy for new local users.

A request-local Drizzle transaction bridge lets existing application admission and account-block checks participate in the plugin's native transaction. The phone stores its verifier challenge in server-owned OAuth state; a state-specific authorization-origin receipt permits the Expo proxy without adding tenant IdP origins to the application's trusted origins. Its callback leaves no browser session. Desktop confirmation and local logout use their existing flows.

## Compatibility patch

`patches/@better-auth%2Fsso@1.7.22.patch` makes two narrowly scoped additions:

- An optional server-side `fetch` transport handles discovery, token, UserInfo and JWKS requests. With it, the transport owns network policy instead of the plugin's unpinned DNS/origin allowlist. Our transport enforces HTTPS, DNS-pinned public destinations on hosted/public-signup servers, no redirects, a ten-second deadline and a 256 KB response cap. Closed self-hosted servers retain private HTTPS IdPs. Tenant IdP origins never become trusted browser request origins or callback destinations.
- OIDC entrypoints generate an ID-token nonce through Better Auth's state API and send it to the IdP. The resolver requires the verified token to carry that nonce. Client-supplied reserved OAuth parameters remain rejected.

Keep the Better Auth packages on the same patch version. When upgrading, prefer upstream equivalents for these additions, remove the patch when possible, and rerun signed-token, network-policy, native-handoff and migration tests. No change to SAML validation is part of this patch.

## Data and rollout

Migration 0254 adds the plugin's fields and backfills each connection. Earlier account IDs encoded as `[issuer, subject]` become the same subject under their existing provider ID; the connection's issuer remains immutable. Existing encrypted secret columns, users, memberships and roles are preserved. The new callback is `/api/auth/sso/callback/sso-PROVIDER-UUID`; settings exposes its exact value.

Owners configure the same UI on Cloud and self-hosted installations. The toggle collapses disabled connections. Scopes use compact named chips; only `openid` is locked, while optional scopes can be removed and added back. Disabling a connection preserves its configuration and links and still requires another usable sign-in method.
