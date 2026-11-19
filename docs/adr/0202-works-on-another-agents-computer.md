# 0202. An agent works on another agent's computer

- Status: Accepted (built). Decided by user instruction and debated defaults, not by an owner decision.
- Date: 2026-11-18
- Extends: 0137 (the right hand has no one working on it, and its scope is a seat), 0148 (an agent's line, which this
  is not), 0175 (a request carrying an id that is not the agent's own)
- Amends: 0057 (files, sign-ins, browser profiles and processes belong to each agent's own user: not for an agent a
  person put on another's computer), 0096 (an agent reaches only its own slice's ports: a member's request is its
  lead's), 0059 §2 (the invariant that no agent that doesn't think with an account can read it: a member's AI account
  stays lent to its lead's user while linked)
- Code: `packages/engine/src/works-on.ts` (`resolveForRow`, `agentScopeOn`, `setWorksOn`, `membersOf`, `worksOnViews`,
  `stopMembersWork`), `agents.works_on_agent_id` (migration 0306), `PUT …/agents/{agentId}/works-on`
  (`apps/server/src/routes/machines.ts`), web `AgentComputerPanel` (`apps/web/src/components/AgentComputer.tsx`), phone
  `apps/mobile/src/features/agents/WorksOnSection.tsx`, the rule shared by both `packages/client/src/lib/works-on.ts`.

## Context

A lead agent set up a computer: a folder with the checkouts, what is installed, the services it runs. Other agents of the
same person should work there without setting all of it up again. Each agent's own OS user, folder, ports and sign-ins
(ADR 0057, 0096) made every agent start from nothing.

## Decision

On agent M a person sets "Works on the computer of" agent L (the words in the apps never say "lead": that word is a
setor's person, ADR 0083). From then on, on L's computer M works as L does there: L's OS user, folder, installed
programs, services and ports, browser, desktop and the sign-ins in L's environment. M stays its own agent everywhere
else: its sidebar entry, name, instructions, memory, conversations, model, its own AI sign-in, budget and approvals.
The default is unset: nothing changes for any agent until a person sets it. No workspace switch.

How it works:

- One rule, `resolveForRow` (`works-on.ts`; `agentScopeOn` for a caller with only an id). Every machine request M
  makes carries L's `id`, `handle` and name (the runner derives the OS user, folder, ports and the commit name from
  them), with M's id beside them server-side only. M's brain turns keep M's own session ids. `machineScope` and
  `agentScopeFromDb` call it, and so does every place that builds a scope for a computer: folder grants, holds, tasks
  (start, stop, status, resume: `scope_id` stays the right hand's seat, ADR 0175; a task's and a hold's
  `runner_scope_id` is the id the computer was asked under when it started, see below), missions (worktree, files, tasks, uploads), the pre-turn checkout sync
  (`prepareAgentCode`), the browser's warm, act, live view, input, restart and keep-alive, a person's view of an
  agent's desktop and browser (`viewerScope`), the handoff's page check, and the plan router's sign-ins
  (`planSignInsOf`).
- The link is honored only while L is a live agent of the same non-null owner, is not a member itself, is not the right
  hand, and M, L and the computer the request goes to are the same one. Otherwise the request is refused, naming L, and
  never runs as M's own user. L's hold refuses M's work and says whose it is; M's own hold is its own.
- The hub (`outgoing()`) takes the `Co-authored-by` line from M's row and removes the member field before the request
  goes out (`callLocal` strips it for every path, hold reconciliation included), no protocol change.
- Git and GitHub are L's (the issue: the lead owns them): M's checkout sync (`machineGitSetup`, `prepareAgentCode`) runs
  entirely as L, with L's grants, repositories, token and author, and M pushes under `agentes/<L's handle>/`. Commits
  end with M's `Co-authored-by` line, so who did the work stays visible.
- Work remembers its scope. Each `machine_tasks` and `machine_holds` row stores `runner_scope_id`: the id its computer
  was asked under when it started (the agent's own, a seat's, or L's for M). Every later request about the row (stop,
  status, output, a hold's end) uses that id and never derives it again from the link, so a link or a lead that changes
  later cannot send a request to the wrong user (`taskScope`, `agentOf` in `machine-holds.ts`). A row from before the
  column is the seat or the agent itself. The resolver decides only whether NEW work may start: a task's start (a
  queued one included, which keeps no scope until it starts), a resume, and a hold taken again at a computer's hello
  are refused when the link is not honored (a hold then ends as restarted).
- When the link or the lead changes, the work that ran under the old scope ends once the change has committed, through
  the computer (`stopWorkOf`, which reads the stored scopes): after `setWorksOn` commits a link set, changed or cleared
  (a refused change touches nothing); after a lead's move (`setAgentComputerTarget`, or the caller that passed
  `stopMembers: false` because it was inside a transaction: an accepted AI-account proposal and its Undo/Redo, which
  call `stopMembersWork` after); after a lead's deletion; and after a lead is archived, which every archiving caller
  does once its transaction has committed: the route, accepted proposals and Undo/Redo of one (`revertSettings`),
  `undoTeam` and the right hand's Desfazer. `stopMembersWork` selects the agents with live work stored under the lead
  as well as those linked to it, so it reaches members whose link is already gone. The hub is the one registered by the
  process (`registerMembersHub`); a computer that does not answer still ends the rows here.
- Setting it: whoever manages both agents (`managesAgent`, ADR 0085 addendum of 2026-11-17, as `setReportsTo` does) and,
  to put M on L's computer, the setter's computer rule. Same non-null owner, one level (L works on no one; an agent
  with any member, archived ones too, works on no one), never the right hand or an archived agent, and L has a
  computer. Linking takes L's row lock and moves M onto L's computer in the same transaction, clearing its AI account
  there as any move does; L's move and L's deletion take the same lock, so a link racing either ends with M where L
  is. Clearing needs only managing M.
- Reach: what M may be asked to do in L's environment is bounded by both agents' audiences and by the person who
  linked them (who manages both); M's audience is who may ask M, L's audience is who may ask L, and a person in M's
  audience and not in L's acts in L's environment through M. That is the trade-off the apps state. Driving M's
  desktop or terminal, taking control of it or being asked for help on it is driving L's OS user, so a person must
  pass the driving rule for L as well as for M (`computerDriving`, `computerDrivers`; manages and owner read from
  each row), and a sign-in lent by L or by any of its members counts for both.
- Placement: M chooses no computer of its own while linked (`setAgentComputerTarget` refuses, bulk moves skip it,
  `works_on`). L's move takes its members along in one transaction and wakes their waiting runs. Lead archived: its
  members' tasks are cancelled and their requests refused while it is, the link kept. Lead deleted: the links are
  cleared and M keeps its computer with its own identity. A writer that moves agents without the cascade (a removed
  computer) is caught at resolve time by the same-computer check.
- Sign-ins: L's frame entry lists its members' AI accounts, so the runner's keep set never closes M's process or task,
  and M's own entry stays with no account, so the folder lent to L's user is never taken back for M's. **A member's AI
  sign-in is kept lent to L's OS user while linked**, not only during M's turn (amends 0059 §2): the same owner bounds
  it, and anyone who can drive L's computer can reach it, which is why driving needs the lead's rule too.
- The apps say it plainly (`worksOn.tradeoff`): on that computer M can do what L can, including using L's sign-ins and
  files there; M's own AI sign-in stays available there, kept lent to L's user; its memory and name stay its own;
  approvals for sensitive actions still go to people.

## What differs from ADR 0094

0094 rejected moving agents to the setup's computer. This is opt-in per agent, by a person who owns both, follows the
lead's computer, and gives M the lead's identity on that computer only: nothing is moved or chosen for anyone.

## Consequences

- One warm model process per lead's id and runner: a lead and its members alternating turns restart each other's idle
  process (cold start, lost prompt cache). A running turn is never closed for another's. Accepted.
- Rolled back to code without this: the columns are ignored. A link left by the newer server is not honored by code that
  does not know it: M works as its own user again with a new folder, and files it made in L's folder stay there. A time
  hold M or its lead had is ended by the old server by its hold id, but the tasks M started under L's user are not
  found by the old server's cancel (it asks by M's id): they keep running under L's user until the computer ends them.
  That is a rollback limit. Going forward to this code again, a link an old server left behind (M on another computer
  than L, an owner changed) is refused until a person clears or sets it again.
- Sites that still name the member's own id, and why: a phone's device tools (`device-tools.ts`: the scope names the run's
  holder for a phone, which is a person's device and not a computer user), the desktop handoff's keep-alive and the
  cancel path's desktop stop (`desktop.ts`, `cancel.ts`: they act on the member's own desktop session, which does not
  exist while it is linked, so they are no-ops). Every other site that builds a scope for a computer goes through
  `resolveForRow`.
- Not run on a real system-mode computer: the two-agents-one-OS-user path is reasoned from code and the runner's tests.
- Members per lead are unbounded in this change (one level and the same owner bound the crew).
