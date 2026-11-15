# Local speech: measured evidence and limits

Snapshot: 2026-11-15. This is a sanitized synthesis of existing CPU and CUDA experiments, not a new inference run. Selected source aggregates and source-file SHA-256 values are in [benchmark-summary.json](benchmark-summary.json). It supports a proposed setup feature, not a claim of production readiness or a universal model winner.

## Corpus and hardware

The frozen manifest has 49 cases, 436.27425 seconds: 36 synthetic speech recordings, 10 public human read-speech recordings, two derived controls and one exact-zero silence. The earlier GPU presentation counted the 39 nonhuman cases together; that is not 39 independent spoken samples. Speech scoring uses 48 cases and 826 reference words; human PT-BR is eight FLEURS cases and 208 words. The two English LibriSpeech clips share a speaker/chapter. The derived quiet/pause controls are not independent speech samples. No spontaneous human PT/EN conversation or personal speech is included.

Manifest SHA-256: `e6bc566a14a5a1f022a77b7722680b832ad3cb2c400c9d585e582b53a34c41a0`. Publisher references were checked against files/sample counts, not independently listened. Selected FLEURS rows are labeled male; speaker diversity is unknown. Public source attribution/license records remain with the original corpus archive; no audio is redistributed in this documentation patch.

CPU host: Windows x64, Intel i7-11700K, eight physical cores/16 logical processors, 34224816128 bytes total physical RAM. Native CLIs requested eight threads. CUDA host: RTX 3070 Ti, 8192 MiB dedicated memory, recorded driver 621.14. Other applications, OS cache, clocks and thermal state were not controlled. These measurements do not establish behavior on every CPU, GPU, VM or server.

## CPU raw auto results

Source report timestamp: 2026-11-14T01:42:18.865Z. Native queue: 1469 measured calls out of 1470 planned, one medium attempt interrupted without a result; 294 pre-existing Foundry calls reused. CPU Qwen has zero inferences. Each of auto and pt planned three repeats of all 49 cases. The table uses the first complete speech repetition per cell, medium auto repetition 2; it does not select the best repeat. Timings use the available cell calls, not only that selected repetition. Forced-pt rows are retained in the original report; auto is shown because forcing Portuguese translated English in small/medium.

| Model | Auto calls | Overall WER | Human PT-BR WER | Median process wall s | Median RTF | Sampled peak RSS MiB |
| --- | --- | --- | --- | --- | --- | --- |
| whisper-small-q5_1 | 147/147 | 133/826 (16.10%) | 14/208 (6.73%) | 4.930 | 0.730 | 520.371 |
| whisper-medium-q5_0 | 146/147 | 112/826 (13.56%) | 13/208 (6.25%) | 13.623 | 2.041 | 1176.074 |
| whisper-large-v3-turbo-q5_0 | 147/147 | 85/826 (10.29%) | 9/208 (4.33%) | 20.728 | 3.091 | 855.836 |
| nemotron-official-q8_0 | 147/147 | 103/826 (12.47%) | 20/208 (9.62%) | 2.376 | 0.358 | 908.840 |
| nemotron-ottema-q8_0 | 147/147 | 88/826 (10.65%) | 24/208 (11.54%) | 2.653 | 0.399 | 976.441 |
| foundry-generic-cpu3 | 147/147 | 125/826 (15.13%) | 23/208 (11.06%) | resident; separate below | not comparable | 1057.422 |

Native Whisper uses whisper.cpp 1.9.2 with explicit CPU (`-ng`); NeMo/Nemotron uses NeMo-Speech.cpp 0.3.0 CPU. Q5_1/Q5_0 are the tested Whisper formats; NeMo Q8_0 files contain mixed tensor types, not exclusively eight-bit tensors. Foundry uses FoundryLocalSDK 2.2.1 ONNX CPUExecutionProvider, catalog generic-cpu:3; the quantization bit width was not independently established.

Native wall is immediately before process spawn through exit and includes model load, ASR and process output. It excludes external hash/review/coordinator serialization. RTF is process wall divided by PCM audio duration; the reported value is the median per-call RTF, not a ratio of sums. These are fresh processes with uncontrolled OS cache, not resident sessions or disk-cold starts. NeMo blocks were fed ASAP, not paced in real time.

RSS is sampled working set, not required installation RAM, model-only memory or an allocation cap. Native sampling requested 50 ms and had measured gaps; Foundry sampled Node+SDK at 100 ms with larger event-loop gaps. Some instantaneous CPU-host percentages exceeded the host's physical 100% ceiling, an unresolved sampling anomaly; do not interpret those values as real utilization. They are deliberately not used for hardware recommendations.

Official NeMo CPU auto had process-wall p95 6.159 s. Its median 2.376 s and RTF 0.358 motivate hardening it as a CPU candidate; low-volume/punctuation failures still require attention. Ottema has lower overall lexical WER but worse observed human PT-BR and mixed-language subsets than official. Turbo has the lowest CPU overall WER here and costs substantially more wall time. Small/medium forced pt are unsuitable as a default for mixed-language transcription.

## Foundry resident session is a different measurement

Auto: median session 6700.763 ms; first partial 1374.704 ms after feed start; final text 136.838 ms relative to audio end; stop-to-drain 114.351 ms. The SDK feeds audio in real-time 256 ms chunks. Session wall includes feed/stop/drain/dispose and is not compute-only RTF. Loading was separate by segment. Auto and pt both resolved to simulated pt-BR; identical outputs do not prove autodetection. English synthetic clips sometimes returned empty. The first six calls retain a pause-attestation gap; configuration/catalog changed in the model-info artifact between segments even though checked weights/config/license identities matched. Do not infer any provider on a corporate laptop from this result.

## Historical CUDA raw auto quality

| Model/system | Overall WER | Human PT-BR WER |
| --- | --- | --- |
| whisper/auto | 131/826 (15.86%) | 13/208 (6.25%) |
| whisper-medium-q5_0/auto | 106/826 (12.83%) | 13/208 (6.25%) |
| whisper-large-v3-turbo-q5_0/auto | 86/826 (10.41%) | 9/208 (4.33%) |
| qwen-Qwen3-ASR-0.6B/auto | 64/826 (7.75%) | 15/208 (7.21%) |
| qwen-Qwen3-ASR-1.7B/auto | 53/826 (6.42%) | 10/208 (4.81%) |

Historical median-of-case-median times: Whisper small 987.67 ms, medium 1355.45 ms, turbo 1248.68 ms; Qwen 0.6B 1565.78 ms and 1.7B 1598.89 ms. Whisper times include process/model load; Qwen is resident synchronized ASR excluding reading/conversion/loading. This is not an equivalent end-to-end latency ranking. The newer CPU wall boundary also differs from historical coordinator end-to-end boundaries; no CPU/GPU speedup ratio is justified.

Whisper CUDA total-device sampled peaks were 3222/3693/3473 MiB for small/medium/turbo. Qwen total-device peaks were 5556/7616 MiB, whereas peak PyTorch allocated memory was 1907.2/4303.1 MiB. Other processes are included in device totals, and the Qwen 0.6B peak spans several test cells. None is a portable VRAM minimum; the 1.7B test left limited margin on the tested 8 GiB device. Runtime/model hashes and revisions are archived with the source experiments. CUDA identity was confirmed in runtime execution, not inferred from a GPU flag.

The historical official NeMo Q8_0 Vulkan experiment is contextual only: different backend/format/feed and wall boundary. No Vulkan number is silently combined with this CUDA table or native CPU timings.

## Quality risks and decision

WER is Levenshtein word edits divided by reference words; CER uses the normalized characters including single spaces. Normalization is NFKC/casefold, punctuation/symbols to spaces, collapsed whitespace and preserved accents. Digits and number words are not canonicalized. WER does not measure semantic correctness, punctuation or personal suitability; 1-WER is not accuracy.

All compared systems damage the identity contrast in the names fixture. Small/medium can change “três e meia da tarde” to 13h30; the official CPU output is malformed rather than a verified 15:30. In the punctuation fixture, “O teste passou? Não. Salve o rascunho...” becomes “O teste passou. Não salve...” in official auto: low lexical WER hides a reversed instruction boundary. Official CPU and Foundry lose low-volume speech; Whisper corrupts it. Raw Whisper generates text on exact-zero silence. One zero fixture does not cover arbitrary noise; preserve a tested VAD/silence strategy without dropping uncertain speech.

Recommend official NeMo Q8_0 CPU as the first profile to harden for a responsive local option, Whisper turbo Q5_0 as an advanced quality/CUDA candidate, and small Q5_1 as the established companion-contract baseline. This is a development recommendation, not a model switch. Keep optional review-oriented dictation as a separate follow-up. Do not perform global name/acronym replacement or LLM cleanup. Qwen's lower CUDA lexical WER is promising, but lifecycle/packaging and memory limits remain. CPU preparation failed before loading Qwen weights: not benchmarked, not ranked, and not declared CPU-incompatible. Parakeet's existing deployment was not rerun here and is not ranked.

## Verification, limitations and release work

Final CPU receipt reports 1763 scored cases, 720 aggregates recalculated with a separate implementation and zero mismatches; 20 scoring fixtures and 19 checkpoint fixtures passed. Its hash verification reports zero mismatches. This was recovery by the same executor, not a new independent listener or inference reviewer; parent review was still pending in that receipt. Two early NeMo attempts have delayed hash-attestation caveats, and the interrupted medium key remains missing rather than invented or replayed.

Historical GPU review separately checked score aggregates, corpus/model/CLI hashes and transcript outputs. Its larger-Whisper subset reproduced ten sequential CUDA outputs with no text differences; earlier Qwen subsets reproduced forty calls. These checks do not add human speaker diversity or auditory reference review. The original archive retains runner-fix and encoding corrections; no new inference was required for those corrections.

This JSON is a selected-aggregate snapshot, not the full raw evidence bundle. Preserve source names/hashes to identify the archived inputs. A reviewer can recompute the displayed ratios from numerators/denominators here; full independent ASR/scorer reproduction additionally needs the licensed corpus, pinned runtimes and original per-call records, to be packaged separately before implementation claims. Do not publish private recordings, machine usernames, conversations or service logs.

Before supported release: test fresh installs, licenses/notices, smaller CPU-only hardware, sustained memory/VRAM and OOM, noise/quiet speech, authenticated host/container/VPN reachability, queued concurrent employees, GPU failures/CPU fallback and comparable end-to-end latency boundaries. A single successful long-audio service request is a functional smoke test, not an additional comparative benchmark. No numerical minimum RAM/VRAM, portable speed guarantee or corporate throughput claim follows from this evidence.

Primary upstream runtime documentation: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR). Their upstream capabilities are not substituted for the pinned local test results.
