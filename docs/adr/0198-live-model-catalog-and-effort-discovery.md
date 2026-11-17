# ADR 0198: Live Model Catalog and Dynamic Effort Discovery

**Status:** accepted (2026-11-17)

## Context

Hardcoding frontier models and reasoning effort levels inside `MODEL_CATALOG`, static provider arrays, and narrow UI sliders caused new frontier models (`gpt-6.1-terra`, `gpt-6.2-*`, Claude Fable/Opus/Sonnet updates, Gemini 4 models, Grok updates) to miss recent releases or clamp supported reasoning levels (`xhigh`, `max`) down to `"high"`.

## Decision

1. **Live Model Catalog (`packages/providers/src/live-catalog.ts`)**: Fetch `https://models.dev/api.json` on server startup and cache in memory (`1h` TTL, `5m` failure retry, `10s` timeout, offline in unit tests unless enabled). Normalize active frontier chat/tool models, pricing, context/output limits, `efforts`, and fast-mode flags while preserving curated metadata (`tier`, `recommended`, `router`, `cheap`, `serverSideFallback`, `intro`, `offPeak`) and keeping `MODEL_CATALOG` strictly as an offline fallback.
2. **Runner Discovery (`apps/server/runner/executors.ts`, `accounts.ts`)**: Probe signed-in `codex app-server` via JSON-RPC (`initialize` -> `initialized` -> `model/list`) to report live Codex `id`, `displayName`, `supportedReasoningEfforts`, `isDefault`, and `additionalSpeedTiers` (`fast`) on `hello.executors.codex.models`.
3. **Full Effort Pipeline**: Propagate supported `efforts` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) and `fast` through `BrainModelOption`, provider adapters (`openai`, `anthropic`, `gemini`), CLI runners (`codex`, `claude_code`, `antigravity`), gateway clamping, and Web/Mobile effort pickers.
