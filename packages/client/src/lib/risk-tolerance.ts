import type { TFunction } from "i18next";
import type { Agent, AuditRow, OrgSettings, RiskClass } from "../api/types";

/**
 * A workspace's risk tolerance (ADR 0180): the kinds of risk an agent at "Só o que é arriscado" runs without asking.
 * The order the screens list them, the server's own.
 */
export const RISK_CLASSES: readonly RiskClass[] = [
  "deletes",
  "spends_money",
  "reaches_people",
  "shares_outside",
  "replaces_data",
  "deploys",
];

const known = (value: unknown): RiskClass[] =>
  Array.isArray(value) ? RISK_CLASSES.filter((c) => value.includes(c)) : [];

/** The workspace's: an older server that doesn't say asks for every class. */
export const workspaceUnaskedRisks = (settings: Pick<OrgSettings, "unaskedRisks"> | null | undefined) =>
  known(settings?.unaskedRisks);

/** An agent's: its own list (`own`) when it has one, else the workspace's. */
export const agentRiskTolerance = (
  agent: Pick<Agent, "unaskedRisks"> | null | undefined,
  workspace: readonly RiskClass[],
): { own: boolean; unasked: RiskClass[] } =>
  agent?.unaskedRisks ? { own: true, unasked: known(agent.unaskedRisks) } : { own: false, unasked: [...workspace] };

/** The list with one class turned on (runs without asking) or off (asks), in the canonical order. */
export const withRisk = (list: readonly RiskClass[], risk: RiskClass, unasked: boolean): RiskClass[] =>
  RISK_CLASSES.filter((c) => (c === risk ? unasked : list.includes(c)));

/** The classes a call in the audit ran without its card for; none for any other call. */
export const auditUnaskedRisks = (row: Pick<AuditRow, "details">): RiskClass[] => known(row.details.unaskedRisks);

/** The audit's approval fact for a call that ran unasked under the risk tolerance, or null for any other call. */
export function auditUnaskedRisksText(t: TFunction, row: Pick<AuditRow, "details">): string | null {
  const risks = auditUnaskedRisks(row);
  if (risks.length === 0) return null;
  return t("audit.panel.unaskedRisks", { risks: risks.map((r) => t(`riskTolerance.classes.${r}`)).join(", ") });
}
