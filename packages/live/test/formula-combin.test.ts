import { describe, expect, test } from "bun:test";
import { book, err, ev, putAll, val } from "./formula-helpers";

describe("COMBIN near the finite numeric limit", () => {
  // Integer reference values calculated with Python's exact math.comb before conversion to float.
  for (const [n, k, expected] of [
    [1022, 511, 1.1214087637706124e306],
    [1028, 514, 7.156051054877897e307],
    [1027, 513, 3.5780255274389484e307],
    [1028, 510, 6.936933673780968e307],
    [1028, 518, 6.936933673780968e307],
  ]) {
    test(`${n} choose ${k} remains finite`, () => {
      const result = ev(`=COMBIN(${n},${k})`);
      expect(typeof result).toBe("number");
      expect(Math.abs((result as number) / (expected as number) - 1)).toBeLessThan(1e-13);
    });
  }

  test("a two-item choice does not overflow before its division by two", () => {
    const result = ev("=COMBIN(1.4E154,2)");
    expect(typeof result).toBe("number");
    expect(Math.abs((result as number) / 9.8e307 - 1)).toBeLessThan(1e-13);
  });

  for (const [formula, expected] of [
    ["=COMBIN(52,5)", 2598960],
    ["=COMBIN(8.9,2.9)", 28],
    ["=COMBIN(0,0)", 1],
    ["=COMBIN(8,8)", 1],
    ["=COMBIN(4,5)", err("#NUM!")],
    ["=COMBIN(-1,0)", err("#NUM!")],
    ["=COMBIN(8,-1)", err("#NUM!")],
    ["=COMBIN(1030,515)", err("#NUM!")],
  ] as const) {
    test(`${formula} retains its result`, () => {
      expect(ev(formula)).toEqual(expected);
    });
  }

  test("dependent cells recover when a choice returns to the finite range", () => {
    const b = book();
    try {
      putAll(b, { A1: 1028, A2: 514, B1: "=COMBIN(A1,A2)", C1: "=B1/1E307" });
      expect(val(b, "C1")).toBeCloseTo(7.156051054877897, 12);
      putAll(b, { A1: 1030, A2: 515 });
      expect(val(b, "B1")).toEqual(err("#NUM!"));
      expect(val(b, "C1")).toEqual(err("#NUM!"));
      putAll(b, { A1: 52, A2: 5 });
      expect(val(b, "B1")).toBe(2598960);
    } finally {
      b.engine.destroy();
      b.doc.destroy();
    }
  });
});
