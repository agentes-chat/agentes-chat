/**
 * The app layer (ADR 0256): the app's own screens in the main window, a web view of their own over the site
 * (app_layer.rs). Rust keeps the route and how it shows (`LayerState`); this draws it, says once it painted each route
 * (the layer appears only then, never with the screen it showed before), and sets `body[data-mode]`: `full` takes the
 * window (opaque), `sheet` is transparent over the site with a scrim and a card (macOS only), `hidden` draws nothing.
 *
 * Until the new screens land, each route shows today's: the first run, the settings' tabs, and the pairing, Prepare,
 * link and iPhone screens in a sheet's card.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useHost } from "../app";
import type { LayerMode, LayerRoute, LayerState } from "../host/types";
import { FirstRun } from "../windows/FirstRun";
import { IphoneSetup } from "../windows/IphoneSetup";
import { Framed, PairLinkSheet, PairOffer, PermissionAskSheet, Prepare } from "../windows/Pair";
import { Prefs } from "../windows/Prefs";
import { isSheet, prefsTabOf, routeKey } from "./routes";
import "./layer.css";

/** How long after a route renders the layer says it painted it (a frame). */
const PAINTED_AFTER_MS = 16;

export function AppLayer() {
  const host = useHost();
  const [state, setState] = useState<LayerState | null>(null);
  useEffect(() => {
    let live = true;
    // Never back to an older state: an answer to `layerState` may come after a newer event.
    const take = (next: LayerState) => {
      if (live) setState((prev) => (prev && prev.seq > next.seq ? prev : next));
    };
    const off = host.onLayer(take);
    host
      .layerState()
      .then(take)
      .catch(() => {});
    return () => {
      live = false;
      off();
    };
  }, [host]);

  const route = state?.route ?? null;
  const mode: LayerMode = route ? (state?.mode ?? "hidden") : "hidden";
  const fullScreen = state?.fullScreen === true;
  useEffect(() => {
    document.body.dataset.mode = mode;
    document.documentElement.toggleAttribute("data-fullscreen", fullScreen);
  }, [mode, fullScreen]);

  // Painted: the app shows the layer now (Rust waits a moment for this, then shows it anyway).
  const seq = state?.seq;
  useEffect(() => {
    if (seq === undefined) return;
    const timer = setTimeout(() => void host.layerPainted(seq).catch(() => {}), PAINTED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [host, seq]);

  const hide = useCallback(() => void host.hideLayer().catch(() => {}), [host]);

  // ⌘W / Ctrl+W, and Esc where the screen has no Esc of its own: settings and sheets step aside (the site, or its
  // cover saying why it isn't there, comes back; with no server at all, Rust puts the first run back). The first run
  // stays: its own Esc goes back a step.
  const screen = route?.screen;
  useEffect(() => {
    if (!screen || screen === "firstRun") return;
    const ownEscape = screen === "link" || screen === "iphone";
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const close = e.key.toLowerCase() === "w" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      const escapes = e.key === "Escape" && !ownEscape;
      if (!close && !escapes) return;
      e.preventDefault();
      hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, hide]);

  if (!route || !state) return <div className="dk-layer" data-mode="hidden" />;
  return (
    <LayerFrame mode={mode} sheet={isSheet(route)} mac={host.platform === "mac"}>
      <RouteScreen key={routeKey(route)} route={route} seq={state.seq} onClose={hide} />
    </LayerFrame>
  );
}

/**
 * The layer's frame. Full: the whole window, with the Mac's 48pt bar on top (it drags the window and keeps the room for
 * its buttons, as the site's own title bar does). Sheet: a scrim over the site, its top 48pt dragging the window, and
 * the screen in a card. A sheet's screen shown full (Windows, Linux, no site behind it) keeps its card.
 */
function LayerFrame({
  mode,
  sheet,
  mac,
  children,
}: {
  mode: LayerMode;
  sheet: boolean;
  mac: boolean;
  children: ReactNode;
}) {
  if (mode === "sheet") {
    return (
      <div className="dk-layer" data-mode="sheet">
        <div className="dk-layer__scrim" />
        <div className="dk-layer__drag" data-tauri-drag-region />
        <div className="dk-layer__card" role="dialog" aria-modal="true">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="dk-layer" data-mode="full" data-sheet={sheet || undefined}>
      {mac && <div className="dk-layer__bar" data-tauri-drag-region />}
      <div className="dk-layer__page">{sheet ? <div className="dk-layer__card">{children}</div> : children}</div>
    </div>
  );
}

/** Today's screen for a route. */
function RouteScreen({ route, seq, onClose }: { route: LayerRoute; seq: number; onClose: () => void }) {
  switch (route.screen) {
    case "firstRun":
      return <FirstRun mode={route.mode} shownAt={seq} />;
    // The first run takes the waiting link itself (`takeLink`) and shows it in large type.
    case "link":
      return <FirstRun shownAt={seq} />;
    case "settings":
      return <Prefs tab={prefsTabOf(route)} shownAt={seq} />;
    case "pairOffer":
      return <PairOffer target={route.target} onClose={onClose} />;
    case "prepare":
      return (
        <Framed>
          <Prepare org={route.org} server={route.server} resumed={route.resumed} onClose={onClose} />
        </Framed>
      );
    case "pairLink":
      return (
        <Framed>
          <PairLinkSheet server={route.server} code={route.code} onClose={onClose} />
        </Framed>
      );
    case "iphone":
      return <IphoneSetup onClose={onClose} />;
    case "permissionAsk":
      return (
        <Framed>
          <PermissionAskSheet onClose={onClose} />
        </Framed>
      );
  }
}
