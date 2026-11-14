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

Arguments: `serve`, plus `--disable-sandbox` at the `yolo` level and nothing else. No `--trust-workspace`: measured
against 1.4.18, the flag alone loads nothing (the workspace only loads when a session declares `workspaceRoots`, which
this brain does not), and with a root declared it is what makes a cloned repo's `.muse/hooks.json` run a command as the
host itself, outside the shell sandbox. The sandbox is a
host-construction decision the wire cannot change ("neither is negotiable over the wire"); the approval mode is the
other way round — "it is selected on the wire, so there is no approval flag here" — so a level nobody answers needs `allowAll`
(a value the wire has; `never` is not one), and `promptUnmatched` is for when approvals are wired.

The levels are four, and only two of them are a posture:

| Level | How |
|---|---|
| `plan` | `--disable-write --disable-shell` (measured: the run completes) |
| `work` | the default: shell and write on, approval on |
| `chat` | `--disable-write --disable-shell` and `denyUnmatched`: its own Bash and Write are refused, the bridge's tools run |
| `yolo` | `--disable-sandbox` |

A named profile (`--permission-profile`) is **not** the path: `read-only` is a display name, not an id — the binary
answers "profile does not exist" — and `-c permissions.default_profile=…` refuses until the settings document carries
`schema_version` ("Named permission profiles are unavailable: missing field `schema_version`"). Its values are JSON
too: `-c permissions.default_profile="read-only"`, never a bare string.

### One host per session, never per turn

**Chosen; the first implementation is one host per turn** (the session id is still kept and resumed, so the thread
survives across hosts). The rest of this section is what moving to a held host costs and why it is the shape to
grow into.

Neither product that integrated this opens a process per turn, and their code says so plainly: OpenBot keeps one host
per agent and multiplexes every session over it, guarding teardown with `canReleaseProcess` — false while any thread
has a turn — so `releaseThread` answers `museBusy` instead of killing a live one. OpenMausBot keeps a host on the
thread and reuses it while `host.key` matches, where the key is the posture plus the MCP set, starting a fresh host
and resuming the same session when either changes.

We take OpenMausBot's shape, because our runner is a process per request and the session is the thing that outlives
it: a host belongs to a session, is reused across its turns, and is remounted — resuming by session id — when the
posture or the MCP set moves. On release the view is unsubscribed first (`view/unsubscribe`), then the host closed;
while a turn runs the release is refused, never forced. Idle teardown is bounded, and the kill tree is the fallback.

### The wire, as measured

`initialize` → the `initialized` notification → `session/start` (or `session/resume`) → `view/subscribe` →
`turn/start`, NDJSON frames of JSON-RPC 2.0, every command carrying a **UUIDv7** (`expected UUIDv7` otherwise).
`clientInfo.name` must be `^[a-z0-9_]+$`. Approval modes are `allowAll`, `promptUnmatched`, `onRequest`,
`denyUnmatched` — there is no `never`. A turn's text is `item/delta` on field `text`; its calls are `item/*` of kind
`toolCall`; it ends at `turn/completed`.

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
- **`session/compact`.**
- **The route path.** `--output-schema` exists, contrary to the docs, but refuses under `--provider echo` ("the
  provider does not send the text.format json_schema block") and is `meta`-only, so it needs a keyed account to test
  at all.
- **Windows**: `serve` works, but the process and PATH handling, PowerShell in place of Bash and the first-run UAC
  prompt need their own pass.

## Two defaults nobody asked for

- **Contributor mode is on for subscriptions**: the workspace's code goes to Meta as training data. Every turn carries
  `--contributor-mode off` (or `MUSE_CONTRIBUTOR_MODE=0`), and the switch is stated in the UI as ADR 0142 §7 does,
  rather than living only in the CLI's docs.
- **Four background observer agents are on by default** and make **their own model calls** — the docs say they add
  token usage, so the person's allowance pays for advice nobody read. The account's settings document exists and
  carries `schema_version: 1`, but the key that turns the observers off is not written yet: that part of the claim is
  still open.

## Consequences

- **A long-lived host per run** is supervision the other brains do not have: shutdown ordinals, an idle bound, and a
  kill tree on the way out. It also means a turn can be steered and interrupted instead of only killed.
- **The sandbox is a prerequisite, not a preference.** On Linux a working `bubblewrap` on a non-musl build is what
  makes every shell command run at all; without it the turn dies on its first command. The runner image must have it
  before the brain is offered anywhere.
- **The installer does not pin.** It writes a launcher that upgrades itself, so a version can change under a running
  parser: the image pins the binary and every host carries `MUSE_NO_AUTO_UPDATE=1`.
- **`mode` is not on the wire.** The typed session arm has no `required` marker; the bridge coming up (or not) shows as
  the turn's own failure.
- **Hooks run outside the sandbox.** A trusted workspace's `.muse/hooks.json` executes through the shell with only a
  cleared environment. Two guards: the account's settings keep `hooks={}` and `managed_hooks_path=null`, and the host
  is started without `--trust-workspace`, so nothing of a cloned repo runs today.
- **The bridge is handed over on the wire.** `session/start` takes `config.mcpServers`, a closed union needing
  `transport` and typed on each arm, and it is what an MSP client adds a server with; a `capabilities.requestedCapabilities`
  of `sessionMcp` in `initialize` is required first, or the start is refused. The settings document keeps the account's
  ground (`schema_version`, `hooks`), and a server declared in *both* is a name conflict, so ours lives only on the wire.
  The entry's fields are literal — a `${VAR}` placeholder is expanded in its `env` but **not** in its `args`, so a
  `--run ${AGENTES_MCP_RUN}` reaches the bridge as that text, which prints its usage and exits and is reported as
  "the transport closed unexpectedly". Two near-misses cost a lot to find and are worth writing down: the settings key is `mcpServers` (not Codex's
  `mcp_servers`) and the settings arm is tagged `type` while the wire arm is tagged `transport`, with neither spelling
  valid in the other place. Measured: the wire form spawns the server (`initialize`, `tools/list`) and a call runs.
- **`muse usage` answers without a turn** (window, weekly use, reset, tier, since 1.4.13): the plan figures come from
  it rather than from a learned table.
- **Where the credential rests is undocumented**, only "stores the credential for you", with no config-directory
  variable. So the account is a key in `META_API_KEY` under the account's own `XDG_CONFIG_HOME`, the variable is
  dropped from an inherited environment, and its value is redacted on the way out — as `OPENCODE_KEY_ENV` already is.
- **The event vocabulary is versioned** (`schema_version`), and `muse schema` exports it offline, so a runner checks
  the surface instead of guessing. A version is parsed from `muse --version` (`\d+\.\d+\.\d+-R\d+`) and below a floor
  the brain is refused, as with the other CLIs.
- **Fourteen locale files** for the name and the switch, as with every brain.
- **The account is a Meta account**, and Meta Managed Accounts cannot use the browser flow at all — an API key is
  their only path, so the key form is not a fallback here, it is a first-class option.
- **Skills are shared ground**: Muse reads `~/.claude/skills` and `~/.codex/skills` by default, so a machine with
  Claude Code already hands our skills to Muse for free — and `--no-foreign-personal-context` is what keeps a private
  rule from travelling when it must not.

## Open questions

- What a `turn/completed` with status `failed` carries per cause; only the success path was read.
- Whether `--workspace` replaces a `cd` into the agent's folder, or both are needed.
