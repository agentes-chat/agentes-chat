import { describe, expect, test } from "bun:test";
import {
  ADDRESS_TEXT,
  addressForm,
  addressWords,
  coverHere,
  FAIL_TEXT,
  failedStep,
  hereBanner,
  hereLine,
  hereView,
  isHereServer,
  type LocalServerStatus,
  NO_SERVER,
  ownerless,
  REASON_TEXT,
  STEP_SLOW_MS,
  setupSteps,
  stepClock,
  stepStates,
  tunnelTarget,
  UPDATE_SLOW_MS,
} from "../src/control/local-server";
import { menuLabels } from "../src/control/menu-labels";
import { createDesktopI18n } from "../src/i18n";

const LOCAL = "http://127.0.0.1:4310";
const TAILNET = "https://agentes.tail1234.ts.net";
const OWN = "https://agentes.example.com";
const running: LocalServerStatus = {
  ...NO_SERVER,
  bundled: true,
  installed: "app",
  run: true,
  owner: true,
  phase: "running",
  url: LOCAL,
  localUrl: LOCAL,
  publicUrl: null,
  installedVersion: "0.8.5",
  serverVersion: "0.1.1",
  dir: "/Users/ana/.agentes",
};
const reached: LocalServerStatus = {
  ...running,
  reach: true,
  publicUrl: TAILNET,
  way: { kind: "tailscale" },
  port: 4310,
  reachHealth: "on",
};
/** Reached through an address of the person's own (ADR 0256 §4). */
const addressed: LocalServerStatus = { ...reached, publicUrl: OWN, way: { kind: "address", url: OWN } };

describe("setting it up", () => {
  test("the steps in order, access from the phone and the team only where it will be used", () => {
    expect(setupSteps("here")).toEqual(["database", "start", "account", "computer"]);
    expect(setupSteps("everywhere")).toEqual(["database", "start", "account", "computer", "reach"]);
  });

  test("each step's state from what arrived; a failure stays on its step", () => {
    const steps = setupSteps("everywhere");
    expect(stepStates(steps, [])).toEqual({
      database: "todo",
      start: "todo",
      account: "todo",
      computer: "todo",
      reach: "todo",
    });
    const states = stepStates(steps, [
      { step: "database", state: "active" },
      { step: "database", state: "done" },
      { step: "start", state: "active" },
      { step: "start", state: "failed" },
    ]);
    expect(states).toMatchObject({ database: "done", start: "failed", account: "todo" });
    // Reach failing is a warning: the rest went on.
    expect(stepStates(steps, [{ step: "reach", state: "warn", reason: { reason: "https", url: null } }]).reach).toBe(
      "warn",
    );
  });

  test("every step, failure and reason has its words in both languages", () => {
    for (const lng of ["en", "pt-BR"] as const) {
      const i18n = createDesktopI18n(lng, "mac");
      const has = (key: string) => i18n.exists(key);
      for (const step of setupSteps("everywhere"))
        expect({ step, ok: has(`desktop.here.step.${step}`) }).toEqual({ step, ok: true });
      for (const key of [
        ...Object.values(REASON_TEXT),
        ...Object.values(FAIL_TEXT),
        ...Object.values(ADDRESS_TEXT),
        "desktop.reach.problem.errorPlain",
        "desktop.reach.problem.unreachablePlain",
        "desktop.reach.line.address",
        "desktop.reach.line.addressDown",
        "desktop.reach.stage.checking",
        "desktop.reach.stage.done",
        "desktop.here.slow",
        "desktop.here.copyDetails",
        "desktop.here.serveFix",
        "desktop.here.fail.retry",
      ]) {
        expect({ key, ok: has(key) }).toEqual({ key, ok: true });
      }
      const reason = i18n.t(REASON_TEXT.https);
      expect(i18n.t("desktop.server.reachFailed", { reason })).toContain(reason);
      // Screen readers hear each step's state: the marks on screen are drawn.
      for (const state of ["active", "done", "failed", "warn"])
        expect({ state, ok: has(`desktop.here.stepState.${state}`) }).toEqual({ state, ok: true });
    }
  });

  test("a step's time shows from 10 s, and from 30 s it takes a little longer than expected (two minutes for an update)", () => {
    expect(stepClock(9_999)).toEqual({ time: false, slow: false });
    expect(stepClock(10_000)).toEqual({ time: true, slow: false });
    expect(stepClock(STEP_SLOW_MS - 1)).toEqual({ time: true, slow: false });
    expect(stepClock(30_000)).toEqual({ time: true, slow: true });
    expect(UPDATE_SLOW_MS).toBe(120_000);
    expect(stepClock(30_000, UPDATE_SLOW_MS)).toEqual({ time: true, slow: false });
    expect(stepClock(120_000, UPDATE_SLOW_MS)).toEqual({ time: true, slow: true });
  });

  test("a setup that ended in an error always stops on a step", () => {
    const steps = setupSteps("here");
    const at = (...changes: Parameters<typeof stepStates>[1]) => failedStep(steps, stepStates(steps, changes));
    const done = (step: (typeof steps)[number]) => [
      { step, state: "active" as const },
      { step, state: "done" as const },
    ];
    // The step that said so.
    expect(at(...done("database"), { step: "start", state: "active" }, { step: "start", state: "failed" })).toBe(
      "start",
    );
    // Else the one under way.
    expect(at(...done("database"), ...done("start"), { step: "account", state: "active" })).toBe("account");
    // Else the first one not done, and with every step done, the last.
    expect(at()).toBe("database");
    expect(at(...done("database"), ...done("start"), ...done("account"), ...done("computer"))).toBe("computer");
  });
});

describe("which screen", () => {
  test("nothing here yet: the form with the owner's name and email", () => {
    expect(hereView({ ...NO_SERVER, bundled: true }, null)).toEqual({ kind: "form", ask: true });
  });

  test("the app's own server from before: started again without asking who", () => {
    expect(hereView({ ...running, run: false, phase: "off" }, null)).toEqual({ kind: "form", ask: false });
    // Set up but its owner never made (the first try stopped there): the form asks again.
    expect(hereView({ ...running, run: false, owner: false, phase: "off" }, null)).toEqual({ kind: "form", ask: true });
  });

  test("one installed from the terminal, or another answering here: use it, with its claim while it waits", () => {
    const terminal = { ...NO_SERVER, installed: "terminal" as const, url: LOCAL, serving: true };
    expect(hereView({ ...terminal, claim: "c".repeat(43) }, null)).toEqual({
      kind: "already",
      server: LOCAL,
      claim: "c".repeat(43),
    });
    expect(hereView({ ...NO_SERVER, bundled: true }, "http://127.0.0.1:3000")).toEqual({
      kind: "already",
      server: "http://127.0.0.1:3000",
      claim: null,
    });
    // The app's own server isn't "another one".
    expect(hereView(running, "http://127.0.0.1:3000").kind).toBe("running");
  });

  test("a terminal install that isn't running: it starts where it was installed, nothing to use yet", () => {
    expect(hereView({ ...NO_SERVER, installed: "terminal", url: LOCAL, serving: false }, null)).toEqual({
      kind: "stopped",
    });
    expect(hereView({ ...NO_SERVER, installed: "terminal", url: null }, "http://127.0.0.1:3000")).toEqual({
      kind: "stopped",
    });
  });

  test("the app runs it already: open it at its loopback address, never set it up again", () => {
    expect(hereView(running, null)).toEqual({ kind: "running", server: LOCAL });
    // With reach on too: the window on this computer never opens it through the tailnet (ADR 0256 §5).
    expect(hereView(reached, null)).toEqual({ kind: "running", server: LOCAL });
    expect(hereView({ ...running, phase: "failing" }, null).kind).toBe("running");
    // An older app's status without `localUrl`: its loopback `url`.
    expect(hereView({ ...reached, localUrl: null }, null)).toEqual({ kind: "running", server: LOCAL });
  });

  test("running with no account left (its owner deleted theirs): the form asks who the new owner is", () => {
    const gone = { ...running, owner: false };
    expect(hereView(gone, null)).toEqual({ kind: "form", ask: true });
    expect(ownerless(gone)).toBe(true);
    expect(ownerless(running)).toBe(false);
    // Stopped, or one from the terminal: never this.
    expect(ownerless({ ...gone, run: false, phase: "off" })).toBe(false);
    expect(ownerless({ ...gone, installed: "terminal" })).toBe(false);
  });
});

describe("what the popover, the cover and Preferences say", () => {
  test("its state in a few words", () => {
    expect(hereLine(running)).toBe("desktop.server.onlyHere");
    expect(hereLine(reached)).toBe("desktop.server.onTailnet");
    expect(hereLine({ ...running, phase: "starting" })).toBe("desktop.server.starting");
    expect(hereLine({ ...running, phase: "updating" })).toBe("desktop.server.updating");
    expect(hereLine({ ...running, phase: "failing" })).toBe("desktop.server.failing");
    expect(hereLine({ ...running, phase: "stopped" })).toBe("desktop.server.stopped");
    // Starting again by itself is never "stopped"; Tailscale off here means nobody else reaches it.
    expect(hereLine({ ...running, phase: "restarting" })).toBe("desktop.server.restarting");
    expect(hereLine({ ...reached, reachDown: true })).toBe("desktop.server.tailnetDown");
    expect(hereLine({ ...reached, reachHealth: "down" })).toBe("desktop.server.tailnetDown");
    // Through the person's own address: its own words, up or down.
    expect(hereLine(addressed)).toBe("desktop.reach.line.address");
    expect(hereLine({ ...addressed, reachDown: true, reachHealth: "address" })).toBe("desktop.reach.line.addressDown");
    expect(hereLine({ ...addressed, reachHealth: "address" })).toBe("desktop.reach.line.addressDown");
  });

  test("the popover's banners", () => {
    expect(hereBanner(running)).toBeNull();
    expect(hereBanner({ ...running, phase: "stopped" })).toBe("stopped");
    expect(hereBanner({ ...running, phase: "failing" })).toBe("failing");
    expect(hereBanner({ ...running, phase: "restarting" })).toBeNull();
    expect(hereBanner({ ...running, backTo: "0.6.0" })).toBe("back");
    expect(hereBanner({ ...running, run: false, phase: "off" })).toBeNull();
  });

  test("the server here, at either of its addresses", () => {
    expect(isHereServer(running, LOCAL)).toBe(true);
    expect(isHereServer(reached, TAILNET)).toBe(true);
    expect(isHereServer(reached, LOCAL)).toBe(true);
    expect(isHereServer({ ...running, url: null }, LOCAL)).toBe(true);
    expect(isHereServer(running, "https://app.agentes.chat")).toBe(false);
    expect(isHereServer({ ...running, run: false }, LOCAL)).toBe(false);
  });

  test("the cover: each state over the server here, and Tailscale is never one of them", () => {
    expect(coverHere({ ...running, phase: "starting" }, LOCAL)).toBe("starting");
    expect(coverHere({ ...running, phase: "restarting" }, LOCAL)).toBe("starting");
    expect(coverHere({ ...running, phase: "updating" }, LOCAL)).toBe("migrating");
    expect(coverHere({ ...running, phase: "stopped" }, LOCAL)).toBe("stopped");
    expect(coverHere({ ...running, phase: "failing" }, LOCAL)).toBe("failing");
    expect(coverHere(running, LOCAL)).toBeNull();
    // Reach on and Tailscale down: the window at loopback works; it is an essentials item, not a cover.
    const down: LocalServerStatus = { ...reached, reachDown: true, reachHealth: "down" };
    expect(coverHere(down, LOCAL)).toBeNull();
    expect(coverHere(down, TAILNET)).toBeNull();
    expect(coverHere({ ...reached, phase: "stopped" }, TAILNET)).toBe("stopped");
    // Another server: the cover's own reachability words, not these.
    expect(coverHere({ ...running, phase: "stopped" }, "https://app.agentes.chat")).toBeNull();
  });

  test("the server here at its address for people: the person's own one too", () => {
    expect(isHereServer(addressed, OWN)).toBe(true);
    expect(isHereServer(addressed, LOCAL)).toBe(true);
    expect(coverHere({ ...addressed, reachDown: true, reachHealth: "address" }, LOCAL)).toBeNull();
  });

  test("Rust's labels for the tray line and the notifications, with {version} left for Rust", () => {
    const labels = menuLabels(createDesktopI18n("en", "linux").t);
    expect(labels.serverTitle).toBe("agentes.chat on this computer");
    expect(labels.serverStop).toBe("Stop");
    expect(labels.hereBack).toBe("The update didn't start. agentes.chat is back on {version}.");
  });

  test("Rust's notification for a setup that failed while its window was closed, in both languages", () => {
    const en = menuLabels(createDesktopI18n("en", "mac").t);
    expect([en.setupFailed, en.setupFailedBody]).toEqual([
      "Setting up agentes.chat on this Mac didn't finish",
      "Open agentes.chat to see what happened.",
    ]);
    const pt = menuLabels(createDesktopI18n("pt-BR", "windows").t);
    expect([pt.setupFailed, pt.setupFailedBody]).toEqual([
      "A preparação do agentes.chat neste PC não terminou",
      "Abra o agentes.chat para ver o que aconteceu.",
    ]);
  });
});

describe("an address of the person's own (ADR 0256 §4)", () => {
  test("its form: an https origin, with a port or not, and nothing after it but a slash", () => {
    expect(addressForm("https://agentes.example.com")).toEqual({ ok: true, url: OWN });
    expect(addressForm("  https://agentes.example.com/  ")).toEqual({ ok: true, url: OWN });
    expect(addressForm("https://Agentes.Example.com:8443")).toEqual({
      ok: true,
      url: "https://agentes.example.com:8443",
    });
    for (const bad of [
      "",
      "agentes.example.com",
      "http://agentes.example.com",
      "https://agentes.example.com/chat",
      "https://agentes.example.com/?a=1",
      "https://agentes.example.com/#top",
      "https://agentes.example.com?",
      "https://ana:secret@agentes.example.com",
      "ftp://agentes.example.com",
      "not an address",
    ])
      expect({ bad, form: addressForm(bad) }).toEqual({ bad, form: { ok: false, why: "notHttps" } });
  });

  test("where a tunnel points: this computer's loopback, by the server's port", () => {
    expect(tunnelTarget(4310)).toBe("http://127.0.0.1:4310");
    expect(tunnelTarget(null)).toBeNull();
  });

  test("each problem in plain words, with the tunnel's target and the status when there are some", () => {
    const en = createDesktopI18n("en", "mac");
    const say = (...args: Parameters<typeof addressWords>) => {
      const words = addressWords(...args);
      return en.t(words.key, words.values);
    };
    expect(say("notHttps", undefined, 4310)).toBe("The address must start with https://");
    expect(say("unreachable", undefined, 4310)).toBe(
      "We couldn't open it. Check that your tunnel is on and points to http://127.0.0.1:4310.",
    );
    expect(say("unreachable", undefined, null)).toBe(
      "We couldn't open it. Check that your tunnel is on and points to this Mac.",
    );
    expect(say("otherServer", undefined, 4310)).toBe("It opens another server, not this Mac's.");
    expect(say("error", 502, 4310)).toBe("It answered with an error (502).");
    expect(say("error", undefined, 4310)).toBe("It answered with an error.");
    const pt = createDesktopI18n("pt-BR", "windows");
    const words = addressWords("otherServer", undefined, 4310);
    expect(pt.t(words.key, words.values)).toBe("Ele abre outro servidor, não o deste PC.");
  });
});
