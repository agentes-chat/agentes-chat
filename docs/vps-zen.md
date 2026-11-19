# VPS Zen: what this branch changes from agentes.chat

This server runs `vps-zen`, the official `main` plus the patches below. Each one is kept small and marked
`VPS Zen` in the code, so a merge of `upstream/main` shows at once what is ours. Before each merge: a tag
`backup/vps-zen-<date>`, a bundle of the branch, a `pg_dump` and a copy of the running image.

| Patch | Where | Why |
| --- | --- | --- |
| Full access on this computer (`AGENTES_RUNNER_FULL_ACCESS=1`) | `apps/server/runner/full-access.ts`, hooks in `mcp.ts`, `brain.ts`, `brain-codex*.ts`, `tasks.ts`, `command-gate.ts` | The agents run this server (sudo, docker, systemctl). An agent a person set to always ask (ADR 0173) still asks. ADR 0053 addendum. |
| Model and effort in the DM's side panel, and as a chip in the composer | `apps/web/src/components/agents/ThinksPicker.tsx`, `ChannelPage.tsx` | Switching model or effort in one or two clicks. ADR 0032 addendum. |
| Typing sound | `apps/web/src/lib/sounds.ts`, `packages/ui/src/sfx/synth.ts` | ADR 0070 addendum. |
| A computer brain's own calls as steps | `packages/engine/src/executor.ts` (`ownToolStep`), `task-manager.ts` | Claude Code's Bash, Read and Edit left no step: "Ver passos" looked empty while the agent worked. Stored as a `context` step's `ownTool`, never `tool_call` (recovery and continuation replay those). |
| A finished work closes its plan | `packages/engine/src/works.ts` (`endWork`) | A work done whole showed "0/5". |
| Files dropped anywhere on the conversation | `apps/web/src/pages/ChannelPage.tsx`, `layout.css` | Only the composer's card took them. |
| Faces in the channel list | `packages/engine/src/channels.ts` (`faces`, `memberCount`), `Sidebar.tsx`, `lib/sidebar-faces.ts` | A channel known by who is in it. On by default; Preferências, "Rostos nos canais". |
| An account at its limit hands the turn to one with room | `packages/engine/src/brains/select.ts` (`brainAccountFor`, `spareAccountFor`), `out-of-office.ts`, `executor.ts` (`waitForUsage`), `test/vps-zen-account-switch.test.ts` | ADR 0041 left automatic switching out. The agent's own account at its plan limit, or at the 95% long-work pause, thinks with another signed-in account of the same kind on the same computer that may think for the agent (`planIsOwners`), the one with the most room. Nothing stored: once its own account resets, its turns go back to it. Not shown as out of office while a spare has room; a turn refused mid-work goes on in 5 s, quietly. |
| A restart resumes a computer turn cut mid-call | `packages/engine/src/recovery.ts` (`recoverStaleRuns`), `executor.ts` (`interruptedTurnPrompt`, `interruptedTurn.uncertain`) | A deploy that cut a tool call in half failed the run ("Interrupted by a server restart") and its work was lost. A Claude Code or Codex turn is sent again as cut off, told which calls may or may not have taken effect. |
| A task in review says what it waits on, and GitHub moves it | `packages/engine/src/review-step.ts`, `issues.ts` (`review`, `applyPullRequestEvent`), `webhooks.ts` (`handleWebhook`), `issue-tools.ts`, `components/ReviewStep.tsx`, `IssuesPage.tsx`, `IssuePage.tsx` | "Em revisão" was a parking spot. Each task there names one next step (merge PR X, a PR closed unmerged, criterion Y, approve or send back, ready) and who decides; the card shows it, the page adds Aprovar and Devolver. The workspace's GitHub webhook (the routines' one, `pull_request` events) links a PR naming `task #N`, records merged or closed, and moves a task to done once every PR is merged and every criterion checked. No migration: the state lives in `issues.pull_requests`. |
| Voice channels and screen sharing, Discord's way | `packages/engine/src/voice-rooms.ts`, `apps/server/src/routes/app/voice-rooms.ts`, `apps/web/src/voice/`, hooks in `Sidebar.tsx`, `ChannelHeader.tsx`, `ChannelPage.tsx`; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Team calls inside the workspace. Every channel has a voice room on LiveKit (`agentes_<org>_<channel>`): the headset in the channel's header or the sidebar row joins it, the sidebar lists who is in each room (speaking, muted, camera, live), the foot shows "Voz conectada" with mic, deafen, camera and screen, and the channel page holds the call: tiles, a shared screen in focus, full screen. The server only signs join tokens (members only, never a task) and reads who is in each room; media goes browser to LiveKit. Voz v2: microphone, speakers and camera picked per device (Configurações › Voz e vídeo, and the carets beside mic and headset in the call), input and output volume, a mic test with a meter; the microphone goes through a gate on an AudioWorklet (`gate.ts`: voice band 80 Hz–4 kHz, opens after 30 ms over the threshold, holds 350 ms, automatic sensitivity from the room's noise or set by hand) or push to talk (a key, a release delay, tab focused); "who is speaking" reads the gate for oneself and each remote track's level for the others; screen sharing with presets (texto nítido 1080p15, equilibrado 720p30, movimento fluido 1080p60, conexão fraca 720p5) or custom resolution and fps, changed live. Prefs are per device in localStorage (`vps-zen.voice`). Voice-only channels: picked as Tipo › Voz in Novo canal or switched back to text by who manages the channel (`PUT …/channels/{id}/voice-only`); kept in `vps_zen_voice_channels`, a table created on first use outside the migrations (cascade on channel delete); their page is the room (`VoiceRoom.tsx`): the call or a lobby, and the members in the room, online and offline, chat one click away. No migration, no new channel kind. Off while the three variables are unset. |

Outside the repository: `deploy/vps-zen/` holds the keepalive (a root timer every minute: the app's containers up,
the runner's service up, Chrome first in line for the OOM killer) and `agentes-deploy` (goes on at once: the agents keep running in the runner and a cut tool call resumes; `--wait` waits for
idle; swaps the image, checks health and the runner, and rolls back by itself when the new image doesn't come up).
The Discord feed (`/opt/aurevia-agentes-feed`, reads Postgres) and the runner's
systemd drop-in with `AGENTES_RUNNER_FULL_ACCESS=1`.

## Central

`/org/<id>/central` (`apps/web/src/central`, `packages/engine/src/vps-central.ts`, `GET …/central`) shows the agents, their
tasks by state, who asked whom, conversations between agents, their GitHub items and the computers.

- A task's state reads from its **last step**: 5 minutes without one is "Sem sinal", 15 is "Parada?". Nothing is stopped
  for it, because a long command is quiet too.
- A percentage appears only when the work has a plan. It is never estimated.
- A run that ended at its step limit continues by itself once (`continueWorkAtStepLimit`, in the recovery sweep). A run
  found stuck, or one that was already a continuation, waits for a person.
- The "Ao vivo" panel lists the run's real steps. Claude Code runs with `-p`, so there is no interactive screen to mirror.
- A fenced `html` block in a message shows as a page, in the artifacts' sandbox (no network, no access to the app).
- "Quem orquestra quem" groups the last week's requests by who asked: agents asking agents (`agent_consultations`) and
  people starting runs (counts only, for who manages the agent).
- Each agent's memory: the runner reads its CLI's process tree every 30 s (`runner/agent-memory.ts`, one `ps`) and sends it
  in `pong.load.agents`; the Central shows a reading under 3 minutes old. Only Claude Code processes are counted.
- The agent panel changes model and effort through the same "Quem pensa" call as the agent's page.
