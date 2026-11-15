# 0187. Claude Design needs a dedicated, verified adapter

- Status: Proposed — experimental qualification recorded, production admission closed
- Date: 2026-11-13

## Context

Claude Design publishing in Claude Code is an internal Artifact capability, enabled experimentally in print mode.
A CLI spike does not establish that the app can authorize every effect, keep accounts isolated, recover uncertain
publication or safely deliver source files. The final adapter must pass those checks with its actual permissions.

## Decision

Keep a separate task variant, using the existing Tool Gateway, account inventory, runner journal, machine RPC,
PostgreSQL outbox and Drive. Main chat brains receive no Artifact capability or personal MCP configuration.
Account owners grant one account to an agent for their private DM. Each remote effect rechecks current authority;
revoking a grant prevents the next effect. No fallback account, permission bypass or credential copying is allowed.

A confirmed remote reference survives interruption, cancellation and local storage failure. Uncertain publication
holds a durable lock and is never automatically repeated. File import is independently retryable, pinned to its
native task manifest and expected content hash, and uses existing untrusted file artifacts in the original DM.
Transient run retention must not erase the lock. Removing an owner or conversation may remove its local history;
removing account metadata does not remotely delete anything.

An owner-confirmed recovery request is a new read-only task on the same job. An owner association is not proof
that the interrupted process created an artifact. Native ownership, version and complete source retrieval must be
proved before recovery can finish. That authenticated recovery path remains incomplete.

## Current feasibility and rollout

The candidate remains native Claude Code 2.1.322 on macOS arm64, user runner, explicitly selected claude.ai CLI login. Other versions, setup-token, system runners and other platforms have not been admitted. The original explicit default-profile attempt failed. A new isolated profile was subsequently authenticated by the owner through the official CLI, without copying credentials; its Max identity matches the local default and differs from the Team test identity.

The original MCP permission transport could not display a native read disclosure. The stdio continuation below resolves that transport limitation for the measured disclosure with an actual owner review, keeping both pre-effect gates and Artifact ask. Separate native qualification fixtures now demonstrate Team publication and complete read-only source recovery, plus Max creation, reviewed read, publication and source import. These fixtures use the production manager and import services, with a local qualification transport rather than the deployed app/runner connection.

Read-only probes in both account directions were refused before content or source delivery. The native requests marked ownership unconfirmed and requested a user-only disclosure unsupported by the strict adapter. Each account also passed an own-artifact positive control. This proves the adapter's denial of these foreign-target requests, not an independently observed provider ACL response.

Consequently, no production combination is approved. `CLAUDE_DESIGN_PILOT_READY` is false at the server composition
boundary as well as `CLAUDE_DESIGN_EXPERIMENTAL` defaulting to false. The environment flag alone cannot enable new
grants, write tools or remote effects. Existing job results remain readable. Owner review and account/job controls exist behind backend admission. New enablement stays hidden while the pilot gate is closed.

The implementation is experimental groundwork, not a released feature. Do not enable rollout until guarded
create, populate, update, cancellation and recovery with complete sources pass in the actual account configuration.
Use a supported interactive consent path if the provider supplies one; never emulate approval of an undisplayed
native disclosure. Private test shells were left untouched, without changing sharing or deleting them.

## Consequences

The experiment consumed the selected subscription, and future native turns would use that account's limits.
Common tests use fakes and PGlite without credentials. Rollback keeps both gates closed, cancels active work where
possible, preserves published references and never retries an uncertain publication. No extra service or mandatory
dependency is introduced. The existing local HTML artifact workflow remains an explicit alternative; it is not
Claude Design and does not promise import into it.


## Stdio continuation (2026-11-14)

The adapter now keeps Artifact/Read/Write ask rules and uses the pinned CLI SDK stdio control protocol with an empty strict MCP configuration. Initialization precedes the prompt and stdin remains open until completion. The pre-effect hook still authorizes the exact native id and canonical input hash. Known native annotations are validated without modification. Unknown disclosure shapes deny.

A native human request creates a durable owner-only consent tied to org, machine, account, task, job, grant revision, sequence, target, native tool id and input hash. The original DM shows a complete review with unchecked acknowledgement. Approve is not offered on the initial card. Decisions cannot be remembered, covered, bulk-approved or made by a model/admin shortcut. Poll delivery consumes one approval once, then a linked sequenced authorization rechecks current authority before replying allow to the CLI. Denial, expiry, cancellation, disconnect and revocation fail closed and preserve confirmed remote references.

The actual native always-deny test reached the host review callback and respected its refusal without a completed Artifact read. Read annotations differ from create/publish annotations, so only the measured read/UUID pin, three false flags and exact display target are admitted. The provider's generic description and native target title are shown as plain text alongside the selected account and canonical URL. This does not establish support for future richer disclosures.

Source recovery recognizes the measured owned/private metadata preamble. Generic Version lines inside content cannot establish either a publication or a read. Native file/source envelopes and human-approved create/populate/update/recover remain qualification requirements. An empty shell or incomplete publication stays published/locked with sources_incomplete, including after cancellation. No implicit abandonment, external-version override or automatic HTML fallback is introduced. Local HTML is offered only as a separate explicit alternative.

Web/mobile controls use backend candidate availability before enabling an agent/account, permit revocation when the account becomes unavailable, and preserve private owner-only job visibility. Manual association requires an unchecked explicit confirmation, is not proof of creation causality, and never replays a create/update. All default admission gates remain closed until the complete native contract and native app UI checks pass.

The first live owner-review qualification registered a pending request through the production manager and consent service, with the actual React review component served locally. No owner review or decision was observed. The wait ended with timeout and no confirmed read, publication or source import. This demonstrates the unattended timeout path, not successful human approval or source recovery. No native operation was replayed.

The isolated Docker bootstrap and iOS/Hermes export passed. Export is not native visual QA: no simulator was running during qualification. Repository-wide CI also exposed host-dependent baseline failures and a geometry finding reproduced with the pre-feature checker and styles. Targeted passing checks do not make that CI run green or satisfy the remaining authenticated admission contract.

A subsequent owner-reviewed request was consumed once and followed by the linked authorization. The native own/private read succeeded. Its version and Artifact type release had changed since creation, so the update stopped with conflict before writing. The old target remains preserved. A separately authorized fresh-create experiment then stopped at the SDK permission gate: the ordinary create request supplied a `decision_reason` field that the strict parser rejected. The CLI explicitly reported the call rejected, but the manager conservatively retained an unknown result without a confirmed reference. No automatic replay or unknown-lock settlement follows from that experiment.

The measured create explanation is now admitted only as bounded plain metadata for a type-based create without a native human-interaction requirement, still tied to the exact live hook id and input. Reason text on reads or human-required calls remains unsupported. This correction does not authorize other disclosure formats or open admission.

Further explicitly authorized experiments created one private shell and populated that same target in a separate manual qualification fixture. This is not evidence of production partial-job continuation. Ordinary publication adds a source pin: only the exact confined file/root, unchanged target, false consent/redirection flags and a UUID pin are admitted. File reads require validated metadata first and cannot read nonexistent own files from a proven empty shell.

The successful update header contains a displayed version number and a separate opaque version id. The parser now recognizes that exact correlated native form. Populated artifacts also use a distinct measured warning preamble before their owned/private header. Later reads observed another version, so no stored version is silently overridden. The original unknown job is not settled by an offline format replay.

Read-only recovery no longer attaches execute-only publication checkpoints to subsequent read requests. A bounded file-inventory operation is allowed only for the exact target after ownership metadata, using the same read authorization. Its native result includes fixed template files as well as project files. Only a complete supported project inventory at one native version can produce sources. Each saved-file envelope must match its inventory path, size and MIME. Cache adoption requires the same internal artifact id, confined regular files without aliases and matching SHA-256, and never overwrites local edits.

The native recovery qualification used this production prompt/parser and one actual owner approval. It downloaded and verified both project files, imported two files plus a reference through the existing upload/Drive services and finished the fixture job as succeeded with the source task bound correctly. The hub transfer was a qualification fake, not the deployed runner transport. This separate manual association does not settle the original unknown publication or prove full authenticated app/journal/account-isolation/mobile admission.

Known-version recovery also refuses to advance stored design metadata when an unknown job lacks a previous remote checkpoint. Publication source manifests are captured before authorization and checked again afterward; unpublished local drafts and later byte substitutions cannot be labeled as uploaded files. Every prepared project file must be sent explicitly, preserving existing verified project files within the existing limits. Both rollout gates remain closed pending the full admission contract.


## Additional qualification (2026-11-14)

The isolated Max positive control completed one create, one consumed owner approval and linked reauthorization, and one content publication. Two verified source files were imported with the reference; the fixture job finished succeeded with the correct source task. No previous unknown job was retried or settled.

A separate read-only cancellation probe ran through the actual TaskManager and its persistent journal. The backend cancellation service canceled a registered native owner request before approval or metadata delivery. There were zero decisions, source files or create/publish authorizations. A duplicate start and a fresh TaskManager reading the journal did not respawn the CLI; the canceled result survived restart. The first frame bridge was in-process qualification code. A second probe repeated cancellation over the real authenticated MachineHub WebSocket and task RPC: the pending native request was canceled without approval, the journal survived restart, and duplicate task starts still produced one native process. This checks cancellation and journal replay on that transport; it does not establish the full authenticated app lifecycle or successful source upload over that connection.

A Release iOS simulator preview launched with the actual consent, card, sheet, button and theme components and synthetic API data. The short Portuguese review showed the account, target and request, an unchecked acknowledgement and disabled approval; synthetic denial changed the card to denied. A long German dark-mode request remained plain text and scrolled to its unchecked acknowledgement and disabled approval. Checkbox interaction/reopening and the full authenticated mobile account/job flow remain separate checks. This preview never contacted Claude.

The source-overlay Docker build at 90c3ad935 passed, including the standalone runner bundle. An isolated PostgreSQL bootstrap, signup, organization creation, web and runner download also passed. These results do not replace the documented repository-wide baseline exceptions or complete admission. Both rollout gates remain closed while the complete authenticated app/runner lifecycle and remaining native UI checks are unproved.


## Authenticated app qualification and final review (2026-11-14)

A disposable archive of the candidate enabled the admission constant only inside that local qualification copy. The source worktree kept both production gates closed. The fixture used a synthetic organization and owner, actual Better Auth cookies/CSRF, app routes and built SPA, the engine Tool Gateway, authenticated MachineHub WebSocket, RunnerConnection/handlers and TaskManager, the pinned native CLI and actual bearer-authenticated machine uploads. No Claude credential was copied.

One private synthetic create completed at local revision 1 with its reference and two source files. An exact-revision update of the same target completed at revision 2 with another verified source snapshot. Both native reads consumed separate actual owner reviews. The first publication's completion delivery was deliberately lost once; reconnect recovered its journal without another native process or publication. A separate owner-associated recovery fixture then read the exact known target through the actual app recovery dialog and native owner review, imported the reference and both sources, and kept the opaque remote version unchanged. Its lost completion delivery was likewise recovered without another native execution. The fixture does not settle earlier uncertain jobs or change the successful original jobs.

Native cancellation was separately qualified through the backend cancellation service, actual authenticated MachineHub RPC and persistent TaskManager journal: pending native consent canceled before approval or metadata delivery, with no source delivery and no create/publish. Duplicate starts and restart retained one process and the canceled result. The owner-only HTTP routes also passed their session/CSRF and tenant isolation tests.

The iOS component preview passed an Xcode UI test on the simulator using actual Consent/Card/Sheet/Button/theme components and synthetic API data. It checked disabled approval initially, enabled approval after acknowledgement, dismissal without a decision, unchecked acknowledgement and disabled approval after reopening, and synthetic approval. Checked/reopened screenshots were inspected. Long German/dark content and short Portuguese/light content were also inspected. This is native component qualification, not an authenticated mobile deployment.

The fresh whole-increment review found no Critical or Minor findings and two Important defects. Both were reproduced before the fix and corrected in one test-driven pass. Recovery accounting now uses its current task's optional run, preserving task/account/person idempotency after original run retention. Input attachments now have an artifact/version/hash/name/path manifest included in approval authority and durable reservation. Changes before dispatch require a fresh approval, and a later save cannot replace already copied pinned bytes. Migration 0266 adds a nullable JSON manifest without changing committed migrations. Legacy jobs with nonempty unpinned sources fail closed rather than selecting current bytes.

This qualification and review concern the experimental implementation. They do not admit other CLI versions, platforms, system modes, setup-token, independent provider ACL guarantees, comments/sharing/deletion/exports or host compromise. Existing baseline CI failures remain recorded. Both production gates remain closed; integration or production admission is a separate decision.


## Port onto current main (2026-11-15)

The upstream port requires runner protocol 68: upstream protocols 65, 66 and 67 do not implement this dedicated task variant. Earlier native qualification above used the isolated implementation and does not qualify the merged protocol for production. Both production gates stay closed. The original experimental migration chain was never accepted upstream; its schema is now generated as migration 0278 after upstream 0277, preserving every accepted migration byte for byte. Disposable databases created with the old experimental chain must stay on that isolated source or be recreated; this migration is not an in-place upgrade for those databases. ADR numbering moved to 0187 because upstream already assigned 0177 and 0186.


The final port review identified two integration defects, both reproduced before their fixes: Design imports had invalidated the chat file’s React Compiler opt-out, and the daemon retained an executable path from session startup even when Claude was installed later. The chat directive is again first, and Design resolves the command per launch while retaining native version/authentication checks. The final combined automated suite passed 895 tests across 77 files (one existing migration-process test skipped), with 11,187 assertions. All package typechecks, web/server/standalone-runner builds, lint (warnings only), boundaries, migration safety and schema drift checks passed. This remains automated compatibility evidence, without a new provider operation or production admission.


A subsequent upstream synchronization preserves request-header migration 0277 and shared Grok protocol 67, moving this unmerged schema to 0278 and Design admission to protocol 68. Its expanded automated run passed 1,345 tests with one skipped migration-process test and one desktop terminal-history failure. That same history test fails independently on a clean upstream checkout under the local macOS Bash 3.2, so the broad run is not reported as fully green. After the final upstream model-resolution update, 176 directed endpoint/Design/compiler tests passed, as did engine types and the server build. The earlier complete package typechecks, web/runner builds, lint, boundaries, migration safety and schema drift checks passed on the synchronized tree. The unrelated desktop limitation is retained; neither the development database nor production admission changed.
