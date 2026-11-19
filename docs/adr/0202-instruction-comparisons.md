# 0202. Compare instruction drafts without applying them

## Context

The instruction editor already shows textual differences. A small set of saved examples can also expose behavioral regressions before an administrator applies a draft.

## Decision

Add an optional comparison beside the existing instruction diff. Store synthetic examples and comparison history per workspace and agent, protected by the instruction management permissions. Applying instructions remains the existing save action.

API models use the Model Gateway. Claude Code and Codex subscriptions use the selected integrated account through the isolated `brain.route` executor, on computers explicitly advertising `instructionTests`. Existing runners stay unavailable until updated; no release version is changed by this feature. The comparison preserves the selected model and frozen effort, uses a temporary folder, disables native tools and custom configuration, and keeps no session. No production chat, memory, skills or MCP connection is loaded. Each side receives the same frozen role, workspace context and example, differing only in instructions.

Before every subscription call, a metadata-only quota probe must explicitly confirm that extra paid usage is disabled (Claude) or no credit balance or unlimited credit billing is available (Codex). Missing evidence, exhausted quota, API credentials, busy accounts and changed configuration stop the comparison without retrying or selecting another account, model or API. Comparisons use the selected integrated account, or the configured local sign-in only when the agent owner paired that non-system computer. Both paths require the same quota evidence. This preflight cannot prevent someone changing provider billing settings concurrently; provider-side paid usage should remain disabled.

The evaluator receives the outputs as data with predeclared criteria and no tools. Hide candidate identities, randomize the first side, alternate across examples and accept an inconclusive result. The UI reports the scope of the examples and the limits of the evaluation instead of a general reliability score.

Use the existing outbox's long-job lane, Model Gateway accounting, rate limits and budgets. Persist the execution claim and cancellation fence. Recovery after an ambiguous interrupted call reports interruption rather than repeating potentially paid calls silently. Save partial responses and accounted usage when a later evaluation fails.

## Consequences

The feature evaluates textual responses under the stated fixed context, not the full production agent or a real integration. API usage may incur provider charges. The person's configured model is preserved, and unavailable executors are explained in the editor.

Users can remove saved examples and comparison records. A new executor requires independent proof of containment, including native tools, authentication, asynchronous work and cancellation. An instruction comparison is optional, and neither running nor passing it changes the active instructions or tool approvals.
