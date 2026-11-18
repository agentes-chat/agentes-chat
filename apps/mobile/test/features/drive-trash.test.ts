import { describe, expect, test } from "bun:test";
import { TRASH_SOON_DAYS, trashLeft } from "../../src/features/drive/logic";

const now = new Date("2026-11-17T12:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe("the Drive's Lixeira on the phone, as the web's", () => {
  test("a file says the whole days it has left", () => {
    expect(trashLeft(inDays(20), now)).toEqual({ count: 20, soon: false, key: "drive.daysLeft" });
    expect(trashLeft(inDays(19.2), now).count).toBe(20);
  });

  test("with few days left it turns to attention, the web's chip", () => {
    expect(TRASH_SOON_DAYS).toBe(3);
    expect(trashLeft(inDays(3), now)).toEqual({ count: 3, soon: true, key: "drive.goneIn" });
    expect(trashLeft(inDays(4), now).soon).toBe(false);
    // Past its date (about to be purged): none left, never a negative count.
    expect(trashLeft(inDays(-1), now)).toEqual({ count: 0, soon: true, key: "drive.goneIn" });
  });
});
