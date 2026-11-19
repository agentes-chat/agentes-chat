import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/pages/wiki.css", import.meta.url), "utf8");

test("on a narrow screen a closed pages tree takes no box (it never lays out outside its page); open, it slides in", () => {
  const narrow = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (max-width: 720px)"));
  expect(narrow).toMatch(/\.wiki-nav:not\(\[data-open\]\)\s*\{\s*display: none;/);
  expect(narrow).toMatch(/\.wiki-nav\[data-open\]\s*\{\s*animation: wiki-nav-in/);
  expect(narrow).not.toContain("translateX(-105%)");
});
