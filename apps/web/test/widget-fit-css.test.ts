import { expect, test } from "bun:test";
import { atRule, builtCss, declarations, topLevel } from "./built-css";

const last = (sheet: string, selector: string, property: string) =>
  declarations(sheet, selector)
    .filter(([p]) => p === property)
    .at(-1)?.[1];

test("what ships: a big number scales to its tile and is never cut", async () => {
  const shipped = topLevel(await builtCss("src/styles.css"));
  expect(last(shipped, ".wg__body:has(>.wk-num)", "container-type")).toBe("inline-size");
  expect(last(shipped, ".wk-num", "font-size")).toMatch(/clamp\(12px,\s*100cqw\s*\/\s*var\(--wk-ems,\s*1\),\s*40px\)/);
  const props = declarations(shipped, ".wk-num").map(([p]) => p);
  expect(props).not.toContain("overflow");
  expect(props).not.toContain("text-overflow");
});

test("what ships: on a phone a fixed tile grows to its rows, so a wrapped action is never under the body's clip", async () => {
  const phone = atRule(await builtCss("src/styles.css"), "@media (max-width: 640px)");
  expect(last(phone, ".wg.wg--fixed[data-capped]", "max-height")).toBe("none");
  expect(last(phone, ".wg.wg--fixed[data-capped]>.wg__body", "overflow")).toBe("visible");
});
