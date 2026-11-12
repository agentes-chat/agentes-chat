# 0173. An approvals level per agent: always ask, only what is risky, never ask

- Status: Accepted
- Date: 2026-11-11
- Extends: ADR 0015 (Tool Gateway and approvals, "Aprovar sempre"), ADR 0053 (who is behind a run, a routine's
  bounds), ADR 0131 (autonomy brakes)
- Code: `packages/db/src/schema/agents.ts` (`approvals_level`, migration `0254_agent_approvals_level`),
  `packages/engine/src/tools/run-policy.ts` (`ApprovalsLevel`, `approvalsLevelOf`, `toolPolicy`'s third argument),
  `packages/engine/src/tools/gateway.ts` (`unaskedAtNever`, the listing and the call), `packages/engine/src/agents.ts`
  (who sets it), `packages/engine/src/agent-audit.ts` (`approvalsLevel: "never"` on a call that ran unasked),
  `packages/engine/src/git/repos.ts` (`mergeReposOfCall`), `apps/server/src/routes/app/schemas.ts`
  (`ApprovalsLevel`), `packages/client/src/lib/approvals-level.ts`, web `pages/agent/ApprovalsLevelCard.tsx`, phone
  `features/agents/ApprovalsLevelRow.tsx`

## Context

Whether a call asks a person was decided per tool: a connector's tool at the level `approval`, a tool the classifier
marks sensitive (deletes, sends, payments), merge, deploy and rollback by name (`ALWAYS_SENSITIVE`), and every write
to a connected app from a routine's run or a run its reading feeds (ADR 0053 §4 and its addendum of 2026-10-31).
"Aprovar sempre" (ADR 0015) removes one card at a time. People asked for one setting per agent: an agent that is
trusted to act alone, and an agent that asks about everything.

## Decision

Each agent has an approvals level, `agents.approvals_level`: `always`, `risky` (the default, and what every agent
did before) or `never`.

1. **`risky`** changes nothing: what is marked sensitive asks.
2. **`always`**: every write to a connected app asks (`toolKind` `external`: a connector's or a custom server's
   tool that isn't a read, a mailbox's send), on a person's run and on the agent's own. The policy answers `approve`
   for it, the answer a routine's run already gets, so the same rules follow: the tool lists as one that asks and
   takes its `why`, "Aprovar sempre" is neither offered nor read, and "Pode fazer merge sem perguntar" is off
   (`mergeReposOfCall` gives no repository), on the connector's merge and on the computer's. Reads, internal changes
   people can undo (issues, memory, Drive, its own branches) and the computer's own command policy are as before:
   they never asked through a card.
3. **`never`**: a connected app's tool that asks only because it is marked sensitive runs without a card
   (`unaskedAtNever`). It still asks for:
   - merge, deploy and rollback, and what starts them under another name or runs whatever its arguments say
     (`customAlwaysAsks`: a release, a build, a workflow, a trigger, a script, a raw request, GraphQL, SQL). This is
     the list "Aprovar sempre" never covers, read on the tool's name, its scope and the actions it runs, so the two
     can't disagree.
   - a call through a tool that runs other actions whose actions it can't read.
   - a tool with its own approvers (someone's mailbox: its owner answers for it, ADR 0038).
   - our own tools that ask (`request_approval`, `request_permission`, `send_feedback`, a workspace where every
     command asks): asking is what they do, or the workspace's own rule.
4. **Routines and outside text are not relaxed.** A routine's run, and a run nobody is behind that a routine's
   report or work woke, ask for every write to a connected app at every level, `never` included. Text nobody checked
   (inbound mail, a webhook, the web) feeds those runs, and a level set once on the agent's page is not a person
   reading that text. A routine keeps its own ways to act alone: the actions its creator allowed for its job, "Sempre
   nesta rotina" and an action approved ahead. `unaskedAtNever` refuses such a run by itself, whatever the policy
   answered for the tool.
5. **It never widens what the agent may use.** Scopes are checked first, then the level. The budget, a connector's
   tools turned off, a mailbox's recipients and From address, the team-action check and the autonomy brakes all apply
   as before. What `never` does lift is asking itself: a tool an admin set to ask, and a shared mailbox set to ask
   before a send or a delete, run without a card (a person's own mailbox still asks its owner).
6. **Who sets it.** Whoever may edit any agent (`manage_agents`), through the agent's `PATCH`, and at creation only
   with that permission. A new agent starts at `risky`. The right hand's level can be changed too.
7. **The audit says so.** A call that ran without its card because of `never` is recorded with
   `details.approvalsLevel = "never"`, and the audit's detail shows "Not asked (Never ask)" where an approval would
   be. Changing the level is an `agent.updated` row with the new value.
8. **The level is read on every listing and every call**, so narrowing it asks from the next call.

In the apps: one row, "Aprovações", on the agent's page under Ferramentas e acesso (web) and on its profile (phone),
showing the level. It opens the three choices, each a title and one line. "Nunca perguntar" says what it still asks
for. A choice saves at once.

## Consequences

- At `never` an agent deletes, sends and pays through its connected apps without a person, within its scopes. The
  audit is where a person sees it afterwards.
- A mission task's call through the bridge has no run: it follows the mission's own Autonomia, and no level moves it.
- `always` does not make internal changes or computer commands ask. A workspace that wants every command to ask has
  its own switch (sandbox settings), which the level leaves alone.
- An approval card doesn't yet say that its agent always asks. The level is on the agent's page, one tap from the
  card's agent.
