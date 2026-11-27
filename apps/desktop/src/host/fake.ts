/**
 * The host for a plain browser (`bun run dev`): fake runners and servers in memory instead of the Tauri
 * shell, so the screens can be designed and checked without building the app. One page shows one screen at
 * a time; `showWindow` and `showLayer` switch it (the dev bar does too) and keep the fake state. The app layer
 * (`?window=app`) starts on `?route=<json>` (a `LayerRoute`), else the first run with no server and This computer's
 * settings with one; a stand-in of the site shows behind it (DevFrame), so a sheet can be checked over it.
 *
 * Scenarios (`?scenario=`): `first` (a Mac, nothing chosen yet), `windows` and `linux` (the same there),
 * `cloud` (agentes.chat, nothing on this computer), `selfhost` (the default: a server on Tailscale with two
 * organizations whose agents work here), `link` (a claim link waiting) and `here` (agentes.chat runs on this
 * computer, its organization's agents too); `?link=` makes any scenario start with that link waiting. A pair link
 * (`agenteschat://pair?server=…&link=ABCDEFGH`) joins Estúdio Norte once its maker lets it in, `HGFEDCBA`'s maker
 * says no, and any other code expired.
 * `?mac=ready`: notifications, Screen Recording and Full Disk Access allowed already (Prepare this Mac is skipped);
 * `?mac=notifications,screen` allows only those, and `?asked=disk` (or `screen`) says it was asked in this version
 * and is still off (Prepare waits on it in System Settings). The sheets: `?tools=` (`claude`, `none`) is which coding
 * tools this computer has (both by default), `?ask=<permission>` (`disk`, `automation`…) makes an agent's work here
 * wait on that permission, and a pair link from chat.example.com can't be read (its server doesn't answer).
 * Servers answer by host: agentes.tail1234.ts.net, agentes.chat and http://127.0.0.1:4310 are servers;
 * noowner.tail1234.ts.net waits for its owner; old.example.com is too old; chat.example.com doesn't answer;
 * anything else isn't agentes.chat. `?found=0` makes discovery find nothing.
 * The server here: `?phase=` (starting, updating, stopped, failing), `?reach=1`, `?back=<version>` (an update
 * went back), `?run=0` (it stopped running here, its data kept), `?owner=0` (it runs with no account left, and the
 * first run opens on Run here's form), `?usage=0` (usage statistics off),
 * `?tailscale=` (on, off, missing: the system's), `?tailnet=` (the Tailscale the app carries, ADR 0256 §4: `signedOut`
 * until it signs in, `on`, `expiring`, `expired`, `needsApproval`, `off`; without it the build carries none), `?installed=terminal` (one from
 * the terminal; `&claim=1` waits for its owner,
 * `&serving=0` isn't running), `?fail=` (database, start, account, reach: that setup step fails), `?hold=<step>`
 * (setting up stops there). Cancel ends a setup at once, held or not (it rejects with "cancelled", as the app's
 * does). `?approve=1`: the setup's access step waits for HTTPS on Tailscale's page until "Finish without it"
 * ("One click left"). `?signin=` (the app's own Tailscale signing in): `hold` stays on its page, `approval` waits for
 * the network's admin, `fail` doesn't finish. `?first=<state>` opens the first run on one of its states
 * (`dev/first-run-start.ts`). An update downloads in about 1.5 s with its progress, and Cancel drops it.
 * Settings › This computer: `?site=0` keeps the site away (offline: This computer's sections alone, with the line
 * that says so), `?autostart=0` has opening at login off, `?backup=` (failed, copy, off) is the server here's backups'
 * state, `?awake=0` lets this Mac sleep while it serves.
 */

import type { OsPermission } from "@agenteschat/adapters/machine-protocol";
import { CLOUD_SERVER, isLoopback, readInstance, type ServerCheck } from "@agenteschat/client/lib/server";
import type { Health, NotifyPermission } from "../control/essentials";
import type { Candidate } from "../control/first-run";
import {
  type KeepRunning,
  type LocalPhase,
  type LocalServerStatus,
  NO_SERVER,
  type PhoneLink,
  type ReachStage,
  type ServeProblem,
  type SetupStep,
  type StepChange,
  setupSteps,
  type Tailnet,
  type TailnetSignIn,
  type TailnetState,
} from "../control/local-server";
import type { LinkInfo } from "../control/pair";
import type { MacPermission, SetupState } from "../control/permissions";
import type { Platform } from "../control/platform";
import type { ServerList, ServerWorkspace, ServerWorkspaces } from "../control/server";
import type { ThisMacRequest } from "../control/this-mac";
import type { TrayState } from "../control/tray";
import { acmeSeed, FAKE_LINKS, FAKE_SERVER, FakeRunner, horizonteSeed } from "../dev/fake-runner";
import { createFakeSite, type FakeSite } from "../dev/fake-site";
import type { ReportFacts } from "../report/report";
import type {
  AppInfo,
  CompatMode,
  Host,
  LayerMode,
  LayerRoute,
  LayerState,
  RunnerInfo,
  RunnerStateChange,
  SiteNav,
  WindowName,
} from "./types";

export type Scenario = "first" | "windows" | "linux" | "cloud" | "selfhost" | "link" | "here";
export const SCENARIOS: readonly Scenario[] = ["first", "windows", "linux", "cloud", "selfhost", "link", "here"];

/** The fake server here's options (`?phase=`, `?reach=1`, …, see above). */
export interface HereOptions {
  phase?: LocalPhase;
  reach?: boolean;
  back?: string | null;
  run?: boolean;
  /** False: it runs, but its owner deleted their account and nobody else has one. */
  owner?: boolean;
  usage?: boolean;
  tailscale?: Tailnet["state"];
  installed?: "terminal";
  claim?: boolean;
  serving?: boolean;
  fail?: SetupStep;
  /** Why reach didn't turn on (`?reason=`; HTTPS off by default). */
  reason?: ServeProblem["reason"];
  hold?: SetupStep;
  /** Each setup step's time in ms (the tests' 10); a little over a second by default. */
  pace?: number;
  /** The Tailscale the app carries (`?tailnet=`): its state as it starts; none carried when unset. */
  tailnet?: "signedOut" | "on" | "expiring" | "expired" | "needsApproval" | "off";
  /** Its backups (`?backup=`): the last one failed, didn't reach its copy, or nightly backups are off. */
  backup?: "failed" | "copy" | "off";
  /** False (`?awake=0`): it serves without keeping this Mac awake. */
  awake?: boolean;
  /** The setup's access step waits for HTTPS to be allowed until "Finish without it" (`?approve=1`). */
  approve?: boolean;
  /** How the app's own Tailscale's sign-in goes (`?signin=`): it signs in about 1.5 s later when unset. */
  signIn?: "hold" | "approval" | "fail";
}

const LOCAL_URL = "http://127.0.0.1:4310";
const TAILNET_URL = "https://ana-mac.tail1234.ts.net";
/** The app's own Tailscale's device: `agentes` on the person's tailnet, whatever this computer is called. */
const OWN_TAILNET_URL = "https://agentes.tail1234.ts.net";
const DAY_MS = 24 * 3600 * 1000;
const LOCAL_BUNDLE_VERSION = "0.8.5";
const LOCAL_SERVER_VERSION = "0.1.1";

export interface FakeHost extends Host {
  window: WindowName;
  /** Linux's Compatibility mode as `compatMode` answers it (`fellBack` once). */
  compat: CompatMode;
  readonly runners: Map<string, FakeRunner>;
  readonly tray: TrayState;
  readonly list: ServerList;
  /** The server's devices API behind `siteFetch`. */
  readonly site: FakeSite;
  onDev(cb: () => void): () => void;
  setVersion(version: string): void;
  /**
   * This Mac's permissions: Screen Recording, Full Disk Access, the app's notifications (`?mac=ready`: all three on),
   * the notification and Local Network prompts raised, the setup kept, the panes opened.
   */
  readonly mac: {
    screen: boolean;
    disk: boolean;
    notifications: NotifyPermission;
    notifyAsks: number;
    networkAsks: number;
    setup: SetupState | null;
    panes: (MacPermission | OsPermission)[];
  };
  /** What keeps the server here up after a restart or a power cut (`keepRunning`, `health`): tests turn them. */
  readonly keep: KeepRunning;
  /** The system notifications raised (`notify`), in order. */
  readonly notified: { title: string; body: string }[];
  /** This computer's essentials read again and sent, as Rust does when the app comes to the front (`onHealth`). */
  sayHealth(): void;
  /** The site in the main window asks this computer (ADR 0036): resolves with the popover's reply. */
  askThisMac(request: ThisMacRequest): Promise<{ ok: boolean; data: unknown }>;
  /** The app layer as Rust would keep it (`app_layer.rs`), and the routes shown, in order. */
  readonly layer: LayerState;
  readonly routes: LayerRoute[];
  /** The site's paths the layer moved it to (`siteGo`). */
  readonly sitePaths: string[];
  /** What the popover last published about this computer's essentials (`publishHealth`). */
  readonly publishedHealth: { needs: number; server: boolean } | null;
}

/** The stand-in site's settings list (the layer's settings show it above This computer's sections), in the language
 * the site would send it in (`?lang=`). */
const SITE_PT =
  typeof location !== "undefined" && (new URLSearchParams(location.search).get("lang") ?? "").startsWith("pt");
const FAKE_NAV: SiteNav = {
  org: { id: "org_acme", name: "Acme" },
  main: [
    { id: "general", label: SITE_PT ? "Geral" : "General", icon: "settings", path: "/org/org_acme/settings" },
    { id: "members", label: SITE_PT ? "Pessoas" : "People", icon: "members", path: "/org/org_acme/settings/members" },
    { id: "agents", label: SITE_PT ? "Agentes" : "Agents", icon: "brainAgent", path: "/org/org_acme/settings/agents" },
    {
      id: "connectors",
      label: SITE_PT ? "Conectores" : "Connectors",
      icon: "plug",
      path: "/org/org_acme/settings/connectors",
    },
  ],
  advanced: [{ id: "usage", label: SITE_PT ? "Uso" : "Usage", icon: "chart", path: "/org/org_acme/settings/usage" }],
};

/** How a route shows (app_layer.rs `mode_for`): sheets over a site only on a Mac. */
export function layerModeFor(route: LayerRoute, siteThere: boolean, platform: Platform): LayerMode {
  if (route.screen === "firstRun" || route.screen === "settings") return "full";
  return platform === "mac" && siteThere ? "sheet" : "full";
}

/**
 * The first server's workspaces: the two this computer works for in `selfhost`, and Estúdio Norte, which it doesn't
 * yet. Every other server has Oficina.
 */
const FIRST_ORGS: ServerWorkspace[] = [
  { id: "org_acme", name: "Acme", logo: null, unread: 0, waiting: 0, pair: true },
  { id: "org_horizonte", name: "Horizonte", logo: null, unread: 0, waiting: 0, pair: true },
  { id: "o-norte", name: "Estúdio Norte", logo: null, unread: 3, waiting: 0, pair: true },
];

/** A 14" MacBook Pro's notch. */
const FAKE_NOTCH = { width: 186, height: 32 };
/** A claim link as the setup prints it, for the `link` scenario. */
const CLAIM_LINK = `agenteschat://connect?server=${encodeURIComponent(FAKE_SERVER)}&claim=b3duZXItY2xhaW0tYWJjZGVmZ2hpamtsbW5vcHFy`;

const instance = (url: string, over: Record<string, unknown> = {}) => ({
  name: "agentes.chat",
  version: "1.4.0",
  api: 1,
  minApi: 1,
  url,
  signIn: { email: true, google: false, github: false, apple: false },
  signup: "invite",
  ...over,
});

/** What each fake server answers to `GET /api/instance` (the host decides); `waits`: the link's server has no owner yet. */
function fakeCheck(server: string, waits: boolean): ServerCheck {
  const host = new URL(server).host;
  if (host === "chat.example.com" || host === "127.0.0.1:4399") return { ok: false, server, problem: "unreachable" };
  if (host === "noowner.tail1234.ts.net") return readInstance(server, instance(server, { ownerClaim: true }));
  if (host === "old.example.com") return readInstance(server, instance(server, { api: 0, minApi: 0 }));
  if (server === FAKE_SERVER || server === CLOUD_SERVER || server === "http://127.0.0.1:4310")
    return readInstance(server, instance(server, waits && server === FAKE_SERVER ? { ownerClaim: true } : {}));
  return readInstance(server, { status: "ok" });
}

export function createFakeHost(
  initial: WindowName,
  scenario: Scenario,
  options: {
    link?: string | null;
    found?: boolean;
    here?: HereOptions;
    someCommands?: boolean;
    /** The app layer's first route (`?route=`); by default the first run, or settings once a server is chosen. */
    route?: LayerRoute | null;
    /** Screen Recording and Full Disk Access allowed already (`?mac=ready`). */
    macReady?: boolean;
    /** Only these of the Mac's permissions allowed already (`?mac=notifications,screen`). */
    macOn?: readonly MacPermission[];
    /** Asked in this version and still off (`?asked=disk`): kept as the app keeps it (`MAC_ASKED_PREF`). */
    macAsked?: readonly MacPermission[];
    /** The coding tools this computer has (`?tools=`): both by default. */
    tools?: "claude" | "none";
    /** An agent's work on the first runner waits on this OS permission (`?ask=`). */
    ask?: OsPermission;
    /** False (`?site=0`): the site never shows behind the layer (offline, its server down). */
    site?: boolean;
    /** False (`?autostart=0`): the app doesn't open at login. */
    autostart?: boolean;
  } = {},
): FakeHost {
  const runners = new Map<string, FakeRunner>();
  const lineListeners = new Set<(homeId: string, line: string) => void>();
  const stateListeners = new Set<(c: RunnerStateChange) => void>();
  const shownListeners = new Set<(n: WindowName) => void>();
  const devListeners = new Set<() => void>();
  const thisMacListeners = new Set<(id: number, request: ThisMacRequest) => void>();
  const thisMacReplies = new Map<number, (reply: { ok: boolean; data: unknown }) => void>();
  let thisMacAsked = 0;
  let signIns = 0;
  /** Servers the app signed out of (`signOutServer`): listed with no workspaces. */
  const signedOut = new Set<string>();
  let tray: TrayState = "idle";
  let autostart = options.autostart !== false;
  let version = "0.6.0";
  const platform: Platform = scenario === "windows" ? "windows" : scenario === "linux" ? "linux" : "mac";
  const here = options.here ?? {};
  const tailnet: Tailnet =
    here.tailscale === "missing"
      ? { state: "missing" }
      : here.tailscale === "off"
        ? { state: "off", app: platform === "mac" }
        : { state: "on", device: "ana-mac.tail1234.ts.net" };
  const running = scenario === "here" && here.run !== false;
  // The Tailscale the app carries (`?tailnet=`): signed in or not, its sign-in expiring or expired.
  const ownStart = here.tailnet;
  let ownTailnet: TailnetState =
    ownStart === undefined
      ? { mode: "none" }
      : {
          mode: "app",
          state: ownStart === "expiring" ? "on" : ownStart,
          ...(ownStart === "on" || ownStart === "expiring"
            ? {
                device: new URL(OWN_TAILNET_URL).host,
                keyExpiry: Date.now() + (ownStart === "expiring" ? 5 : 170) * DAY_MS,
                https: "ok" as const,
              }
            : {}),
          // Waiting for the tailnet's admin to approve the new device (`?tailnet=needsApproval`).
          ...(ownStart === "needsApproval" ? { approveUrl: "https://login.tailscale.com/admin/machines" } : {}),
        };
  const peopleUrl = ownStart === undefined ? TAILNET_URL : OWN_TAILNET_URL;
  const tailnetOf = (reach: boolean): TailnetState =>
    ownStart !== undefined
      ? ownTailnet
      : reach
        ? { mode: "system", state: "on", device: new URL(TAILNET_URL).host, https: "ok" }
        : { mode: "none" };
  let local: LocalServerStatus = {
    ...NO_SERVER,
    bundled: true,
    dir: "/Users/voce/.agentes",
    usage: here.usage !== false,
    ...(scenario === "here"
      ? {
          installed: "app" as const,
          run: running,
          owner: here.owner !== false,
          phase: running ? (here.phase ?? "running") : "off",
          url: LOCAL_URL,
          localUrl: running ? LOCAL_URL : null,
          publicUrl: here.reach ? peopleUrl : null,
          reach: !!here.reach,
          tailnet: tailnetOf(!!here.reach),
          ownTailnet: ownStart !== undefined,
          reachHealth: !here.reach
            ? ("off" as const)
            : ownStart === "signedOut" || ownStart === "expired"
              ? ("signIn" as const)
              : ownStart === "expiring"
                ? ("expiring" as const)
                : ownStart === "needsApproval"
                  ? ("approve" as const)
                  : ownStart === "off"
                    ? ("down" as const)
                    : ("on" as const),
          expiresAt: here.reach && ownTailnet.mode === "app" ? (ownTailnet.keyExpiry ?? null) : null,
          installedVersion: LOCAL_BUNDLE_VERSION,
          serverVersion: running && (here.phase ?? "running") === "running" ? LOCAL_SERVER_VERSION : null,
          backTo: here.back ?? null,
          awake: running && here.awake !== false,
          eraseTo: "/Users/voce/agentes.chat erased 2026-11-14",
          backups: {
            nightly: here.backup !== "off",
            copyTo: null,
            files: [
              { path: "/Users/voce/.agentes/backups/agentes-2026-10-25-030000.tar.gz", at: Date.UTC(2026, 9, 25, 6) },
            ],
            problem: here.backup === "failed" ? "backup" : here.backup === "copy" ? "copy" : null,
          },
        }
      : here.installed === "terminal"
        ? {
            installed: "terminal" as const,
            url: LOCAL_URL,
            serving: here.serving !== false,
            claim: here.claim && here.serving !== false ? "b3duZXItY2xhaW0tYWJjZGVmZ2hpamtsbW5vcHFy" : null,
          }
        : { systemName: "Ana Souza", ownTailnet: ownStart !== undefined, tailnet: tailnetOf(false) }),
  };
  const tailnetListeners = new Set<(state: TailnetState) => void>();
  const signInListeners = new Set<(stage: TailnetSignIn) => void>();
  const saySignIn = (stage: TailnetSignIn) => {
    for (const l of signInListeners) l(stage);
  };
  let signInStopped = false;
  const setOwnTailnet = (next: TailnetState) => {
    ownTailnet = next;
    for (const l of tailnetListeners) l(next);
    setLocal({ tailnet: next });
  };
  const localListeners = new Set<(s: LocalServerStatus) => void>();
  const stepListeners = new Set<(c: StepChange) => void>();
  const reachListeners = new Set<(s: ReachStage) => void>();
  const sayReach = (stage: ReachStage) => {
    for (const l of reachListeners) l(stage);
  };
  let reachStopped = false;
  const progressListeners = new Set<(got: number, total: number | null) => void>();
  let cancelSetup: (() => void) | null = null;
  let dropUpdate: (() => void) | null = null;
  const setLocal = (next: Partial<LocalServerStatus>) => {
    local = { ...local, ...next };
    local.serverVersion = local.phase === "running" ? LOCAL_SERVER_VERSION : null;
    for (const l of localListeners) l(local);
    devChanged();
  };
  const list: ServerList =
    scenario === "cloud"
      ? { current: CLOUD_SERVER, servers: [CLOUD_SERVER] }
      : scenario === "selfhost"
        ? { current: FAKE_SERVER, servers: [FAKE_SERVER, CLOUD_SERVER] }
        : running
          ? // The window opens the server here at its loopback address (ADR 0256 §5).
            { current: LOCAL_URL, servers: [LOCAL_URL] }
          : { current: null, servers: [] };
  let link: string | null = options.link ?? (scenario === "link" ? CLAIM_LINK : null);
  const waits = link?.includes("claim=") ?? false;
  const devChanged = () => {
    for (const l of devListeners) l();
  };
  const layerListeners = new Set<(state: LayerState) => void>();
  const routes: LayerRoute[] = [];
  const sitePaths: string[] = [];
  let published: { needs: number; server: boolean } | null = null;
  const healthListeners = new Set<(health: Health) => void>();
  const notified: { title: string; body: string }[] = [];
  const keep: KeepRunning = { autoLogin: false, autoRestart: false };
  // What Rust's `health_get` reads (always_on.rs): only a Mac has the permissions, the settings and `caffeinate`.
  const healthNow = (): Health => ({
    autostart,
    screen: platform !== "mac" || host.mac.screen,
    disk: platform !== "mac" || host.mac.disk,
    notifications: platform === "mac" ? host.mac.notifications : "granted",
    keepRunning: platform === "mac" ? { ...keep } : { autoLogin: null, autoRestart: null },
    awake: platform === "mac" ? local.awake : null,
  });
  // The stand-in site is there once a server is chosen (a design tool: no cover, no sign-in).
  const siteThere = () => list.current !== null && options.site !== false;
  const firstRoute: LayerRoute | null =
    options.route !== undefined
      ? options.route
      : initial !== "app"
        ? null
        : here.owner === false
          ? { screen: "firstRun", mode: "owner" }
          : list.current
            ? { screen: "settings" }
            : { screen: "firstRun" };
  const layer: LayerState = {
    seq: firstRoute ? 1 : 0,
    mode: firstRoute ? layerModeFor(firstRoute, siteThere(), platform) : "hidden",
    route: firstRoute,
    site: { there: siteThere(), nav: siteThere() ? FAKE_NAV : null },
    fullScreen: false,
  };
  if (firstRoute) routes.push(firstRoute);
  const sayLayer = () => {
    layer.site = { there: siteThere(), nav: siteThere() ? FAKE_NAV : null };
    const now = { ...layer, site: { ...layer.site } };
    for (const l of layerListeners) l(now);
    devChanged();
  };
  const putLayer = (route: LayerRoute) => {
    routes.push(route);
    layer.seq++;
    layer.route = route;
    layer.mode = layerModeFor(route, siteThere(), platform);
    host.window = "app";
    sayLayer();
  };
  const dropLayer = () => {
    // Nothing under it with no server chosen: the first run comes back, as in the app.
    if (!list.current) {
      if (layer.route?.screen !== "firstRun") putLayer({ screen: "firstRun" });
      return;
    }
    layer.seq++;
    layer.route = null;
    layer.mode = "hidden";
    sayLayer();
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const spawn = (homeId: string, seed: ReturnType<typeof acmeSeed> | null) => {
    const runner = new FakeRunner(
      homeId,
      seed,
      (line) => {
        for (const l of lineListeners) l(homeId, line);
      },
      () => signIns++,
    );
    runners.set(homeId, runner);
    setTimeout(() => {
      runner.start();
      for (const l of stateListeners) l({ homeId, running: true, removed: false });
    }, 30);
  };

  if (scenario === "selfhost") {
    spawn("a1b2c3d4", acmeSeed());
    // `?commands=some`: the second organization joined with commands turned off.
    const horizonte = horizonteSeed();
    if (options.someCommands) horizonte.access.tools.commands = false;
    spawn("e5f6a7b8", horizonte);
    signIns = 2;
  }
  if (running) {
    spawn("0e7c1d2a-0000-4000-8000-000000000001", acmeSeed());
    for (const r of runners.values()) r.server = LOCAL_URL;
    signIns = 1;
  }
  // The sheets' states: the coding tools found here (`?tools=`), a permission an agent's work waits on (`?ask=`).
  for (const r of runners.values()) {
    if (options.tools === "none") r.executors = {};
    if (options.tools === "claude") r.executors = { claude: r.executors.claude };
  }
  if (options.ask) {
    const since = new Date().toISOString();
    [...runners.values()][0]?.setPermissions([
      { permission: options.ask, trigger: "ls ~/Desktop", agentId: "ag_dev", since },
    ]);
  }
  // This Mac's permissions allowed already (`?mac=`); asked in this version and still off, as the app keeps it
  // (`MAC_ASKED_PREF`, under `agentes.desktop.`).
  const macOn = (p: MacPermission) => options.macReady === true || !!options.macOn?.includes(p);
  if (options.macAsked?.length) {
    try {
      localStorage.setItem("agentes.desktop.macAsked", JSON.stringify({ version, asked: options.macAsked }));
    } catch {
      // Not kept: Prepare shows them as never asked.
    }
  }

  const orgsOf = (i: number): ServerWorkspace[] =>
    i === 0 ? FIRST_ORGS : [{ id: `o-${i}`, name: "Oficina", logo: null, unread: 1, waiting: 0, pair: true }];
  const site = createFakeSite(
    (orgId) => {
      const ids = [...runners.values()].map((r) => r.ids()).find((i) => i?.orgId === orgId);
      return ids ? { machineId: ids.machineId, name: ids.name } : null;
    },
    (orgId, userCode) => {
      const org = list.servers.flatMap((_, i) => orgsOf(i)).find((o) => o.id === orgId);
      const runner = [...runners.values()].find((r) => r.pendingCode === userCode);
      return org && runner ? runner.confirm({ id: org.id, name: org.name }) : null;
    },
  );

  const host: FakeHost = {
    window: initial,
    compat: { on: true, fellBack: false, own: false },
    fake: true,
    platform,
    runners,
    list,
    site,
    get tray() {
      return tray;
    },
    listRunners: async (): Promise<RunnerInfo[]> =>
      [...runners.keys()].map((homeId) => ({
        homeId,
        dir: `/Users/voce/.agentes-runner/orgs/${homeId}`,
        running: true,
        hello: {
          type: "hello",
          control: 1,
          version: "0.1.0",
          protocol: 10,
          home: `/Users/voce/.agentes-runner/orgs/${homeId}`,
        },
      })),
    send: async (homeId, line) => {
      const r = runners.get(homeId);
      if (!r) throw new Error("not running");
      r.handle(line);
    },
    addRunner: async () => {
      const id = Math.random().toString(16).slice(2, 10);
      spawn(id, null);
      return id;
    },
    removeRunner: async (homeId) => {
      runners.get(homeId)?.stop();
      runners.delete(homeId);
      for (const l of stateListeners) l({ homeId, running: false, removed: true });
    },
    onLine: (cb) => {
      lineListeners.add(cb);
      return () => lineListeners.delete(cb);
    },
    onRunnerState: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    onShown: (cb) => {
      shownListeners.add(cb);
      return () => shownListeners.delete(cb);
    },
    openExternal: async (url) => {
      console.info("[fake] open:", url);
    },
    servers: async () => ({ current: list.current, servers: [...list.servers] }),
    chooseServer: async (server, page) => {
      if (!list.servers.includes(server)) list.servers.push(server);
      list.current = server;
      console.info("[fake] main window on", server + (page ?? ""));
      devChanged();
    },
    workspaces: async (): Promise<ServerWorkspaces[]> =>
      list.servers.map((server, i) => ({
        server,
        signedIn: !signedOut.has(server),
        agentsHere: !isLoopback(server),
        orgs: signedOut.has(server) ? [] : orgsOf(i),
      })),
    // The fake reads nothing again by itself: an offer never takes the one window over while designing.
    onWorkspaces: () => () => {},
    pairLinkInfo: async (server, code): Promise<LinkInfo> => {
      await wait(300);
      if (new URL(server).host === "chat.example.com") throw "unreachable";
      if (code !== FAKE_LINKS.live && code !== FAKE_LINKS.denied) throw "link_expired";
      return {
        org: "Estúdio Norte",
        by: "Sam Rivera",
        kind: "computer",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        computer: "Sam's MacBook Pro",
      };
    },
    askToPair: async () => true,
    layer,
    routes,
    sitePaths,
    get publishedHealth() {
      return published;
    },
    keep,
    notified,
    health: async () => healthNow(),
    onHealth: (cb) => {
      healthListeners.add(cb);
      return () => healthListeners.delete(cb);
    },
    sayHealth: () => {
      const now = healthNow();
      for (const l of healthListeners) l(now);
    },
    notificationPermission: async () => (platform === "mac" ? host.mac.notifications : "granted"),
    requestNotifications: async () => {
      if (platform !== "mac") return "granted";
      // macOS asks once: after that the person changes it in System Settings.
      if (host.mac.notifications === "notDetermined") {
        host.mac.notifyAsks++;
        host.mac.notifications = "granted";
      }
      return host.mac.notifications;
    },
    showLayer: async (route) => putLayer(route),
    hideLayer: async () => dropLayer(),
    layerState: async () => ({ ...layer, site: { ...layer.site } }),
    onLayer: (cb) => {
      layerListeners.add(cb);
      return () => layerListeners.delete(cb);
    },
    layerPainted: async () => {},
    siteGo: async (path) => {
      sitePaths.push(path);
      console.info("[fake] the site moves to", path);
      dropLayer();
    },
    firstRunSignIn: async (method) => {
      await host.chooseServer(CLOUD_SERVER, method === "email" ? "/login" : `/login?with=${method}`);
      dropLayer();
    },
    publishHealth: async (next) => {
      published = next;
    },
    siteFetch: async (server, method, path, body) => {
      if (!list.servers.includes(server)) throw "not a server of this app";
      return site.answer(method, path, body);
    },
    removeServer: async (server) => {
      list.servers = list.servers.filter((s) => s !== server);
      if (list.current === server) list.current = list.servers[0] ?? null;
      devChanged();
    },
    signOutServer: async (server) => {
      signedOut.add(server);
      devChanged();
    },
    discover: async (): Promise<Candidate[]> => {
      await wait(1200);
      if (options.found === false) return [];
      // With the system's Tailscale off or missing, nothing on the network can be found.
      const onNetwork = tailnet.state === "on" || (ownTailnet.mode !== "none" && ownTailnet.state === "on");
      return [
        { server: "http://127.0.0.1:4310", where: "here" },
        ...(onNetwork ? [{ server: FAKE_SERVER, where: "tailnet" as const }] : []),
      ];
    },
    checkServer: async (server) => {
      await wait(700);
      return fakeCheck(server, waits);
    },
    takeLink: async () => {
      const taken = link;
      link = null;
      return taken;
    },
    onLink: () => () => {},
    revealFolder: async (path) => {
      console.info("[fake] show in Finder:", path);
    },
    pickFolder: async () => {
      const picks = ["/Users/voce/Documents/Notas", "/Users/voce/Projects/Personal/site", "/Users/voce/Desktop/Fotos"];
      return picks[Math.floor(Math.random() * picks.length)] ?? null;
    },
    setTrayState: async (state) => {
      if (tray !== state) {
        tray = state;
        devChanged();
      }
    },
    setTrayVisible: async () => {},
    showWindow: async (name) => {
      host.window = name;
      devChanged();
      for (const l of shownListeners) l(name);
    },
    hideWindow: async (name) => {
      console.info("[fake] hide", name);
    },
    quit: async () => {
      console.info("[fake] quit");
    },
    askQuit: async (words) => {
      console.info("[fake] ask to quit", words.title);
      return false;
    },
    appInfo: async (): Promise<AppInfo> => ({
      version,
      os: platform === "mac" ? "macos" : platform,
      arch: platform === "mac" ? "aarch64" : "x86_64",
      system: platform === "mac" ? "15.5" : null,
      details:
        platform === "linux"
          ? `agentes.chat ${version} · Linux · Ubuntu 26.04 LTS · wayland (GNOME) · WebKitGTK 2.50.4 · Intel (i915) · CPU (chosen) · AppImage`
          : `agentes.chat ${version} · ${platform === "mac" ? "macOS 15.5" : "Windows"}`,
    }),
    reportFacts: async (): Promise<ReportFacts> => ({
      osVersion: platform === "mac" ? "15.5" : platform === "windows" ? "10.0.19045" : "6.8.0-45-generic",
      cpus: 8,
      memoryBytes: 16 * 2 ** 30,
      webviewBytes: 240_000_000,
      openingMs: 2300,
    }),
    compatMode: async () => {
      const now = { ...host.compat };
      host.compat.fellBack = false;
      return now;
    },
    setCompatMode: async (on) => {
      host.compat.on = on;
    },
    reopen: async () => {
      console.info("[fake] reopen");
    },
    autostart: async () => autostart,
    setAutostart: async (on) => {
      autostart = on;
    },
    // No main window in the browser: only tests ask (`askThisMac`).
    onThisMac: (cb) => {
      thisMacListeners.add(cb);
      return () => thisMacListeners.delete(cb);
    },
    thisMacReply: async (id, ok, data) => {
      thisMacReplies.get(id)?.({ ok, data });
      thisMacReplies.delete(id);
    },
    askThisMac: (request) =>
      new Promise((resolve) => {
        const id = ++thisMacAsked;
        thisMacReplies.set(id, resolve);
        for (const l of thisMacListeners) l(id, request);
      }),
    // No menu bar in the browser.
    setAppMenu: async () => {},
    onMenuAction: () => () => {},
    thisMacListening: async () => {},
    setSiteNotify: async () => {},
    onBadge: (cb) => {
      const timer = setTimeout(() => cb({ waiting: 3, unread: 5 }), 50);
      return () => clearTimeout(timer);
    },
    notify: async (title, body) => {
      notified.push({ title, body });
      console.info("[fake] notification:", title, "—", body);
    },
    // Nothing installs in a browser: once downloaded, the manual way.
    installUpdate: () =>
      new Promise<boolean>((resolve, reject) => {
        const total = 48_000_000;
        let got = 0;
        const timer = setInterval(() => {
          got = Math.min(total, got + total / 10);
          for (const l of progressListeners) l(got, total);
          if (got < total) return;
          clearInterval(timer);
          dropUpdate = null;
          setTimeout(() => resolve(false), 300);
        }, 150);
        dropUpdate = () => {
          clearInterval(timer);
          dropUpdate = null;
          reject("cancelled");
        };
      }),
    cancelUpdate: async () => dropUpdate?.(),
    onUpdateProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    setNotch: async (on) => {
      console.info("[fake] notch:", on ? "on" : "off");
    },
    notchInfo: async () => FAKE_NOTCH,
    notchPlace: async () => FAKE_NOTCH,
    resize: async () => {},
    localServer: async () => local,
    onLocalServer: (cb) => {
      localListeners.add(cb);
      return () => localListeners.delete(cb);
    },
    onSetupStep: (cb) => {
      stepListeners.add(cb);
      return () => stepListeners.delete(cb);
    },
    installLocalServer: async (choice) => {
      const say = (change: StepChange) => {
        for (const l of stepListeners) l(change);
      };
      const cancelled = new Promise<never>((_, reject) => {
        cancelSetup = () => reject("cancelled");
      });
      cancelled.catch(() => {});
      for (const step of setupSteps(choice.place)) {
        say({ step, state: "active" });
        await Promise.race([
          cancelled,
          here.hold === step ? new Promise(() => {}) : wait(here.pace ?? (step === "database" ? 1400 : 800)),
        ]);
        if (step === "reach" && ownStart !== undefined && ownTailnet.mode === "app" && ownTailnet.state !== "on") {
          // The app's own Tailscale signs in first, in the browser (as `signInTailnet`).
          sayReach({ stage: "joining" });
          await host.signInTailnet().catch(() => {});
        }
        if (step === "reach" && here.approve) {
          // Tailscale waits for HTTPS to be allowed on its page, with no time limit: "Finish without it" ends it.
          reachStopped = false;
          let over = false;
          cancelled.catch(() => {
            over = true;
          });
          sayReach({ stage: "approve", url: "https://login.tailscale.com/f/serve?node=fake" });
          await Promise.race([
            cancelled,
            (async () => {
              while (!reachStopped && !over) await wait(50);
            })(),
          ]);
          say({ step, state: "warn", reason: { reason: "stopped" } });
          continue;
        }
        if (step === "reach" && (here.fail === "reach" || (tailnet.state !== "on" && ownStart === undefined))) {
          const reason: ServeProblem =
            here.reason === "operator" || here.reason === "serve"
              ? { reason: here.reason }
              : { reason: "https", url: null };
          say({ step, state: "warn", reason });
          continue;
        }
        if (here.fail === step) {
          say({ step, state: "failed" });
          throw new Error(step);
        }
        say({ step, state: "done" });
      }
      const reach =
        choice.place === "everywhere" &&
        (tailnet.state === "on" || (ownTailnet.mode === "app" && ownTailnet.state === "on")) &&
        here.fail !== "reach";
      setLocal({
        installed: "app",
        run: true,
        owner: true,
        phase: "running",
        url: LOCAL_URL,
        localUrl: LOCAL_URL,
        publicUrl: reach ? peopleUrl : null,
        reach,
        tailnet: tailnetOf(reach),
        reachHealth: reach ? "on" : "off",
        usage: choice.usage,
        installedVersion: LOCAL_BUNDLE_VERSION,
      });
      cancelSetup = null;
      // At its loopback address, always (the app signs the window in there after the account step).
      await host.chooseServer(LOCAL_URL, "/desktop/handover#token=fake");
    },
    cancelLocalSetup: async () => cancelSetup?.(),
    startLocalServer: async () => {
      setLocal({ run: true, phase: "starting", backTo: null, held: false, heldUntil: null });
      await wait(1200);
      setLocal({ phase: "running" });
    },
    stopLocalServer: async (forget, minutes) => {
      await wait(600);
      setLocal({
        phase: forget ? "off" : "stopped",
        run: !forget,
        held: !forget,
        heldUntil: !forget && minutes ? Date.now() + minutes * 60_000 : null,
      });
      if (forget) await host.removeServer(LOCAL_URL);
    },
    restartLocalServer: async () => {
      setLocal({ phase: "starting" });
      await wait(1200);
      // Started again, it keeps this Mac awake with it (`caffeinate`).
      setLocal({ phase: "running", awake: platform === "mac" });
    },
    setLocalReach: async (on) => {
      reachStopped = false;
      const own = ownStart !== undefined;
      if (on && own && ownTailnet.mode === "app" && ownTailnet.state !== "on") {
        sayReach({ stage: "joining" });
        const signedIn = await host.signInTailnet().then(
          () => true,
          () => false,
        );
        if (!signedIn)
          return { ok: false, problem: reachStopped ? { reason: "stopped" } : { reason: "signIn", url: null } };
      }
      if (on) sayReach({ stage: "sharing" });
      await wait(900);
      if (on && !own && tailnet.state !== "on") return { ok: false, problem: { reason: "serve" } };
      if (on && here.fail === "reach") {
        // Tailscale asks for HTTPS to be allowed and waits: until "Stop waiting", or a few seconds as if never allowed.
        sayReach({ stage: "approve", url: "https://login.tailscale.com/f/serve?node=fake" });
        for (let i = 0; i < 40 && !reachStopped; i++) await wait(100);
        return { ok: false, problem: reachStopped ? { reason: "stopped" } : { reason: "https", url: null } };
      }
      sayReach({ stage: "restarting" });
      setLocal({ phase: "starting" });
      await wait(900);
      setLocal({ phase: "running" });
      // The window stays on the loopback address: the list never changes (ADR 0256 §5).
      const url = on ? peopleUrl : LOCAL_URL;
      setLocal({
        reach: on,
        publicUrl: on ? url : null,
        tailnet: tailnetOf(on),
        reachHealth: on ? "on" : "off",
        tailnetDown: false,
      });
      if (on) sayReach({ stage: "done", url });
      return { ok: true, url };
    },
    setLocalUsage: async (on) => {
      setLocal({ phase: "starting", usage: on });
      await wait(900);
      setLocal({ phase: "running" });
    },
    backupLocalServer: async () => {
      await wait(1100);
      const path = "/Users/voce/.agentes/backups/agentes-2026-10-25-101500.tar.gz";
      setLocal({
        backups: { ...local.backups, files: [{ path, at: Date.now() }, ...local.backups.files].slice(0, 2) },
      });
      return path;
    },
    setLocalBackups: async (nightly, copyTo) => {
      setLocal({ backups: { ...local.backups, nightly, copyTo } });
    },
    restoreLocalServer: async () => {
      setLocal({ phase: "starting" });
      await wait(1500);
      setLocal({ phase: "running" });
    },
    eraseLocalServer: async () => {
      // As the app does: it stops first, still the server here, and only then its folder moves.
      if (local.run) setLocal({ phase: "stopped", awake: false });
      await wait(600);
      const to = local.eraseTo ?? "";
      // Its agents' homes on this computer go with it.
      for (const [homeId, runner] of runners) if (runner.server === LOCAL_URL) await host.removeRunner(homeId);
      for (const server of new Set([local.localUrl, local.url])) if (server) await host.removeServer(server);
      setLocal({ ...NO_SERVER, bundled: true, dir: local.dir, systemName: "Ana Souza", erased: to });
      putLayer({ screen: "firstRun", mode: "owner" });
      return to;
    },
    keepRunning: async () => (platform === "mac" ? { ...keep } : { autoLogin: null, autoRestart: null }),
    openSystemSettings: async (page) => {
      console.info("[fake] open System Settings:", page);
    },
    localDiagnostics: async () => `agentes.chat app ${version} (macos aarch64)\nserver here: ${local.phase}`,
    syncLocalHomes: async () => {},
    onLocalReach: (cb) => {
      reachListeners.add(cb);
      return () => reachListeners.delete(cb);
    },
    stopLocalReach: async () => {
      reachStopped = true;
      signInStopped = true;
    },
    tailscale: async () => tailnet,
    openTailscale: async (page) => {
      console.info("[fake] open Tailscale:", page);
    },
    tailnet: async () => ownTailnet,
    onTailnet: (cb) => {
      tailnetListeners.add(cb);
      return () => tailnetListeners.delete(cb);
    },
    // Tailscale's page "opens" and the person signs in about 1.5 s later, unless Cancel or Stop waiting.
    signInTailnet: async () => {
      if (ownStart === undefined) return Promise.reject("start");
      signInStopped = false;
      setOwnTailnet({ mode: "app", state: "signingIn" });
      saySignIn({ stage: "url", url: "https://login.tailscale.com/a/fake" });
      if (here.signIn === "approval") {
        setOwnTailnet({ mode: "app", state: "needsApproval" });
        saySignIn({ stage: "approval", url: "https://login.tailscale.com/admin/machines" });
      }
      // `?signin=hold|approval`: on Tailscale's page until Cancel; otherwise signed in about 1.5 s later.
      const held = here.signIn === "hold" || here.signIn === "approval";
      for (let i = 0; (held || i < 15) && !signInStopped; i++) await wait(100);
      if (here.signIn === "fail" && !signInStopped) {
        setOwnTailnet({ mode: "app", state: "signedOut" });
        saySignIn({ stage: "failed", reason: "failed" });
        return Promise.reject("failed");
      }
      if (signInStopped) {
        setOwnTailnet({ mode: "app", state: "signedOut" });
        saySignIn({ stage: "failed", reason: "cancelled" });
        return Promise.reject("cancelled");
      }
      const device = new URL(OWN_TAILNET_URL).host;
      setOwnTailnet({ mode: "app", state: "on", device, keyExpiry: Date.now() + 180 * DAY_MS });
      if (local.reach) setLocal({ reachHealth: "on", expiresAt: Date.now() + 180 * DAY_MS });
      saySignIn({ stage: "done", device });
      return { device };
    },
    cancelTailnetSignIn: async () => {
      signInStopped = true;
    },
    onTailnetSignIn: (cb) => {
      signInListeners.add(cb);
      return () => signInListeners.delete(cb);
    },
    useTailnetSource: async (mode) => {
      if (mode === "app") setOwnTailnet({ mode: "app", state: "signedOut" });
      else setLocal({ tailnet: { mode: "system", state: tailnet.state === "on" ? "on" : "off" } });
    },
    // A one-time sign-in for the phone, only while Tailscale shares it.
    phoneLink: async (): Promise<PhoneLink> => {
      if (!local.reach || !local.publicUrl) return Promise.reject("not_served");
      const token = `fake${Date.now().toString(36)}${"x".repeat(32)}`;
      const query = new URLSearchParams({ server: local.publicUrl, token });
      return { link: `agenteschat://connect?${query}`, server: local.publicUrl, expiresIn: 180 };
    },
    onNewHostHome: () => () => {},
    // Screen Recording and Full Disk Access take effect once the app opens again, as on a Mac.
    mac: {
      screen: macOn("screen"),
      disk: macOn("disk"),
      notifications: macOn("notifications") ? "granted" : "notDetermined",
      notifyAsks: 0,
      networkAsks: 0,
      setup: null,
      panes: [],
    },
    screenAccess: async () => platform !== "mac" || host.mac.screen,
    requestScreenAccess: async () => host.mac.screen,
    diskAccess: async () => platform !== "mac" || host.mac.disk,
    askLocalNetwork: async () => {
      host.mac.networkAsks++;
    },
    openPrivacy: async (pane) => {
      host.mac.panes.push(pane);
    },
    setupState: async () => host.mac.setup,
    setSetupState: async (state) => {
      host.mac.setup = state && { ...state, resumed: false };
    },
    onDev: (cb) => {
      devListeners.add(cb);
      return () => devListeners.delete(cb);
    },
    setVersion: (v) => {
      version = v;
    },
  };
  return host;
}
