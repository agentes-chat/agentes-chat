import { expect, test } from "bun:test";
import type { ClaudeDesignConsent } from "@agenteschat/client";
import { canApproveDesignConsent, designConsentIdOf } from "@agenteschat/client/lib/claude-design";
import { eventLineOf } from "../../src/features/chat/logic";
import { translator } from "./fixtures";

test("the native request reaches the phone event surface and uses reviewed owner-only approval", async () => {
  const id = crypto.randomUUID();
  const meta = { notice: { kind: "design_consent", text: "Native request", refs: { designConsentId: id } } };
  expect(designConsentIdOf(meta)).toBe(id);
  const line = eventLineOf({ body: "Review", meta }, { author: "Agent", agentByHandle: () => null });
  expect(line?.key).toBe("claudeDesign.pending");
  for (const lng of ["pt-BR", "en"] as const) {
    const t = await translator(lng);
    expect(t("claudeDesign.ack")).not.toBe("claudeDesign.ack");
    expect(t("claudeDesign.approve")).not.toBe("claudeDesign.approve");
  }
  const row: ClaudeDesignConsent = {
    id,
    jobId: "job",
    status: "pending",
    title: "Sample",
    accountLabel: "Local",
    remoteUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
    description: "Read",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    canDecide: true,
  };
  expect(canApproveDesignConsent(row, false)).toBe(false);
  expect(canApproveDesignConsent(row, true)).toBe(true);
  expect(canApproveDesignConsent({ ...row, canDecide: false }, true)).toBe(false);
  expect(canApproveDesignConsent({ ...row, status: "expired" }, true)).toBe(false);
});
