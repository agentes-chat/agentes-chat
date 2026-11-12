import { expect, test } from "bun:test";
import { APPROVALS_LEVELS, approvalsLevelOf, auditUnasked, shownApprovalsLevel } from "../src/lib/approvals-level";

test("an agent's level: its own, and risky from a server that doesn't say", () => {
  expect(APPROVALS_LEVELS).toEqual(["always", "risky", "never"]);
  expect(approvalsLevelOf({ approvalsLevel: "never" })).toBe("never");
  expect(approvalsLevelOf({})).toBe("risky");
  expect(approvalsLevelOf(undefined)).toBe("risky");
});

test("while a change is on its way the row shows what was asked for", () => {
  const agent = { approvalsLevel: "risky" as const };
  expect(shownApprovalsLevel(agent, { isPending: false, variables: { approvalsLevel: "never" } })).toBe("risky");
  expect(shownApprovalsLevel(agent, { isPending: true, variables: { approvalsLevel: "never" } })).toBe("never");
  // Another field of the agent is being saved: the level stays as saved.
  expect(shownApprovalsLevel(agent, { isPending: true, variables: {} })).toBe("risky");
});

test("the audit marks a call that ran without its card because the agent never asks", () => {
  expect(auditUnasked({ details: { approvalsLevel: "never" } })).toBe(true);
  expect(auditUnasked({ details: { approvalRules: ["r1"] } })).toBe(false);
});
