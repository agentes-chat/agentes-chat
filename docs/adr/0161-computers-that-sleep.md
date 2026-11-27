# 0161. The workspace's computer sleeps when nobody uses it

- Status: Accepted. Amended 2026-11-27 (the addendum on guesses: woken before the message is sent).
- Date: 2026-11-09
- Amends: ADR 0056 (§5: `machine.wake_wanted`; §10: standby, `busy` and `lastUsedAt`), ADR 0032 (a run waits for a
  computer that wakes, as it does for one just gone)

## Context

The workspace's own computer (ADR 0056 §10) costs its operator the same whether anyone uses it or not. The operator can
put it to sleep while nobody does and wake it when it is wanted, but only with the server's help: to the server a
sleeping computer is one that stopped answering. Runs say it is offline, the apps say it isn't answering, it is listed
as disconnected, and nothing asks for it back.

## Decision

### 1. Standby is the operator's word

`machines.standby_at` (migration 0248). The operator says it put the workspace's computer to sleep, or that it no
longer is: `PUT /api/operator/v1/orgs/{orgId}/machines/{machineId}/standby` with `{ standby }` answers `{ standby }`,
404 unless the workspace has that `managed` computer; `true` again keeps the first time. The computer's next hello
clears it, whoever woke it, and so does removing the computer. Only the workspace's own computer is ever in standby
(`inStandby` in `machines.ts`).

### 2. Whatever wants it says so

Through the hub (`MachineCaller.wake`, `wantMachine` in `packages/engine/src/machine-wake.ts`), with why:

- `run`: a run's first turn on the computer (its admission, before its place in the computer's line) and a run's wait
  for it (§3);
- `view`: a person's apps asking for the agent's screen (`GET …/agents/{agentId}/desktop`), which they do every few
  seconds while a view of the computer is open;
- `call`: any request sent to a computer in standby (`hub.call`), so every path that touches it wakes it.

Each writes `machines.wanted_at` (at most every 30 seconds per computer and server process) and, while the computer is
in standby, records `machine.wake_wanted` with `{ machineId, why }` in the events feed (at most every 10 seconds per
computer and process, `recordWakeWanted`). Other computers: nothing.

### 3. A run waits quietly while it wakes

A run that finds its computer in standby asks for it and waits up to `COMPUTER_WAKE_WAIT_MS` (60 seconds), still
working, nothing posted or stored, however long the computer slept (`computerBackSoon`, beside the 30-second wait for a
computer just gone): at its start, and again when it comes back from another wait (a plan's reset, the end of a drop's
grace). The browser's and the desktop's tools (`callWhenBack`) and the sandbox's (`withConnectedMachine`) wait the same
way. Not back by then, something is wrong: the existing path follows (the note and the
wait for the computer's return; the model brain no longer stands in, ADR 0032's 2026-11-15 addendum).

### 4. Nothing is wrong to its people

Each computer in the apps' list carries `standby` (`GET …/machines`; a change comes as `machine.updated`). The
computer's view (the web's dialog, the phone's screen) shows "Opening …'s computer…" while it wakes, never "not
answering"; its status line (`entryState`, on the web and the phone) reads "Available · nobody's using it" unless a
request, someone in control or the agent's work says more; and a computer in standby is never an outage
(`…/machines/outages`).

### 5. What the operator decides with

`GET /orgs/{orgId}/machines` adds `standby`, `busy` and `lastUsedAt` (false, false and null for other computers),
from one query (`machineActivity`):

- `busy`: a run of the workspace queued or running, a run waiting for this computer, a task running on it, someone in
  control of one of its agents' screens, or something wanting it in the last 2 minutes;
- `lastUsedAt`: the latest of the workspace's runs and this computer's tasks created in the last 7 days (each run's end,
  else its last change), `wanted_at`, and its people's last visit.

How the operator uses them is its own: put the computer to sleep while it isn't busy and hasn't been used for a while,
then say `standby: true`; wake it on `machine.wake_wanted`, or when it reads `busy` in standby (something waits for it).

## Consequences

- An open view of the computer keeps it awake, the conversation's side panel showing the agent's screen included.
- A wake longer than a minute reads to the run that waited as the computer not answering (its note), though the run
  goes on by itself once the computer is back.
- The throttles are per server process: with several replicas, each writes and tells on its own.
- A hello clears the standby, so the operator says `true` after the computer is asleep, not before.

## Addendum (2026-11-27): woken on a guess, before the message is sent

A run that finds its computer asleep waits for the wake and the runner's hello, several seconds, before its first word.
Most of that wait can come before the message is sent, from what the person does in the app. Each sign weighs
(`wake-intent.ts`, `INTENT_WEIGHTS`):

| Sign | Weight |
| --- | --- |
| The app opened (its socket connects) | 1 |
| A channel opened (`open` frame) | 2 |
| A thread opened | 3 |
| A DM opened | 4 |
| The composer focused (`intent` frame, `signal: "focus"`) | 3 |
| A typing frame | 3 |
| An agent picked after `@` (`intent`, `signal: "mention"`, its `agentId`) | 4 |
| A voice message recording (a typing frame of kind `voice`) | 4 |

A conversation's signs add up over 3 minutes, the app's opening counted in each, and at 4 the computers of its agents
(its agent members and the agent named, not archived nor held) that are in standby are asked back, once a conversation
a window. So opening the app or a channel alone never wakes one, a DM with an agent, `@` and an agent or a voice message
wakes it at once, and the rest takes two signs (a channel opened and its composer focused, two typing frames). The
apps send `open` for every conversation now, and `intent` from the composer; web, desktop and phone alike. An older
server answers `intent` with `bad_frame`, which the apps ignore. The frames go only in a channel the socket is
subscribed to and are rate-limited per connection (5 every 10 seconds); the typing frames keep their own limit.

The ask is `wantMachine(…, "intent")`: in standby and not waking already (no wake's clock running), it records
`machine.wake_wanted` with `why: intent`, at most once per computer every 2 minutes and 10 times an hour per server
process, on a count of its own so it never takes the place of a run's ask. It writes no `wanted_at` (a guess is no use
of the computer and never keeps it awake) and starts no wake's clock (a guess that fails never shows the computer down).
The typing warm-up's own wake (`warmWhileTyping`) is a guess too. On a self-hosted server nothing is ever in standby, so
nothing is asked.

`GET /orgs/{orgId}/machines` adds `workedAt`: `lastUsedAt` without its people's visit. The operator may wake a guess's
computer without making room for it, never pages when that fails, and may put it back to sleep sooner when no work
followed the wake (`workedAt` older than it) instead of waiting its idle minutes, which a person in the app keeps fresh.
Nothing of this is shown to people: a computer woken on a guess reads ready, as one asleep does.

