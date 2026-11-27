import { expect, test } from "bun:test";
import type { NotifyPermission } from "../src/control/essentials";
import {
  allDone,
  askedIn,
  hasLocalNetwork,
  MAC_PERMISSIONS,
  readGrants,
  viaSettings,
  withAsked,
} from "../src/control/permissions";
import type { Host } from "../src/host/types";

/** A Mac's answers for Screen Recording, Full Disk Access and the app's notifications, none of them asking. */
const mac = (screen: boolean, disk: boolean, notifications: NotifyPermission = "granted") =>
  ({
    screenAccess: async () => screen,
    diskAccess: async () => disk,
    notificationPermission: async () => notifications,
  }) as unknown as Host;

test("Prepare asks for notifications, Screen Recording and Full Disk Access, never Local Network (ADR 0256)", () => {
  expect([...MAC_PERMISSIONS]).toEqual(["notifications", "screen", "disk"]);
  expect(MAC_PERMISSIONS as readonly string[]).not.toContain("network");
});

test("a permission is asked once per version of the app: an update asks again", () => {
  const once = withAsked(null, "0.6.0", "screen");
  expect(withAsked(once, "0.6.0", "screen")).toEqual({ version: "0.6.0", asked: ["screen"] });
  expect(askedIn(withAsked(once, "0.6.0", "disk"), "0.6.0")).toEqual(["screen", "disk"]);
  expect(askedIn(once, "0.6.1")).toEqual([]);
  // Local Network is still remembered as asked: the site's just-in-time ask uses the same record.
  expect(withAsked(once, "0.6.1", "network")).toEqual({ version: "0.6.1", asked: ["network"] });
});

test("each state read without a prompt: off once asked and not allowed, notifications as macOS keeps them", async () => {
  expect(await readGrants(mac(false, false, "notDetermined"), [])).toEqual({
    notifications: "ask",
    screen: "ask",
    disk: "ask",
  });
  expect(await readGrants(mac(false, true, "denied"), ["screen"])).toEqual({
    notifications: "off",
    screen: "off",
    disk: "on",
  });
  // Full Disk Access reads On before anyone asked: reading it never prompts.
  const ready = await readGrants(mac(true, true), []);
  expect(ready).toEqual({ notifications: "on", screen: "on", disk: "on" });
  expect(allDone(ready)).toBe(true);
  expect(allDone({ ...ready, notifications: "ask" })).toBe(false);
  expect(allDone({ ...ready, notifications: "off" })).toBe(false);
  expect(allDone({ ...ready, disk: "off" })).toBe(false);
});

test("an old Local Network answer in the record changes nothing Prepare shows", async () => {
  const grants = await readGrants(mac(true, true), ["network"]);
  expect(Object.keys(grants).sort()).toEqual(["disk", "notifications", "screen"]);
  expect(allDone(grants)).toBe(true);
});

test("Local Network is a permission from macOS 15 on: before that the site's ask does nothing", () => {
  expect(hasLocalNetwork("14.7.1")).toBe(false);
  expect(hasLocalNetwork("11.0")).toBe(false);
  expect(hasLocalNetwork("15.0")).toBe(true);
  expect(hasLocalNetwork("26.1")).toBe(true);
  // A version the app couldn't read asks: a click too many beats adb without the grant.
  expect(hasLocalNetwork(null)).toBe(true);
});

test("Full Disk Access always goes to System Settings, the others once asked (macOS prompts only once)", () => {
  expect(viaSettings("disk", "ask")).toBe(true);
  expect(viaSettings("screen", "ask")).toBe(false);
  expect(viaSettings("screen", "off")).toBe(true);
  expect(viaSettings("notifications", "ask")).toBe(false);
  expect(viaSettings("notifications", "off")).toBe(true);
});
