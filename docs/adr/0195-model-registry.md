# 0195. One model registry: every model in one file, roles by family

- Status: Accepted
- Date: 2026-11-17
- Extends: ADR 0018 (providers and the catalog), ADR 0059 §8 (coding plans as key accounts), ADR 0087 (OpenRouter's
  list), ADR 0132 (OpenCode's free tier), ADR 0142 (Grok Build), ADR 0143 (Antigravity), ADR 0149 (Fast mode)
- Code: `packages/providers/src/models.json` (the data), `registry.ts` (`REGISTRY`, `routeModels`, `resolveRoles`,
  `roleModel`, `sentId`), `catalog.ts` (`MODEL_CATALOG` read from it, `claudeCodeAliasModel`, `defaultModels`), `plans.ts`
  (each plan's `claudeCode.models`, `FAST_MODE_MODELS`, `GROK_BUILD_MODELS`, `ANTIGRAVITY_MODELS`,
  `OPENCODE_FREE_MODELS`); `packages/engine/src/brain-settings.ts` (`CLAUDE_CODE_MODELS`); `packages/config/src/schema.ts`
  and `apps/server/src/engine.ts` (`ROUTER_MODEL`, `SUMMARY_MODEL`, `OPENAI_CHEAP_MODEL` unset by default); tests
  `packages/providers/test/registry.test.ts`

## Context

Models were written in several places, each in its own shape: the catalog of API models with their prices
(`MODEL_CATALOG`), each coding plan's models, ChatGPT's Fast mode list, the CLIs' fallback lists, Claude Code's aliases,
and the deployment's default models in the environment's schema. One model could appear four or five times (GLM-5.3:
its maker's key, Command Code, the GLM Coding Plan, OpenCode Go). A new model meant finding every list, and the roles
(Automatic's sizes, the suggested model, the cheap one, the routing pick, each plan's aliases) were flags on rows
that a newer model then had to take over by hand.

## Decision

1. **One file, one block per model.** `models.json` holds every model: its name, maker, family, the day it came out,
   its window, and `on`, the routes it runs on, each with what is particular to it there (the id it sends, a label,
   prices, a window, thinking and output details, a plan's tag or need, Fast mode, a CLI's thinking levels). Routes are
   an API provider's id (`PROVIDERS`), `commandcode`, `plan:<id>`, `codex` (ChatGPT through Codex) and `cli:<name>`.
   Prices are in USD per million tokens, as providers publish them; `catalog.ts` turns them into nano-USD per token,
   so every cost stays an exact integer. `sources` says where and when each route's data was read.
2. **Roles by family.** `roles` gives each role on each route to a family (`anthropic`: `medium` and `recommended` to
   `claude-sonnet`; `plan:zai`: `sonnet` to `glm`; `claude-code`: Claude Code's aliases, on Claude's API models, `fable` among them). The
   family's newest model on that route (latest `released`, each model's first release day) holds it, and a role
   names the model: what a route sends for it is that route's own `id`. A newer model of a family is one new block:
   it takes the family's roles everywhere with no other change; the older one stays choosable. A family with no role
   (GPT-6 Astra, Gemini 4 Carbon) is never picked by Automatic, only by people; Claude Fable's one role is Claude
   Code's `fable` alias, which people choose. API routes take
   `API_ROLES`, Claude Code and the plans `ALIAS_ROLES`.
3. **Everything else reads it.** `MODEL_CATALOG` is the API routes' models, in `PROVIDERS`' order and then the file's,
   with the roles they hold; Command Code's are its long list (`pick: false`). Each plan's models are its route's, each
   maker's together, the aliases' makers first; a plan of one maker names none. Claude Code's aliases, Fast mode's list
   and the CLIs' fallback lists come from their routes. `ROUTER_MODEL`, `SUMMARY_MODEL` and `OPENAI_CHEAP_MODEL` are
   unset by default: the registry's routing and cheap picks (`defaultModels()`) stand in, and the server refuses to
   start if the file names none. `AGENT_DEFAULT_MODEL`, unused since new agents start on Automatic, is gone.
   Nothing in the file is a load error for the apps or the runner, which import it too: an API route without prices
   is left out of the catalog, and only the server asks for the defaults.
4. **What stays in code.** Where a key goes (`PROVIDERS`' addresses, a plan's endpoint and key variable) never comes from
   the registry: the runner keeps its own copy of `plans.ts`, so data that may one day be read from elsewhere can't
   send a key to another address. Lists read at run time stay as they are (OpenRouter's, a workspace's own endpoint,
   a plan's `modelsUrl`, what a computer's CLI lists) and keep the registry as their fallback.
5. **Pure data.** `registry.ts` imports only the JSON, so the runner and the apps read it as they read `plans.ts`.
   A test checks the file: every model runs somewhere real, an API route always has prices and a plan never does, every
   role is one its route takes and reaches a model, every model of a family a role names has a release day and no two
   of them on a route share one, each alias runs a model of its own, no route sends one id twice.

## Consequences

- Adding a model is one block in one file. A newer model in a known family takes over its roles; a new family takes
  none until `roles` names it.
- The file is data, so a later step can read it from the public repository at run time, as a release ships it, or
  have a job compare it with providers' lists and propose the new blocks.
- Command Code's long list and OpenCode Go's table follow the file's order (makers grouped), no longer the order they
  were typed in.
