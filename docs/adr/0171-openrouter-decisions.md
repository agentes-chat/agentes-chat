# 0171 — System One decisions through OpenRouter

Status: Proposed

## Context

The installation's Jev client already speaks System One. OpenRouter serves the same request and
response contract at `https://openrouter.ai/api/v1/systemone`, with Jev and other decision models.
Requiring a direct TypeSafe key prevents using an existing OpenRouter account for these calls.

## Decision

Expose `TYPESAFE_BASE_URL` and `JEV_MODEL` as server configuration. Keep the direct TypeSafe URL,
`jev-latest` and `jev-preview` defaults. Apply the endpoint to key validation, routing and all
judgments, and the text model to key validation and routing too. Allow namespaced model IDs in
both text and vision configuration. Retain the encrypted installation key and its existing owner,
environment precedence, cooldowns and fallback behavior. This is not an ordinary chat provider.

Use the System One compatibility endpoint, preserving image assets and typed questions without
translation or an SDK. OpenRouter's returned `usage.cost` determines the recorded nano-USD cost;
a missing or invalid cost fails the decision instead of substituting Jev's fixed price. Record
these calls as `openrouter-decisions`, so the installation's monthly decision total includes them
without including ordinary organization OpenRouter calls. Keep direct TypeSafe price accounting.

## Consequences

Switching services requires replacing the key and restarting with the new URL. No client key
exposure, database migration or additional dependency. The existing UI still calls this feature
Jev. The operator must choose models that support the questions used and evaluate their calibration;
a text-only model can use a separate vision model. Existing timeouts and fallbacks apply.

Contract: https://openrouter.ai/docs/guides/community/typesafe-sdk
