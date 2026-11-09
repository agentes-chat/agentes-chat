import { expect, test } from "bun:test";
import { builtCss, declarations, topLevel } from "./built-css";

// Built once for both: the build is the slow part.
const built = builtCss();

test("what ships puts Atende outras pessoas' label, its ⓘ and the switch on one line, the switch at its end", async () => {
  const css = await built;
  const shipped = topLevel(css);
  const last = (selector: string, property: string) =>
    declarations(shipped, selector)
      .filter(([p]) => p === property)
      .at(-1)?.[1];

  // The label (with its ⓘ right after it) and the switch on one line, nothing under them.
  expect(last(".plan-replies", "display")).toBe("flex");
  expect(last(".plan-replies", "justify-content")).toBe("space-between");
  expect(last(".plan-replies", "line-height")).toBe("20px");
  // The switch's middle on the label's capitals' middle, as an `.ac-iconline` lead's: the 20px line without lh.
  expect(last(".plan-replies>.ac-switch", "translate")).toBe("0 calc(10px - var(--cap-mid) - 50%)");
  expect(css).toContain("@supports (top:1lh){.plan-replies>.ac-switch{translate:0 calc(.5lh - var(--cap-mid) - 50%)}}");
  expect(last(".plan-replies>.ac-switch", "flex")).toBe("none");
});

test("what ships keeps Configuração avançada closed while its body is hidden: its own display gives way", async () => {
  const shipped = topLevel(await built);
  expect(declarations(shipped, ".ai-adv__body")).toContainEqual(["display", "flex"]);
  expect(declarations(shipped, ".ai-adv__body[hidden]")).toContainEqual(["display", "none"]);
});
