import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const SOURCES = files(SRC).map((f) => ({ path: relative(SRC, f), code: readFileSync(f, "utf8") }));
/** The source files that import `name` (a module's file name, by its alias or a relative path). */
const importers = (name: string) =>
  SOURCES.filter((s) => new RegExp(`from "(?:@/[\\w/-]+|\\.{1,2}(?:/[\\w-]+)*)/${name}"`).test(s.code))
    .map((s) => s.path)
    .sort();

test("the computers' screens and the import load with their own pages, never with the app (#1)", () => {
  expect(importers("Machines")).toEqual(["components/devices/DevicePage.tsx", "components/devices/DevicesSection.tsx"]);
  expect(importers("DevicePage")).toEqual(["pages/SettingsPage.tsx"]);
  expect(importers("DevicesSection")).toEqual(["components/devices/DevicePage.tsx", "pages/SettingsPage.tsx"]);
  // The import's sheet and its steps take the flow's state type from it; the sheet is itself loaded only by the flow,
  // and the steps only by the sheet.
  expect(importers("ImportFlow")).toEqual([
    "components/ImportChoice.tsx",
    "components/ImportSheet.tsx",
    "components/new-agent/ImportAgentsDialog.tsx",
    "pages/NewAgentPage.tsx",
    "pages/SettingsPage.tsx",
  ]);
  expect(importers("ImportSheet")).toEqual(["components/ImportFlow.tsx"]);
  expect(importers("ImportChoice")).toEqual(["components/ImportSheet.tsx"]);
  // Over the new agent's dialog, which the app's shell holds: only its `lazy(() => import(…))` reaches the import.
  expect(importers("ImportAgentsDialog")).toEqual([]);
  expect(SOURCES.find((s) => s.path === "components/new-agent/NewAgentDialog.tsx")?.code).toContain(
    'import("./ImportAgentsDialog")',
  );
  // Pages only routes import, which the router splits out of the first load.
  for (const page of ["SettingsPage", "NewAgentPage", "OnboardingPage", "MemberOnboardingPage"])
    for (const by of importers(page)) expect({ page, by }).toEqual({ page, by: expect.stringMatching(/^routes\//) });
});

test("the onboarding's import of other agent apps loads when asked for, never with the onboarding's first screens", () => {
  // "Bring from another app" on the work step opens the import's dialog: only the page's `lazy(() => import(…))` reaches
  // it.
  const page = SOURCES.find((s) => s.path === "pages/OnboardingPage.tsx")?.code ?? "";
  expect(page).toContain('import("@/components/new-agent/ImportAgentsDialog")');
  // Types alone from the import's modules: their readers (every app's parser, the archive reader) stay behind.
  const heavy =
    /^import (?!type )[^;]*from "[^"]*\/(?:ImportFlow|ImportSheet|ImportAgentsDialog|import|import-flow|import\/[\w-]+)";/gm;
  for (const path of ["pages/OnboardingPage.tsx", "pages/MemberOnboardingPage.tsx"]) {
    const code = SOURCES.find((s) => s.path === path)?.code ?? "";
    expect({ path, heavy: code.match(heavy) }).toEqual({ path, heavy: null });
  }
  for (const step of ["AreaStep", "AgentStep", "AskStep", "HireStep", "AiStep", "CelebrateStep", "Shell"]) {
    const code = SOURCES.find((s) => s.path === `pages/onboarding/${step}.tsx`)?.code;
    // Every step listed is there: one renamed or gone is said here, never passed over as empty.
    expect({ step, found: code !== undefined }).toEqual({ step, found: true });
    expect({ step, heavy: code?.match(heavy) ?? null }).toEqual({ step, heavy: null });
  }
});
