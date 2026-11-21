import { describe, expect, test } from "bun:test";
import { quickAgentHint, quickAgentIndex } from "../src/lib/agent-shortcuts";

const key = (over: Partial<Parameters<typeof quickAgentIndex>[0]>) => ({
  key: "1",
  code: "Digit1",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...over,
});

describe("quickAgentIndex", () => {
  test("Ctrl+1..9 off a Mac, ⌘1..9 on one", () => {
    expect(quickAgentIndex(key({ ctrlKey: true }), false)).toBe(0);
    expect(quickAgentIndex(key({ ctrlKey: true, key: "9", code: "Digit9" }), false)).toBe(8);
    expect(quickAgentIndex(key({ metaKey: true, key: "3", code: "Digit3" }), true)).toBe(2);
    expect(quickAgentIndex(key({ ctrlKey: true }), true)).toBeNull();
    expect(quickAgentIndex(key({ metaKey: true }), false)).toBeNull();
  });
  test("Alt+digit, for a browser tab that keeps Ctrl+digit", () => {
    expect(quickAgentIndex(key({ altKey: true, key: "2", code: "Digit2" }), false)).toBe(1);
  });
  test("a layout whose number row types other characters reads the key's place", () => {
    expect(quickAgentIndex(key({ ctrlKey: true, key: "&", code: "Digit1" }), false)).toBe(0);
  });
  test("plain digits, 0, Shift, AltGr and composing are left alone", () => {
    expect(quickAgentIndex(key({}), false)).toBeNull();
    expect(quickAgentIndex(key({ ctrlKey: true, key: "0", code: "Digit0" }), false)).toBeNull();
    expect(quickAgentIndex(key({ ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(quickAgentIndex(key({ ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(quickAgentIndex(key({ ctrlKey: true, isComposing: true }), false)).toBeNull();
  });
});

describe("quickAgentHint", () => {
  test("the first nine rows only", () => {
    expect(quickAgentHint(0, false)).toBe("Alt 1");
    expect(quickAgentHint(4, true)).toBe("⌘5");
    expect(quickAgentHint(9, false)).toBeNull();
  });
});
