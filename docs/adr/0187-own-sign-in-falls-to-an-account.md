# 0187. An agent with no account picked thinks with a connected account where the computer has no sign-in of its own

- Status: Accepted
- Date: 2026-11-15
- Code: engine `packages/engine/src/brains/select.ts` (`brainAccountFor`, `ownSignInStandIn`, `ownSignInProven`);
  client `packages/client/src/lib/brain-picker.ts` (`modelPickerTiles`); tests
  `packages/engine/test/own-sign-in-stand-in.test.ts`, `packages/client/test/brain-picker-lib.test.ts`

## Context

An agent on a plan (Claude Code, Codex, Gemini through Antigravity…) thinks with one of the accounts connected on its
computer (ADR 0041), or with no account: "the computer's own sign-in", the CLI signed in at that computer's terminal
(ADR 0059 §3).

On a server whose CLIs think only through connected accounts, that own sign-in doesn't exist. Picking a plan's model in
the chat header's picker could still leave an agent there: the picker listed "Conta deste computador" for every CLI the
computer runs, with no usage known it sorted first, and a pick took the first. In one afternoon seven agents of one
workspace moved to Gemini that way. Then every turn failed `not_logged_in`:

- a person's message fell back, unannounced, to the agent's API key, while the header said Gemini;
- a routine failed for good with `no_ai` (`not_signed_in`), since background work never falls back (ADR 0053 §6.4),
  and paused itself after five failures in a row.

## Decision

1. **The engine** (`brainAccountFor`, `ownSignInStandIn`). An agent with no account on its own computer thinks with a
   connected account of the same CLI there when the computer never proved its own sign-in (`ownSignInProven`: Claude
   Code's `claude auth status`, or a usage read of that CLI's own plan, the only two things a runner reports) and such
   an account may think for the agent (it serves everyone, or it is the agent's owner's, its owner still a member).
   The owner's accounts come first, then the oldest. Turns, tasks, the AI status and the usage rows all see that
   account, so a routine runs and its usage is counted on the account that did the work. Not on a computer where each
   agent is its own OS user (system mode): there the computer hands each worker the one account it was given.
2. **The picker** (`modelPickerTiles`). "Conta deste computador" is offered in a tile only when the computer proved
   that sign-in, when the agent thinks with it now, or when the tile has no account to offer; and connected accounts
   sort before it.

An agent whose computer did prove its own sign-in keeps thinking with it, as before.

## Consequences

- An agent saved with no account on a server like this one thinks with the account its owner connected, without
  anyone opening its settings.
- A CLI signed in at the terminal and never reported (any CLI but Claude Code and Codex, which report usage) is passed
  over for a connected account when there is one: both are that computer's people's, and the connected one is the one
  the workspace can see and count.
