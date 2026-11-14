import { expect, test } from "bun:test";
import {
  agentRiskTolerance,
  auditUnaskedRisks,
  auditUnaskedRisksText,
  RISK_CLASSES,
  withRisk,
  workspaceUnaskedRisks,
} from "../src/lib/risk-tolerance";

test("the classes in the order the screens list them, as the server stores them", () => {
  expect(RISK_CLASSES).toEqual([
    "deletes",
    "spends_money",
    "reaches_people",
    "shares_outside",
    "replaces_data",
    "deploys",
  ]);
});

test("the workspace's: every class asks from an older server that doesn't say", () => {
  expect(workspaceUnaskedRisks({ unaskedRisks: ["deletes"] })).toEqual(["deletes"]);
  expect(workspaceUnaskedRisks({})).toEqual([]);
  expect(workspaceUnaskedRisks(undefined)).toEqual([]);
});

test("an agent's: its own list when it has one, else the workspace's", () => {
  const workspace = ["deletes" as const];
  expect(agentRiskTolerance({ unaskedRisks: null }, workspace)).toEqual({ own: false, unasked: ["deletes"] });
  expect(agentRiskTolerance({}, workspace)).toEqual({ own: false, unasked: ["deletes"] });
  expect(agentRiskTolerance({ unaskedRisks: [] }, workspace)).toEqual({ own: true, unasked: [] });
});

test("turning one class on or off keeps the canonical order and each class once", () => {
  expect(withRisk(["deploys"], "deletes", true)).toEqual(["deletes", "deploys"]);
  expect(withRisk(["deletes", "deploys"], "deletes", true)).toEqual(["deletes", "deploys"]);
  expect(withRisk(["deletes", "deploys"], "deletes", false)).toEqual(["deploys"]);
});

test("the audit names the classes a call ran unasked for, and nothing for any other call", () => {
  expect(auditUnaskedRisks({ details: { unaskedRisks: ["deletes", "bogus"] } })).toEqual(["deletes"]);
  expect(auditUnaskedRisks({ details: { approvalsLevel: "never" } })).toEqual([]);
});

test("the audit's line names the classes in the person's words", () => {
  const t = ((key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join("|")})` : key) as unknown as Parameters<
    typeof auditUnaskedRisksText
  >[0];
  expect(auditUnaskedRisksText(t, { details: { unaskedRisks: ["deletes", "deploys"] } })).toBe(
    "audit.panel.unaskedRisks(riskTolerance.classes.deletes, riskTolerance.classes.deploys)",
  );
  expect(auditUnaskedRisksText(t, { details: {} })).toBeNull();
});
