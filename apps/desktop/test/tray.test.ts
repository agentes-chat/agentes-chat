import { describe, expect, test } from "bun:test";
import type { ControlJob, ControlStatus } from "@agenteschat/adapters/runner-control";
import type { Essential } from "../src/control/essentials";
import { NO_SERVER } from "../src/control/local-server";
import { combinedPause, extendPause, pauseUntil } from "../src/control/pause";
import { macStateOf, type TrayInput, trayStateOf } from "../src/control/tray";
import { desktopEn } from "../src/i18n/keys.en";
import { desktopPtBR } from "../src/i18n/keys.pt-BR";
import {
  agentRows,
  bannerEssential,
  essentialIcon,
  essentialWords,
  fixLabel,
  fixPlan,
  headLine,
  hereState,
} from "../src/windows/popover/state";

const status = (over: Partial<ControlStatus> = {}): ControlStatus => ({
  paired: true,
  connection: "online",
  version: "0.1.0",
  protocol: 10,
  paused: { paused: false },
  executors: {},
  agents: [],
  ...over,
});
const job: ControlJob = { id: "j", kind: "exec", summary: "bun test", startedAt: "2026-10-17T15:00:00Z" };
const home = (over: Partial<ControlStatus> = {}, jobs: ControlJob[] = [], running = true): TrayInput => ({
  running,
  status: status(over),
  jobs,
});

describe("trayStateOf", () => {
  test("idle with nothing going on", () => {
    expect(trayStateOf([home(), home()], false)).toBe("idle");
    expect(trayStateOf([], false)).toBe("idle");
  });
  test("any paused organization pauses the icon", () => {
    expect(trayStateOf([home({}, [job]), home({ paused: { paused: true, until: null } })], true)).toBe("paused");
  });
  test("any job means working", () => {
    expect(trayStateOf([home(), home({}, [job])], false)).toBe("working");
  });
  test("offline only when every organization is offline", () => {
    expect(trayStateOf([home({ connection: "offline" }), home()], false)).toBe("idle");
    expect(trayStateOf([home({ connection: "offline" }), home({}, [], false)], false)).toBe("offline");
  });
  test("a newer version shows the update badge when nothing else does", () => {
    expect(trayStateOf([home()], true)).toBe("update");
    expect(trayStateOf([home({}, [job])], true)).toBe("working");
  });
  test("unpaired homes (a sign-in in progress) don't count", () => {
    expect(trayStateOf([home({ paired: false, connection: "unpaired" })], false)).toBe("idle");
  });
  test("an essential that needs the person turns the icon to attention, over everything but an agent asking", () => {
    expect(trayStateOf([home()], false, 1)).toBe("attention");
    expect(trayStateOf([], false, 2)).toBe("attention");
    expect(trayStateOf([home({}, [job])], true, 1)).toBe("attention");
    expect(trayStateOf([home({ paused: { paused: true, until: null } })], false, 1)).toBe("attention");
    expect(trayStateOf([home({ connection: "offline" }), home({}, [], false)], false, 1)).toBe("attention");
    // An agent waiting for a person in its browser is more urgent: the dot stays.
    const asking = home({
      browsers: [
        { agentId: "a1", open: true, host: "app.acme.example", handoff: { status: "pending", request: "Sign in" } },
      ],
    } as Partial<ControlStatus>);
    expect(trayStateOf([asking], false, 1)).toBe("needs");
    // Nothing needs the person: the usual states.
    expect(trayStateOf([home()], false, 0)).toBe("idle");
    expect(trayStateOf([home()], true, 0)).toBe("update");
  });
});

describe("pause", () => {
  const now = new Date(2026, 9, 17, 15, 24, 0);
  test("1 hour, tomorrow at 9, until resumed", () => {
    expect(pauseUntil("1h", now)).toBe(new Date(2026, 9, 17, 16, 24, 0).toISOString());
    expect(pauseUntil("tomorrow", now)).toBe(new Date(2026, 9, 18, 9, 0, 0).toISOString());
    expect(pauseUntil("manual", now)).toBeNull();
  });
  test("+1 hour from the end, or from now when it already ended", () => {
    const until = new Date(2026, 9, 17, 16, 24).toISOString();
    expect(extendPause({ paused: true, until }, now)).toBe(new Date(2026, 9, 17, 17, 24).toISOString());
    const past = new Date(2026, 9, 17, 14, 0).toISOString();
    expect(extendPause({ paused: true, until: past }, now)).toBe(new Date(2026, 9, 17, 16, 24).toISOString());
    expect(extendPause({ paused: true, until: null }, now)).toBeNull();
  });
  test("several organizations: the latest end wins, until-resumed beats any time", () => {
    const a = new Date(2026, 9, 17, 16, 0).toISOString();
    const b = new Date(2026, 9, 17, 18, 0).toISOString();
    expect(combinedPause([{ paused: false }])).toBeNull();
    expect(
      combinedPause([
        { paused: true, until: a },
        { paused: true, until: b },
      ]),
    ).toEqual({ paused: true, until: b });
    expect(
      combinedPause([
        { paused: true, until: a },
        { paused: true, until: null },
      ]),
    ).toEqual({ paused: true, until: null });
  });
});

describe("macStateOf", () => {
  test("paused wins, then online, else offline", () => {
    expect(macStateOf([home(), home({ paused: { paused: true, until: null } })])).toBe("paused");
    expect(macStateOf([home({ connection: "offline" }), home()])).toBe("online");
    expect(macStateOf([home({}, [], false)])).toBe("offline");
    expect(macStateOf([])).toBe("offline");
  });
});

describe("the popover's head (ADR 0256 §7)", () => {
  test("what needs the person first, then paused, then out of reach, else all set", () => {
    expect(headLine({ needs: 2, pause: { until: null }, offline: true })).toEqual({ kind: "needs", count: 2 });
    expect(headLine({ needs: 0, pause: { until: "2026-11-26T18:00:00.000Z" }, offline: true })).toEqual({
      kind: "paused",
      until: "2026-11-26T18:00:00.000Z",
    });
    expect(headLine({ needs: 0, pause: { until: null }, offline: false })).toEqual({ kind: "paused", until: null });
    expect(headLine({ needs: 0, pause: null, offline: true })).toEqual({ kind: "offline" });
    expect(headLine({ needs: 0, pause: null, offline: false })).toEqual({ kind: "allSet" });
  });

  test("its words in both languages, one thing and several", () => {
    for (const { tray } of [desktopEn, desktopPtBR]) {
      expect(tray.needsYou_one).toContain("{{count}}");
      expect(tray.needsYou_other).toContain("{{count}}");
      expect(tray.allSet).toBeTruthy();
      expect(tray.settings).toContain("{{device}}");
    }
    expect(desktopPtBR.tray.needsYou_one).toBe("{{count}} coisa precisa de você");
    expect(desktopPtBR.tray.allSet).toBe("Tudo certo");
  });
});

describe("the popover's essentials banner", () => {
  const off = (over: Partial<Essential> & Pick<Essential, "id">): Essential => ({
    state: "off",
    fix: { kind: "autostart" },
    ...over,
  });

  test("the first one off that counts, never an optional one nor the update that has its own banner", () => {
    const screen = off({ id: "screen", fix: { kind: "permission", permission: "screen" } });
    expect(
      bannerEssential([
        { id: "launchAtLogin", state: "on", fix: null },
        off({ id: "autoUpdate", fix: { kind: "update" }, reason: "required" }),
        off({ id: "reach", fix: { kind: "reach" }, reason: "chosen", optional: true }),
        screen,
        off({ id: "disk", fix: { kind: "permission", permission: "disk" } }),
      ]),
    ).toBe(screen);
    expect(bannerEssential([{ id: "screen", state: "checking", fix: null }])).toBeNull();
    expect(
      bannerEssential([off({ id: "autoLogin", fix: { kind: "systemSettings", page: "users" }, optional: true })]),
    ).toBeNull();
  });

  test("each fix: done from the popover where it can be, else This computer's settings on its row", () => {
    expect(fixPlan({ kind: "autostart" })).toEqual({ kind: "autostart" });
    expect(fixPlan({ kind: "permission", permission: "notifications" })).toEqual({ kind: "notifications" });
    expect(fixPlan({ kind: "permission", permission: "screen" })).toEqual({ kind: "privacy", pane: "screen" });
    expect(fixPlan({ kind: "permission", permission: "disk" })).toEqual({ kind: "privacy", pane: "disk" });
    expect(fixPlan({ kind: "autoUpdate" })).toEqual({ kind: "autoUpdate" });
    expect(fixPlan({ kind: "restartServer" })).toEqual({ kind: "restart" });
    // Reach, either way (ADR 0256 §4): its row in Settings › Server on this computer, where its fix is.
    const reach = { kind: "layer", route: { screen: "settings", section: "server", focus: "reach" } };
    for (const fix of [
      { kind: "reach" },
      { kind: "tailscaleHttps" },
      { kind: "tailscaleStart" },
      { kind: "reachCheck" },
    ] as const) {
      expect(fixPlan(fix)).toEqual(reach as never);
    }
    expect(fixPlan({ kind: "backupNow" })).toEqual({
      kind: "layer",
      route: { screen: "settings", section: "server", focus: "backups" },
    });
    expect(fixLabel({ kind: "permission", permission: "screen" })).toBe("desktop.tray.essential.turnOnAgain");
    expect(fixLabel({ kind: "autostart" })).toBe("desktop.tray.essential.turnOn");
    expect(fixLabel({ kind: "backupNow" })).toBe("desktop.server.backup");
    expect(fixLabel({ kind: "reachCheck" })).toBe("desktop.tray.essential.fix");
    expect(fixLabel({ kind: "restartServer" })).toBe("desktop.server.restart");
  });

  test("every essential the banner shows has its words in both languages", () => {
    const get = (tree: object, key: string) =>
      key
        .replace(/^desktop\./, "")
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);
    const shown: Essential[] = [
      off({ id: "launchAtLogin" }),
      off({ id: "notifications" }),
      off({ id: "screen" }),
      off({ id: "disk" }),
      ...(["approve", "down", "address"] as const).map((reason) => off({ id: "reach", reason })),
      ...(["off", "backup", "copy"] as const).map((reason) => off({ id: "backup", reason })),
      off({ id: "autoUpdate" }),
      off({ id: "awake" }),
    ];
    for (const e of shown) {
      const words = essentialWords(e);
      expect(words).not.toBeNull();
      for (const tree of [desktopEn, desktopPtBR]) {
        expect(typeof get(tree, words?.title ?? "")).toBe("string");
        expect(typeof get(tree, words?.body ?? "")).toBe("string");
      }
    }
    expect(essentialWords(off({ id: "powerRestart" }))).toBeNull();
    // The person's own address down has its own words, not Tailscale's.
    expect(essentialWords(off({ id: "reach", reason: "address" }))?.title).toBe(
      "desktop.tray.essential.reach.address.title",
    );
    expect(essentialWords(off({ id: "reach", reason: "down" }))?.title).toBe("desktop.tray.essential.reach.down.title");
  });

  test("its icon: a link for the person's own address, as its row shows; the globe for Tailscale's problems", () => {
    expect(essentialIcon(off({ id: "reach", reason: "address", fix: { kind: "reachCheck" } }))).toBe("link");
    expect(essentialIcon(off({ id: "reach", reason: "down", fix: { kind: "tailscaleStart" } }))).toBe("globe");
    expect(essentialIcon(off({ id: "reach", reason: "approve", fix: { kind: "tailscaleHttps" } }))).toBe("globe");
    expect(essentialIcon(off({ id: "screen", fix: { kind: "permission", permission: "screen" } }))).toBe("eye");
  });
});

describe("the server here on the popover", () => {
  test("its state in a word, in its colour", () => {
    const here = (phase: (typeof NO_SERVER)["phase"]) => hereState({ ...NO_SERVER, run: true, phase });
    expect(here("running")).toEqual({ key: "desktop.server.running", tone: "ok", busy: false });
    expect(here("starting")).toEqual({ key: "desktop.server.starting", tone: "muted", busy: true });
    expect(here("updating")).toEqual({ key: "desktop.server.updating", tone: "muted", busy: true });
    expect(here("failing")).toEqual({ key: "desktop.server.failing", tone: "danger", busy: false });
    expect(here("stopped")).toEqual({ key: "desktop.server.stopped", tone: "warn", busy: false });
  });
});

describe("the popover's Now", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 18, min)).toISOString();
  const work = (id: string, agent: string | null, min: number, kind: ControlJob["kind"] = "exec"): ControlJob => ({
    id,
    kind,
    summary: id,
    startedAt: at(min),
    ...(agent ? { agent: { id: agent, name: agent } } : {}),
  });

  test("one row per agent with its latest job, the most recent first, each workspace in turn", () => {
    const homes = [
      { homeId: "acme", jobs: [work("a1", "ada", 1), work("a2", "ada", 5), work("d1", "dev", 3)] },
      { homeId: "horizonte", jobs: [work("l1", "lia", 9), work("x", null, 2)] },
    ];
    const rows = agentRows(homes);
    expect(rows.map((r) => [r.key, r.job.id, r.jobs])).toEqual([
      ["acme:ada", "a2", 2],
      ["acme:dev", "d1", 1],
      ["horizonte:lia", "l1", 1],
      ["horizonte:job:x", "x", 1],
    ]);
  });

  test("a job shown elsewhere (its agent drives its browser) leaves Now", () => {
    const homes = [{ homeId: "acme", jobs: [work("t", "theo", 1, "brain"), work("d", "dev", 2)] }];
    const rows = agentRows(homes, (_home, job) => job.kind === "brain" && job.agent?.id === "theo");
    expect(rows.map((r) => r.key)).toEqual(["acme:dev"]);
  });
});
