/**
 * Development only (`bun run dev` in a browser): a bar to switch screens and nudge the fake runners
 * (go offline, raise a folder request), and a frame the size of each real one. The app layer (`app`) shows in a
 * 1240×800 main window with a stand-in of the site behind it, so a sheet can be checked over it. `?bare=1` drops the
 * bar (screenshots). Not product UI.
 */
import { switchTheme } from "@agenteschat/ui";
import { useEffect, useReducer } from "react";
import type { FakeHost } from "../host/fake";
import type { LayerRoute, WindowName } from "../host/types";
import { WindowView } from "../WindowView";
import "./dev-frame.css";

const SIZES: Record<WindowName, { width: number; height: number | "auto" }> = {
  // The card (380) and its transparent margin (POP_PAD in Popover.tsx), as the real window.
  popover: { width: 424, height: "auto" },
  app: { width: 1240, height: 800 },
  notch: { width: 480, height: 420 },
};

/** The layer's routes the bar offers. */
const ROUTES: { name: string; route: LayerRoute }[] = [
  { name: "first run", route: { screen: "firstRun" } },
  { name: "settings", route: { screen: "settings" } },
  {
    name: "ready",
    route: {
      screen: "pairOffer",
      target: { server: "https://agentes.tail1234.ts.net", orgId: "o-norte", name: "Estúdio Norte", logo: null },
    },
  },
  { name: "prepare", route: { screen: "prepare", org: "Acme", server: "https://agentes.tail1234.ts.net" } },
  { name: "pair link", route: { screen: "pairLink", server: "https://agentes.tail1234.ts.net", code: "ABCDEFGH" } },
  { name: "permission", route: { screen: "permissionAsk" } },
  { name: "iphone", route: { screen: "iphone" } },
];

/** The site behind the layer: a plain stand-in, so a sheet's scrim and card can be seen over something. */
function SiteStandIn({ there }: { there: boolean }) {
  return (
    <div className="dk-dev__site" aria-hidden="true">
      {there && (
        <>
          <div className="dk-dev__siteside" />
          <div className="dk-dev__sitemain">
            <div className="dk-dev__siteline" />
            <div className="dk-dev__siteline" data-short />
            <div className="dk-dev__siteline" />
          </div>
        </>
      )}
    </div>
  );
}

export function DevFrame({ host }: { host: FakeHost }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => host.onDev(rerender), [host]);
  // The popover's states by address: `?paused=1` (every workspace paused), `?offline=1` (every one out of reach),
  // `?requests=0` (no folder request waiting), once the fake runners started.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search);
    const timer = setTimeout(() => {
      for (const runner of host.runners.values()) {
        if (asked.get("offline") === "1") runner.setOnline(false);
        if (asked.get("paused") === "1") runner.handle(JSON.stringify({ id: "dev-pause", type: "pause", until: null }));
        if (asked.get("requests") === "0") {
          const answer = { type: "access.answer", requestId: "req_1", decision: "denied", scope: "agent" };
          runner.handle(JSON.stringify({ id: "dev-answer", ...answer }));
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [host]);
  const name = host.window;
  const size = SIZES[name];
  const first = [...host.runners.values()][0];
  const bare = new URLSearchParams(window.location.search).get("bare") === "1";
  const toggleTheme = () => switchTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  return (
    <div className="dk-dev" data-bare={bare || undefined}>
      {!bare && (
        <div className="dk-dev__bar">
          {(["popover", "notch"] as const).map((w) => (
            <button key={w} type="button" aria-pressed={w === name} onClick={() => void host.showWindow(w)}>
              {w}
            </button>
          ))}
          {ROUTES.map(({ name: label, route }) => (
            <button
              key={label}
              type="button"
              aria-pressed={name === "app" && host.layer.route?.screen === route.screen}
              onClick={() => void host.showLayer(route)}
            >
              {label}
            </button>
          ))}
          {name === "app" && host.layer.route && (
            <button type="button" onClick={() => void host.hideLayer()}>
              hide layer
            </button>
          )}
          <span className="dk-dev__sep" />
          <button type="button" onClick={() => first?.setOnline(false)}>
            offline
          </button>
          <button type="button" onClick={() => first?.setOnline(true)}>
            online
          </button>
          <button type="button" onClick={() => first?.raiseRequest()}>
            folder request
          </button>
          <button type="button" onClick={() => first?.askPick(true)}>
            folder pick
          </button>
          <button type="button" onClick={toggleTheme}>
            theme
          </button>
          <span className="dk-dev__tray">
            tray: {host.tray} · server: {host.list.current ?? "none"}
          </span>
        </div>
      )}
      <div
        className="dk-dev__window"
        data-window={name}
        style={{ width: size.width, height: size.height === "auto" ? undefined : size.height }}
      >
        {name === "app" && <SiteStandIn there={host.layer.site.there} />}
        <div className="dk-dev__layer" data-mode={name === "app" ? host.layer.mode : undefined}>
          <WindowView key={name} name={name} />
        </div>
      </div>
    </div>
  );
}
