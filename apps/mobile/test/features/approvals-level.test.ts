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
  expect(row).toMatch(/can\(org, "manage_agents"\)\s*\? \{ chevron: true, disabled: update\.isPending, onPress:/);
  // A failed save says so.
  expect(row).toContain("{ onError: failed }");
  expect(read("features/agents/AgentProfileScreen.tsx")).toContain("<ApprovalsLevelRow agent={agent} />");
});
