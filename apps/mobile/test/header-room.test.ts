import { describe, expect, test } from "bun:test";
import { facesFit, MIN_ROOM, pillRoom, switchFits } from "../src/features/chat/headerRoom";

describe("the chat bar's room for the switch button", () => {
  test("the pill's room shrinks by a button's 44 and never under its floor", () => {
    expect(pillRoom(390, 0)).toBe(238);
    expect(pillRoom(390, 1)).toBe(194);
    expect(pillRoom(320, 3)).toBe(MIN_ROOM);
    expect(MIN_ROOM).toBe(120);
  });

  test("it shows on a 360 phone with one other button and steps aside once a second one crowds it", () => {
    expect(switchFits(360, 0)).toBe(true);
    expect(switchFits(360, 1)).toBe(true);
    expect(switchFits(360, 2)).toBe(false);
  });

  test("a channel on a 411 dp phone (faces in the pill, search and a queue button) shows it", () => {
    expect(switchFits(411, 1)).toBe(true);
    expect(switchFits(411, 2)).toBe(true);
  });

  test("it shows on a wide phone with one more button, and never leaves the pill under its floor", () => {
    expect(switchFits(430, 2)).toBe(true);
    for (const screen of [320, 360, 390, 430, 768]) {
      for (const extra of [0, 1, 2, 3]) {
        if (switchFits(screen, extra)) expect(screen - 152 - (extra + 1) * 44).toBeGreaterThanOrEqual(MIN_ROOM);
      }
    }
  });

  test("the right hand's DM (no computer button) and an agent DM without a computer keep it on 390, 393 and 402", () => {
    for (const screen of [390, 393, 402]) expect(switchFits(screen, 0)).toBe(true);
  });

  test("the member faces show only with a room of 160 or more, so the name keeps it on a 360 phone", () => {
    expect(facesFit(160)).toBe(true);
    expect(facesFit(159)).toBe(false);
    // 360 with the switch and search buttons: the pill is at its floor, no faces.
    expect(facesFit(pillRoom(360, 2))).toBe(false);
    expect(facesFit(pillRoom(411, 1))).toBe(true);
  });
});
