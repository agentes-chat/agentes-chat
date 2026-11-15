# Claude Design board tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in the preserved Native session. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Track Claude Design jobs automatically on the existing board and give the agent/user consistent live status.
**Architecture:** Durable nullable historical issueId on Design jobs; Design-only status projection reads job, current native task and current consent. Reservation and lifecycle transitions synchronize one issue without creating a new agent run. Public views, board activity and current conversation context consume that projection.
**Tech Stack:** Bun, TypeScript, Drizzle/PostgreSQL/PGlite, React/React Native and existing i18n.
**Spec:** docs/superpowers/specs/2026-11-15-claude-design-board.md

## Global Constraints

- Only Claude Design; preserve native owner consent, account isolation, original reply placement and uncertain-result locks.
- No provider execution, automatic retry, historical publication or production rollout.
- Keep existing issue privacy, UI components and source download behavior; no invented percentage/ETA.
- Preserve externally managed isolated worktree, local database, credentials and accounts.

## Review Focus

- Duplicate/concurrent callbacks and recovery reuse one card, without another run or remote creation.
- Consumed/expired/stale approvals never keep a live waiting badge or cause another approval request.
- Shells, late callbacks and original-turn completion never mark the board done prematurely.
- Foreign/private/reassigned/deleted issues do not widen audience or become silently recreated.
- Missing/purged original runs, historical jobs and native failures preserve truthful current status and uncertain locks.

### Task 1: Durable board link and native lifecycle

**Files:** db schema + migration0267; engine claude-design progress/board modules, ledger/service/files/consent; issues native activity projection; engine tracking tests.
**Interfaces:** DesignJob.issueId nullable historical pointer. designProgressOf(db,jobs) returns a map of live Design progress (stage,updatedAt,pending consent reference, issue reference). syncClaudeDesignIssue(deps,jobId,{create?}) synchronizes latest state under the job lock, creates only when requested and never dispatches another agent. DesignJobView.progress and issue are optional for historical compatibility.

- [x] Write tracking tests: reservation creates one private assigned card; repeats/concurrent reconciliation reuse it without new runs; current consent pending→approved/consumed clears wait; empty shell stays in progress; final imports complete; failure/unknown blocks and retains lock; deleted/reassigned/foreign cards are not recreated/updated; original run retention does not erase linkage. Run focused tests and observe RED.
- [x] Add migration and shared Design status projection. Implement atomic issue linking and idempotent transition activity using existing issue services/events, retaining current privacy. Connect actual lifecycle entry points. Run focused tests and observe GREEN.
- [x] Check migrations and commit the verified backend increment.

### Task 2: Current context and visible progress

**Files:** engine context/Design notice/tools; client job type; web/mobile ClaudeDesignJob cards; shared i18n; engine/web/mobile tests; research/spec/plan.
**Interfaces:** Consume Task1 progress/issue references. Live Design brief is scoped to the same agent/org/channel and original reply thread, refreshes each turn, and is authoritative over historical approval notices. Chat card links to the actual issue and shows stage from the same projection.

- [x] Write RED tests for current consumed-vs-historical-pending context, thread/account scoping and true failure feedback; UI shows pending/working/unknown states and task reference without restoring preview. Run and inspect failures.
- [x] Implement current context and Design-only presentation with existing controls/i18n; retain link-only delivery. Run and observe GREEN.
- [x] Run Design and adjacent issue/context tests, all package typechecks, migrations, boundaries, build and changed-file lint. Commit; request one fresh read-only whole-increment review. Re-grade findings, fix Important/Critical in one RED→GREEN pass and run the final suite; no re-review.
- [x] Refresh isolated local dev while quiescent, preserving private config/database/accounts and local-only admission. Apply additive migration with the app's normal migration path. Verify API/UI and existing job status without executing another provider operation. Record decisions and complete.

Completed in the preserved isolated worktree. Five Important review findings fixed with RED→GREEN,399/399 tests across42files,2337 assertions; all package types, web/server build, boundaries and migrations pass. Changed-file lint passes with warnings (including existing large catalog skips), no errors. Migration0267 applied to the isolated dev DB through createDatabase.migrate while no native/conversational task was active. Dev API/web200 and real Chrome status UI verified; one earlier uncertain and two succeeded historical jobs retained with no automatic backfill. No provider operation performed. Two Minor findings documented in research: additive OpenAPI response fields and legacy nested-checkpoint publication. No second review, merge or push.
