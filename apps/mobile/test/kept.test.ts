import { expect, test } from "bun:test";
import { kept, type StillFace, stillFaceKey, stillImageKey } from "../src/agent/kept";

const face: StillFace = {
  drawn: "sky:#4a90e2",
  eyes: "dot",
  accessory: undefined,
  size: 40,
  mode: "idle",
  seed: 3.12,
  reduced: false,
  tile: true,
  dark: false,
  expression: undefined,
  gaze: undefined,
  bodyless: false,
};

test("identical faces share one key; size, theme, look and density each make another", () => {
  expect(stillFaceKey({ ...face })).toBe(stillFaceKey(face));
  const key = stillFaceKey(face);
  expect(stillFaceKey({ ...face, size: 41 })).not.toBe(key);
  expect(stillFaceKey({ ...face, dark: true })).not.toBe(key);
  expect(stillFaceKey({ ...face, accessory: "hat" })).not.toBe(key);
  expect(stillFaceKey({ ...face, gaze: "up" })).not.toBe(key);
  expect(stillImageKey(key, 2)).toBe(stillImageKey(key, 2));
  expect(stillImageKey(key, 3)).not.toBe(stillImageKey(key, 2));
});

test("kept makes once, keeps the most recently used and drops the oldest past its limit", () => {
  const map = new Map<string, string | null>();
  let made = 0;
  const make = (v: string | null) => () => {
    made++;
    return v;
  };
  expect(kept(map, "a", make("A"), 2)).toBe("A");
  expect(kept(map, "a", make("other"), 2)).toBe("A");
  expect(made).toBe(1);
  // A failure is kept too: never retried on the next mount.
  expect(kept(map, "b", make(null), 2)).toBeNull();
  expect(kept(map, "b", make("B"), 2)).toBeNull();
  expect(made).toBe(2);
  // "a" used last, so "b" is the oldest when "c" comes in.
  kept(map, "a", make("x"), 2);
  kept(map, "c", make("C"), 2);
  expect([...map.keys()]).toEqual(["a", "c"]);
  expect(map.size).toBe(2);
});
