# What each AI provider can make, and what agents get

What people pay an AI provider for should work through their agents. An agent asked for something its provider can
make (a picture, a video, speech) makes it here, through the agent's own plan when its CLI can, otherwise through the
workspace's keys, and otherwise says plainly that it can't and what would fix it. This page is the audit behind that:
what each plan, CLI and API makes as of 2026-11-23, what agentes.chat already does with it, and what is next.

Sources are each provider's own documentation, SDK and model listings, read on 2026-11-23. "Not verified" marks what
couldn't be checked from public documentation.

## Plans and their CLIs

An agent on a plan runs that provider's CLI on its computer (ADR 0032). Only what the CLI itself can make reaches the
agent that way; what the consumer app offers on top doesn't.

| Plan | CLI | Pictures | Video | Speech out | Music |
|------|-----|----------|-------|------------|-------|
| ChatGPT | Codex | Yes: Codex's own image tool (generate and edit; animated GIFs behind a feature flag) | No | No (realtime voice in the terminal is a way to talk to Codex, not a file) | No |
| Claude | Claude Code | No | No | No | No |
| Google AI (Gemini) | Gemini CLI | Only through an extension (Nano Banana), none built in | No | No | No |
| SuperGrok (Grok) | Grok Build | Not verified | Not verified | Not verified | No |

So no CLI makes a video, speech or music: those come from the workspace's keys, below.

## API keys a workspace can add

| Key | Pictures | Video | Speech out | Music |
|-----|----------|-------|------------|-------|
| OpenAI | GPT Image | None: the Sora API shut down on 2026-09-24 | `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` | No |
| Gemini | Nano Banana | Gemini Omni Flash (`gemini-omni-1.2-flash`, 3 to 15 s with sound, Interactions API); Veo 3.1 Preview shut down on 2026-10-22 | Gemini 3.8 Flash TTS and Flash-Lite TTS | Lyria 3.5, Lyria 3 Clip |
| OpenRouter | Gemini, GPT Image, Seedream and more | Its Video API: Gemini Omni Flash, Grok Imagine Video, Veo 3.1, Kling, Seedance, Wan and more | Many speech models (`output_modalities=speech`) | Lyria |
| Anthropic | No | No | No | No |
| A workspace's own endpoint | When it serves `/images/generations` | No standard API | Not offered | No |

Grok's models have no key of their own here; Grok Imagine Video is reached through OpenRouter.

## What agentes.chat does today

| Capability | Status |
|------------|--------|
| Pictures | Live (ADR 0197): `generate_image` through the Model Gateway on the workspace's keys, and Codex's own image tool on a ChatGPT plan |
| Video | Live with this change (ADR 0219): `generate_video` on a Gemini or OpenRouter key |
| Speech in (transcription) | Live (ADR 0100): voice messages, on the server's own engines |
| Watching videos, hearing audio | Live: `review_media` on the agent's computer |
| Speech out | Not yet |
| Music | Not yet |

## Order

Ranked by how often people would ask for it and how much it misses today:

1. **Video**: what people ask an agent for most after pictures, and what Google's and xAI's consumer apps lead with
   after pictures. Two of the four keys here make it (Gemini directly, OpenRouter for the rest), and videos already
   play inline in the chat on the web and the phone, so nothing new is needed to show one. Built here.
2. **Speech out**: a voiceover or a spoken summary as an audio file. Three keys make it (OpenAI, Gemini, OpenRouter),
   cheaply. It needs audio files to play inline in the chat first, which they don't yet.
3. **Music**: Lyria through Gemini or OpenRouter. Rarely asked of a work agent.

Each one, when built, goes through the Model Gateway like pictures: the agent's budget reserved before the call, one
usage row with its cost after, and the same on a self-hosted server with the same keys.
