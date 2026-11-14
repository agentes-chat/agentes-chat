import { expect, test } from "bun:test";
import { atRule, builtCss, declarations, topLevel } from "./built-css";

test("a channel's dashboard: a quarter of the window on the members' surface, its grid in two columns, one when narrow", async () => {
  const css = await builtCss(
    "src/styles.css",
    "src/components/members/members.css",
    "src/components/channel-board/channel-board.css",
  );
  const shipped = topLevel(css);
  const last = (sheet: string, selector: string, property: string) =>
    declarations(sheet, selector)
      .filter(([p]) => p === property)
      .at(-1)?.[1];

  // Docked: the members column's surface and line, its own width and scroll.
  expect(last(shipped, ".members-side", "background")).toBe("var(--pane)");
  expect(last(shipped, ".members-side.channel-board", "width")).toBe("clamp(360px,26vw,520px)");
  expect(last(shipped, ".members-side.channel-board", "flex-basis")).toBe("clamp(360px,26vw,520px)");
  expect(last(shipped, ".members-side.channel-board", "container-type")).toBe("inline-size");
  expect(last(shipped, ".channel-board__scroll", "overflow")).toBe("hidden auto");
  // The grid follows the column, not the window: two columns, a 2-wide widget across the row.
  expect(last(shipped, ".channel-board .wgrid", "grid-template-columns")).toBe("repeat(2,minmax(0,1fr))");
  const narrow = atRule(css, "@container (width<=359px)");
  expect(last(narrow, ".channel-board .wgrid", "grid-template-columns")).toBe("minmax(0,1fr)");
  // Floating: the panels' sheet, a thread's width or less, the whole screen on a phone (threads.css).
  const wide = atRule(css, "@media (width>=861px)");
  expect(last(wide, ".thread-panel.channel-board--float", "width")).toBe("min(480px,100vw - 20px)");
});
