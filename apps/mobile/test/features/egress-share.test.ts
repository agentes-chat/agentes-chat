import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The source with every run of white space as one space, for checks across a formatter's line breaks. */
const flat = (file: string) => readFileSync(join(import.meta.dir, "../../src", file), "utf8").replace(/\s+/g, " ");

test("a computer's page on the phone: its internet for the agents, as the web's (ADR 0237)", () => {
  const computer = flat("features/devices/ComputerSection.tsx");
  // Shown where there is something to lend to, and to whoever may change it or while it is on.
  expect(computer).toContain("d.shareInternet && (d.mayManage || sharing)");
  expect(computer).toContain('label={t("devices.shareInternet")}');
  expect(computer).toContain("sub={shareInternetText(t, d, lending) ?? undefined}");
  // Its owner turns it on; an admin may only turn it off.
  expect(computer).toContain("disabled={!d.mayManage || (!mine && !sharing)}");
  // The pending value shows at once; on again picks it first, its owner's alone.
  expect(computer).toContain("(share.isPending ? share.variables : undefined) ?? d.shareInternet?.on ?? false");
  expect(computer).toContain('label={t("devices.shareInternetPick")}');
  expect(computer).toContain("lending !== null && mine");
});

test("the workspace's computer on the phone says whose internet its agents use", () => {
  expect(flat("features/settings/MachineScreen.tsx")).toContain("egressViaText(t, m),");
});

test("letting a computer join on the phone says it will lend its internet, as the web's Let it join does", () => {
  const parts = flat("features/devices/parts.tsx");
  expect(parts).toContain('d.machineKind === "managed"');
  expect(parts).toContain('t("devices.shareInternetJoin")');
  // The devices list's card and the notice's card both show it.
  expect(parts).toContain("{joinFacts(t, r)} </Text> <JoinInternetLine />");
  expect(flat("features/devices/notices.tsx")).toContain("{joinFacts(t, request)} </Text> <JoinInternetLine />");
});
