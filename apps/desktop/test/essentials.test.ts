import { describe, expect, test } from "bun:test";
import type { ControlStatus } from "@agenteschat/adapters/runner-control";
import {
  ESSENTIAL_IDS,
  type Essential,
  type EssentialId,
  type EssentialsInput,
  essentialsOf,
  fallenSince,
  fellByItself,
  type Health,
  needsYou,
} from "../src/control/essentials";
import { type LocalServerStatus, NO_SERVER } from "../src/control/local-server";
import type { TrayInput } from "../src/control/tray";

/** Everything the system says is on. */
const health = (over: Partial<Health> = {}): Health => ({
  autostart: true,
  screen: true,
  disk: true,
  notifications: "granted",
  keepRunning: { autoLogin: true, autoRestart: true },
  awake: true,
  ...over,
});

/** A workspace that paired this computer (its agents work here). */
const paired: TrayInput = { running: true, status: { paired: true } as ControlStatus, jobs: [] };
/** A home still signing in: it doesn't make this computer used. */
const signingIn: TrayInput = { running: true, status: { paired: false } as ControlStatus, jobs: [] };

/** The server running here, reach on and working, backups on, this Mac kept awake. */
const here = (over: Partial<LocalServerStatus> = {}): LocalServerStatus => ({
  ...NO_SERVER,
  installed: "app",
  run: true,
  owner: true,
  phase: "running",
  url: "http://127.0.0.1:4310",
  publicUrl: "https://agentes.tail1234.ts.net",
  reach: true,
  way: { kind: "tailscale" },
  awake: true,
  reachHealth: "on",
  backups: { nightly: true, copyTo: null, files: [], problem: null },
  ...over,
});

const input = (over: Partial<EssentialsInput> = {}): EssentialsInput => ({
  health: health(),
  local: NO_SERVER,
  autoUpdate: true,
  update: { available: false, required: false },
  homes: [paired],
  platform: "mac",
  ...over,
});

const byId = (list: readonly Essential[], id: EssentialId) => {
  const found = list.find((e) => e.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const states = (list: readonly Essential[]) => Object.fromEntries(list.map((e) => [e.id, e.state]));

describe("essentialsOf", () => {
  test("every essential, once each, in the Overview's order", () => {
    const list = essentialsOf(input({ local: here() }));
    expect(list.map((e) => e.id)).toEqual([...ESSENTIAL_IDS]);
    expect(needsYou(list)).toBe(0);
    expect(list.every((e) => e.state === "on" && e.fix === null)).toBe(true);
  });

  test("a computer nothing uses yet (no workspace paired it, no server here): only updates are one", () => {
    const list = essentialsOf(input({ homes: [], health: health({ autostart: false, screen: false, disk: false }) }));
    expect(states(list)).toEqual({
      launchAtLogin: "na",
      notifications: "na",
      screen: "na",
      disk: "na",
      reach: "na",
      backup: "na",
      autoUpdate: "on",
      awake: "na",
      powerRestart: "na",
      autoLogin: "na",
    });
    expect(needsYou(list)).toBe(0);
    // A home that is only signing in doesn't count either.
    const signing = essentialsOf(input({ homes: [signingIn], health: health({ screen: false }) }));
    expect(byId(signing, "screen").state).toBe("na");
  });

  test("a paired Mac without the server: open at login and the permissions; not the server's items", () => {
    const list = essentialsOf(input());
    expect(states(list)).toMatchObject({
      launchAtLogin: "on",
      notifications: "on",
      screen: "on",
      disk: "on",
      reach: "na",
      backup: "na",
      awake: "na",
      powerRestart: "na",
      autoLogin: "na",
    });
  });

  test("before the system's first answer, what it says is still being read and nothing needs the person", () => {
    const list = essentialsOf(input({ health: null, local: here() }));
    expect(states(list)).toMatchObject({
      launchAtLogin: "checking",
      notifications: "checking",
      screen: "checking",
      disk: "checking",
      powerRestart: "checking",
      autoLogin: "checking",
      // What the server here's status says is known already.
      reach: "on",
      backup: "on",
      awake: "on",
    });
    expect(needsYou(list)).toBe(0);
  });

  test("open at login and the permissions off: each with the one action that turns it on, each counted", () => {
    const list = essentialsOf(
      input({ health: health({ autostart: false, notifications: "notDetermined", screen: false, disk: false }) }),
    );
    expect(byId(list, "launchAtLogin")).toEqual({ id: "launchAtLogin", state: "off", fix: { kind: "autostart" } });
    expect(byId(list, "notifications").fix).toEqual({ kind: "permission", permission: "notifications" });
    expect(byId(list, "screen").fix).toEqual({ kind: "permission", permission: "screen" });
    expect(byId(list, "disk").fix).toEqual({ kind: "permission", permission: "disk" });
    expect(needsYou(list)).toBe(4);
    // Notifications turned off by the person read the same way: off, fixed in System Settings by the screen.
    const denied = essentialsOf(input({ health: health({ notifications: "denied" }) }));
    expect(byId(denied, "notifications").state).toBe("off");
  });

  test("Windows and Linux: open at login, no macOS permissions, nothing to keep awake, no macOS settings", () => {
    for (const platform of ["windows", "linux"] as const) {
      const list = essentialsOf(
        input({
          platform,
          local: here(),
          health: health({ autostart: false, keepRunning: { autoLogin: null, autoRestart: null }, awake: null }),
        }),
      );
      expect(states(list)).toEqual({
        launchAtLogin: "off",
        notifications: "na",
        screen: "na",
        disk: "na",
        reach: "on",
        backup: "on",
        autoUpdate: "on",
        awake: "na",
        powerRestart: "na",
        autoLogin: "na",
      });
      expect(needsYou(list)).toBe(1);
    }
  });

  test("the server here makes this computer used even before any workspace pairs it", () => {
    const list = essentialsOf(input({ homes: [], local: here(), health: health({ autostart: false }) }));
    expect(byId(list, "launchAtLogin").state).toBe("off");
    expect(byId(list, "screen").state).toBe("on");
  });
});

describe("reach (the server here only)", () => {
  const reach = (over: Partial<EssentialsInput>) => byId(essentialsOf(input(over)), "reach");

  test("left off by the person (only this computer): shown with its switch, never counted", () => {
    const item = reach({ local: here({ reach: false, reachHealth: "off", way: null }) });
    expect(item).toEqual({ id: "reach", state: "off", fix: { kind: "reach" }, reason: "chosen", optional: true });
    expect(needsYou([item])).toBe(0);
    // Turned off with a way saved (kept for turning it on again): still the person's choice.
    expect(reach({ local: here({ reach: false, reachHealth: "off" }) }).reason).toBe("chosen");
  });

  test("from what the status says (ADR 0256 §4): HTTPS waiting, Tailscale not connected, the address down", () => {
    expect(reach({ local: here({ reachHealth: "approve" }) })).toEqual({
      id: "reach",
      state: "off",
      fix: { kind: "tailscaleHttps" },
      reason: "approve",
    });
    expect(reach({ local: here({ reachHealth: "down", reachDown: true }) })).toMatchObject({
      reason: "down",
      fix: { kind: "tailscaleStart" },
    });
    const address = here({
      way: { kind: "address", url: "https://agentes.example.com" },
      publicUrl: "https://agentes.example.com",
      reachHealth: "address",
      reachDown: true,
    });
    expect(reach({ local: address })).toMatchObject({ reason: "address", fix: { kind: "reachCheck" } });
    for (const reachHealth of ["approve", "down", "address"] as const) {
      const item = reach({ local: here({ reachHealth }) });
      expect(needsYou([item])).toBe(1);
      expect(fellByItself(item)).toBe(true);
    }
  });

  test("on while the status says so, either way", () => {
    expect(reach({ local: here() }).state).toBe("on");
    const address = here({ way: { kind: "address", url: "https://agentes.example.com" } });
    expect(reach({ local: address })).toEqual({ id: "reach", state: "on", fix: null });
  });

  test("no server here: not one", () => {
    expect(reach({ local: NO_SERVER }).state).toBe("na");
  });
});

describe("the nightly backup (the server here only)", () => {
  const backup = (backups: Partial<LocalServerStatus["backups"]>) =>
    byId(essentialsOf(input({ local: here({ backups: { ...here().backups, ...backups } }) })), "backup");

  test("on and working, switched off, or the last one failed", () => {
    expect(backup({}).state).toBe("on");
    expect(backup({ nightly: false })).toEqual({
      id: "backup",
      state: "off",
      fix: { kind: "backups" },
      reason: "off",
    });
    expect(backup({ problem: "backup" })).toMatchObject({ state: "off", fix: { kind: "backupNow" }, reason: "backup" });
    expect(backup({ problem: "copy" })).toMatchObject({ state: "off", fix: { kind: "backupNow" }, reason: "copy" });
    expect(needsYou([backup({ nightly: false })])).toBe(1);
  });

  test("no server here: not one", () => {
    expect(byId(essentialsOf(input()), "backup").state).toBe("na");
  });
});

describe("updates", () => {
  test("installing at night is on by default; off is one to turn on again", () => {
    expect(byId(essentialsOf(input()), "autoUpdate").state).toBe("on");
    expect(byId(essentialsOf(input({ autoUpdate: false })), "autoUpdate")).toEqual({
      id: "autoUpdate",
      state: "off",
      fix: { kind: "autoUpdate" },
    });
  });

  test("a version that can't keep working needs the update, even with installing at night on", () => {
    const item = byId(essentialsOf(input({ update: { available: true, required: true } })), "autoUpdate");
    expect(item).toEqual({ id: "autoUpdate", state: "off", fix: { kind: "update" }, reason: "required" });
    // Only available: the night's install takes it, nothing needs the person.
    expect(byId(essentialsOf(input({ update: { available: true, required: false } })), "autoUpdate").state).toBe("on");
  });
});

describe("staying awake while serving (a Mac running the server)", () => {
  const awake = (over: Partial<EssentialsInput>) => byId(essentialsOf(input(over)), "awake");

  test("running without keeping this Mac awake: restarting the server starts it again", () => {
    expect(awake({ local: here(), health: health({ awake: false }) })).toEqual({
      id: "awake",
      state: "off",
      fix: { kind: "restartServer" },
    });
    // The system's read is the newer one; before it answers, the status says it.
    expect(awake({ local: here({ awake: false }), health: health({ awake: true }) }).state).toBe("on");
    expect(awake({ local: here({ awake: false }), health: null }).state).toBe("off");
  });

  test("only while it serves: stopped, starting or not here, not one", () => {
    expect(awake({ local: here({ phase: "stopped" }), health: health({ awake: false }) }).state).toBe("na");
    expect(awake({ local: here({ phase: "starting" }), health: health({ awake: false }) }).state).toBe("na");
    expect(awake({ health: health({ awake: false }) }).state).toBe("na");
  });
});

describe("macOS's own settings (a Mac running the server)", () => {
  test("off: shown with System Settings, never counted (the person's or macOS's choice)", () => {
    const list = essentialsOf(
      input({ local: here(), health: health({ keepRunning: { autoLogin: false, autoRestart: false } }) }),
    );
    expect(byId(list, "powerRestart")).toEqual({
      id: "powerRestart",
      state: "off",
      fix: { kind: "systemSettings", page: "energy" },
      optional: true,
    });
    expect(byId(list, "autoLogin")).toEqual({
      id: "autoLogin",
      state: "off",
      fix: { kind: "systemSettings", page: "users" },
      optional: true,
    });
    expect(needsYou(list)).toBe(0);
  });

  test("a laptop has no power-failure setting, FileVault no automatic login: not one", () => {
    const list = essentialsOf(
      input({ local: here(), health: health({ keepRunning: { autoLogin: null, autoRestart: null } }) }),
    );
    expect(byId(list, "powerRestart").state).toBe("na");
    expect(byId(list, "autoLogin").state).toBe("na");
  });

  test("without the server here: not one", () => {
    const list = essentialsOf(input({ health: health({ keepRunning: { autoLogin: false, autoRestart: false } }) }));
    expect(byId(list, "powerRestart").state).toBe("na");
    expect(byId(list, "autoLogin").state).toBe("na");
  });
});

describe("needsYou", () => {
  test("counts what is off and on by default, never what is checking, not one, or the person's choice", () => {
    const list = essentialsOf(
      input({
        local: here({ reach: false, reachHealth: "off", backups: { ...here().backups, nightly: false } }),
        health: health({ screen: false, keepRunning: { autoLogin: false, autoRestart: false } }),
        autoUpdate: false,
      }),
    );
    // Screen Recording, the nightly backup and installing at night; not reach (only this computer) nor macOS's own.
    expect(needsYou(list)).toBe(3);
    expect(needsYou([])).toBe(0);
  });
});

describe("notifications for what fell", () => {
  const listWith = (over: Partial<Health> = {}, local: LocalServerStatus = here()) =>
    essentialsOf(input({ local, health: health(over) }));

  test("only what fell by itself is told, never a switch the person turned off in the app", () => {
    const off = (over: Partial<Health>, local?: LocalServerStatus) =>
      listWith(over, local).filter((e) => e.state === "off");
    expect(off({ screen: false }).every(fellByItself)).toBe(true);
    expect(off({ disk: false }).every(fellByItself)).toBe(true);
    expect(off({ awake: false }).every(fellByItself)).toBe(true);
    expect(off({}, here({ reachHealth: "address" })).every(fellByItself)).toBe(true);
    expect(off({}, here({ backups: { ...here().backups, problem: "copy" } })).every(fellByItself)).toBe(true);
    // Turned off by the person: open at login, notifications, reach left off, backups switched off.
    expect(off({ autostart: false }).some(fellByItself)).toBe(false);
    expect(off({ notifications: "denied" }).some(fellByItself)).toBe(false);
    expect(off({}, here({ reach: false, reachHealth: "off" })).some(fellByItself)).toBe(false);
    expect(off({}, here({ backups: { ...here().backups, nightly: false } })).some(fellByItself)).toBe(false);
    const required = essentialsOf(input({ update: { available: true, required: true } }));
    expect(byId(required, "autoUpdate").state).toBe("off");
    expect(fellByItself(byId(required, "autoUpdate"))).toBe(true);
    expect(fellByItself(byId(essentialsOf(input({ autoUpdate: false })), "autoUpdate"))).toBe(false);
  });

  test("each is told once as it falls, again only after it came back on", () => {
    // The first read: nothing told, what is on remembered.
    const first = fallenSince(listWith(), null);
    expect(first.fallen).toEqual([]);
    expect(first.seen.on).toContain("screen");
    expect(first.seen.on).toContain("awake");
    // macOS takes Screen Recording back: told.
    const fell = fallenSince(listWith({ screen: false }), first.seen);
    expect(fell.fallen).toEqual(["screen"]);
    expect(fell.seen.on).not.toContain("screen");
    // Read again while still off: not told again.
    expect(fallenSince(listWith({ screen: false }), fell.seen).fallen).toEqual([]);
    // Back on, then off again: told again.
    const back = fallenSince(listWith(), fell.seen);
    expect(back.fallen).toEqual([]);
    expect(fallenSince(listWith({ screen: false }), back.seen).fallen).toEqual(["screen"]);
  });

  test("one never seen on is never told; a read still under way keeps what was seen", () => {
    // Off since before (skipped at Prepare): the Overview and the tray say it, no notification.
    const skipped = fallenSince(listWith({ disk: false }), { on: [] });
    expect(skipped.fallen).toEqual([]);
    // Still being read: whatever it was stays as it was, nothing told.
    const seen = { on: ["screen", "disk"] as EssentialId[] };
    const checking = fallenSince(essentialsOf(input({ health: null, local: here() })), seen);
    expect(checking.fallen).toEqual([]);
    expect(checking.seen.on).toEqual(expect.arrayContaining(["screen", "disk"]));
  });

  test("several fall at once: each is told", () => {
    const first = fallenSince(listWith(), null);
    const both = fallenSince(listWith({ screen: false, disk: false, awake: false }), first.seen);
    expect(both.fallen).toEqual(["screen", "disk", "awake"]);
  });
});
