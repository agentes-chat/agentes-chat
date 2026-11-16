import { describe, expect, test } from "bun:test";
import { nearestRequestEffort } from "../src/catalog";

describe("the effort a call sends", () => {
  test("an unknown list keeps the call's own effort", () => {
    expect(nearestRequestEffort("low", undefined)).toBe("low");
    expect(nearestRequestEffort("medium", {})).toBe("medium");
  });
  test("a model tested as taking none gets no effort at all", () => {
    expect(nearestRequestEffort("high", { efforts: [] })).toBeUndefined();
  });
  test("otherwise the nearest level it takes, a tie going up", () => {
    expect(nearestRequestEffort("low", { efforts: ["high"] })).toBe("high");
    expect(nearestRequestEffort("medium", { efforts: ["low", "high"] })).toBe("high");
    expect(nearestRequestEffort("high", { efforts: ["low", "medium"] })).toBe("medium");
  });
  test("a list of names we don't send leaves the adapter to map it", () => {
    expect(nearestRequestEffort("medium", { efforts: ["ultra", "turbo"] })).toBe("medium");
  });
});
