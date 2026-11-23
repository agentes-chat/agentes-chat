# 0219. Video generation through the Model Gateway

- Status: Accepted
- Date: 2026-11-23
- Amends: 0012 (a usage kind `video`), 0197 (videos beside pictures)
- Code: `packages/providers/src/videos.ts` (`VIDEO_CATALOG`, `VideoRequest`, costs), `generateVideo` in `gemini.ts` and
  `openrouter.ts` (the fake in `fake.ts`), engine `gateway.ts` (`generateVideo`, `availableVideoModels`),
  `packages/engine/src/videos.ts` (`generateVideoInChat`, the `generate_video` tool), migration 0323 (`usage_kind`
  `video`); the audit behind it is `docs/provider-capabilities.md`

## Context

What a person's AI plan can make, their agents should make too, for every capability and provider. Pictures were the
first (ADR 0197). The audit (`docs/provider-capabilities.md`) found that no plan's CLI makes a video, speech or
music, so those can only come from a workspace's keys, and that video is the one people miss most: Gemini makes it
(Gemini Omni Flash) and OpenRouter routes to several makers, while OpenAI's Sora API and Google's Veo 3.1 Preview
were shut down this autumn.

## Decision

**One catalog of video models**, apart from the chat and image models: `VIDEO_CATALOG` lists each with its provider,
the lengths it makes, whether it takes a picture to start from, and its price per second of 720p video with sound,
dated. Gemini Omni Flash through the Gemini key (the Interactions API the adapter already speaks, the video inline,
or as a Files API file it waits for and downloads), and Gemini Omni Flash and Grok Imagine Video through OpenRouter's
Video API (a job polled until done, then downloaded, priced at what OpenRouter reports; sound is left to
OpenRouter's default, on for the models that make it). A workspace can make videos
when it has a key, its own or the platform's, for one of them; the default is the first in the catalog's order.

**Every video goes through the gateway**, as pictures do: the workspace's standing, the agent's budget reserved at the
request's worst case (its seconds at the dearest rate), the key for the video model's provider (an agent's own
credential only when it is of that provider), the person's limit, the call, and one `usage_records` row of the new
kind `video` with its cost. An agent's budget pays for `agent`, `image` and `video`. A failed call is recorded at
nothing (a call stopped by the wait may still be billed by its provider: see Consequences).

**In a conversation.** An agent calls `generate_video` (`drive:write`, offered only where a video model is available)
with a prompt, a length (3 to 15 seconds by model, 8 by default), landscape or portrait, and optionally a picture file
it reads to start from. It waits for the video, at most 280 seconds (a computer brain gives our tools five minutes),
and the video is saved as a video file where its run posts, so its reply carries it and people play it in the chat on
the web and the phone like any video posted there. The agent hasn't watched it and is told not to describe it beyond
what it asked for. What wasn't made says why: no key, budget, the person's limit, refused by the provider, the
provider failing or taking too long, or storage full.

## Consequences

- Video spend shows in Usage as its own kind ("Videos") and budgets stop it like any other spend.
- A video slower than the wait is lost and may still be billed by its provider; a job that posts it when ready, as
  `live.image` does for canvases, is the next step if providers get slower.
- A self-hosted server makes videos with the same keys; nothing else is needed.
- Speech output and music are next in the audit's order; each goes through the gateway the same way.
