import { expect, test } from "bun:test";
import { missionBrain } from "../src/missions-engine";

test("agent missions inherit a computer brain configured on the mission's computer", () => {
  expect(
    missionBrain(
      { executor: "agent", machineId: "mission-computer" },
      { brain: "opencode", machineId: "mission-computer" },
    ),
  ).toEqual({ brain: "opencode" });
});

test("agent missions use the API brain when the configured computer brain belongs elsewhere", () => {
  expect(
    missionBrain(
      { executor: "agent", machineId: "mission-computer" },
      { brain: "opencode", machineId: "other-computer" },
    ),
  ).toEqual({ brain: "model" });
});

test("an explicit mission brain and model override the agent configuration", () => {
  expect(
    missionBrain(
      { executor: "agent", machineId: "mission-computer", brain: "codex", brainModel: "gpt-6.1-sol" },
      { brain: "opencode", machineId: "mission-computer" },
    ),
  ).toEqual({ brain: "codex", model: "gpt-6.1-sol" });
});
