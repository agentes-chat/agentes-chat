import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * A pushed screen's bar holds the system's own title, centred by it. What a subtitle would say (the step, the board,
 * the plan, who made a file) goes right under the bar as a `BarNote`: a title and a subtitle of our own in the bar
 * didn't fit its middle beside the buttons, and the system pushed them against the back button.
 */
const SRC = join(import.meta.dir, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

/** Comments out, so a word in one never reads as an attribute. */
const uncommented = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, "$1");

/** From a tag's `<` at `i`, the opening tag up to its `>` outside any braces or strings. */
function openingTag(s: string, i: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j] as string;
    if (quote) {
      if (ch === quote && s[j - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0 && s[j - 1] !== "=") return s.slice(i, j + 1);
  }
  return s.slice(i);
}

/**
 * The bar's own props in a `<PushedHeader …>` tag: its attributes and what its spreads hold, not a view passed as its
 * title (the computer's pill has a subtitle of its own).
 */
function ownProps(tag: string): string {
  let out = "";
  let depth = 0;
  let spread = false;
  for (let j = 0; j < tag.length; j++) {
    const ch = tag[j] as string;
    if (ch === "{") {
      if (depth === 0) spread = tag.startsWith("{...", j);
      depth++;
    } else if (ch === "}") depth--;
    if (depth === 0 || spread) out += ch;
  }
  return out;
}

test("no pushed screen draws a subtitle in its bar", () => {
  const parts = read("features/shared/parts.tsx");
  const props = parts.slice(
    parts.indexOf("export function PushedHeader({"),
    parts.indexOf("const { colors } = useTheme();"),
  );
  expect(props).not.toContain("subtitle");
  const found: string[] = [];
  for (const path of files(SRC)) {
    const s = uncommented(readFileSync(path, "utf8"));
    for (const m of s.matchAll(/<PushedHeader\b/g)) {
      if (/\bsubtitle\b/.test(ownProps(openingTag(s, m.index)))) found.push(relative(SRC, path));
    }
  }
  expect(found).toEqual([]);
});

test("words in the bar are the system's own title; only a view of our own is drawn there", () => {
  const parts = read("features/shared/parts.tsx");
  expect(parts).toContain('const custom = title != null && typeof title !== "string";');
  expect(parts).toContain(
    "headerTitle: custom ? () => <HeaderTitle node={titleNode} beside={word !== null} /> : text,",
  );
});

test("what a subtitle said sits right under the bar, first in the page", () => {
  const settings = read("features/settings/parts.tsx");
  const compact = settings.slice(
    settings.indexOf("function CompactPage("),
    settings.indexOf("export function useUnsavedGuard"),
  );
  expect(compact).toMatch(/>\s*\{subtitle \? <BarNote>\{subtitle\}<\/BarNote> : null\}\s*\{\/\*/);
  for (const path of [
    "features/agents/NewAgentScreen.tsx",
    "features/usage/UsageAccountScreen.tsx",
    "features/ai/ConnectAi.tsx",
  ]) {
    expect(read(path)).toContain("{subtitle ? <BarNote>{subtitle}</BarNote> : null}");
  }
  expect(read("features/ai/KeyForAllScreen.tsx")).toContain("{plan ? <BarNote>{plan.label}</BarNote> : null}");
  expect(read("features/dashboards/ShareScreen.tsx")).toContain("<BarNote>{board.title}</BarNote>");
  expect(read("features/dashboards/OrganizeScreen.tsx")).toContain(
    '<BarNote>{home ? t("dashboards.home") : board.title}</BarNote>',
  );
  // A live file's state under its bar is the same note, in the state's colour.
  expect(read("features/live-files/shared/LiveBar.tsx")).toContain(
    '<BarNote color={said === "readOnly" ? c.faint : c.warn}>',
  );
});

test("General saves as a control moves, as the system's settings do: no Saved flashing under the title", () => {
  const general = read("features/settings/GeneralScreen.tsx");
  expect(general).not.toContain("subtitle=");
  expect(general).not.toContain("SAVED_MS");
  // A screen reader still hears that the change stuck.
  expect(general).toContain('onSuccess: () => AccessibilityInfo.announceForAccessibility(t("settings.savedShort")),');
});
