import { describe, expect, test } from "bun:test";
import { book, type Case, err, ev, put, putAll, same, val } from "./formula-helpers";

describe("NUMBERVALUE group separators", () => {
  const invalid: Case[] = [
    ['=NUMBERVALUE("1,234.56,7",".",",")', err("#VALUE!")],
    ['=NUMBERVALUE("2.500,2.7",",",".")', err("#VALUE!")],
    ['=NUMBERVALUE("12.34,")', err("#VALUE!")],
    ['=NUMBERVALUE(".1,2")', err("#VALUE!")],
    ['=NUMBERVALUE("1.2,3%")', err("#VALUE!")],
    ['=NUMBERVALUE("1|234:5|6",":","|")', err("#VALUE!")],
    ['=NUMBERVALUE("1,234.5,6","..",",,")', err("#VALUE!")],
    ['=NUMBERVALUE("1,234",",",",")', err("#VALUE!")],
  ];
  test.each(invalid)("%s rejects grouping after the decimal", (formula, expected) => same(ev(formula), expected));

  const valid: Case[] = [
    ['=NUMBERVALUE("1,234.567",".",",")', 1234.567],
    ['=NUMBERVALUE("2.500,27",",",".")', 2500.27],
    ['=NUMBERVALUE("12,34,567.89")', 1234567.89],
    ['=NUMBERVALUE("1,234")', 1234],
    ['=NUMBERVALUE(" 1, 234 . 56 ")', 1234.56],
    ['=NUMBERVALUE(".12")', 0.12],
    ['=NUMBERVALUE("1,234.56%%")', 0.123456],
    ['=NUMBERVALUE("1|234:56",":","|")', 1234.56],
    ['=NUMBERVALUE("1,234.56","..",",,")', 1234.56],
    ['=NUMBERVALUE("")', 0],
  ];
  test.each(valid)("%s preserves valid conversion", (formula, expected) => same(ev(formula), expected));

  test.each([
    ["en-US", "1,234.56", "1,234.5,6"],
    ["pt-BR", "1.234,56", "1.234,5.6"],
  ])("%s propagates invalid pasted amounts to dependent formulas", (locale, validText, invalidText) => {
    const b = book(["Amounts"], { locale });
    try {
      putAll(b, { A1: validText, B1: "=NUMBERVALUE(A1)", C1: "=B1*2" });
      same(val(b, "B1"), 1234.56);
      same(val(b, "C1"), 2469.12);

      put(b, "A1", invalidText);
      expect(val(b, "B1")).toEqual(err("#VALUE!"));
      expect(val(b, "C1")).toEqual(err("#VALUE!"));

      put(b, "A1", validText);
      same(val(b, "C1"), 2469.12);
    } finally {
      b.engine.destroy();
      b.doc.destroy();
    }
  });
});
