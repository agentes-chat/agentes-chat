# Claude Design stdio continuation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native execution already selected by the user).

**Goal:** Complete the authorized Claude Design integration with native human permission review, verified recovery and existing app controls.

**Qualification status (2026-11-14):** Native create/update, app owner review, source upload, lost-delivery journal recovery and owner-associated read-only recovery passed in the disposable admitted copy. Native cancellation/isolation and iOS component review also passed. Final review found two Important defects, corrected with regression tests. Production admission, merge and deployment remain separate; both rollout gates stay closed. See ADR 0177 and the research report for scope and existing CI exceptions.

**Architecture:** Preserve the dedicated task/account/grant lifecycle and pre-effect hook. Replace only the permission transport with pinned CLI stdio control, store native consents in PostgreSQL and obtain owner decisions through existing app UI. Resume the unfinished original tasks after that gate is testable.

**Tech Stack:** Existing Bun/TypeScript/Hono/Drizzle/PostgreSQL/React and React Native, no new dependency.

**Spec:** ../specs/2026-11-13-claude-design-stdio-design.md, amending ../specs/2026-11-13-claude-design-design.md.

## Global constraints

- Preserve both pre-effect gates, account isolation and original owner DM restriction. Never drop Artifact ask, automatically acknowledge requires_user_interaction, or mutate native __artifact fields.
- CLI candidate remains 2.1.322, user macOS arm64 cli_login. Dedicated protocol becomes 65; other versions remain unadmitted.
- Both rollout gates remain closed until the complete authenticated contract passes. No create/update retry on unknown outcomes.
- Native choices are owner-only, reviewed and single-use, at most 900 seconds. No model, bulk, always-allow or admin shortcut.
- Credentials remain local to the existing account folders. Tests use synthetic data/PGlite except explicitly authorized native smoke.

## Review focus

1. A stale/replayed human consent or changed target/grant must not authorize another native call.
2. Hook disabled or server unavailable while a permission waits must deny before native execution.
3. Lost approval delivery/reconnect must preserve uncertainty without another create/update.
4. Rich/unknown native disclosure fields or spoofed provider text must not become automatic approval or active UI content.
5. Recovery version drift, source-path substitution and canceled partial publications must preserve references and lock semantics.

### Task 1: Bound consent storage and authenticated contract

**Files:** packages/adapters/src/{claude-design,machine-protocol}.ts; packages/db/src/schema/claude-design.ts + new generated migration; packages/engine/src/claude-design/{lifecycle,consent}.ts; packages/engine/test/claude-design-consent.test.ts; packages/adapters/test/claude-design.test.ts.

**Interfaces:** EffectRequest optional toolUseId/inputHash (required to register consent); jobs.lastAuthorization stores its task/grant/sequence/target binding. New ClaudeDesignConsentRequest frame (type design.consent, requestId, jobId, taskId, grantRevision, sequence, toolUseId, inputHash, remoteId, description). Reply (type design.consented, requestId, pending, allow). register/poll function resolves authenticated org/machine, create-once by requestId, same-input replay only. Owner GET view and decide function require reviewed:true on approve and bind/revalidate, changing only pending to approved/denied. Runner polling consumes approved once; a subsequent linked fresh authorization marks reauthorizedAt once. Persist pending/approved/denied/consumed/expired/canceled with expiry and audit.

- [x] Write tests that fail for absent implementation, then binding/replay, wrong owner/machine/org, revoked grant/scope, operator hold, expiry and approved-once cases. Run bun test packages/engine/test/claude-design-consent.test.ts packages/adapters/test/claude-design.test.ts and observe FAIL.
- [x] Add strict protocol parsers, one authorization snapshot per sequential native effect, composite tenant schema and service. Send a DM delivery notice through deliverNotice(wake:false), with stable consent refs. Reuse owner notifications. Generate next migration and verify no drift/deploy-safety.
- [x] Run the new tests plus existing design lifecycle suites, expect PASS. Commit feat(design): bind native consent to owner and operation.

### Task 2: Native stdio transport and correlated metadata

**Files:** apps/server/runner/claude-design/{manager,guard,stream,sdk-control}.ts; runner/{tasks,connection}.ts; packages/engine/src/machine-hub.ts; apps/server/test/runner/claude-design-{manager,guard,stream,task}.test.ts.

**Interfaces:** DesignManagerOptions.consent receives native exact operation binding and description and returns Promise<boolean>. TaskManager emits/polls the consent frame until terminal reply/abort. SDK controller initializes before first user prompt, parses correlated control frames, requires exact hook id/hash, calls owner consent when true, then makes a fresh read authorization before allow. Leaves stdin open until result. Ordinary permission calls reuse the existing exact hook gate.

- [x] Write failing fake-CLI tests for SDK initialization, native human flag never auto-allowed, deny/cancel/timeout, hook-disabled/forged input, grant recheck and stale request id. Run targeted runner tests and observe FAIL.
- [x] Replace permission MCP launch with stdio and strict empty MCP, keep ask/hook settings. Integrate consent transport at authenticated runner/backend frames. Parse measured native metadata envelope/owned-private proof before recovery can establish a remote reference. Unknown envelopes remain failures.
- [x] Run runner/design lifecycle/protocol regressions, expect PASS. Repeat the existing private target's always-deny native smoke; no new publication. Commit feat(runner): transport native design consent over stdio.

### Task 3: Owner review API and existing app surfaces

**Files:** apps/server/src/routes/app/claude-design.ts; packages/client/src/{api/{client,http-client,queries,types},lib/claude-design}.ts; apps/web/src/components/ai/ClaudeDesignConsent.tsx; apps/mobile/src/features/ai/ClaudeDesignConsent.tsx; existing conversation renderers; i18n catalogs and mobile keys; focused tests in server/client/web/mobile.

**Interfaces:** client.claudeDesign getGrant/setGrant/getJob/cancel/recover/getConsent/decideConsent, using existing session transport. Consent view includes status, title, account label, canonical remote URL, exact description, expiry and canDecide. Decide payload decision approve|deny and reviewed:true for approval. No token or native hidden fields in UI.

- [x] Write failing route/HTTP/UI tests for session+CSRF, owner-only decisions, full review before enabled approve, unchecked initial acknowledgement, no bulk/always controls and expired/revoked/pending states. Run backend/web/mobile processes separately.
- [x] Add routes/client and owner DM review cards/dialog/sheet. Keep native text plain and repeat no native effect without current authority. Reuse design-system components and notifications. Add all required locale values and mobile keys.
- [x] Run targeted UI/API/client tests and typecheck, expect PASS. Commit feat(design): show owner review for native consent.

### Task 4: Finish original recovery, controls and admission

**Files:** original plan Tasks 7/8 files, strict native source parser/recovery, existing AiAccounts web/mobile, ADR0177 and rollout evidence. Tests include original design-results/recovery and new controls.

- [x] Read original Task7/8 briefs. Write failing tests for actual native source envelope, drift across reads, correct source-task binding, incomplete shell/denied consent and partial-published cancellation. Keep original native version proof/causality rules: partial publications remain published/locked with sources_incomplete and are shown as such, never silently terminalized.
- [x] Complete read-only source retrieval and idempotent Drive import, then original per-agent grant/account controls, job/results/manual recovery surfaces and explicit local-HTML alternative.
- [x] Run full relevant suites, lint/typecheck/build/boundaries/licenses/migrations/schema drift and isolated Docker bootstrap. Expect PASS with real recorded exceptions only.
- [x] Perform authenticated smoke using the authorized account, actual owner review through the new consent path and complete create/populate/update/cancel/recover/source contract. Native host human approvals require user input; do all independent work before requesting them. Keep production closed if any essential contract remains unproved.
- [x] Update ADR/research and original ledger. Commit the completed scope and request one fresh whole-increment review per Native workflow. Fix Critical/Important findings in one TDD pass. Do not merge/push/deploy without user instruction.


### Task 5: Render the saved design layout in result cards

**Files:** engine claude-design/ledger.ts and results tests; server Claude Design job schema; client job types, queries and new lib/claude-design-preview.ts plus tests; web/mobile ClaudeDesignJob and new preview components; catalogs/mobile keys; presentation tests and docs.

**Interfaces:** Job view optional title/preview {version, files:[{artifactId,version,relativePath,sha256,size,contentType}]}, derived only from that job's source task/import records. Shared buildClaudeDesignPreview(files) returns bounded boards {id,title,width,height,html}. Client query loads the exact stored artifact version bytes through the authenticated API. Render static board defaults inside the existing isolated page policies with project scripts/network disabled. Keep sources secondary, selector for multiple boards, existing open/cancel/recovery controls.

- [x] Write failing server association tests, parser/defaults/dimensions/unsupported-input tests and web result tests proving a rendered board replaces primary source tiles for published/recovered results. Expected: FAIL for missing presentation.
- [x] Add authoritative preview mapping, shared source loader/parser and isolated web/native views with ordinary result-card status, collapsed sources and localized labels. Expected: supported captured canvas/HTML renders, no project script/network/parent authority.
- [x] Run affected server/client/web/mobile tests, typecheck/lint/boundaries/build. Capture actual measured blue-card preview at desktop/390, both themes, and native fixture. Expected: layout visible after publication and recovery, no source tiles until expanded.
- [x] Record this new scope separately from the completed transport qualification, commit, then request one fresh read-only review of the preview increment and fix Important/Critical findings by TDD. This is a new user-requested presentation increment, not a re-review of the closed authority fix pass. Keep rollout gates closed.
