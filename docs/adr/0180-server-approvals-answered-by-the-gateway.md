# 0180. A server's own approval request is our card, answered through its `resume`

- Status: Accepted
- Date: 2026-11-13
- Amends: ADR 0015 (what an approval runs), ADR 0016 (custom servers' tools)
- Code: `packages/engine/src/connectors/server-approval.ts` (`serverPauseOf`, `resumeInput`),
  `packages/engine/src/connectors/mcp.ts` (`resumeWith`, `data.serverPause`), `packages/engine/src/tools/gateway.ts`
  (`serverPauseIn`, `openServerCard`, `resumeAlone`, `runApproved`, `answerServerRequest`),
  `packages/engine/src/executor.ts` (the resume of a paused run), `packages/db/src/schema/runtime.ts`
  (`approvals.server_request`, migration `0266_approval_server_request`), `packages/engine/src/approvals.ts`
  (`ApprovalView.serverRequest`), `packages/client/src/lib/approval-words.ts`, `approval-origin.ts`
  (`approvalServerWords`), web `components/ApprovalAsk.tsx`, `pages/ApprovalsPage.tsx`, phone
  `features/chat/cards.tsx`, `features/approvals/ApprovalSheet.tsx`, `parts.tsx`

## Context

Some MCP servers gate their own actions and ask for approval in the tool's result instead of an MCP elicitation.
Executor does so in `elicitation_mode=model`: a write comes back as

```json
{"status":"approval-required","requestId":"apr_…","invocation":{"tool":"api.calendar.calendars.calendarEventsPatch","kind":"mutation"},
 "elicitation":{"mode":"form","message":"Approve api.calendar.calendars.calendarEventsPatch? …"}}
```

and the model is expected to show it to a person and call the server's `resume` tool with the answer. In practice
agents often end the turn saying they "raised an authorization card", no card exists, and the action never runs. When
the model does call `resume`, `resume` is marked destructive, so it opens a card of ours, and that card is the only
real gate. Freeing `resume` to stop the second card (ADR 0174) removes every human gate.

## Decision

1. **Reading the request.** A call's result opens a card only when all of these hold:
   - the tool is a server connected by address, not through Composio, and not a catalog connector;
   - the server lists a tool named exactly `resume`, classified and not off (`resumeWith` on each of its tools);
   - the call did not fail, and its whole result is one JSON object with `status: "approval-required"` and a
     `requestId` that starts with `apr_` (`serverPauseOf`). Text that only contains such an object (a page, an email)
     never matches;
   - its `elicitation` asks for no form fields. A form with fields (`requestedSchema.properties`) is input, not an
     approval, and goes to the model as before. So do `input-required` and `elc_` requests.

   The source reads it from the server's own words, before the gateway wraps them as outside text, and hands it on in
   the result's `data`. The gateway only acts on it for a tool with `resumeWith`, and only when this agent may call
   that `resume` in this run (its scope, and the run policy of ADR 0053 not refusing it). Otherwise the model reads the
   result as it came.

2. **The card.** The gateway opens an approval whose action is the server's `resume` with
   `{"requestId": …, "response": {"action": "accept"}}`, hashed like any other (ADR 0015). Its title is the server's
   name and the action it named, its detail what the server asks, its `why` the agent's own reason when the call gave
   one. `approvals.server_request` keeps the server's name, the action, its message, the request id and the tool whose
   call was paused. It is high risk, never offered "Aprovar sempre", and never folded among routine approvals. The run
   waits on it (`waiting_approval`) the way it waits on any card: run hold and continuation (ADR 0097) see an ordinary
   approval.

3. **Approving runs `resume` once, with no second card.** A decision resumes the run, and the gateway's
   `runApproved` runs the stored `resume` call exactly as hashed, at most once, with the scope and the arguments'
   rules checked again. `runApproved` never asks, so `resume` opens no card of its own whatever its classification.
   What the server answers becomes the result of the agent's original call: the model never sees the request, only
   what the action did.

4. **A server that pauses again.** When `resume`'s answer is itself `approval-required` (a program with a second
   action to approve), the gateway opens the next card (its tool-use id is the call's, then `~` and the request id)
   and the run keeps waiting on it. The results already decided are kept on the paused calls, so nothing runs twice
   and the model reads them all once nothing is left to decide. A retried job that finds the call already ran waits on
   the card its server asked for next, if that one still waits. The same holds when the paused call was itself
   approved on a card first (a `call` that still asks): our card for the call, then the server's, and never a step
   that waits on the model.

5. **Refused, expired.** A refusal is sent to the server as `resume` with `decline`, and a card nobody decided before
   it expired as `cancel`, so the paused work ends there too. The model reads the refusal as for any card, not the
   server's reply. A card canceled with its run sends nothing: the server's own expiry ends it.

6. **An agent that never asks** (ADR 0173) gets no card: the gateway answers `accept` at once, as a person approving
   would, for up to five requests in a row, and the call is audited as run unasked.

7. **Routines** (ADR 0053): the card goes where the routine reports, with its origin, like any of a routine's
   approvals. Approving it is what lets the action run. Nothing a routine's policy refuses becomes a card.

8. **Audit.** The paused call is a `tool.call` row with outcome `pending` and the card's id, then the approved
   `resume` its own row with how it ended, as any approved action, and so is a `decline` or `cancel` sent to the
   server. The decision is the approval's own audit row.

9. **The apps.** The card reads as the server's request ("Executor: api.calendar…Patch", and its message), never as
   a `resume` call. Its details say that the server asked for it (`approval.serverAsks`), and the Approvals
   page names the server under "Asked by".

## How it combines with freeing a tool (ADR 0174) or trusting the connection (ADR 0175)

For a gateway like Executor, an owner frees `call` and `execute` (they run without our card) and leaves `resume`
asking or free: either way the model no longer calls it for an approval, because the card of this ADR is the gate.
One human gate per risky action, the one the gateway itself asks for, at the gateway's own risk policy. Trusting the whole
connection (ADR 0175) does the same for all of its sensitive tools at once: `call` and `execute` run unasked, and
the server's own request still reaches a person as this card, because the trust frees what we would ask, never what
the server asks. Without freeing or trust, the same flow still works, with our card for the call before the server's.

## Consequences

- An approval's action may differ from the call that opened it: its tool is the server's `resume`. Anything that
  reads an approval's tool to say what it does reads `server_request` first.
- A server that returns this shape for anything else (a bug, or text it repeats from elsewhere as its whole answer)
  opens a card instead of reaching the model. That only happens with a `resume` tool of its own and an `apr_` id, and
  the card only lets that server's `resume` run.
- Elicitations over MCP itself (`elicitation/create`) and requests for form input are not handled here.
