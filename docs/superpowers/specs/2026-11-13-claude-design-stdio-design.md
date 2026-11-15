# Claude Design: transport native permission requests over stdio

Status: technical amendment to the approved Claude Design design. The user explicitly chose SDK/stdio with human approval and authorized continuing implementation. The original account/DM/authority/uncertainty constraints remain binding. Continue Native execution in the existing isolated worktree.

## Intent and evidence

Complete the existing dedicated Design adapter by keeping Artifact in ask and replacing its two-field MCP permission transport with the pinned CLI's bidirectional stdio protocol. Measured 2.1.322 emits can_use_tool with requires_user_interaction=true for the Artifact read and respects an always-deny host. Removing Artifact ask permits the own-artifact read but leaves effects exposed when hooks do not run. Neither production admission nor a blanket automatic approval follows from the spike.

## Approaches and decision

1. Remove Artifact ask and depend on the existing hook: fewer prompts, but does not meet the approved pre-effect guarantee when hooks are disabled. Rejected.
2. Keep ask and forward structured stdio permission requests, requiring the account owner's review for native interaction requests: preserves both gates. Selected by the user after the measured always-deny spike.
3. Handoff all work to a terminal: supports native UI but does not implement the requested app workflow. Remains an external manual alternative.

## Permission flow

Start the same pinned CLI and isolated account/workspace with stream-json in both directions and --permission-prompt-tool stdio. Strict MCP config is empty. Keep ask for Artifact/Read/Write and the immutable PreToolUse/onFailure:block. Initialize the SDK control protocol before sending the first user prompt; hold stdin open until result/abort. Unknown/malformed control requests deny. Initializations and responses are bounded and correlated, and cancellation closes pending requests.

A normal SDK tool permission can be automatically allowed only by the same live, unconsumed, exact hook decision as today. An Artifact call must be sequential until its native result, so a permission cannot drift to a different authorized operation. The hook authorization carries toolUseId and canonical input hash. Backend stores the last authorization binding on the job. Human approval does not replace this hook check.

When requires_user_interaction=true, accept only the measured Artifact read shape for the current own/owner-associated target. Persist one consent request tied to org, machine, account, grant revision, job, task, native toolUseId, inputHash, authorization sequence and exact description. Unsupported native disclosure types stay denied. Never set __artifact fields or infer approval from an agent's approval level. The native description measured so far is generic: show all the supplied text plus the exact operation, target, selected account and a clear explanation of access to Claude content. Do not claim that richer future disclosures are supported without a schema/test for them.

The runner polls the same authenticated frame every two seconds until decision/deadline; no external queue. The backend returns pending, allow or deny. Only an authenticated owner session in the original DM can decide. A review acknowledgement is mandatory for approve. No admin override, coverage delegation, approve-all, remember-always, model tool or approval-level shortcut. Approved consent is consumed once when delivered to the exact waiting operation; lost delivery fails closed. Recheck current authority at registration, decision and consumption. After human acceptance, the runner reauthorizes the read with the backend immediately before replying allow to the CLI.

Each consent expires within 900 seconds and sooner when task/job ends, cancels, disconnects, account changes or access is revoked. Decisions and expiration are audited. Active remote locks and confirmed publication references survive denied/canceled reads exactly as in the original design. No native create/update replay.

## Storage and app surface

Use PostgreSQL jobs plus a new claude_design_consents child table, with org_id and composite org/job FK. Preserve historical native decisions without making transient run retention erase unknown job locks. Add the optional authorization snapshot to jobs in a new generated migration. Bump dedicated runner protocol to 65 while retaining generic legacy behavior.

Expose owner-only GET/POST consent routes under the existing Claude Design routes with session/CSRF checks. Use the existing delivery path to place a request in the owner's DM (no agent wake) and existing notification infrastructure for that owner. Render a dedicated review card/sheet on web and mobile from the same client API. The initial card opens the full review; acknowledgement starts unchecked and approve stays disabled until checked. Render provider text as plain text and canonical links as external Claude links, never active source. Poll pending state and show expired/revoked/denied states.

Resume original Task 7 source/version recovery work using measured native metadata/file envelopes and strict owned/private proof, then original Task 8 account controls and rollout checks. The new transport alone does not make the pilot available. Human-native smoke needs actual owner decisions, not a test callback silently returning allow. No implementation dependency or external service is added.

## Acceptance and calls made by the implementer

- Hook absent/broken/disabled, false native tool id/hash, replay, wrong owner/org/account, expired consent or revocation while waiting yields zero remote effect after the denial.
- Native requires_user_interaction is never automatically approved. A real owner review is necessary even when agent approvals are never.
- Exactly one operation may consume one reviewed consent. Late frames cannot approve the next operation.
- Metadata parsing uses only a correlated native envelope, not version strings inside user-authored content. Recovery owns the target, pins a consistent version and imports only bounded verified source files.
- Keep rollout gates closed until create/populate/update/cancel/recover/source delivery and web/mobile controls pass the same contract with the selected test account.
- Implementation choices: reuse request-card/dialog/sheet UI and notification primitives; a 900-second maximum follows the current task budget. A different default can be tuned without weakening binding or extending a running native task past its limit.

## Builder-check resolutions

1. Exact binding uses native SDK tool_use_id for Artifact, the original PreToolUse input and SHA-256 of canonical JSON. Normalize only the three measured post-hook Artifact additions, with the same strict types/target checks as the current guard: __artifactPublishTarget null or exact current target, __artifactRoomJoinDisclosed false only, optional UUID __artifactTypeCreatePin. Hook inputs containing these fields are rejected. Unknown added fields deny. Native __ fields are never changed on the response. A second Artifact cannot be authorized until the first has a native result. Internal Read is a separate, confined exception already covered by the guard, never a human consent for another Artifact.

2. Decide changes pending to approved/denied, not consumed. Runner poll atomically consumes approved and delivers allow once; all later polls deny. Before replying allow to the CLI, the runner makes a new sequenced read authorization carrying consentRequestId and the same toolUseId/hash/target. The backend checks the consumed row against the previous authorization snapshot and marks reauthorizedAt once, then installs the new snapshot. Replay denies. Lost delivery leaves consumed but no reauthorization and therefore no provider effect. A concurrent change/revocation denies the final authorization.

3. Owned/private evidence is a native-generated header preceding source sections, observed in the approved own-target tool_result: [Artifact <internal UUID> (version <opaque>) — owned by you, private; ...]. It must occur at the measured start of the correlated native read envelope, not as a line inside a source body. The internal UUID is not assumed equal to the compact editor URL id. Native file envelopes/hash/cache paths are not yet measured: collecting them with explicit owner review is a prerequisite to source recovery admission. Readability alone, generic SDK description, and synthesized source wrappers do not establish ownership/source proof. Unknown/rich native disclosure types remain denied until their displayed text can be reviewed.

4. No new partial-terminal state is introduced. A confirmed shell or incomplete publication remains published with sources_incomplete and holds its design lock. Cancel stops the process and consents but preserves the reference/state. An empty shell cannot succeed or unlock merely because it was read. UI labels the incomplete result explicitly and links to the external editor. Unknown/known-version recovery continues to reject external version drift. A separate future owner-abandon/version-resolution policy would need its own explicit design; this continuation does not silently add one.


## Rendered result amendment (2026-11-14)

The owner corrected the acceptance criterion after seeing the actual app: publication and recovery must display the design layout, rather than a reference document and source-file tiles as the primary result. This explicit correction authorizes the presentation work in the current Native execution.

Use a saved read-only preview of the recovered canvas/artboards. Reuse the existing isolated HTML presentation and native WebView, with no account cookies, network access or execution of project scripts. Parse the measured canvas v3 board dimensions/order and apply scalar visual property defaults from native dc HTML. Do not execute DCLogic or fetch the missing support runtime. Unknown computed bindings or unsupported formats must show preview unavailable with the external editor action, not invent a layout. Keep source downloads in a collapsed secondary area, preserve them in Drive, and use a normal result card rather than an approval request.

The server must associate preview files with the completed job's task-pinned source manifest and verified uploads, not current artifact titles or the latest mutable design. Client file reads use authenticated artifact APIs at the stored file version and check metadata/size against that manifest. Only the resulting isolated page enters the preview. Web and mobile use the same board/parser model. No native effect, sharing change, new credential or production admission is introduced.

Alternatives considered: embedding the private Claude editor depends on another site's login and embedding policy; exposing source cards does not meet the corrected visual requirement. The selected snapshot approach fits the existing app isolation and verified source pipeline. Its limit is static supported layouts; the full interactive Claude editor remains external.
