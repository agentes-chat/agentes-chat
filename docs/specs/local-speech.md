# Local speech setup: product requirements

Status: Proposed, 2026-11-15. Decision: [ADR 0174](../adr/0174-local-speech-setup.md). Evidence: [benchmark summary](../local-speech/benchmark-summary.md).

## Problem and intended outcome

A self-hosted owner should configure speech using either an existing compatible service, including a corporate VPN endpoint, or a guided local installation that explains what the chosen machine can run. CPU-only hardware is a first-class path. The owner can see the recommended device/model, change it deliberately and understand unsupported configurations without learning model deployment commands.

The existing local URL provider is the foundation, not a new invention. Today its web form sends only a URL, while the backend accepts model/key. The app server calls STT and the setting affects the whole installation. A VPN on an employee's laptop alone does not give the app server access. Detection on that laptop does not describe a remote server.

## Personas and scope

| Scenario | Product behavior |
| --- | --- |
| Corporate self-hosted owner | Configure one authenticated VPN STT URL/model for employees; validate server reachability and isolate installation credentials. Employees need no model install. |
| Personal self-hosted owner | Run explicit setup on the selected STT host, inspect hardware, review downloads, install a recommended profile and run a speech test. |
| CPU-only server owner | Use the URL path or existing CPU speech deployment now; guided CPU setup on Windows x64 first, Linux CPU packaging next. Never claim Windows results predict low-power server performance. |
| Ordinary employee/member | Use voice under existing workspace permission/settings; cannot change the installation endpoint, download models or inspect another host. |

MVP includes both entry points, URL/model/key validation, host identity and hardware report, Windows x64 CPU/CUDA managed profiles, recommended/advanced choices, explicit installation, service lifecycle, speech verification and local-only versus explicit fallback policy. The CPU candidate must pass the runtime hardening gates before being labeled supported. An unavailable candidate is shown as experimental, never silently substituted.

Outside MVP: streaming UI, per-person or per-org provider overrides, automatic model tuning, diarization, LLM cleanup, corporate SSO/mTLS provisioning, arbitrary runner relays, public tunnels, driver installation, untested AMD/Intel GPU and macOS backends. Preserve existing Linux `deploy/speech`; guided Linux CPU packaging is the next increment. Editable pre-send dictation is a separate follow-up, not an implied change to voice-message send semantics.

## Configuration experience

In the self-hosted installation owner's existing Voice section, show **Use my server** and **Set up on this machine**, keeping hosted providers available. Explain once: “This setting serves everyone on this installation.” Use current shared design-system components, accessible labels, keyboard navigation and English/Portuguese translations.

### Use my server

1. Enter base URL (example `https://speech.internal.example/v1`), model and optional secret key. Say “Your agentes.chat server must reach this address; connect that server to the corporate VPN if required.”
2. Choose local-only or explicitly allowed provider fallback. Display every configured destination that might receive audio; local-only forbids hosted hedges as well as retries.
3. Test from the app server. Show connection, authentication, contract and known-speech checks separately. A generic compatible server does not need a `/health` route. Run the speech check with a bundled licensed nonpersonal fixture and known reference; a silent second is only a connection probe.
4. Save only after validation; failed edits keep the previous working configuration. Show caller host/topology, configured model and last successful test time. Do not claim an alias proves which weights a third-party service loaded.

Useful error text distinguishes DNS/VPN route unavailable, certificate, 401/403, busy, unsupported model, malformed JSON and deadline. Do not expose keys or server response bodies containing transcript data. Offer retry after the owner fixes routing; never create a tunnel on their behalf.

### Set up on this machine

1. Identify the intended STT host. Show browser host, app-server location and selected installer host distinctly. If no authorized installer is connected to that host, provide its signed/versioned setup command or downloadable helper, then resume its authenticated result; do not pretend the browser detected remote hardware.
2. Show OS/CPU, RAM available/total, disk space and each GPU's dedicated/free VRAM with backend compatibility. If a probe fails, say which capability is unknown. Container limits override physical host totals for admission.
3. Present one recommendation with why and confidence: “CPU candidate; measured on a different processor; this machine still needs a test.” Advanced choices show device/model, download size, verified envelope, language behavior and experimental/support status. No fixed RAM/VRAM table is claimed until the profile manifest has a tested envelope. Exclude profiles with inadequate free resources; unknown resources require a successful bounded probe before recommendation.
4. Before installing, show download bytes, destination host, runtime/model versions, notices, optional startup behavior and the chosen fallback policy. Explicit **Install** starts resumable download/verification/load/test progress; **Cancel** restores the previous working profile.
5. Run load and known-speech calibration. Show actual backend, cold-start and transcription time separately, peak memory and viability. Recommend CPU when it passes the proposed response target below; offer GPU when compatible and verified, never solely because a GPU exists. Verify app-server reachability before **Use this configuration** saves it.
6. Show ready, stopped, loading, busy, degraded CPU fallback, failed and unsupported states. Actions: test again, start/stop owned service, change profile, remove setup. A restart reuses one service. Uninstall preserves unrelated shared assets and requires a reference check before deleting shared weights.

If the app server is remote/Docker and cannot reach the selected host, explain exactly which network boundary failed and offer the URL path or setup on the app server. Do not claim setup is complete after a loopback test only.

## Model and viability policy

Use [the evidence](../local-speech/benchmark-summary.md) as measured priors, not universal defaults. Official NeMo/Nemotron Q8_0 CPU is the first hardening candidate; Whisper small Q5_1 is the existing contract baseline; turbo Q5_0 is an advanced quality candidate and CUDA pilot. Qwen remains experimental GPU; CPU unmeasured. Ottema and Foundry are evidence/reference options until distribution and portable lifecycle are validated. No Parakeet ranking: the deployed option was not tested in this same comparison.

Proposed calibration target, not an observed benchmark result: on a published fixture set of short notes, report **responsive** only if all calls complete correctly under the service contract, process/end-to-end RTF p95 <= 1 and post-upload p95 <= 10 seconds for notes of up to 10 seconds. Measure cold readiness separately. Otherwise show **works, slower** or **not ready**, preserving advanced owner choice when safe. A hardware admission check also needs the manifest's measured peak plus explicit reserve and a successful load; one RSS sample is not an installation RAM minimum. Publish the fixture version, repetitions, timing boundaries and measured host. Maintainers may revise the proposed target before implementation; it is not retroactively imposed on historical results.

Quality and speed are separate. Present measured WER by overall speech and human PT-BR subset, protected-token/punctuation risks and corpus limits in advanced detail. Do not label 1-WER as accuracy. Never silently replace names/acronyms or translate English because the interface is Portuguese. The existing voice-message flow posts after transcription; show its transcript/playback under ADR 0100. A future dictation flow must offer editable review and explicit send.

## Acceptance criteria and verification

| ID | Observable result | Verification required in implementation PR |
| --- | --- | --- |
| URL1 | Existing URL config migrates without behavior change; model/key fields work; only pinned owner can save. | Adapter/settings/routes tests for backward defaults, encrypted storage, nonowner denial and failed-save preservation. |
| URL2 | Authenticated private/VPN endpoint works from app-server namespace; employee browser need not reach STT. | Disposable two-host/container integration fixture; valid/invalid auth, DNS, VPN disconnected and certificate failures. |
| URL3 | Endpoint test separates connectivity from real recognition. | Silent probe success with garbage speech output must fail speech validation; JSON without string text and wrong-model response fail clearly. |
| URL4 | Endpoint is scoped, not a general network probe; no secret URLs or redirect leaks. | Owner authorization, scheme/userinfo/metadata rejection, DNS rebinding and cross-host redirects with credential stripping/refusal tests. |
| HW1 | Hardware report refers to the selected host, preserves unknowns and respects container/free-memory limits. | Deterministic fixtures: CPU only, unsupported GPU, missing CUDA DLL, low RAM/disk, busy VRAM, probe denied and Docker limit. |
| HW2 | Recommendation uses manifest + actual load/test and explains CPU/GPU/model choice. | Fixtures where CPU meets target despite a GPU, CPU is slower, unsupported backend, envelope/reserve insufficient and model missing; no auto selection of experimental model. |
| INS1 | Explicit install verifies pins/notices and never runs partial/unverified assets. | Fresh nonadmin host; corrupt hash, canceled download, no disk, interrupted activation, restart and concurrent install attempts. |
| INS2 | Exactly one owned service starts; offline speech works after install. | Repeated start/reconnect/reboot; network disabled after assets acquired; stop/uninstall/refcount checks. |
| RUN1 | Actual backend is visible. Auto can fall back to ready CPU once; strict GPU errors visibly. | GPU load/ASR failure, CPU OOM, child cleanup, deadline exhaustion; assert no overlapping inference or silent model/download change. |
| RUN2 | Limits are coherent: up to 300 s decoded audio, 25 MiB file plus 64 KiB multipart allowance; no silent truncation. | Empty/invalid/MP4/WebM/WAV, exactly 300/300.1 s, upload boundary, decode limit and child crash. |
| RUN3 | Bounded queue, cancellation and deadlines prevent stuck jobs; cleanup finishes before slot reuse. | 429/503, timeout and canceled child process trees; valid call after each failure; whole-job deadline compatible with adapter 30 s + 2x duration. |
| PRIV1 | Local-only sends no request to hosted providers, including hedging; fallback is explicit. | Instrument every engine call during local busy/refused/timeout/failure; fresh policy defaults local-only, old settings retain old semantics. |
| VOICE1 | Existing clientId retry posts once; failed recognition retains playable audio/no-words semantics; low speech isn't treated as proven silence. | Voice job tests for retries/exhaustion and retention; public quiet/noise/zero fixtures; exact-zero skips ASR, quiet speech refusal preserves recording. |
| QUAL1 | Scores and protected-token failures remain visible; no semantic rewrite or forced PT translation. | Frozen corpus regression including identity, ADR/DR, time, values, negation, punctuation and mixed language; listen to licensed human samples separately. |
| UX1 | Owner can finish each path and recover an error with keyboard and screen reader labels. | Web/desktop configuration tests in en/pt-BR; mobile reads resulting status; native mobile setup control deferred. |
| OPT1 | Core starts without STT assets; no schema/env convention violations. | No-engine boot, existing speech tests, config schema/env docs if new variables; new migrations only if needed. |

## Architecture and data changes

Browser/native settings -> authenticated app configuration/control routes -> speech settings/policy -> existing engine voice job -> SpeechEngine -> custom endpoint or managed companion. Audio continues to use existing clip storage/outbox. No browser direct-to-localhost transport is added.

Extend the existing sealed instance speech record with versioned mode, configured model, companion profile reference and provider-fallback policy; read older records with existing behavior. Control state contains requested/observed device, manifest revision, last test/status and diagnostics without secrets. Companion host authorization is independent of organization membership: only the installation owner and explicitly authorized host operator install/start/stop. A paired helper must use a short-lived authenticated pairing flow and narrow speech-control capabilities; it must never accept arbitrary shell from a page. Final persisted schema changes require a separate implementation ADR/migration review if they extend beyond the sealed record.

Keep probing, runtime manifests and lifecycle logic separate from the adapter. Enforce isolation, concurrency and corporate quotas at the endpoint; the organization header is not a security boundary. If environment settings include hosted engines, new local-only configuration filters them before the voice job selects/hedges providers. A readiness check must not overwrite pending voice jobs or replay posted messages.

## Implementation plan

| Increment | Change and likely code | Exit evidence |
| --- | --- | --- |
| 0: proposal | This PR: proposed ADR, PRD and sanitized evidence. | Document/links/numeric provenance checks; maintainer agreement before larger implementation. |
| 1: endpoint setup | `VoiceSettings.tsx`, shared client contracts, server `voice.ts` configuration routes, `speech-settings.ts`, `speech.ts`; model/key form and safe tests. | URL1-4; preserve current chain and settings. |
| 2: local policy and control contracts | Versioned sealed config, policy resolution before provider hedging, typed companion status/manifest and narrow helper pairing. | PRIV1, HW1 fixtures, old/new record compatibility and authorization tests. |
| 3: CPU installer | Managed runtime outside core, Windows x64 CPU candidate, asset/license manifest, resumable installer and supervisor. | INS1-2, RUN2-3, QUAL1; fresh-host offline evidence. Do not label NeMo supported until quiet/punctuation cases are reviewed. |
| 4: CUDA and recommendation | Backend probes, free VRAM/reserves, calibrated recommendation and strict/auto policies. | HW2, RUN1; repeat on tested NVIDIA and a CPU-only smaller host; no driver modifications. |
| 5: UI and topology completion | Host-aware two-path wizard, progress/status/error recovery, translations, server-namespace integration. | UX1, URL2, VOICE1, OPT1; complete product acceptance. |
| 6: server reach and capacity | Guided Linux CPU packaging, corporate concurrent load, optional additional profiles. | Real hardware/throughput evidence before expanding claims. |

Each increment is a focused PR with its own tests and verification instructions. This documentation PR installs nothing. Release checklist: clean-directory install, model license/notices review, offline smoke, host/container/VPN matrix, model-load/OOM fallback, pending-job idempotency, observability without content, CPU-only trial and separately reported quality/latency. Review against CONTRIBUTING and run lint, typecheck, affected tests and boundaries; production-runtime PRs also run the documented build/image checks.

## Open evidence gaps

No minimum RAM/VRAM or general CPU performance guarantee; no corporate concurrency benchmark; no CPU Qwen result; no matched CPU/CUDA end-to-end speedup study; no spontaneous human PT/EN or broad Portuguese speaker coverage. Historical GPU review is separate from final CPU recovery scoring, whose receipt still marked parent review pending. New installer acceptance cannot inherit prototype readiness or a single successful long-recording request. These are bounded follow-up measurements, not invented completed results.
