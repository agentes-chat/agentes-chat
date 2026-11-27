/**
 * Development only (`bun run dev`, then `/cover.html` in a browser): the app's answers to the main window's cover,
 * so each of its states can be designed and captured without the app. Not product code: `cover/main.ts` loads it
 * only in development and outside the app.
 *
 * `?server=` picks what the window opens: `private` (the default: a workspace on a Tailscale address, out of reach),
 * `other` (a server on the internet, out of reach: "Can't reach…") or `here` (the server on this computer,
 * `?phase=starting|updating|stopped|failing`). For `private`: `?tailscale=off|missing|on` (the system's Tailscale, off by default; `&app=0` a Mac
 * with only its command-line tool), `?own=signedOut|expired|needsApproval|signingIn|off|on` (the app's own Tailscale
 * as the one chosen; none by default), `?org=` (the workspace's name, Acme by default; empty: several workspaces),
 * `?platform=mac|windows|linux` (the cover reads it from the browser's user agent). Dark: the browser's own dark
 * mode (the cover follows the system).
 */

const params = new URLSearchParams(location.search);
const kind = params.get("server") ?? "private";
const PRIVATE = "https://agentes.tail1234.ts.net";
const HERE = "http://127.0.0.1:4310";
/** `.invalid` never resolves: out of reach without a network to turn off. */
const server = kind === "other" ? "https://chat.example.invalid" : kind === "here" ? HERE : PRIVATE;

const platform = params.get("platform");
if (platform === "windows" || platform === "linux" || platform === "mac") {
  const agent =
    platform === "windows"
      ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      : platform === "linux"
        ? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
        : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => agent });
}

const system = (() => {
  const state = params.get("tailscale") ?? "off";
  if (state === "missing") return { state: "missing" };
  if (state === "on") return { state: "on", device: "ana-mac.tail1234.ts.net" };
  return { state: "off", app: params.get("app") !== "0" };
})();
let own: Record<string, unknown> = params.get("own")
  ? { mode: "app", state: params.get("own") }
  : { mode: system.state === "on" ? "system" : "none" };

const org = params.get("org") ?? "Acme";
const orgs = org ? [{ id: "org_acme", name: org, logo: null, unread: 0, waiting: 0 }] : [];

const phase = params.get("phase") ?? "running";
const local = {
  run: kind === "here",
  installed: kind === "here" ? "app" : null,
  phase: kind === "here" ? phase : "off",
  url: HERE,
  localUrl: kind === "here" ? HERE : null,
  publicUrl: null,
  held: false,
  heldUntil: null,
  dir: "/Users/voce/.agentes",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each command the cover asks, answered as the app would in that state. */
async function answer(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (command) {
    case "cover_server":
      return server;
    case "local_server_status":
      return local;
    case "servers_get":
      return { current: server, servers: [server, "https://app.agentes.chat"] };
    case "workspaces_get":
      return [{ server: PRIVATE, signedIn: true, orgs }];
    case "tailscale_status":
      return system;
    case "tailnet_status":
      return own;
    case "tailnet_sign_in":
      own = { ...own, state: "signingIn" };
      await wait(4000);
      own = { mode: "app", state: "on", device: "agentes.tail1234.ts.net" };
      return { device: "agentes.tail1234.ts.net" };
    case "tailscale_open":
      console.info("[fake cover] opens Tailscale:", args.page);
      return null;
    case "layer_show":
      console.info("[fake cover] opens the app layer:", args.route);
      return null;
    case "local_server_diagnostics":
    case "cover_details":
      return "agentes.chat (fake cover)";
    default:
      return null;
  }
}

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => answer(command, args),
  transformCallback: () => 0,
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main-cover" } },
};
