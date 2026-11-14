import type { PlanUsage } from "@agenteschat/client";
import { planState } from "@agenteschat/ui";

// The words of the usage views live in the client, shared with the phone (ADR 0063).
export {
  accountName,
  accountOwner,
  accountShares,
  brandOf,
  groupUsageAccounts,
  loginsText,
  modelLimitText,
  noWindowsText,
  ownPlanLines,
  partedUsage,
  planMeterText,
  planWord,
  servesTerms,
  servesText,
  shareFacts,
  splitUsage,
  usageShown,
  usageSourceName,
  usageSourcePart,
  workspaceUsesApi,
} from "@agenteschat/client/lib/plan-usage";
// At the limit, the owner's other accounts that could think instead: shared with the phone.
export { limitOffers } from "@agenteschat/ui";

/**
 * Of the viewer's plans, the one to warn about: at its limit first, then the fullest from `PLAN_ALMOST` (80%). Null
 * while every plan is under it.
 */
export function planNearLimit<P extends { usage: PlanUsage }>(plans: readonly P[], now = new Date()): P | null {
  const near = plans
    .map((plan) => ({ plan, ...planState(plan.usage, now.getTime()) }))
    .filter((p) => p.state !== "ok")
    .sort((a, b) => Number(b.state === "limited") - Number(a.state === "limited") || b.used - a.used);
  return near[0]?.plan ?? null;
}
