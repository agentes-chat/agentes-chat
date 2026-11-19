import { expect, test } from "bun:test";
import { builtCss, declarations, topLevel } from "./built-css";

const last = (sheet: string, selector: string, property: string) =>
  declarations(sheet, selector)
    .filter(([p]) => p === property)
    .at(-1)?.[1];

test("what ships: the initials' box is a line taller than the type, never a trimmed or padded one", async () => {
  const shipped = topLevel(await builtCss("src/styles.css"));
  const props = declarations(shipped, ".ac-avatar__initials").map(([p]) => p);
  expect(last(shipped, ".ac-avatar__initials", "line-height")).toBe("1.3");
  expect(last(shipped, ".ac-avatar__initials", "translate")).toBe("0 var(--cap-mid)");
  expect(props).not.toContain("text-box");
  expect(props).not.toContain("padding-block");
});
