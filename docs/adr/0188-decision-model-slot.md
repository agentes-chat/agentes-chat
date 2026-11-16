# 0188. An optional decision model for the installation, beside Jev

**Status:** accepted (2026-11-16)

## Context

Jev was the only decision model an installation could configure. Its key lives in `instance_secrets` and is used
through `jev-key.ts`; the judge and the router speak its typed questions (noul, choice, score, box). A self-hosted
server without a Jev key falls back to a workspace's small model, to people's plans, or to rules.

OpenAI and Gemini now serve the same kind of decisions on their own APIs: OpenAI's `POST /v1/decisions` with
`gpt-6-luna` (predicate, choice, score; text, pictures and JSON), and Gemini's `POST /v1beta/decisions` with
`gemini-decision-1` (noul, choice, score; text, image, audio, video and PDF). llama.cpp, Ollama and LM Studio serve
the Jev-shaped `POST /v1/systemone` locally. Laya, a 421M-parameter decision model, runs in about 0.5 GB and is light
enough for a small server.

## Decision

1. **A second, optional slot.** `instance_decision_model` holds one row: the switch, the provider, the model, a sealed
   key (OpenAI and Gemini; the local runtime takes none) and the install state. The switch is off by default, so a
   server that never turns it on behaves exactly as before.
2. **Jev is untouched.** Its key, its two routes, its wire, its price and its role as the first step stay as they
   were. TypeSafe and OpenRouter remain the Jev card.
3. **Providers: OpenAI, Gemini and local.** OpenRouter serves no decision models (its public list has none with
   `decisions`), and Claude has no decision API in this product. The local slot is Laya only, served by llama.cpp
   through `/v1/systemone`; the compose `decision` service downloads it on its first start.
4. **Precedence.** With the switch on, the chosen model answers first. The Jev chain answers box questions (only Jev
   has them), pictures a model cannot read, and any failure. A calibrated request may be answered by any native
   decision model; it is still refused when no native model can answer.
5. **Background install.** Turning the switch on writes the row and enqueues `decision.model.install` on the outbox.
   OpenAI and Gemini are checked with one tiny decision; the local model is waited for until llama.cpp answers, up to
   ten minutes. The row's `install_token` fences every write, so a cancel or a newer activation wins. The right hand
   tells the owner in the inbox how it ended.
6. **Capabilities.** Each model records the inputs it takes (text, image, audio, video, file), read from the
   provider's own model or the local runtime. Pictures go to the chosen model only when it reads them; box always
   goes to Jev. Audio, video and PDF are carried by the Gemini adapter; no caller sends them today.
7. **Security and cost.** The route is for the pinned owner only, 404 on agentes.chat Cloud, rate limited and audited.
   The key is sealed with envelope encryption and never returned. Usage is recorded as an external call with the
   provider and the input tokens: OpenAI and Gemini at US$ 0.10 per million input tokens and no output, Jev at its own
   price, local at zero.
8. **Host recommendation.** The screen reads this server's CPUs, memory and free disk, and recommends the local model
   that fits. It only recommends: any listed model can be chosen.

## Consequences

- A server without Jev can decide with OpenAI, Gemini or a local Laya, at its owner's choice.
- Jev keeps working unchanged, including images and boxes, and remains the fallback when the chosen model fails.
- The local model is prepared by the deployment, not by the app's process: the compose service owns the download and
  the runtime, and the app's job only waits for it. A server that runs llama.cpp itself points `DECISION_MODEL_URL`
  at it.
- The help page and the screenshots still describe Jev as the default; this slot is documented in Settings and in
  `SELF_HOSTING.md`.
