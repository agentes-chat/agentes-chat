# 0174. A person may free a tool its server marks sensitive

- Status: Accepted, amended by ADR 0175 (a whole server trusted at once), extended by ADR 0181 (a risk tolerance per class,
  gateway paths)
- Date: 2026-11-12
- Amends: ADR 0016's addendum of 2026-10-16 ("sensitive tools only ask or stay off")
- Code: `packages/db/src/schema/connectors.ts` (`custom_tools.freed_at`, migration `0255_custom_tool_freed`),
  `packages/engine/src/connectors/custom.ts` (`freedByPerson`, `saveCustomTools`, `syncCustomTools`,
  `acceptCustomSuggestion`), `packages/engine/src/connectors/mcp.ts` (the custom source), `packages/client/src/lib/tool-review.ts`
  (`runsUnasked`), web `components/ToolReview.tsx`, phone `features/connectors/ToolReview.tsx`

## Context

A server connected by address lists its tools, and each comes classified (ADR 0016's addendum). A tool the server
marks `destructiveHint`, or whose verb deletes, sends or pays, is sensitive. Until now a sensitive tool could only ask
for approval or be off: the API refused `read` and `write`, and every listing put a stored free level back to
`approval`.

That breaks gateway servers, where one generic tool runs everything behind it and the gateway keeps its own approval
policy. Executor's MCP server exposes `call`, `execute` and `resume`, all marked destructive, so every action through
it, a calendar read included, waited on a card here and was then gated again by the gateway. Owners edited
`custom_tools` by hand to get out of it, and the next listing undid the edit.

ADR 0173 already lets an agent never ask, and offers "Aprovar sempre" on every card. Both act per agent. Neither lets
the workspace say that one server's tool is safe for every agent that may use it.

## Decision

1. **Whoever manages connectors (`manage_connectors`) may set a sensitive tool to `write`, `approval` or `off`**, on
   a server connected by address. Saving `write` on it stamps `custom_tools.freed_at`. Saving `approval` or `off`
   clears it. Never `read`: the run policy treats a read scope as a read, which a routine may run and which goes to
   every agent given read access (ADR 0053), and this tool changes things.
2. **A freed tool runs without asking.** The custom source marks a tool sensitive when it is sensitive and not freed
   (`freedByPerson`: sensitive, `write` and `freed_at` set). A free level stored any other way (old data, the
   database by hand, a `read`) still asks, as before.
3. **Each call of a freed tool goes to the audit log** (`connector.tool_changed`, as any `write` tool's does).
4. **A listing keeps a freed level** while the tool stays sensitive. A tool freed while it was sensitive is a choice
   about that risk. A tool set free before it was sensitive is not, so when its server starts marking it destructive
   a listing turns it back to `approval`, and `freed_at` stays empty. Accepting the suggestions never frees a tool and
   keeps one already freed.
5. **The save says so.** `connector.custom_tools_classified` names the tools that save newly freed (`details.freed`).
6. **The apps warn.** The review offers Muda coisas besides Aprovação and Desligada for a sensitive tool whose server
   allows it (`mayFree` on the tool), and under one set to it says that the service marks it risky and that agents
   run it without asking anyone.
7. **Not through Composio.** Its sensitive tools only ask or stay off (`connector.sensitive_tool`), as do our catalog
   connectors' tools. Composio's own rules (`COMPOSIO_ANY_ACTION`, an action the entry makes ask) decide at every call
   whatever is stored, so a freed level there would show one thing and do another.

Freeing changes asking and nothing else. An agent still needs the scope (`custom:{id}:read` or `:write`), routines'
writes still ask (ADR 0053), and an agent set to always ask still does (ADR 0173).

## Consequences

- An owner can drop the second gate on a gateway server: set `call` and `execute` to `write`, and either free `resume` too or
  keep it asking so that the gateway's own approval reaches a person through our card.
- A person who frees a tool takes on its risk for every agent that holds its scope. The warning and the audit row are
  where that shows.
- Not done here, each its own decision if wanted: trusting a whole connection at once (done in ADR 0175), a workspace-wide risk
  tolerance by category, and showing a gateway's model-mode approval (`approval-required` in a tool result) as a
  native card answered through the server's `resume`.
