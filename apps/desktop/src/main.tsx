import type { OsPermission } from "@agenteschat/adapters/machine-protocol";
import { ErrorBoundary } from "@agenteschat/client/lib/error-boundary";
import { installTitleTips, switchTheme } from "@agenteschat/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import "./styles.css";
import { AppProvider } from "./app";
import { toolWords } from "./control/activity";
import type { LocalPhase, ServeProblem, SetupStep, Tailnet } from "./control/local-server";
import { MAC_PERMISSIONS, type MacPermission } from "./control/permissions";
import { DesktopStore, orgName } from "./control/store";
import { DevFrame } from "./dev/DevFrame";
import { readPref } from "./hooks";
import { createFakeHost, type HereOptions, SCENARIOS, type Scenario } from "./host/fake";
import { createTauriHost, inTauri } from "./host/tauri";
import { type Host, type LayerRoute, WINDOW_NAMES, type WindowName } from "./host/types";
import { LOCALE_PREF, loadDesktopI18n, pickLocale, switchDesktopLocale, systemLocale } from "./i18n";
import { ToastProvider } from "./ui/Toast";
import { baseName } from "./ui/time";
import { WindowError, WindowView } from "./WindowView";

const params = new URLSearchParams(window.location.search);
const asked = params.get("window");
const scenario = params.get("scenario");
/** `?route=<json>`: the app layer's first route while designing (a `LayerRoute`); anything unreadable is ignored. */
const askedRoute = (() => {
  const raw = params.get("route");
  if (!raw) return undefined;
  try {
    const route = JSON.parse(raw) as LayerRoute;
    return route && typeof route.screen === "string" ? route : undefined;
  } catch {
    return undefined;
  }
})();
const isMacPermission = (p: string): p is MacPermission => (MAC_PERMISSIONS as readonly string[]).includes(p);
/** `?mac=notifications,screen`, `?asked=disk`: some of the Mac's permissions, while designing the sheets. */
const macList = (name: string) => (params.get(name) ?? "").split(",").filter(isMacPermission);
const fakeHost = inTauri()
  ? null
  : createFakeHost(
      (WINDOW_NAMES as readonly string[]).includes(asked ?? "") ? (asked as WindowName) : "popover",
      (SCENARIOS as readonly string[]).includes(scenario ?? "") ? (scenario as Scenario) : "selfhost",
      {
        link: params.get("link"),
        found: params.get("found") !== "0",
        someCommands: params.get("commands") === "some",
        macReady: params.get("mac") === "ready",
        macOn: macList("mac"),
        macAsked: macList("asked"),
        tools: (params.get("tools") as "claude" | "none" | null) ?? undefined,
        ask: (params.get("ask") as OsPermission | null) ?? undefined,
        site: params.get("site") !== "0",
        autostart: params.get("autostart") !== "0",
        route: askedRoute,
        here: {
          phase: (params.get("phase") as LocalPhase | null) ?? undefined,
          reach: params.get("reach") === "1",
          back: params.get("back"),
          run: params.get("run") !== "0",
          owner: params.get("owner") !== "0",
          usage: params.get("usage") !== "0",
          tailscale: (params.get("tailscale") as Tailnet["state"] | null) ?? undefined,
          installed: params.get("installed") === "terminal" ? "terminal" : undefined,
          claim: params.get("claim") === "1",
          serving: params.get("serving") !== "0",
          fail: (params.get("fail") as SetupStep | null) ?? undefined,
          reason: (params.get("reason") as ServeProblem["reason"] | null) ?? undefined,
          hold: (params.get("hold") as SetupStep | null) ?? undefined,
          tailnet: (params.get("tailnet") as HereOptions["tailnet"] | null) ?? undefined,
          backup: (params.get("backup") as "failed" | "copy" | "off" | null) ?? undefined,
          awake: params.get("awake") !== "0",
          approve: params.get("approve") === "1",
          signIn: (params.get("signin") as "hold" | "approval" | "fail" | null) ?? undefined,
        },
      },
    );
const host: Host = fakeHost ?? createTauriHost();

// The browser's own language, or `?lang=` while designing.
const i18n = await loadDesktopI18n(
  fakeHost && params.get("lang") ? pickLocale([params.get("lang")]) : systemLocale(),
  host.platform,
);
document.documentElement.lang = i18n.language;
// A language picked in settings reaches every open screen.
window.addEventListener("storage", (e) => {
  if (e.key === `agentes.desktop.${LOCALE_PREF}`) switchDesktopLocale(i18n, systemLocale(), host.platform);
});

// Light or dark like the system (`?theme=` while designing).
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const forced = fakeHost ? params.get("theme") : null;
const applyTheme = () => {
  switchTheme(forced === "dark" || forced === "light" ? forced : dark.matches ? "dark" : "light");
};
applyTheme();
dark.addEventListener("change", applyTheme);

const store = new DesktopStore(host, {
  // Only the popover window raises notifications (every window has its own store).
  onAccessRequested: (home, request) => {
    if (host.window !== "popover" || !readPref("notify", true)) return;
    const title = i18n.t("desktop.tray.notifTitle", { agent: request.agent.name, folder: baseName(request.path) });
    const org = home.status?.org?.name;
    void host.notify(title, org ? `${org} · ${request.reason}` : request.reason).catch(() => {});
  },
  // Always told, whatever the notification preference: a tool turned on from elsewhere must never go unseen.
  onToolAllowed: (home, allowed) => {
    if (host.window !== "popover") return;
    const values = { name: allowed.byName || orgName(home), tool: toolWords(i18n.t, allowed.tool) };
    void host.notify(i18n.t("desktop.tray.allowedTitle", values), i18n.t("desktop.tray.allowedBody")).catch(() => {});
  },
});
store.start();

installTitleTips();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <AppProvider host={host} store={store}>
          <ToastProvider>
            {/* A window that breaks shows why and a way to try again, never an empty window. */}
            <ErrorBoundary fallback={() => <WindowError />}>
              {fakeHost ? <DevFrame host={fakeHost} /> : <WindowView name={host.window} />}
            </ErrorBoundary>
          </ToastProvider>
        </AppProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}
