# 0175. A person may trust a whole server to ask for its own approvals

- Status: Accepted
- Date: 2026-11-13
- Amends: ADR 0174 (its "not done here": trusting a whole connection at once)
- Code: `packages/db/src/schema/connectors.ts` (`connector_connections.trusted_at`, migration
  `0256_connection_trusted`), `packages/engine/src/connectors/custom.ts` (`freedByPerson`, `saveCustomTools`,
  `syncCustomTools`, `acceptCustomSuggestion`), `packages/engine/src/connectors/mcp.ts` (the custom source),
  `packages/client/src/lib/tool-review.ts` (`offersTrust`, `trustLevels`), web `components/ToolReview.tsx`
  (`TrustRow`), phone `features/connectors/ToolReview.tsx`

## Context

ADR 0174 lets whoever manages connectors free one sensitive tool of a server connected by address: set to `write`,
it runs without asking. Gateway servers such as Executor keep their own approval policy for every action behind a few
generic tools, all marked destructive. Freeing them one by one works, but it says the wrong thing. The person isn't
judging each tool. They are saying that this server gates its own risky actions. And a tool the gateway adds later
comes in asking again.

The issue asked for this either as "trust this server's annotations: no" or as "this server enforces its own
approvals". We take the second. The annotations still say which tools are risky, and that stays worth showing: the
review warns under each one, and the audit names them. What the person decides is who asks before they run.

## Decision

1. **A server connected by address may be trusted** ("O serviço pede as próprias aprovações"), by whoever manages
   connectors, through the review's save (`trusted` on `PUT …/connectors/custom/{id}/tools`). Saving it stamps
   `connector_connections.trusted_at`. Turning it off clears it.
2. **Trust works by freeing, not beside it.** `freedByPerson(tool, connection)` is true for a sensitive tool at `write`
   that a person freed (`freed_at`, ADR 0174) or that sits on a trusted connection. Everything that reads it follows:
   the custom source runs it without asking, each call is audited (`connector.tool_changed`), and a listing keeps it.
   Never `read`, as before: a read runs in routines and goes to every agent that may read.
3. **Turning it on frees what asks.** Every sensitive tool stored at `approval` becomes `write`, unless the same save
   names it. Nothing else changes: a tool that is off stays off, and a tool set back to `approval` afterwards asks and
   keeps asking through listings. That's how an owner keeps one gate (Executor's `resume`, say).
4. **The trust covers what comes later.** A sensitive tool nobody decided yet gets Muda as its suggestion, and accepting
   the suggestions frees it. A free tool that becomes sensitive turns `write` (a `read` too) instead of `approval`.
5. **Turning it off asks again.** Every sensitive tool at `write` that only the trust freed (no `freed_at`) goes back to
   `approval`. A tool freed on its own keeps its level. Saving `write` on a sensitive tool while the connection is
   trusted doesn't stamp `freed_at`, so turning the trust off takes it back too.
6. **The save says so.** `connector.custom_tools_classified` records `trusted` when the save changed it, and `freed`
   names the tools that save freed, including the ones the trust freed.
7. **The apps show it in sight.** Above the tools, a switch with an ⓘ (web and phone) appears when the server may be
   trusted and has a sensitive tool a person may free, or is trusted already. Flipping it moves the levels on screen before saving
   (`trustLevels`). While it is on, a line under it says the risky tools run without asking. Each such tool still
   shows ADR 0174's warning.
8. **Not through Composio**, nor our catalog connectors (they aren't servers by address). Composio's own rules ask on
   every call whatever is stored (ADR 0174 §7), so the API refuses it (`connector.trust_refused`) and the view says
   `mayTrust: false`.

As with freeing, trust changes asking and nothing else. An agent still needs the scope, routines' writes still ask
(ADR 0053), and an agent set to always ask still does (ADR 0173).

## Consequences

- One switch drops the second gate on a gateway server, and its new tools follow it. Setting one tool back to
  Aprovação keeps that tool's card, so the gateway's own approval can still reach a person.
- A person who trusts a server takes on the risk of every sensitive tool it has, or adds, for every agent with its
  scope. The switch's line, each tool's warning and the audit rows are where that shows.
- Still open: a workspace-wide risk tolerance by category, and showing a gateway's model-mode approval as a native
  card answered through its `resume`.
