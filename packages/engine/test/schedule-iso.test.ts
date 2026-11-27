import { expect, test } from "bun:test";
import { parseWhen } from "../src/schedule";

const now = new Date("2026-11-13T09:00:30Z");
const read = (text: string, timezone = "UTC") => parseWhen(null, { orgId: "org", text, timezone, now });

test("an offset does not make an impossible calendar date a valid reminder", async () => {
  for (const text of ["2027-02-30T09:00:00Z", "2027-02-29T09:00:00+05:45", "2026-11-31T09:00:00-0300"]) {
    expect(await read(text)).toMatchObject({ ok: false, code: "when.nonexistent" });
  }
  expect(await read("2028-02-29T09:00:00Z")).toMatchObject({ ok: true, at: new Date("2028-02-29T09:00:00Z") });
});

test("local ISO seconds and milliseconds survive timezone conversion and the past check", async () => {
  expect(await read("2026-11-13T09:00:42.125")).toMatchObject({
    ok: true,
    at: new Date("2026-11-13T09:00:42.125Z"),
  });
  expect(await read("2026-11-14T09:00:42.125", "Asia/Kathmandu")).toMatchObject({
    ok: true,
    at: new Date("2026-11-14T03:15:42.125Z"),
  });
  expect(await read("2026-11-14T00:00:42.125+05:45")).toMatchObject({
    ok: true,
    at: new Date("2026-11-13T18:15:42.125Z"),
  });
});

test("invalid seconds are refused instead of being silently dropped", async () => {
  expect(await read("2026-11-14T09:00:99")).toMatchObject({ ok: false });
  expect(await read("2026-11-13T09:00:29.999")).toMatchObject({ ok: false, code: "when.past" });
});
