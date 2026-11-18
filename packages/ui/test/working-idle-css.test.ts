import { expect, test } from "bun:test";

const css = await Bun.file(new URL("../src/styles/components.css", import.meta.url).pathname).text();

// An infinite animation keeps the compositor drawing at the screen's rate for as long as it runs.
test("the working halo and the stop button never animate forever", () => {
  const rules = css.split("}").filter((r) => r.includes(".ac-avatar--running::after") || r.includes(".ac-pixstop"));
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) expect(rule).not.toMatch(/animation[^;]*infinite/);
  expect(css).not.toContain("@keyframes ac-halo");
  expect(css).not.toContain("ac-pixstop-breathe");
});
