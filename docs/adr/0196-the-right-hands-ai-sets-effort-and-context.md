# 0196. The right hand's own AI sets the effort and the context window

**Status:** accepted (2026-11-16)

## Context

ADR 0137 §11 gives each person their own AI for their DM with the team's right hand: `right_hand_brains` holds the
brain, the model and the account, and `setPersonalBrain` saves them. The dialog that chooses it
(`RightHandBrainDialog`) showed the account in use and the model, and nothing else.

An agent's "Quem pensa" (`BrainDialog`) has, under the model, a "Mais opções" line with the effort and the context
window (ADR 0086). The right hand's own AI had neither: the effort was stored (`right_hand_brains.brain_effort`) and
used by the run, but no screen offered it, and the context window had no per-person column — `personalAgent` read the
right hand's own `agents.context_tokens`, and `setPersonalBrain` ignored `contextTokens`.

## Decision

1. **The person's own AI carries both.** `right_hand_brains.brain_context_tokens` (migration 0283) joins
   `brain_effort`; `setPersonalBrain` validates and saves them both, and `getAgentBrain` returns them for
   `scope: "mine"`.
2. **The run follows them.** `withPersonalBrain` puts `contextTokens` on the agent the executor and `resolveBrain`
   use, as it already did with the effort: the context budget (`fitContextWindow`) and the computer turn read it. A
   stand-in plan (`servingPlanFor`) has none and keeps its model's window.
3. **The same screen as an agent's.** `RightHandBrainDialog` gains a "Mais opções" line that opens a screen with the
   effort ramp and the context window, drawn from `BrainDialog`'s pieces and saving through the caller's `setBrain`
   on its scope. The workspace's AI, which is the right hand's `agents` row, keeps its own (already supported).
4. **The workspace's AI is untouched.** Its effort and window stay on the right hand's row; a person with no row reads
   them.
5. **The phone's advanced screen takes a scope**, so "Sua IA" reaches the same two settings; it hides the audience and
   fallback rows, which the person's own AI doesn't have.

## Consequences

- A person sets how hard their own AI thinks and how much it reads, for any plan, as on any agent.
- The values are per person and go with the row: back to the workspace's AI deletes them.
- The workspace's AI keeps one effort and one window for everyone without a plan of their own.
