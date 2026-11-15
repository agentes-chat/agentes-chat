# 0174. Two setup paths for optional local speech

- Status: Proposed; number subject to maintainer allocation
- Date: 2026-11-15
- Extends: [ADR 0100](0100-voice-messages.md)
- Product requirements: [Local speech setup](../specs/local-speech.md)
- Evidence: [Benchmark summary](../local-speech/benchmark-summary.md)

## Context

Self-hosted installations need speech without requiring a paid external provider or a GPU. An organization may already operate a speech server shared by employees over a VPN. A small installation may instead need help installing a runtime and selecting a model on its own machine. Hardware detection alone cannot establish recognition quality or acceptable response time.

The existing `local` SpeechEngine already accepts an OpenAI-compatible base URL, optional bearer key and model. Requests originate at the application server. Saved speech credentials are installation-wide and restricted to its pinned owner, not personal settings. The web picker currently exposes only the URL for `local`; the adapter and save route also accept model and key. A one-second silence test verifies connectivity, not intelligible speech. See `packages/adapters/src/speech.ts`, `packages/engine/src/speech-settings.ts`, `apps/server/src/routes/app/voice.ts` and `apps/web/src/components/VoiceSettings.tsx`.

CPU measurements support a useful path on the tested i7-11700K. They do not justify a minimum-CPU guarantee. CUDA results support GPU options, but timing boundaries differ between experiments. Qwen CPU preparation failed before inference and is not evidence of CPU incompatibility. The evidence appendix separates these facts from proposed release gates.

## Decision proposed

### One provider contract, two ways to obtain it

Extend the existing self-hosted owner's voice configuration with **Use my server** and **Set up on this machine**. Both resolve to the same `local` SpeechEngine. Keep PostgreSQL as the only required dependency and the existing hosted-provider options. Speech remains optional; the core starts without an accelerator, model, encoder or companion.

1. **Use my server:** URL ending in `/v1`, model and optional bearer key. Test from the app server and show its identity as the caller. Support private DNS and VPN destinations through the owner's explicit speech configuration; do not weaken URL protections for arbitrary agent tools or connectors. For a shared corporate endpoint, require server-to-server authentication and HTTPS or an explicitly administered encrypted private transport, quotas and bounded concurrency. Employees use the configured installation; separate self-hosted installations may configure that same endpoint. A single installation still has one speech configuration. Per-person and per-organization routing are outside the MVP.
2. **Set up on this machine:** an explicit installer on the chosen STT host inspects that host, proposes a supported model/device profile, obtains download consent, verifies pinned assets, starts a supervised service, and tests it from the app server before saving configuration. A browser cannot inspect a remote host's GPU. The wizard must name the inspected host and distinguish it from the browser and app server. The first installer target is Windows x64 CPU and compatible NVIDIA CUDA; Linux CPU packaging is a required follow-up before claiming server-wide installer support. Linux deployments keep their existing `deploy/speech` option and custom URL throughout. Other GPUs/OS targets remain unverified until packaged and tested.

Same-host uses loopback. A container's loopback is its container, not the desktop. An installer on another machine needs a deliberate private route from the app server; the wizard must fail with a topology explanation when that route does not exist. No automatic public tunnel, firewall change, VPN enrollment or browser-to-STT bypass. Do not repurpose an agent runner as a per-user audio relay in this MVP.

### Contract and service boundary

Keep `POST <base>/audio/transcriptions`, multipart `file`, `model`, `response_format=json`, optional `prompt`; success is JSON `{ "text": string }`. Do not force the interface language into Whisper's transcription language. `X-Agentes-Org` is a routing/accounting hint, never authentication or authorization. The corporate gateway authenticates each installation and checks which organization hints it may assert; it must never trust an arbitrary header as tenant identity.

Keep the core adapter portable: third-party servers need not implement health or hardware APIs. Managed companions additionally expose liveness and readiness (model loaded, actual backend, busy/queue state) through their authenticated control surface. Health alone cannot mark configuration validated: use a known speech fixture through the real transcription contract. Preserve recording limits, deadlines and failure mapping; distinguish silent input from speech the recognizer could not decode, so quiet speech is not silently discarded.

The companion owns model installation, decoding, VAD, device policy, execution limits and cleanup. The app owns authorization, encrypted credentials, provider policy, retained voice clips, retries and posting. Runtime output and transcript are data, never shell commands. No runtime library becomes a required dependency of the core server.

### Hardware recommendation and model policy

Detect OS/architecture, available and total RAM, CPU capabilities, free disk, GPU adapter, dedicated/free VRAM, driver and usable runtime. Record requested device separately from backend observed during a real load/inference. Unknown information stays unknown. Model manifests pin version, weights/quantization/hash, runtime/build, tested platforms, download size, license/notices and independently measured resource envelopes.

Apply a deterministic filter: supported OS/runtime -> required artifacts available -> disk and RAM/VRAM envelope with explicit safety reserve -> load probe -> short calibrated transcription. Recommend CPU when the supported CPU profile meets the published local response target; a GPU's presence does not win automatically. Offer **Recommended**, **Use less memory**, and an advanced CPU/GPU/model selector. Display actual measurements and remaining uncertainty. Resource estimates never promise quality or freedom from out-of-memory errors.

Use official NeMo/Nemotron Q8_0 CPU as the first candidate to harden, not an automatically shipped default: its observed balance is preferable to forcing a GPU. The current benchmark's low-volume and punctuation failures are blocking test cases for its wrapper. Whisper small Q5_1 remains the proven companion compatibility baseline; Whisper turbo Q5_0 is an optional quality candidate, especially for CUDA. Do not select medium automatically given its measured cost and lack of clear benefit. Ottema is experimental pending distribution/provenance review. Qwen is experimental GPU only until packaging, lifecycle and CPU evidence are available. Foundry is a measured resident reference, not a portable installer default. The existing Parakeet deployment remains supported; it was not rerun in this corpus and is not ranked here.

Profiles have `auto`, strict `cpu`, and strict `gpu` policies. Auto may retry on CPU once after GPU initialization/execution failure only when the CPU profile has passed readiness; terminate and clean up the GPU job first, respect the original deadline and show the fallback. Strict GPU fails visibly. Never silently switch model family, download weights, duplicate a job or send audio to a hosted provider. Existing provider-chain behavior remains unchanged for existing installations; a newly selected **local only** policy must explicitly prevent hosted hedging/fallback. Implement that policy before advertising that audio stays local.

### Installation lifecycle and privacy

Install only on explicit action, without administrator privileges where possible. Verify asset hashes and notices before execution; reserve space; atomically activate a complete model/runtime pair. Lock installation and startup per host/profile, recover interrupted downloads, and reuse a healthy service instead of duplicating it. Cancel closes child process trees and removes temporary audio. Stop/uninstall removes owned components only; shared runtime/model removal requires checking references. Pin upgrades, retain the previous working profile for recovery, and never change drivers automatically.

URL validation rejects embedded credentials, non-HTTP schemes and credential-bearing redirects. Private speech destinations are an owner-only capability, with explicit host/port scope, DNS/redirect revalidation and rejection of link-local/metadata endpoints. Keys remain sealed on the backend, excluded from URLs, views and logs. Ordinary diagnostics contain model/backend/status/duration, not audio, transcripts or filesystem identities. Model downloads are separate from inference: the installed profile must transcribe offline. External provider fallback is a separate, visible opt-in.

### Preserve voice-message behavior

ADR 0100 still stores audio first and posts the resulting voice message through the existing job. Preserve clientId idempotency, playable audio, retention and no-words outcomes. This setup feature does not silently convert voice messages into editable dictation. A later, separately specified dictation mode needs explicit review and manual send; quality evidence supports that work, but it is not a prerequisite to reviewing this setup proposal. Never rewrite names, negations, numbers or acronyms automatically.

## Alternatives considered

| Alternative | Reason |
| --- | --- |
| Custom URL only | Already largely exists; insufficient for people who cannot install and choose a runtime. Retain as first path. |
| GPU mandatory | Excludes CPU servers despite useful measured CPU behavior. |
| Choose by model size or VRAM alone | Ignores runtime, free memory, loading, quality and real response time. |
| Bundle every model in the app | Large optional assets, licensing and lifecycle burden; breaks optionality. |
| Browser calls localhost directly | Wrong network origin for the current server contract; remote clients and Docker differ. |
| Reuse corporate VPN with no endpoint auth | VPN membership and a user-supplied org header do not authorize a tenant. |
| Automatically correct ASR with an LLM | Unmeasured protected-token changes and potential external transfer; deferred. |

## Consequences and release gates

The feature can serve one person and shared corporate infrastructure without separate speech interfaces. It adds a maintained runtime catalog and supervisor, host-aware setup, endpoint diagnostics and a local-only policy. It does not promise arbitrary hardware or corporate multi-user throughput from a single-host benchmark.

Ship focused increments from the [PRD implementation plan](../specs/local-speech.md#implementation-plan). Before a supported installer release, validate assets/licenses, fresh install/restart/offline behavior, OOM/fallback/cancellation, quiet speech/silence, both network topologies and representative hardware including a smaller CPU-only host. Before corporate capacity claims, measure queueing and concurrent employees. This ADR is proposed documentation; it neither changes the active speech model nor accepts the architecture on behalf of maintainers.
