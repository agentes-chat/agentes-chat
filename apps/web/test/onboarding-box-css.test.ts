import { describe, expect, test } from "bun:test";
import path from "node:path";
import { declarations } from "./built-css";

/*
 * The onboarding's box (ADR 0162): only its answer scrolls, between the title and the footer. What ends that scroll
 * area (the plan step's "See all plans" on a phone) needs room under it, or the edge cuts its last line.
 */

const read = (file: string) => Bun.file(path.join(import.meta.dir, "../src", file)).text();
const px = (value: string | undefined) => Number.parseFloat(value ?? "0");

describe("the onboarding's box", () => {
  test("its scroll area keeps room under its last line, more than the kit's focus-ring margin", async () => {
    const css = await read("pages/onboarding/shell.css");
    const body = declarations(css, ".onbx .ac-dialog__body.onbx__body");
    expect(body.find(([p]) => p === "overflow-y")?.[1]).toBe("auto");
    expect(px(body.filter(([p]) => p === "padding-bottom").at(-1)?.[1])).toBeGreaterThanOrEqual(12);
  });
});
