import { expect, test } from "bun:test";
import { parseMarkdown, plainLine } from "../src/markdown";

// Each of these once stopped the paragraph before its first line, and the parser read that line again forever: the
// server's main thread froze and grew until the kernel killed it (an agent quoting an error between backticks).
test("a line no block claims still ends: the parser always moves on", () => {
  expect(parseMarkdown("````")).toEqual([{ type: "paragraph", text: "````" }]);
  expect(parseMarkdown("```failed to spawn code-mode host: No such file or directory```")).toEqual([
    { type: "paragraph", text: "```failed to spawn code-mode host: No such file or directory```" },
  ]);
  expect(parseMarkdown("<details>\nnever closed", { details: true }).length).toBeGreaterThan(0);
  // An opening fence with nothing under it: an empty code block, as CommonMark reads it.
  expect(plainLine("```text: x")).toBe("");
});

test("a fence with an info string is a code block, its first word the language", () => {
  expect(parseMarkdown("```c#\nvar x = 1;\n```")).toEqual([{ type: "code", lang: "c#", text: "var x = 1;" }]);
  expect(parseMarkdown("```sh title=a\nls\n```")).toEqual([{ type: "code", lang: "sh", text: "ls" }]);
  expect(parseMarkdown("```\nplain\n```")).toEqual([{ type: "code", lang: "", text: "plain" }]);
});
