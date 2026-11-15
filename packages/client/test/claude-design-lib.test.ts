import { expect, test } from "bun:test";
import type { ClaudeDesignConsent } from "../src/api/types";
import { canApproveDesignConsent, designConsentIdOf } from "../src/lib/claude-design";

const row: ClaudeDesignConsent = {
  id: "consent",
  jobId: "job",
  status: "pending",
  title: "Sample",
  accountLabel: "Local",
  remoteUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
  description: "read",
  expiresAt: "2026-11-14T10:00:00Z",
  canDecide: true,
};
test("only an acknowledged current owner request is approvable", () => {
  const now = Date.parse("2026-11-14T09:00:00Z");
  expect(canApproveDesignConsent(row, false, now)).toBe(false);
  expect(canApproveDesignConsent(row, true, now)).toBe(true);
  for (const status of ["approved", "denied", "consumed", "expired", "canceled"] as const)
    expect(canApproveDesignConsent({ ...row, status }, true, now)).toBe(false);
  expect(canApproveDesignConsent({ ...row, canDecide: false }, true, now)).toBe(false);
  expect(canApproveDesignConsent(row, true, Date.parse(row.expiresAt))).toBe(false);
  expect(canApproveDesignConsent({ ...row, expiresAt: "invalid" }, true, now)).toBe(false);
});
test("only a typed native consent notice opens the owner request", () => {
  const id = crypto.randomUUID();
  expect(designConsentIdOf({ notice: { kind: "design_consent", refs: { designConsentId: id } } })).toBe(id);
  expect(designConsentIdOf({ notice: { kind: "agent_note", refs: { designConsentId: id } } })).toBeNull();
  expect(designConsentIdOf({ notice: { kind: "design_consent", refs: { designConsentId: "forged" } } })).toBeNull();
});

test("only an owned native Claude account exposes Design controls, and job references are strict", async () => {
  const { designJobIdOf, showDesignAccountControls } = await import("../src/lib/claude-design");
  expect(showDesignAccountControls({ mine: true, kind: "claude_code", provider: null }, true)).toBe(true);
  for (const a of [
    { mine: false, kind: "claude_code", provider: null },
    { mine: true, kind: "codex", provider: null },
    { mine: true, kind: "claude_code", provider: "foreign" },
  ])
    expect(showDesignAccountControls(a, true)).toBe(false);
  expect(showDesignAccountControls({ mine: true, kind: "claude_code", provider: null }, false)).toBe(false);
  const id = crypto.randomUUID();
  expect(designJobIdOf({ claudeDesign: { jobId: id } })).toBe(id);
  expect(designJobIdOf({ claudeDesign: { jobId: "bad" } })).toBeNull();
});
