import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { book, err, putAll, val } from "./formula-helpers";

const CASES: [string, string, number, number, number | null][] = [
  ["***a**b***", "xxA\nxByy", 1, 1, 1],
  ["A?*B", "zzAAxBB yyAAzBB", 0, 1, 3],
  ["A?*B", "zzAAxBB yyAAzBB", 0, 7, 11],
  ["*A?*B", "zzAAxBB yyAAzBB", 1, 7, 7],
  ["~*", "x*y", 0, 1, 2],
  ["~~", "a~b", 0, 1, 2],
  ["~?", "a?b", 0, 1, 2],
  ["~", "a~b", 0, 1, 2],
  ["~a", "x~ay", 0, 1, 2],
  ["A[?].~*$", "A[1].*$", 1, 1, 1],
  ["a?*b", "zzA\nxB", 0, 1, 3],
  ["*Á*", "olá", 1, 1, 1],
  ["?b", "🙂b", 0, 1, 2],
  ["*", "text", 1, 5, 5],
  ["?", "text", 0, 5, null],
  ["*~*", "a*", 1, 2, 2],
];

describe("spreadsheet wildcard matching", () => {
  for (const [pattern, text, count, start, position] of CASES) {
    test(`${JSON.stringify(pattern)} in ${JSON.stringify(text)} from ${start}`, () => {
      const b = book();
      putAll(b, { A1: text, B1: pattern, C1: "=COUNTIF(A1,B1)", F1: `=SEARCH(B1,A1,${start})` });
      expect(val(b, "C1")).toBe(count);
      expect(val(b, "F1")).toEqual(position ?? err("#VALUE!"));
      b.engine.destroy();
      b.doc.destroy();
    });
  }

  test("many wildcard pieces followed by digits retain their captures", () => {
    const b = book();
    putAll(b, {
      A1: `${"a".repeat(12)}7z`,
      B1: `${"*a".repeat(12)}*7z`,
      C1: "=COUNTIF(A1,B1)",
      F1: "=SEARCH(B1,A1)",
    });
    expect(val(b, "C1")).toBe(1);
    expect(val(b, "F1")).toBe(1);
    b.engine.destroy();
    b.doc.destroy();
  });

  test("cached patterns keep whole-cell matching and each SEARCH start position separate", () => {
    const b = book();
    putAll(b, { A1: "ab-ab", B1: "a*", C1: "=COUNTIF(A1,B1)", F1: "=SEARCH(B1,A1,4)", E1: "=SEARCH(B1,A1)" });
    expect(val(b, "F1")).toBe(4);
    expect(val(b, "C1")).toBe(1);
    expect(val(b, "E1")).toBe(1);
    putAll(b, { A1: "xxab-ab" });
    expect(val(b, "F1")).toBe(6);
    expect(val(b, "C1")).toBe(0);
    expect(val(b, "E1")).toBe(3);
    b.engine.destroy();
    b.doc.destroy();
  });

  test("repeated stars and fixed pieces finish on long nonmatching text", () => {
    // A subprocess deadline can stop a regressed synchronous RegExp match, keeping the test runner responsive.
    const code = `
      import { sheetDoc, EN } from ${JSON.stringify(new URL("./spreadsheet-fixtures.ts", import.meta.url).href)};
      import { LOCAL } from ${JSON.stringify(new URL("../src/origins.ts", import.meta.url).href)};
      import { setValues } from ${JSON.stringify(new URL("../src/spreadsheet/ops.ts", import.meta.url).href)};
      import { SheetEngine } from ${JSON.stringify(new URL("../src/spreadsheet/engine.ts", import.meta.url).href)};
      const { doc, sheet } = sheetDoc();
      const text = "a".repeat(31999);
      const pattern = "*a*a*a*a*a*b";
      const formulas = [
        '=COUNTIF(A1:A2,"' + pattern + '")',
        '=SUMIF(A1:A2,"' + pattern + '",B1:B2)',
        '=XLOOKUP("' + pattern + '",A1:A2,B1:B2,"none",2)',
        '=MATCH("' + pattern + '",A1:A2,0)',
        '=SEARCH("' + pattern + '",A1)',
        '=SEARCH("' + pattern + '",A2)',
        '=SEARCH("a*a*a*a*a*b",A1)',
        '=SEARCH("a*a*a*a*a*b",A2,10000)',
        '=COUNTIF(A1,"' + "*".repeat(128) + 'b")'
      ];
      setValues(doc, { sheet, row: 0, col: 0 }, [[text, 5], [text + "b", 7]], EN, LOCAL);
      setValues(doc, { sheet, row: 2, col: 0 }, [formulas], EN, LOCAL);
      const engine = new SheetEngine(doc, { locale: EN });
      console.log(JSON.stringify(formulas.map((_, col) => engine.valueAt(sheet, 2, col))));
      engine.destroy();
      doc.destroy();
    `;
    const result = spawnSync(process.execPath, ["--eval", code], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([1, 7, 7, 2, err("#VALUE!"), 1, err("#VALUE!"), 10000, 0]);
  }, 10000);
});
