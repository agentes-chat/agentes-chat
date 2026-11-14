import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", "..", "src", path), "utf8");

test("Aprovações on the agent's profile: one row with the level, a sheet only for who manages agents, off while saving", () => {
  const row = read("features/agents/ApprovalsLevelRow.tsx");
  // The row says the level; the three choices and their lines are the web's, in the app's own sheet.
  expect(row).toContain("value={t(`approvalsLevel.${level}.title`)}");
  expect(row).toContain("options: APPROVALS_LEVELS.map(");
  expect(row).toContain("sub: t(`approvalsLevel.${value}.text`)");
  // Each line is a sentence: never cut to one line by a long language or large text.
  expect(row).toContain("subLines: 3");
  expect(read("features/shared/PickerSheet.tsx")).toContain("{ subLines: o.subLines }");
  expect(row).toContain('const manages = can(org, "manage_agents");');
  expect(row).toMatch(/manages \? \{ chevron: true, disabled: update\.isPending, onPress:/);
  // A failed save says so.
  expect(row).toContain("{ onError: failed }");
  expect(read("features/agents/AgentProfileScreen.tsx")).toContain("<ApprovalsLevelRow agent={agent} />");
});

test("at Só o arriscado the kinds of risk that ask follow the row: the workspace's, or the agent's own", () => {
  const row = read("features/agents/ApprovalsLevelRow.tsx");
  expect(row).toContain('{level === "risky" ? (');
  expect(row).toContain("agentRiskTolerance(agent, workspace)");
  // "Igual ao workspace" hands the agent the workspace's list to start from, and back to null when on again.
  expect(row).toContain("onPress={() => save(risks.own ? null : workspace)}");
  // The kinds change only on a list of its own, and only for who manages agents.
  expect(row).toContain("disabled={!manages || update.isPending || !risks.own}");
  const rows = read("features/settings/RiskTolerance.tsx");
  expect(rows).toContain("toggle={asks}");
  expect(rows).toContain("onChange(withRisk(unasked, risk, asks))");
  // Geral holds the workspace's, read by everyone, changed by who configures it.
  const general = read("features/settings/GeneralScreen.tsx");
  expect(general).toContain("<WorkspaceRiskTolerance settings={settings.data} editable={editable} onSave={save} />");
  expect(read("features/settings/AuditScreen.tsx")).toContain("auditUnaskedRisksText(t, row)");
});
