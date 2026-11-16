# 0187. An OpenRouter key chooses its models, and API models' effort levels are checked

- Status: Accepted (built)
- Date: 2026-11-15
- Extends: ADR 0087 (OpenRouter), 0146 (a workspace's own endpoint), 0005 (the outbox)
- Code: db `schema/agents.ts` (`StoredEndpoint.models[].efforts`, `effortsSync`, `options.openrouter` with `efforts`/`effortsAt`/`effortsSync`); providers `openrouter.ts` (the `:batch` filter, the `exactEffort` probe body), `catalog.ts` (`nearestRequestEffort`, the widened `RequestEffort`), `types.ts` (`ModelRequest.effort`, `exactEffort`); engine `endpoints.ts` (`infoOf`, `cleanEndpointModels`, `probeCredentialEfforts`, `markCredentialEffortsFailed`), `credentials.ts` (`checkedOpenRouterModels`, `openRouterSelection`, `openRouterTestedEfforts`, `updateOpenRouterModels`, the `syncEfforts` enqueue), `credential-efforts.ts` (`CREDENTIAL_EFFORTS_JOB`), `jobs.ts` (the handler and the right hand's notice), `notifications.ts` (`credential_efforts`, in `MERGING`), `gateway.ts` (the clamp and `exactEffort`), `brains/model.ts` (`apiEffort`), `auto-model.ts` (`allowed`); server `routes/app/agents.ts` (`POST …/credentials/openrouter-models`, `PUT …/credentials/{id}/openrouter-models`, `POST …/credentials/{id}/efforts`), `schemas.ts`, `credential-view.ts`; client `api/types.ts`, `api/client.ts`, `lib/providers.ts` (`modelChoices`), `lib/brain-advanced.ts` (`keyEffortScale`, the full `EFFORT_SCALE`), `lib/notifications.ts`; web `components/ai/OpenRouterModels.tsx`, `EndpointForm.tsx`, `ModelPicker.tsx`, `components/ConnectAi.tsx`, `components/ai/ConnectAiSteps.tsx`, `pages/SettingsPage.tsx`, `pages/agent/brain/BrainDialog.tsx`, `state.tsx`, `NotificationParts.tsx`; phone `features/ai/EndpointForm.tsx`, `ConnectAi.tsx`, `ConnectAiSteps.tsx`, `EffortRamp.tsx`, `AgentAiScreen.tsx`, `AgentAdvancedScreen.tsx`, `features/i18n/keys.*`

## Context

OpenRouter's list is one line for many makers' models: a workspace with its key saw the whole list in every picker, and nothing said which of them it actually works with. Its batch variants (`…:batch`) are the same models sold for asynchronous jobs, which agents don't use. A workspace's own endpoint (ADR 0146) has models the catalog knows nothing about, and the effort ramp for API keys was fixed to `low`, `medium`, `high`: whether a model takes a level, or any effort at all, was never asked. The same three levels were what the apps showed for a model whose provider lists `max` or `xhigh`, and the provider layer could not send those levels at all.

This change was reported in three parts: (A) pickers listed models of providers the workspace never connected; (B) a DeepSeek model that takes `max` only showed "Baixo/Médio/Alto"; (C) saving the OpenRouter key never asked to test the models' levels, never ran the check and never sent the right hand's notice. The two screenshots that came with the report showed the agent's model dialog and its "Mais opções" effort ramp.

## Decision

### 1. An OpenRouter key lists the models it uses

`provider_credentials.options.openrouter.models` holds the models the workspace chose when it saved the key (at least one, at most 100, each one the list still carries). The choice is per key; the pickers show the union of the workspace's live OpenRouter keys, and a key saved before this choice (no list) keeps showing the whole list until someone chooses. The apps require a choice for a new key; the API keeps it optional for older clients. Changing it later is `PUT …/credentials/{id}/openrouter-models`, audited as `credential.models_changed`.

The list route (`POST …/credentials/openrouter-models`) reads OpenRouter's public list (no model call) and, when a key is given, checks it first (a refused or management key never chooses). `parseOpenRouterModels` leaves out `:batch` ids, so they are never listed, chosen or run.

### 2. What the choice changes, and what it doesn't

The pickers (`modelChoices`) and Automático (`autoModelFor`, the right hand's decided calls and the AI status) offer the chosen models alone; an agent already fixed on a model left out keeps running it (the choice is about what is offered, not about what is allowed), and the picker shows that current model with a note. Routing, the judge and summaries keep their own picks: they are invisible to the person.

A model of a provider the workspace has no key for is not offered at all. Before, it was listed greyed with "needs an API key", which read as an offer of something the workspace cannot use; the model an agent already runs stays visible so removing a key never hides the agent's own setting.

### 3. The effort check runs for an endpoint and for an OpenRouter key

Saving an API key whose models have no checked levels asks whether to check them in the background (an endpoint's custom models, or an OpenRouter key's chosen models); declining saves the models without levels, and the apps then fall back to what the provider declares (OpenRouter) or offer no ramp (an endpoint). Accepting enqueues `credential.efforts`: one short `summary` call per level and model, through the Model Gateway, whose tokens and cost are recorded. The levels probed are `low`, `medium`, `high`, `xhigh` and `max` — every level an API brain can store.

An endpoint is probed for the level itself (its Chat Completions adapter sends `reasoning_effort` verbatim). An OpenRouter model is probed with `exactEffort`, so the adapter sends `reasoning: { effort }` instead of taking the request to the nearest level its list already claims; the accepted set is then intersected with `reasoning.supported_efforts` from OpenRouter's list, never widened by a sweep. The list is read before the probe; a model the list doesn't know is a retryable failure, never "takes none".

The result is written per model (`options.endpoint.models[].efforts` / `options.openrouter.efforts[id]`, with `effortsAt`) and on the credential (`effortsSync`: running, done, failed with the server's words). A 4xx means that level isn't taken; the key's own refusal (401/403) stops the run and marks it failed; transport errors and 429/5xx throw, so the outbox retries and an outage is never recorded as "takes none". Models already checked are skipped; "check again" forces all. The key's owner hears from the right hand (`credential_efforts` in the inbox, the agent as its actor), with the key's name and, on a failure, the server's words; the kind merges on the same row while unread, so a retry or a second check updates it instead of vanishing.

### 4. The ladder the apps show and the effort a call sends

`Model.efforts` carries the levels known for a model (checked for an endpoint, declared by OpenRouter's list, the catalog's when it has them). The API ramp shows the whole seven-step ladder (`EFFORT_SCALE`: none, low, minimal, medium, high, xhigh, max) with the steps the model doesn't take greyed out (`keyEffortScale`), as the Antigravity family ramp already did. A custom or OpenRouter model with no levels has no ramp and says why; a catalog model with no list keeps `low`/`medium`/`high`, the levels every provider API takes.

`ModelRequest.effort` now covers all seven levels, `apiEffort` passes a stored level through, and the Model Gateway takes it to the nearest level the model takes (`nearestRequestEffort`). A model with no declared list is clamped to the safe four (`none`, `low`, `medium`, `high`), so widening the ladder can never send `xhigh`/`max` to an API that doesn't take them; `none` is passed through unchanged, since turning thinking off is each adapter's own business. The adapters keep a defensive cast only after that clamp.

`none` and `minimal` are shown, and greyed for an API key: the API-brain setting (`agents.effort` validated against `BRAIN_EFFORTS`) stores `low`…`max` today. Storing them is the next step; until then the ramp is honest about what can be chosen.

## Consequences

- The OpenRouter list a workspace sees is its own choice; the model list stays global for cross-workspace pricing and usage.
- A key saved before this change keeps every model until someone chooses; the key's row offers "Models".
- Checking an API key's effort levels costs one short call per level and model (five per model, at most); the dialog says so and it only runs when the person accepts. OpenRouter's declared levels are the authority; the sweep can only narrow them.
- Nothing needed a migration: all of it lives in `provider_credentials.options`.
- The phone now filters the same models from the shared client, chooses an OpenRouter key's models on the key step, offers the same custom-endpoint effort prompt and draws the full ladder.
- Still open: `none`/`minimal` storage in the API-brain setting; restricting the OpenRouter list server-side for people who don't manage keys (the apps' filter reads credentials, which only admins load); a "test levels" button on an existing key's Models dialog (the route is ready); and push/banner for `credential_efforts` (the inbox row is the notice, as before).
