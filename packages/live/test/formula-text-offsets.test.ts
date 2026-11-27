import { describe, expect, test } from "bun:test";
import { type Case, err, ev } from "./formula-helpers";

describe("case-insensitive text functions retain original string positions", () => {
  const cases: Case[] = [
    ['=TEXTBEFORE("İstanbul:TR",":",1,1)', "İstanbul"],
    ['=TEXTAFTER("İstanbul:TR",":",1,1)', "TR"],
    ['=TEXTBEFORE("İ:A:İ:B",":",2,1)', "İ:A"],
    ['=TEXTAFTER("İ:A:İ:B",":",2,1)', "İ:B"],
    ['=TEXTBEFORE("İ:A:İ:B",":",-1,1)', "İ:A:İ"],
    ['=TEXTAFTER("İ:A:İ:B",":",-1,1)', "B"],
    ['=TEXTAFTER("İstanbul:TR|EU",{":","|"},1,1)', "TR|EU"],
    ['=TEXTBEFORE("İstanbul:TR|EU",{":","|"},2,1)', "İstanbul:TR"],
    ['=TEXTAFTER("XİY","İ",1,1)', "Y"],
    ['=TEXTAFTER("XİY","i",1,1)', "Y"],
    ['=TEXTAFTER("📝İ:x",":",1,1)', "x"],
    ['=SEARCH(":","İstanbul:TR")', 9],
    ['=SEARCH("TR","İstanbul:TR")', 10],
    ['=SEARCH("Y","XİY",3)', 3],
    ['=SEARCH("x","İx",2)', 2],
    ['=SEARCH("x","İx",3)', err("#VALUE!")],
    ['=SEARCH("","İx",3)', 3],
    ['=SEARCH("İ","XİY")', 2],
    ['=SEARCH("ς","ΟΣ")', 2],
    ['=SEARCH("ς","ΟΣ İ")', 2],
    ['=SEARCH("?R","İstanbul:TR")', 10],
    ['=SEARCH("*:","İstanbul:TR")', 1],
    ['=TEXTBEFORE("İstanbul:TR",":",1,0)', "İstanbul"],
    ['=TEXTAFTER("İstanbul:TR",":",1,0)', "TR"],
    ['=TEXTAFTER("İstanbul:TR","tr",1,0)', err("#N/A")],
    ['=TEXTAFTER("AbCx","c",1,1)', "x"],
    ['=TEXTBEFORE("İx",":",1,1,1)', "İx"],
    ['=TEXTAFTER("İx",":",1,1,1)', ""],
  ];

  for (const [formula, expected] of cases) {
    test(formula, () => {
      expect(ev(formula)).toEqual(expected);
    });
  }
});
