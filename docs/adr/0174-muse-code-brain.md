# 0174: A Muse Code brain

- Status: proposed
- Date: 2026-11-12

## Context

Every brain here is somebody else's coding agent, driven from a machine, and the shape of each was decided by what
its CLI offers: an argv, a stream to parse, a token that expires. Muse Code is Meta's agent for the terminal, and it
is the first one to publish a protocol — so the only question worth an ADR is which of its two faces to drive.

What the binary says about itself, measured on 1.4.18 (`1.4.18-R8587.1`): `muse exec "<prompt>" --json` runs one
prompt headlessly and emits the session's event log as JSONL (`payload_type` `run.output.delta`, `item.*`,
`run.terminal.completed`, `run.usage`; exit `0`/`1`/`2`/`130`). `muse serve` runs the same event vocabulary as the
**MSP** request/response protocol over stdio, and `muse schema generate-json-schema` exports it offline. `META_API_KEY`
authenticates; a browser or device-code sign-in is the interactive path. Approvals are on by default
(`--approval-mode`, an LLM judge, an OS sandbox that refuses to start if it cannot enforce its boundary), and an
`elicitation`/`request_user_input` reaches the client as an event it must answer.

Two other products already integrated it, and both independently chose `serve`:

- OpenBot (`src/backend/muse-client.ts`, `muse-login.ts`) speaks MSP directly over the official `@muse-code/sdk`,
  with `session/start`, `turn/start`, `turn/interrupt`, `turn/steer`, `approval/request`→`approval/decide`,
  `item/{started,delta,completed}`, `view/{page,gap}`, `model/list`. Its sign-in is a device code obtained from a
  `serve --disable-shell --disable-write` host with `META_API_KEY` removed from the environment so a saved key cannot
  sign in for the person.
- OpenMausBot (`server/drivers/muse-code.ts`) speaks the same protocol, and injects its own stdio transport because
  the SDK's `spawnMspConnection` spawns outside the sandbox and home it needs the process in.

## Decision

We drive `muse serve` over MSP, one host per run, and add the ninth brain.

`exec --json` stays as the documented fallback and the parser is the same event vocabulary either way — but `serve`
is what the product needs: it can **park an approval and answer it**, which is the exact gap our Claude Code brain
still has (`REFUSED_ELICITATION`, ADR-adjacent fix in flight), and it lists models, reads history and interrupts a
turn. A one-shot process cannot.

### Protocol 59

`brain.turn` takes `kind: "muse"`; `account` takes `kind: "muse"`; `hello.executors.muse` reports the CLI, its
version and the models `model/list` returns; `access.tools.muse` turns it on or off. A `chat` turn is checked on a
machine like the others.

### The process is ours, not the SDK's

`spawnMspConnection` starts `muse serve` with its own `child_process.spawn`: no cgroup, no agent home, no PATH from
the runner. The host is spawned by the runner like every other brain (`scope-gate`), and only the framing is taken
from the SDK — OpenMausBot's `stdioTransport` is the model for that.

Arguments: `serve --trust-workspace`, plus `--disable-sandbox` at the `yolo` level and nothing else. The sandbox is a
host-construction decision the wire cannot change ("neither is negotiable over the wire"); the approval mode is the
other way round — "it is selected on the wire, so there is no approval flag here" — so `yolo` sets `allowAll` and
every other level `promptUnmatched` on the request, not on the argv. Shell and write stay on: the agent's own command
policy is the engine's (ADR 0053 §3), not Muse's.

### Approvals are the point

An `approval/requested` becomes the agent's approval card, and the person's answer maps back to a `choiceId` the
server offered — never a decision string of our invention: the narrowest `approved` for "once", `approvedForSession`
for "always", `denied`, else `abort` where a shell ask offers no deny. `approval/decide` then carries `choiceId`.

### Items, and what must not leak

`item/*` maps to `tool_call`, `text` and `summary`; cells carry `revision`, and an item at a revision we already have
is skipped. Streamed deltas are redacted with the held-suffix algorithm OpenBot uses (`#streamDelta`): a secret split
across two deltas leaks on the first if each chunk is redacted alone. `view/gap` means a lost page and a resync from
`view/page`, not a dropped line.

### Sign-in

A device code from `serve --disable-shell --disable-write`, `META_API_KEY` deleted from that host's environment,
`hooks={}` and `managed_hooks_path=null` so no hook of the machine executes during a sign-in. `MUSE_NO_AUTO_UPDATE=1`
always: the runner owns the version, and Muse upgrades itself otherwise. Stored like the other keys, sealed.

### Not now

- **Subagents and workflows.** One turn, one host. Its own children are its business until the mapping shows
  otherwise.
- **`--output-schema`** on the route path (`brain.route`), and `session/compact`.
- **Windows**: `serve` works, but the process and PATH handling needs its own pass.

## Consequences

- **A long-lived host per run** is supervision the other brains do not have: shutdown ordinals, an idle bound, and a
  kill tree on the way out. It also means a turn can be steered and interrupted instead of only killed.
- **The event vocabulary is versioned** (`schema_version`), and `muse schema` lets a runner check it instead of
  guessing. A version is parsed from `muse --version` (`\d+\.\d+\.\d+-R\d+`) and reported; below a floor the brain
  is refused, as with the other CLIs.
- **Fourteen locale files** for the name and the switch, as with every brain.
- **The account is a Meta account**, and Meta Managed Accounts cannot use the browser flow at all — an API key is
  their only path, so the key form is not a fallback here, it is a supported first-class option.
- **Cost is the person's**, with no plan table to learn from: the usage payload carries per-model call counts and
  token counts, but nothing tells us the shape of a subscription window.
- **Skills are shared ground**: Muse reads `~/.claude/skills` and `~/.codex/skills` by default, so a machine with
  Claude Code already hands our skills to Muse for free — and `--no-foreign-personal-context` is what keeps a private
  rule from travelling when it must not.

## Open questions

- Whether the host survives between turns of one run (one per run, or one per session) — the SDK model suggests one
  per session, which changes the supervisor work substantially.
- What a `turn/completed` with status `failed` carries per cause; only the success path was read.
- Whether `--workspace` replaces a `cd` into the agent's folder, or both are needed.
