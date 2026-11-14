# 0181. A risk tolerance per workspace and agent, and "Aprovar sempre" per path through a gateway

- Status: Accepted
- Date: 2026-11-13
- Extends: ADR 0173 (approvals level per agent, "Aprovar sempre" on every card), ADR 0174 (freeing a sensitive
  custom tool), ADR 0015 (Tool Gateway and approvals)
- Code: `packages/engine/src/tools/risk.ts` (`RISK_CLASSES`, `riskClassesOf`, `unaskedRisksOf`, `toleratedRisks`),
  `packages/engine/src/tools/gateway.ts` (`toleratedCall`, the listing and the call), `packages/db/src/schema/agents.ts`
  (`organization_settings.unasked_risks`, `agents.unasked_risks`, migration `0256_unasked_risks`),
  `packages/engine/src/management.ts`, `packages/engine/src/agents.ts`, `packages/engine/src/connectors/custom.ts`
  (`isGatewayCallTool`, `gatewayCallPaths`), `packages/engine/src/connectors/mcp.ts` (`asksByRisk`, the gateway's
  `actions`), `packages/client/src/lib/risk-tolerance.ts`, web `components/RiskTolerance.tsx` and
  `pages/agent/ApprovalsLevelCard.tsx`, phone `features/settings/RiskTolerance.tsx` and
  `features/agents/ApprovalsLevelRow.tsx`

## Context

Issue #255 asked for two more ways out of approvals that a server's annotations force: a risk tolerance (which kinds
of risk need a person, per workspace or per agent), and "Aprovar sempre" for a gateway's generic tools (Executor's
`call` and `execute`), kept per action as Composio's executor already is.

What ADR 0173 (as amended 2026-11-12) and ADR 0174 already cover:

- An agent's level is all or nothing at its ends: `always` asks for every change, `never` for nothing. `risky` asks
  for whatever is marked sensitive, with no say over which kinds.
- Every approval card at `risky` offers "Aprovar sempre", sensitive custom tools included: the custom source keeps
  every tool by the server's own name (`rememberAs`), and the old exclusion of tools that run anything is gone. So a
  person can already keep Executor's `call` or `execute` for good, but only as the whole tool: one click covered every
  action the gateway runs.
- A person may free one sensitive custom tool for every agent (ADR 0174). That is per tool, not per kind of risk.

The gap: no setting says "deletes may run, payments may not", and a gateway's `call` can't be kept one action at a
time.

## Decision

1. **Six risk classes**: `deletes`, `spends_money`, `reaches_people`, `shares_outside`, `replaces_data`, `deploys`
   (merge, deploy, rollback, a release or a workflow). They are the judge's reasons for a tool that needs a person
   (`JUDGE_REASONS`) and the words that make a name sensitive (`SENSITIVE_VERBS`, the gateway's `RISKY_WORDS` and
   never-for-good list), grouped the way people say them.
2. **A call's classes come from its names** (`riskClassesOf`): the server's name for the tool and its scope, or, for a
   tool that runs others, each action this call runs (a Composio slug, an Executor path). A call has no class, and
   its risk is unknown, when nothing names one (a server's `destructiveHint` on `call` or `toggle`) or when a name
   runs whatever its arguments say (GraphQL, SQL, a raw request, `execute_*`, `run_*`). A call whose actions can't be
   read has no class either.
3. **The tolerance lists the classes that run without a card** (`unasked_risks`). The workspace's is on
   `organization_settings`, empty by default, so every class asks as before. An agent may have its own list
   (`agents.unasked_risks`), which replaces the workspace's; null follows it. Storing what runs unasked, rather than
   what asks, makes a class added later ask until someone frees it.
4. **It lifts a card only for a call that asks for its risk alone** (`toleratedCall`):
   - at `risky`, on a run (a mission task's call has no level);
   - the run policy didn't send it to approval, so a routine's writes and a run a routine's reading feeds still ask
     (ADR 0053), and `always` still asks for everything;
   - the tool is sensitive by its classification or its name (`asksByRisk` from the source: a custom row's
     `sensitive`, a Composio action the entry makes ask, our catalog's `sensitive`; or `ALWAYS_SENSITIVE` in its
     name), never because a person set it to ask: a custom tool at `approval` that isn't sensitive, or our own
     sensitive tools, keep their card;
   - not a mailbox's tool (its own setting and owner decide), our asking tools, nor Composio's workbench, bash and
     proxy;
   - every class the call carries is tolerated, and it carries at least one.
   `never` already lifts every card, so the tolerance changes nothing there.
5. **The listing shows it as it runs**: a tool whose own names are all tolerated lists without its card or `why`,
   as at `never`. A tool that runs others is judged only on each call, since its actions are in the input.
6. **The audit says so**: such a call's `tool.call` row carries `details.unaskedRisks` with the classes, and the
   audit's detail reads "Not asked (allowed: Deleting)". Changing the workspace's list is an
   `organization.risk_tolerance_changed` row with before and after. An agent's is an `agent.updated` change.
7. **Who sets it**: the workspace's, whoever configures the workspace (`configure`); an agent's, whoever manages
   agents, like its level (ADR 0173 §6), the right hand's included. Both are read fresh on every listing and call.
8. **A gateway's `call` is judged and kept per path.** A custom server's tool named `call` whose input takes `calls`
   (Executor's shape: one `{ path, input }` or a list of them) gets `actions` from those paths (`gatewayCallPaths`).
   "Aprovar sempre" keeps each path, so approving
   `tools.google.api.calendar.calendars.calendarEventsPatch` for good doesn't cover a delete. The card's title names
   the paths, the paths are what a routine's own actions and an action approved ahead name, and the risk tolerance
   reads them. An input of any other shape reads as no actions: "Aprovar sempre" keeps the tool itself, as before.
   No opt-in beyond that click is needed: the per-path rule is narrower than the whole-tool rule ADR 0173 already
   offers.
9. **`execute` and `resume` stay whole tools.** `execute` runs a program, whose actions can't be read from its input,
   so its rule covers the tool (ADR 0173's consequence for a tool that runs anything) and the tolerance never lifts
   it. `resume` answers a gateway's own approval: it has no actions of its own.

In the apps: Configurações › Geral has a card, "Pedir aprovação para", with one switch per class, on while it asks.
The agent's Aprovações dialog at "Só o arriscado" shows the same switches under "Igual ao workspace", which hands the
agent a list of its own when turned off. The phone has both as grouped rows.

## Consequences

- A personal workspace can let its agents delete and deploy without a card while payments still ask, and a team keeps
  today's defaults by doing nothing.
- The classes are read from names. A tool whose name doesn't say what it does asks, as before, and one whose name
  misleads is judged by its words. Freeing such a tool is ADR 0174's per-tool choice.
- A judge's reason stored for an ambiguous tool (`spends_money` on a tool at `approval`) is not read: that tool is at
  `approval` by a person's confirmation, not by its classification, so it keeps asking.
- An agent's own list can be wider than the workspace's: whoever manages agents could already set `never`.
- Lines that say merge, deploy and rollback ask "unless the agent never asks" (the agent's tools page) are untrue for
  an agent whose tolerance lets deploys run. The Approvals row beside them says so ("Só o arriscado · 5 de 6").
- Not done here: showing a gateway's model-mode approval (`approval-required` in a tool result) as a native card, and
  trusting a whole connection at once. Each has its own change in the same issue.
