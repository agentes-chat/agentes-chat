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
| A task in review says what it waits on, and GitHub moves it | `packages/engine/src/review-step.ts`, `issues.ts` (`review`, `applyPullRequestEvent`), `webhooks.ts` (`handleWebhook`), `issue-tools.ts`, `components/ReviewStep.tsx`, `IssuesPage.tsx`, `IssuePage.tsx` | "Em revisão" was a parking spot. Each task there names one next step (merge PR X, a PR closed unmerged, criterion Y, approve or send back, ready) and who decides; the card shows it, the page adds Aprovar and Devolver. The workspace's GitHub webhook (the routines' one, `pull_request` events) links a PR naming `task #N`, records merged or closed, and moves a task to done once every PR is merged and every criterion checked. No migration: the state lives in `issues.pull_requests`. |

Outside the repository: the Discord feed (`/opt/aurevia-agentes-feed`, reads Postgres) and the runner's
systemd drop-in with `AGENTES_RUNNER_FULL_ACCESS=1`.
