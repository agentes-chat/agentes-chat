/**
 * The main window's cover (cover.rs): the boot sky with the agent, over the server's page while it
 * loads, so the window is never blank. Rust shows it and hides it (the page says when it painted); this page
 * only tells, while it shows, whether the server open now can be reached ("No internet connection…" or
 * "Can't reach {{host}}…"), and when it is back it asks to load the page again. Over the server here it says
 * that one's state instead (starting, updating, stopped, not starting), with the buttons that fix it: a start or an
 * update shows its time from 10 s, and Copy details once it takes longer than expected. The window opens the server
 * here at its loopback address, never through the tailnet (ADR 0265 §5), so Tailscale is never its reason. A server
 * out of reach offers another one; a workspace on a private network (a Tailscale address) while Tailscale is off here
 * says so with the button that turns it on (the system's Tailscale, ADR 0265 §4: its Mac app opens, or its download
 * page), never a command. Every state is the same stack (cover.html): the picture, a title (the wordmark while it
 * loads, what happened when the person has something to do), one line, at most two buttons and a link.
 */

import { checkServer, isTailnet, serverHost } from "@agenteschat/client/lib/server";
import { drawAgent, idlePose } from "@agenteschat/ui/agent/engine";
import { startSky } from "@agenteschat/ui/sky/engine";
import { SKY_TONES } from "@agenteschat/ui/sky/math";
import { invoke } from "@tauri-apps/api/core";
import "@fontsource-variable/onest/index.css";
import "../fonts.css";
import "./cover.css";
import {
  coverHere,
  isHereServer,
  type LocalServerStatus,
  STEP_SLOW_MS,
  stepClock,
  type Tailnet,
  UPDATE_SLOW_MS,
} from "../control/local-server";
import { platformOf } from "../control/platform";
import { type ServerWorkspaces, serverName, type VersionProblem, versionProblem } from "../control/server";
import { SITE_URL } from "../control/version";
import { desktopStrings, systemLocale } from "../i18n";
import { mountReportPanel } from "../report/panel";
import { type CoverParts, coverReport, knownServers, type ReportFacts } from "../report/report";
import { TAILSCALE_MARK } from "../ui/tailscale-mark";
import { elapsedClock, fillIn } from "../ui/time";
import { type NetworkFix, networkFix, networkWords, privateTitle } from "./network";
import "./private.css";
import { stuckAction } from "./stuck";

// In a plain browser while designing (`bun run dev`, cover.html): answers in place of the app (src/dev/fake-cover.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("../dev/fake-cover");

/** How long the cover waits before it asks whether the site can be reached, and how often after. */
const CHECK_MS = 3000;

const strings = desktopStrings(systemLocale());
const words = strings.cover;
const platform = platformOf(navigator.userAgent);
const device = strings.device[platform];
const root = document.querySelector<HTMLElement>(".cover");
const heading = document.querySelector<HTMLElement>(".cover__title");
const line = document.querySelector<HTMLElement>(".cover__line");
const time = document.querySelector<HTMLElement>(".cover__time");
const sky = document.querySelector<HTMLCanvasElement>(".cover__sky");
const agent = document.querySelector<HTMLCanvasElement>(".cover__agent");
const acts = document.querySelector<HTMLElement>(".cover__acts");
const moreAct = document.querySelector<HTMLElement>(".cover__more");
const tile = document.querySelector<HTMLElement>(".cover__tile");
/** The wordmark, as cover.html first paints it: the title while nothing needs the person. */
const wordmark = heading?.querySelector(".cover__word")?.cloneNode(true) ?? null;
document.documentElement.lang = systemLocale();

let shownAt = performance.now();
/** The site couldn't be reached: the sky calms down and the agent closes its eyes. */
let unreachable = false;
/** The server here wasn't up: once it answers, the page loads again. */
let hereWaiting = false;
/** Since when the cover sees the server here starting or updating. */
let waitSince: { state: "starting" | "migrating"; at: number } | null = null;
/** How many of the stuck page's steps were taken in this showing (`stuck.ts`). */
let stuckSteps = 0;
/** The server open now is the one here (the last check): Copy details copies its diagnostics, else the window's. */
let overHere = false;
/** The server open now speaks an app API this app doesn't: the cover says so and stays until the person chooses. */
let tooOld: VersionProblem | null = null;
/** A short word in the time's place ("Copied"), until then: the explanation above it stays as it is. */
let aside: { text: string; until: number } | null = null;
/** What turns the network on, as last read, and when: each read runs Tailscale's own command. */
let network: { at: number; fix: NetworkFix | null } | null = null;
const NETWORK_READ_MS = 10_000;

function sayAside(text: string, ms = 2500) {
  aside = { text, until: performance.now() + ms };
  tick();
}

if (sky) {
  // The same sky as the site's BootSplash (apps/web Sky.tsx), so the hand-over doesn't show.
  startSky(sky, () => ({
    pixel: 4,
    palette: SKY_TONES,
    sprites: { area: 700, max: 40 },
    rise: 2.2,
    light: 0.12,
    base: (u, v, t) => {
      const fill = Math.min(1, (performance.now() - shownAt) / 1800) * (unreachable ? 0.55 : 1);
      return -0.3 + 1.15 * fill * (0.35 + 0.65 * v) + 0.05 * Math.sin(u * 6 + t);
    },
  }));
}

if (agent) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = 72;
  agent.width = agent.height = Math.round(size * dpr);
  const ctx = agent.getContext("2d");
  const seed = Math.random() * 9;
  // With reduced motion the agent is drawn still (the sky does the same, packages/ui sky engine).
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (now: number) => {
    if (ctx) {
      const s = agent.width;
      const inner = s * 0.84;
      ctx.clearRect(0, 0, s, s);
      // Calm faces only: a cross or a spiral would read as something broken while it waits.
      const pose = idlePose(now / 1000, seed, { every: 10, expressions: ["happy", "wink"] });
      drawAgent(ctx, (s - inner) / 2, s - inner + s * 0.04, inner, {
        color: "sky",
        eyes: "round",
        cells: 12,
        pose: unreachable ? { ...pose, blink: false, expression: "closed" } : pose,
      });
    }
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function say(text: string) {
  if (line) line.textContent = text;
}

/** The stack's title: what happened, when the person has something to do; the wordmark otherwise. */
function title(text: string | null) {
  if (!heading) return;
  if (text === null) {
    if (wordmark && !heading.querySelector(".cover__word")) heading.replaceChildren(wordmark.cloneNode(true));
  } else if (heading.querySelector(".cover__word") || heading.textContent !== text) {
    heading.textContent = text;
  }
}

/** A cover action: its label and what it does. */
type Act = [string, () => void];

function button(label: string, run: () => void, variant?: "primary") {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  if (variant) node.dataset.variant = variant;
  node.addEventListener("click", run);
  return node;
}

/**
 * The cover's buttons: at most two, bordered, with `main` (the one that moves forward) white and last; `link`, a third
 * way, as a link under them.
 */
function buttons(list: Act[], main?: Act, link?: Act) {
  if (!acts || !moreAct) return;
  const now = [...list, ...(main ? [main] : []), ...(link ? [link] : [])].map(([label]) => label).join("|");
  if (acts.dataset.now === now) return;
  acts.dataset.now = now;
  acts.replaceChildren(
    ...list.map(([label, run]) => button(label, run)),
    ...(main ? [button(main[0], main[1], "primary")] : []),
  );
  moreAct.replaceChildren(...(link ? [button(link[0], link[1])] : []));
}

/**
 * The wait's time from 10 s, and once it takes longer than expected (30 s starting, 2 minutes updating), that line
 * with Copy details.
 */
function tick() {
  const word = aside && performance.now() < aside.until ? aside.text : null;
  if (!waitSince) {
    if (time) time.textContent = word ?? "";
    return;
  }
  if (word) {
    if (time) time.textContent = word;
    return;
  }
  const ms = performance.now() - waitSince.at;
  const clock = stepClock(ms, waitSince.state === "migrating" ? UPDATE_SLOW_MS : STEP_SLOW_MS);
  if (time)
    time.textContent = clock.slow ? `${strings.here.slow} · ${elapsedClock(ms)}` : clock.time ? elapsedClock(ms) : "";
  if (clock.slow) buttons([[words.copy, copyDiagnostics]], undefined, overHere ? report : undefined);
  else buttons([]);
}

/** Shown again (cover.rs `show`): the sky fills again, nothing is said yet. */
function shown() {
  shownAt = performance.now();
  unreachable = false;
  waitSince = null;
  stuckSteps = 0;
  tooOld = null;
  title(null);
  say("");
  tick();
  buttons([]);
  hidePrivate();
  root?.removeAttribute("data-fading");
  void checkVersion();
  void check();
}

/** On its way out (cover.rs `hide`): it fades, the site shows through. */
function fade() {
  root?.setAttribute("data-fading", "");
}

const w = window as { __coverShown?: () => void; __coverFade?: () => void };
w.__coverShown = shown;
w.__coverFade = fade;

/** The server the main window opens (servers.json, through Rust); agentes.chat before one is chosen. */
const currentServer = () =>
  invoke<string | null>("cover_server").then(
    (s) => s ?? SITE_URL,
    () => SITE_URL,
  );

/** Whether the server answers at all (any answer: the cover can't read it, only that it came). */
async function reachable(server: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    await fetch(`${server}/api/health`, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/** Why the page isn't there: no internet, or this server. */
function unreachableText(server: string): string {
  if (!navigator.onLine) return words.offline;
  return fillIn(words.unreachable, { host: serverHost(server) });
}

const localStatus = () => invoke<LocalServerStatus>("local_server_status").catch(() => null);

/**
 * Copy details: the server here's diagnostics over it, the window's own story (its log) over any other server.
 * "Copied" or that it couldn't shows in the time's place, never over what the cover explains.
 */
const copyDiagnostics = () =>
  void invoke<string>(overHere ? "local_server_diagnostics" : "cover_details")
    .then((text) => navigator.clipboard.writeText(text))
    .then(
      () => sayAside(words.copied),
      () => sayAside(words.copyFailed),
    );

/**
 * Send a report (the server here only): what Copy details copies, as the problem report, shown in full over the cover
 * before it goes. Rust posts it, as the server may be what's failing.
 */
function sendReport() {
  if (!root || root.querySelector(".cover__report")) return;
  const host = document.createElement("div");
  host.className = "cover__report";
  root.append(host);
  let unmount = () => host.remove();
  const close = () => {
    unmount();
    host.remove();
  };
  void Promise.all([
    invoke<CoverParts>("problem_report_parts"),
    // An app whose Rust is older than its page answers nothing: the report goes without this computer.
    invoke<ReportFacts>("problem_report_facts").catch(() => null),
    localStatus(),
    currentServer(),
  ]).then(
    ([parts, about, status, server]) => {
      const known = knownServers([server, status?.url, status?.publicUrl]);
      unmount = mountReportPanel(host, {
        words: strings.report,
        lead: strings.report.coverLead,
        report: coverReport(parts, about, known, systemLocale()),
        onClose: close,
      });
    },
    () => {
      unmount = mountReportPanel(host, {
        words: strings.report,
        lead: strings.report.coverLead,
        report: null,
        onClose: close,
      });
    },
  );
}
const report: Act = [strings.report.button, sendReport];

/** Another server of the app's list than the one open (and the server here), to open instead. */
async function otherServer(status: LocalServerStatus | null): Promise<string | null> {
  const list = await invoke<{ current: string | null; servers: string[] }>("servers_get").catch(() => null);
  if (!list) return null;
  return list.servers.find((s) => s !== list.current && !(status && isHereServer(status, s))) ?? null;
}
const openServer = (server: string) => void invoke("server_choose", { server }).catch(() => {});

/** The server here's state on the cover, with what fixes it. */
function showHere(state: NonNullable<ReturnType<typeof coverHere>>, status: LocalServerStatus, other: string | null) {
  const start = () => void invoke("local_server_start").catch(() => {});
  const fill = (text: string) => fillIn(text, { device });
  hidePrivate();
  if (state === "starting" || state === "migrating") {
    if (waitSince?.state !== state) waitSince = { state, at: performance.now() };
    title(null);
    say(fill(state === "starting" ? words.starting : words.migrating));
    tick();
    return;
  }
  waitSince = null;
  tick();
  if (state === "stopped") {
    // Stopped to stay stopped (Stop): until when, Start now, and another server of the list meanwhile.
    const until = status.held && status.heldUntil ? clockTime(status.heldUntil) : null;
    title(fill(words.stopped));
    say(
      until
        ? fillIn(words.heldUntil, { device, time: until })
        : status.held
          ? fill(words.held)
          : fill(strings.server.stoppedBody),
    );
    const others: Act[] = other
      ? [[fillIn(words.openOther, { server: serverName(other) }), () => openServer(other)]]
      : [];
    buttons(others, [status.held ? words.startNow : words.start, start]);
  } else {
    title(fill(words.failing));
    say("");
    buttons([[words.copy, copyDiagnostics]], [words.retry, start], report);
  }
}

/** The first run, to pick another server or workspace (the main window's app layer, ADR 0265). */
const otherWorkspace = () =>
  void invoke("layer_show", { route: { screen: "firstRun", mode: "servers" } }).catch(() => {});

/** What turns the network on here, read at most every few seconds unless `fresh` (a button was just pressed). */
async function readNetwork(fresh = false): Promise<NetworkFix | null> {
  if (!fresh && network && performance.now() - network.at < NETWORK_READ_MS) return network.fix;
  const system = await invoke<Tailnet>("tailscale_status").catch(() => null);
  const fix = networkFix(platform, system);
  network = { at: performance.now(), fix };
  return fix;
}

/** Tailscale's mark on its tile, the stack's picture over a private network, drawn once. */
function drawMark(tile: Element) {
  if (tile.firstChild) return;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("focusable", "false");
  for (const [d, opacity] of [
    [TAILSCALE_MARK.solid, "1"],
    [TAILSCALE_MARK.faded, "0.4"],
  ] as const) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill-opacity", opacity);
    svg.append(path);
  }
  tile.append(svg);
}

/** Says `text` in the time's place for a moment (Tailscale's page didn't open), never over the line. */
const note = (text: string) => sayAside(text, 5000);

/** Over a workspace on a private network: its name, what is off here, and what turns it on, in the same stack. */
async function showPrivate(server: string, fix: NetworkFix) {
  if (!root) return;
  const list = await invoke<ServerWorkspaces[]>("workspaces_get").catch(() => null);
  const named = privateTitle(list?.find((w) => w.server === server)?.orgs);
  const { line: lineKey, button: turnOnKey } = networkWords(fix);
  if (tile) drawMark(tile);
  title(named.key === "privateTitle" ? fillIn(words.privateTitle, { org: named.org ?? "" }) : words.privateTitleAny);
  say(fillIn(words[lineKey], { device }));
  buttons([[words.useOther, otherWorkspace]], turnOnKey ? [words[turnOnKey], () => turnOn(fix)] : undefined);
  root.setAttribute("data-private", "");
}

function hidePrivate() {
  root?.removeAttribute("data-private");
}

/**
 * Its main button: the system's Tailscale opens (its Mac app) or its official download page does. Once the network
 * is on here and the server answers, the page loads.
 */
function turnOn(fix: NetworkFix) {
  const openPage = (page: "app" | "download") =>
    void invoke("tailscale_open", { page }).catch(() => note(strings.common.error));
  if (fix.act === "openApp") openPage("app");
  else if (fix.act === "download") openPage("download");
}

const showAnyway: Act = [words.showAnyway, () => void invoke("cover_hide").catch(() => {})];
const another: Act = [words.otherServer, otherWorkspace];

/**
 * Each time a server of the list opens, whether this app still speaks its app API (`GET /api/instance`, as when it was
 * added): if not, the first run's words over its page, which Rust keeps covered (`cover_hold`) until Show it
 * anyway or another server.
 */
async function checkVersion() {
  const server = await currentServer();
  const problem = versionProblem(await checkServer(server).catch(() => null));
  if (!problem || server !== (await currentServer())) return;
  tooOld = problem;
  void invoke("cover_hold").catch(() => {});
  const host = serverName(server);
  const connect = strings.connect;
  title(fillIn(problem === "app-too-old" ? connect.appTooOld : connect.serverTooOld, { host }));
  say("");
  const updates: Act = [
    connect.checkUpdates,
    () =>
      void invoke("layer_show", { route: { screen: "settings", section: "overview", focus: "updates" } }).catch(
        () => {},
      ),
  ];
  if (problem === "app-too-old") buttons([another], updates, showAnyway);
  else buttons([], another, showAnyway);
}

async function check() {
  if (tooOld) return;
  if (document.visibilityState !== "visible" || root?.hasAttribute("data-fading")) return;
  const waited = performance.now() - shownAt;
  const server = await currentServer();
  const here = await localStatus();
  overHere = !!here && isHereServer(here, server);
  if (here && overHere) {
    const state = coverHere(here, server);
    if (state) {
      hereWaiting = true;
      unreachable = state === "stopped" || state === "failing";
      const other = state === "stopped" ? await otherServer(here) : null;
      showHere(state, here, other);
      return;
    }
    if (hereWaiting) {
      // Up now: the page loads again; the cover stays until it painted.
      hereWaiting = false;
      shown();
      void invoke("cover_retry").catch(() => {});
      return;
    }
  }
  if (waited < CHECK_MS) return;
  if (!(await reachable(server))) {
    unreachable = true;
    // A workspace on a private network while the network is off here: what turns it on (ADR 0265).
    const fix = navigator.onLine && isTailnet(server) ? await readNetwork() : null;
    if (fix) {
      await showPrivate(server, fix);
      return;
    }
    hidePrivate();
    title(null);
    say(unreachableText(server));
    buttons([another]);
    return;
  }
  hidePrivate();
  if (unreachable) {
    // Back: the site loads again; the cover stays until it painted.
    shown();
    void invoke("cover_retry").catch(() => {});
    return;
  }
  stuck(waited);
}

/** The server answers and the page never painted: load it again, then with the web cache cleared, then say so. */
function stuck(waited: number) {
  const next = stuckAction(waited, stuckSteps);
  if (!next) return;
  stuckSteps = next.step;
  if (next.action !== "say") {
    const why = `not painted after ${Math.round(waited / 1000)} s`;
    void invoke("cover_retry", { fresh: next.action === "fresh", why }).catch(() => {});
    return;
  }
  title(null);
  say(words.stuck);
  buttons(
    [showAnyway],
    [
      words.retry,
      () => {
        shown();
        void invoke("cover_retry", { fresh: true, why: "try again" }).catch(() => {});
      },
    ],
    [words.copy, copyDiagnostics],
  );
}

/** "15:32": the hour and minute in the person's own way. */
function clockTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(systemLocale(), { hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

setInterval(() => void check(), CHECK_MS);
setInterval(tick, 1000);
