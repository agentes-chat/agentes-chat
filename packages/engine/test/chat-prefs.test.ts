import { expect, test } from "bun:test";
import { chatPrefsOf } from "../src/chat-prefs";

test("a person's own accent: a #rrggbb kept in lower case, anything else dropped", () => {
  expect(chatPrefsOf({ accent: "#F97316", textSize: "lg" })).toEqual({ accent: "#f97316", textSize: "lg" });
  for (const accent of ["orange", "#f97", "#f973160", "f97316", 42, null])
    expect(chatPrefsOf({ accent, textSize: "lg" })).toEqual({ textSize: "lg" });
});
