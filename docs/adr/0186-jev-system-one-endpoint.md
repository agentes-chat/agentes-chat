# 0186. Jev's System One endpoint

- Status: Accepted (built)
- Date: 2026-11-14
- Amends: ADR 0073 §2 and §4 (the endpoint used to check and call Jev)
- Code: `packages/config/src/jev-origin.ts` and `JEV_BASE_URL`; `packages/db/src/schema/instance-secrets.ts` (`base_url`); `packages/engine/src/jev-key.ts` (one origin for key checks, router and judge); `apps/server/src/routes/app/jev.ts`; `apps/web/src/components/ai/Jev.tsx`

## Context

ADR 0073 gives a self-hosted installation one Jev key, selected by `TYPESAFE_API_KEY` or its pinned owner in Settings and checked before it is stored. A self-hoster may run a System One compatible endpoint beside the server, or use a gateway with a different origin. A key that is checked at TypeSafe and then sent to another endpoint has not been validated for that endpoint.

## Decision

1. **One effective origin for every System One request.** The pinned owner may choose TypeSafe or “Other provider” in Settings → AI accounts. The selection is stored as nullable `base_url` on the existing `instance_secrets` row named `typesafe`; deleting the Jev key deletes that row and its endpoint selection together. With no owner selection, `JEV_BASE_URL` supplies the server default; if it is unset, Jev uses `https://api.typesafe.ai`. The owner can explicitly select TypeSafe to override an operator default.
2. **A bare HTTP(S) origin only.** Configuration and the Jev write route reject a URL with a path other than the optional root slash, query, fragment or userinfo. Accepted values are normalized to an origin before use or storage. An unset variable preserves TypeSafe behavior.
3. **Check the candidate before saving.** When adding or replacing the key, the server checks it at the origin included in that save request before it persists either value. Omitting the origin keeps the existing owner selection or uses the effective server default. An endpoint that refuses the key leaves both the key and origin unchanged.
4. **Resolve through the shared key.** The installation's single Jev key resolver supplies the effective origin to key checks, router calls and judge calls, including image requests. There is no image-specific block; support for image payloads depends on the configured endpoint.
5. **Keep the origin private to the owner.** Only the pinned-owner Jev route returns the effective origin and its source. Other people continue to receive the route's 404 response.

## Consequences

- Self-hosters can use a local System One compatible service without changing the Jev request path or introducing another credential record.
- Operators can set a default once with `JEV_BASE_URL`; an owner choice persists over it.
- Removing the key also removes the owner-specific endpoint, so another first account never inherits that choice.
- Whether a custom endpoint supports image requests should be confirmed with maintainers; the server continues sending the existing image request shape.
