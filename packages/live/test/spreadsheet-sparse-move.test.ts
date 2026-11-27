import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { LOCAL } from "../src/origins";
import { copyRange, moveRange } from "../src/spreadsheet/clipboard";
import { cellsMap, getCell } from "../src/spreadsheet/doc";
import { SheetEngine } from "../src/spreadsheet/engine";
import { addSheet, ensureSize, formatRange, setValues } from "../src/spreadsheet/ops";
import { cell, cells, EN, range, sheetDoc, sync, twin } from "./spreadsheet-fixtures";

describe("moving sparse ranges", () => {
  test("empty source cells replace values, formulas and styles at the destination", () => {
    const { doc, sheet } = sheetDoc();
    setValues(doc, { sheet, row: 0, col: 0 }, [[7]], EN, LOCAL);
    setValues(doc, { sheet, row: 1, col: 1 }, [["=A1"]], EN, LOCAL);
    formatRange(doc, range(sheet, "C3"), { b: 1 }, LOCAL);
    setValues(doc, { sheet, row: 5, col: 5 }, [[99, "=1+1"]], EN, LOCAL);
    setValues(doc, { sheet, row: 8, col: 8 }, [[42]], EN, LOCAL);
    formatRange(doc, range(sheet, "F7"), { i: 1 }, LOCAL);
    setValues(doc, { sheet, row: 4, col: 4 }, [["outside"]], EN, LOCAL);
    moveRange(doc, range(sheet, "A1:D4"), { sheet, row: 5, col: 5 }, LOCAL);
    expect(cell(doc, sheet, "F6")).toBe("7");
    expect(cell(doc, sheet, "G7")).toBe("=F6");
    expect(getCell(doc, sheet, 7, 7)).toEqual({ s: { b: 1 } });
    expect(getCell(doc, sheet, 5, 6)).toBeUndefined();
    expect(getCell(doc, sheet, 6, 5)).toBeUndefined();
    expect(getCell(doc, sheet, 8, 8)).toBeUndefined();
    expect(getCell(doc, sheet, 2, 2)).toBeUndefined();
    expect(cell(doc, sheet, "E5")).toBe("outside");
    const engine = new SheetEngine(doc, { locale: EN });
    expect(engine.valueAt(sheet, 6, 6)).toBe(7);
    engine.destroy();
  });

  test("references to an entirely empty source block follow its full range", () => {
    const { doc, sheet } = sheetDoc();
    setValues(doc, { sheet, row: 0, col: 7 }, [["=A1+B2", "=SUM(A1:B2)", "=SUM(A1:C3)"]], EN, LOCAL);
    setValues(
      doc,
      { sheet, row: 3, col: 5 },
      [
        [8, "=2+2"],
        [null, 9],
      ],
      EN,
      LOCAL,
    );
    formatRange(doc, range(sheet, "F5"), { b: 1 }, LOCAL);
    moveRange(doc, range(sheet, "A1:B2"), { sheet, row: 3, col: 5 }, LOCAL);
    expect(cells(doc, sheet, "H1:J1")).toEqual([["=F4+G5", "=SUM(F4:G5)", "=SUM(A1:C3)"]]);
    for (let row = 3; row < 5; row++) {
      for (let col = 5; col < 7; col++) expect(getCell(doc, sheet, row, col)).toBeUndefined();
    }
    const engine = new SheetEngine(doc, { locale: EN });
    expect(engine.valueAt(sheet, 0, 7)).toBe(0);
    setValues(doc, { sheet, row: 3, col: 5 }, [[5]], EN, LOCAL);
    setValues(doc, { sheet, row: 4, col: 6 }, [[2]], EN, LOCAL);
    expect(engine.valueAt(sheet, 0, 7)).toBe(7);
    expect(engine.valueAt(sheet, 0, 8)).toBe(7);
    expect(engine.valueAt(sheet, 0, 9)).toBe(0);
    engine.destroy();
  });

  test("overlapping moves preserve source holes and snapshot formulas and style-only cells", () => {
    const { doc, sheet } = sheetDoc();
    ensureSize(doc, sheet, 1000, 500, LOCAL);
    setValues(
      doc,
      { sheet, row: 0, col: 0 },
      [
        [1, null, 2],
        [null, 3],
        [null, null, "=A1+C1"],
      ],
      EN,
      LOCAL,
    );
    formatRange(doc, range(sheet, "C2"), { b: 1 }, LOCAL);
    setValues(doc, { sheet, row: 1, col: 3 }, [[9], [null], [6]], EN, LOCAL);
    setValues(doc, { sheet, row: 0, col: 499 }, [["=B1"]], EN, LOCAL);
    moveRange(doc, range(sheet, "A1:GR1000"), { sheet, row: 1, col: 1 }, LOCAL);
    expect(cells(doc, sheet, "A1:D4")).toEqual([
      ["", "", "", ""],
      ["", "1", "", "2"],
      ["", "", "3", ""],
      ["", "", "", "=B2+D2"],
    ]);
    expect(getCell(doc, sheet, 2, 3)).toEqual({ s: { b: 1 } });
    expect(getCell(doc, sheet, 1, 2)).toBeUndefined();
    expect(cell(doc, sheet, "SF1")).toBe("=C2");
    const engine = new SheetEngine(doc, { locale: EN });
    expect(engine.valueAt(sheet, 3, 3)).toBe(3);
    engine.destroy();
  });

  test("cross-sheet moves preserve outside references and follow empty inside coordinates", () => {
    const { doc, sheet } = sheetDoc();
    const two = addSheet(doc, "Two", LOCAL);
    ensureSize(doc, sheet, 1000, 500, LOCAL);
    setValues(doc, { sheet, row: 0, col: 0 }, [[4]], EN, LOCAL);
    setValues(doc, { sheet, row: 1, col: 2 }, [["=A1+B2+SF1"]], EN, LOCAL);
    setValues(doc, { sheet, row: 0, col: 499 }, [[10], ["=B2"]], EN, LOCAL);
    formatRange(doc, range(sheet, "B1"), { i: 1 }, LOCAL);
    setValues(doc, { sheet: two, row: 3, col: 4 }, [[99]], EN, LOCAL);
    setValues(doc, { sheet: two, row: 0, col: 499 }, [["='Sheet 1'!B2"]], EN, LOCAL);
    moveRange(doc, range(sheet, "A1:GR1000"), { sheet: two, row: 2, col: 3 }, LOCAL);
    expect(cell(doc, two, "F4")).toBe("=D3+E4+'Sheet 1'!SF1");
    expect(cell(doc, sheet, "SF2")).toBe("=Two!E4");
    expect(cell(doc, two, "SF1")).toBe("=E4");
    expect(getCell(doc, two, 2, 4)).toEqual({ s: { i: 1 } });
    expect(getCell(doc, two, 3, 4)).toBeUndefined();
    const engine = new SheetEngine(doc, { locale: EN });
    expect(engine.valueAt(two, 3, 5)).toBe(14);
    setValues(doc, { sheet: two, row: 3, col: 4 }, [[6]], EN, LOCAL);
    expect(engine.valueAt(two, 3, 5)).toBe(20);
    expect(engine.valueAt(sheet, 1, 499)).toBe(6);
    expect(engine.valueAt(two, 0, 499)).toBe(6);
    engine.destroy();
  });

  test("a large sparse cut retains the selection, replicates and undoes in one step", () => {
    const { doc, sheet } = sheetDoc();
    ensureSize(doc, sheet, 3000, 500, LOCAL);
    setValues(doc, { sheet, row: 0, col: 0 }, [[3, null, "=A1*2"]], EN, LOCAL);
    setValues(doc, { sheet, row: 0, col: 499 }, [["=A1+GR1000"]], EN, LOCAL);
    setValues(doc, { sheet, row: 2000, col: 250 }, [[99, 88, 77]], EN, LOCAL);
    setValues(doc, { sheet, row: 2999, col: 449 }, [[11]], EN, LOCAL);
    const replica = twin(doc);
    const undo = new Y.UndoManager([doc.getMap("sheets"), doc.getArray("sheetOrder")], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 0,
    });
    const engine = new SheetEngine(doc, { locale: EN });
    const from = range(sheet, "A1:GR1000");
    const copied = copyRange(doc, from, engine, EN);
    expect(copied.cells).toHaveLength(1);
    expect(copied.cells[0]).toHaveLength(3);
    expect(moveRange(doc, from, { sheet, row: 2000, col: 250 }, LOCAL)).toEqual({
      sheet,
      r1: 2000,
      c1: 250,
      r2: 2999,
      c2: 449,
    });
    sync(doc, replica);
    expect(engine.valueAt(sheet, 2000, 252)).toBe(6);
    expect(engine.valueAt(sheet, 0, 499)).toBe(3);
    expect(getCell(doc, sheet, 2000, 251)).toBeUndefined();
    expect(getCell(doc, sheet, 2999, 449)).toBeUndefined();
    expect(cellsMap(doc, sheet)?.size).toBe(3);
    expect(getCell(replica, sheet, 2000, 250)).toEqual({ v: 3 });
    expect(getCell(replica, sheet, 2999, 449)).toBeUndefined();
    expect(getCell(replica, sheet, 0, 499)).toEqual(getCell(doc, sheet, 0, 499));
    undo.undo();
    expect(engine.valueAt(sheet, 0, 2)).toBe(6);
    expect(getCell(doc, sheet, 2000, 250)).toEqual({ v: 99 });
    expect(getCell(doc, sheet, 2000, 251)).toEqual({ v: 88 });
    expect(getCell(doc, sheet, 2999, 449)).toEqual({ v: 11 });
    expect(cellsMap(doc, sheet)?.size).toBe(7);
    undo.redo();
    expect(engine.valueAt(sheet, 2000, 252)).toBe(6);
    expect(getCell(doc, sheet, 2999, 449)).toBeUndefined();
    expect(undo.undoStack).toHaveLength(1);
    engine.destroy();
    undo.destroy();
    replica.destroy();
    doc.destroy();
  });

  test("a large completely empty source clears destination cells and moves references to its holes", () => {
    const { doc, sheet } = sheetDoc();
    ensureSize(doc, sheet, 3000, 500, LOCAL);
    setValues(doc, { sheet, row: 0, col: 499 }, [["=A1+GR1000"]], EN, LOCAL);
    setValues(doc, { sheet, row: 2000, col: 250 }, [[42]], EN, LOCAL);
    formatRange(doc, { sheet, r1: 2999, c1: 449, r2: 2999, c2: 449 }, { b: 1 }, LOCAL);
    moveRange(doc, range(sheet, "A1:GR1000"), { sheet, row: 2000, col: 250 }, LOCAL);
    expect(getCell(doc, sheet, 2000, 250)).toBeUndefined();
    expect(getCell(doc, sheet, 2999, 449)).toBeUndefined();
    expect(cellsMap(doc, sheet)?.size).toBe(1);
    const engine = new SheetEngine(doc, { locale: EN });
    expect(engine.valueAt(sheet, 0, 499)).toBe(0);
    setValues(doc, { sheet, row: 2999, col: 449 }, [[8]], EN, LOCAL);
    expect(engine.valueAt(sheet, 0, 499)).toBe(8);
    engine.destroy();
  });
});
