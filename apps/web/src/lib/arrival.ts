import { STORAGE_KEYS, storage } from "@/lib/storage";

/** What the onboarding's last step puts in the address of the workspace it opens (`?arrival=1`, ADR 0160). */
export const ARRIVAL_PARAM = "arrival";

/**
 * The arrival's value when the onboarding already asked for the AI (its own step, or a plan left for later, whose
 * row leads the right hand's card): the welcome wizard alone, no Connect after it (ADR 0162).
 */
export const ARRIVAL_BETA_ONLY = "beta";

/** Where this browser keeps that the welcome wizard was on screen for a person in a workspace (ADR 0160). */
export const welcomeSeenKey = (userId: string, orgId: string) => `${STORAGE_KEYS.welcomeSeen}.${userId}.${orgId}`;

/** Whether this browser already showed the welcome wizard to this person in this workspace: it opens once. */
export const welcomeSeen = (userId: string, orgId: string) => storage.get(welcomeSeenKey(userId, orgId)) !== null;
