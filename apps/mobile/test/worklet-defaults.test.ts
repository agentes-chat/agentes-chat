import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// On the UI thread a worklet's default parameter is read before the values it captured, so a default that names
// anything (a constant of its module) throws there: a voice message's wave crashed the conversation it was in.
const ROOT = join(import.meta.dir, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
// A function or an arrow whose body opens with the worklet directive, and its parameters.
const WORKLET =
  /(?:function\s+\w+|\b\w+\s*=\s*(?:async\s*)?)\s*\(([^)]*)\)\s*(?::\s*[^={]+)?(?:=>)?\s*\{\s*["']worklet["']/g;
// A default that is a literal (a number, a string, true, false, null) captures nothing.
const LITERAL = /^(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|true|false|null)$/;

test("no worklet's default parameter names a value: it would be read on the UI thread where that value doesn't exist", () => {
  const named: string[] = [];
  for (const file of files(ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(WORKLET)) {
      for (const param of (m[1] ?? "").split(",")) {
        const at = param.indexOf("=");
        if (at < 0) continue;
        const value = param.slice(at + 1).trim();
        if (!LITERAL.test(value)) named.push(`${relative(ROOT, file)}: ${param.trim()}`);
      }
    }
  }
  expect(named).toEqual([]);
});
