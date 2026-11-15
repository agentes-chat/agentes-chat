# Claude Design verified-link delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in the current Native session. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a verified external design link at the original conversation location, without a failed embedded preview.
**Architecture:** Preserve internal native-effect journaling; derive public readiness from the job's confirmed nonempty source snapshot. Resolve reply placement through the job's durable original trigger. Reuse result cards and version-pinned source disclosures.
**Tech Stack:** Bun, TypeScript, Drizzle, React, React Native, existing auth/runner.
**Spec:** docs/superpowers/specs/2026-11-14-claude-design-link-delivery.md

## Global Constraints

- Owner-only DM authorization, native human disclosures and uncertain-result locks remain unchanged.
- Other machine-task delivery remains unchanged. No schema migration or new dependency.
- Production rollout gates remain closed; local development copy alone stays admitted.
- No paid provider invocation, new artifact or automatic retry for verification.

## Review Focus

- A shell checkpoint or canceled shell must not expose a ready link or release its effect lock.
- A subsequent update's mutable design metadata must not substitute a historical job's link/version.
- Top-level and existing-thread delivery, including recovery after run retention, preserve the original channel and thread.
- Missing or foreign-channel trigger messages must not widen visibility; fall back conservatively.
- Removing preview must keep exact-version source access and recovery/cancel controls without blank/error preview surfaces.

### Task 1: Publish readiness and original delivery

**Files:** engine claude-design ledger/service/consent/files; engine Design tests and new link-delivery tests.
**Interfaces:** designJobView exposes remote only with the job's confirmed nonempty source result. designReplyThreadId(db, job) returns original trigger threadId or stored root fallback, scoped to org/channel. Consumers use it for Design machine tasks, consent messages and imported source placement.

- [x] Write readiness/earlier-version/canceled-shell and delivery/retained-run tests. Run and observe RED.
- [x] Implement readiness mapping and Design-only delivery resolution; keep internal states/effects unchanged. Run and observe GREEN.
- [x] Commit the tested backend change.

### Task 2: Link-only UI and local verification

**Files:** web/mobile ClaudeDesignJob; preview components, shared preview renderer/hook/tests; web/engine/server affected tests; documentation.
**Interfaces:** Keep job title/remote/source descriptor, remove HTML rendering path. Sources stay collapsed, exact versions retained. Ready/pending states do not claim content before proof.

- [x] Write link-only result tests, then remove preview mounts/renderer/loader and adjust the real source-pipeline contract test. Observe RED then GREEN.
- [x] Run affected server/runner/engine/client/web/mobile tests, typecheck, build, boundaries and targeted lint. Inspect real existing finance result with new code in local dev, without another provider call.
- [x] Commit, request one fresh read-only whole-increment review, re-grade and fix Important/Critical once with RED→GREEN. Record decisions and verify the final suite.
- [x] Synchronize verified files to the already running local development copy, preserving private env/database/accounts and local-only admission. Confirm API/UI and original worktree gates.

Completed in the isolated detached worktree. Final fresh review: three Important findings fixed with RED→GREEN tests;225/225 affected and adjacent-context tests pass, all package typechecks, web/server build and boundaries pass. Targeted lint:12 warnings, zero errors. Existing real dev result verified with API/web200, confirmed link,12 sources and13 artifact references. Native/provider behavior was not re-exercised; no new publication or subscription use. Private dev configuration and local-only admission preserved; production gates remain closed. Historical messages remain unchanged.
