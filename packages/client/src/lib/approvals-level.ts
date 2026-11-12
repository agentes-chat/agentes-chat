import type { Agent, ApprovalsLevel, AuditRow } from "../api/types";

/** The levels as the choice lists them, the one that asks most first. */
export const APPROVALS_LEVELS: readonly ApprovalsLevel[] = ["always", "risky", "never"];

/** An agent's level (ADR 0173): one from an older server, which doesn't say, asks for what is risky. */
export const approvalsLevelOf = (agent: Pick<Agent, "approvalsLevel"> | null | undefined): ApprovalsLevel =>
  agent?.approvalsLevel ?? "risky";

/** The level while a change is on its way: what was asked for, else what is saved. */
export const shownApprovalsLevel = (
  agent: Pick<Agent, "approvalsLevel"> | null | undefined,
  update: { isPending: boolean; variables?: { approvalsLevel?: ApprovalsLevel } | undefined },
): ApprovalsLevel => (update.isPending ? update.variables?.approvalsLevel : undefined) ?? approvalsLevelOf(agent);

/** A call in the audit that ran without its approval card because its agent never asks. */
export const auditUnasked = (row: Pick<AuditRow, "details">) => row.details.approvalsLevel === "never";
