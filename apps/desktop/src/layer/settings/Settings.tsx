/**
 * Settings › This computer on the main window's app layer (ADR 0265 §7): a dialog over the workspace's page (a card of
 * the layer's sheets, `SheetFrame`), its sections in a list beside the page: Overview, Folders and tools, Server on
 * this computer (only while the app runs it), Activity and App settings. The workspace's own settings stay on its
 * page. × , Esc and ⌘W close it; without the site behind it (offline, its server down, signed out) the same card fills
 * the window, stays, and a quiet line on top says what waits for the connection. Everything about this computer acts
 * through its own runners and the app; nothing is granted from the site.
 */
import { Button, Icon, type IconName } from "@agenteschat/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot } from "../../app";
import { homeServer, serverName } from "../../control/server";
import { type Home, orgName, pairedHomes } from "../../control/store";
import { type UpdateCheck, useLocalServer, useUpdateCheck } from "../../hooks";
import type { LayerSection, LayerState } from "../../host/types";
import { type Essentials, useEssentials } from "../../ui/essentials";
import { SHEET_TITLE_ID } from "../sheets/SheetFrame";
import { Access } from "./Access";
import { Activity } from "./Activity";
import { rowsNeedingYou } from "./AlwaysOn";
import { AppSettings } from "./AppSettings";
import { Overview } from "./Overview";
import { ServerHere } from "./Server";
import { sectionFor, sectionsOf } from "./sections";
import "./settings.css";

const SECTION_ICON: Record<LayerSection, IconName> = {
  overview: "computerMac",
  folders: "drive",
  server: "globe",
  activity: "list",
  app: "cog",
};

/** The site's part of the layer's state, kept current (`layer://state`). */
function useLayerSite(): LayerState["site"] {
  const host = useHost();
  const [site, setSite] = useState<LayerState["site"]>({ there: false, org: null });
  useEffect(() => {
    let live = true;
    let seq = -1;
    const take = (state: LayerState) => {
      if (!live || state.seq < seq) return;
      seq = state.seq;
      setSite(state.site);
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
  return site;
}

/** The server the window opens now (`servers.json`), read again when asked. */
function useCurrentServer(): [string | null, () => void] {
  const host = useHost();
  const [current, setCurrent] = useState<string | null>(null);
  const read = useCallback(() => {
    void host
      .servers()
      .then((l) => setCurrent(l.current))
      .catch(() => {});
  }, [host]);
  useEffect(read, [read]);
  return [current, read];
}

/** What every section draws from, computed once for the screen. */
export interface SettingsContext {
  homes: Home[];
  essentials: Essentials;
  update: UpdateCheck;
  /** The workspace whose page is there (its invite page). */
  org: string | null;
  siteThere: boolean;
  /** Moves the site to one of its pages and steps the layer aside (only paths the site listed, or its settings). */
  siteGo: (path: string) => void;
  /** The row the route asked for (`focus`) while the person hasn't picked a section themselves. */
  focus?: string;
  /** Opens a section on one of its rows, as a route would (the Overview's way to reach's chooser). */
  show: (section: LayerSection, focus?: string) => void;
}

/**
 * `section`/`focus`: what the layer's route asks for; `shownAt`: the layer's `seq` when it was put on screen, a new one
 * is the settings shown again (the asked section, a fresh update check).
 */
export function Settings({ section, focus, shownAt }: { section?: LayerSection; focus?: string; shownAt?: number }) {
  const { t } = useTranslation();
  const host = useHost();
  const snap = useSnapshot();
  const local = useLocalServer();
  const update = useUpdateCheck(false);
  const site = useLayerSite();
  const [current, readCurrent] = useCurrentServer();
  const homes = pairedHomes(snap);
  const essentials = useEssentials(update.state, homes);
  const needs = rowsNeedingYou(essentials.list);
  const shown = sectionsOf({
    works: homes.length > 0,
    server: local.run || (local.installed === "app" && local.owner),
  });
  const [asked, setAsked] = useState(() => ({ section, focus }));
  const [picked, setPicked] = useState<LayerSection | null>(null);
  const open = picked && shown.includes(picked) ? picked : sectionFor(asked, shown);

  // Shown again, maybe on another section or row (the site's rows, the popover's menu).
  const firstShown = useRef(shownAt);
  const again = useRef(() => {});
  again.current = () => {
    setAsked({ section, focus });
    setPicked(null);
    void update.check();
    readCurrent();
    essentials.reread();
  };
  useEffect(() => {
    if (shownAt === undefined || shownAt === firstShown.current) return;
    firstShown.current = shownAt;
    again.current();
  }, [shownAt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when the server here's address moves, or it leaves
  useEffect(readCurrent, [local.run, local.publicUrl]);

  // The asked row, brought into view and marked a moment once its section drew it.
  const askedFocus = picked ? undefined : asked.focus;
  // biome-ignore lint/correctness/useExhaustiveDependencies: again once another section drew its rows
  useEffect(() => {
    // The site's and the popover's row names are plain words (main_window.rs checks them).
    if (!askedFocus || !/^[a-z]+$/i.test(askedFocus)) return;
    let tries = 0;
    let unmark: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-focus="${askedFocus}"]`);
      if (!el && ++tries < 20) return;
      clearInterval(timer);
      if (!el) return;
      el.scrollIntoView?.({ block: "center" });
      el.setAttribute("data-focused", "");
      unmark = setTimeout(() => el.removeAttribute("data-focused"), 2000);
    }, 100);
    return () => {
      clearInterval(timer);
      if (unmark) clearTimeout(unmark);
    };
  }, [askedFocus, open]);

  // With no site behind it, ⌘W and Esc keep the settings (the layer's own keys would step it aside onto nothing).
  useEffect(() => {
    if (site.there) return;
    const onKey = (e: KeyboardEvent) => {
      const close = e.key.toLowerCase() === "w" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      // A dialog open on top closes with its own Esc.
      if (e.key === "Escape" && document.querySelector('[role="dialog"]')) return;
      if (close || e.key === "Escape") e.preventDefault();
    };
    // Before the layer's own keys, which take a key whose default was prevented as handled.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [site.there]);

  // The workspace the window opens, by its name when this computer works for it; else its server.
  const awayName =
    (current && homes.find((h) => homeServer(h) === current && orgName(h))?.status?.org?.name) ||
    (current ? serverName(current) : null);
  const siteGo = (path: string) => void host.siteGo(path).catch(() => {});
  const show = (id: LayerSection, rowFocus?: string) => {
    setPicked(null);
    setAsked({ section: id, focus: rowFocus });
  };
  const ctx: SettingsContext = {
    homes,
    essentials,
    update,
    org: site.there ? site.org : null,
    siteThere: site.there,
    siteGo,
    focus: askedFocus,
    show,
  };

  const sectionItem = (id: LayerSection) => (
    <button
      key={id}
      type="button"
      aria-current={open === id ? "page" : undefined}
      onClick={() => {
        setPicked(id);
        setAsked({ section: id, focus: undefined });
      }}
    >
      <Icon name={SECTION_ICON[id]} size={16} />
      <span className="dk-sx__label">{t(`desktop.settings.nav.${id}`)}</span>
      {id === "overview" && needs > 0 && (
        <span className="dk-sx__dot">
          <span className="ac-visually-hidden">{t("desktop.settings.nav.needs", { count: needs })}</span>
        </span>
      )}
    </button>
  );

  let body: ReactNode;
  if (open === "folders") body = <Access />;
  else if (open === "server") body = <ServerHere ctx={ctx} />;
  else if (open === "activity") body = <Activity />;
  else if (open === "app") body = <AppSettings ctx={ctx} />;
  else body = <Overview ctx={ctx} />;

  return (
    <div className="dk-sx">
      <nav className="dk-pnav dk-sx__nav" aria-label={t("desktop.settings.nav.label")}>
        <h1 id={SHEET_TITLE_ID} className="dk-sx__title">
          {t("desktop.settings.nav.thisDevice")}
        </h1>
        {shown.map(sectionItem)}
      </nav>
      <main className="dk-sx__body" key={open}>
        {!site.there && awayName && (
          <p className="dk-sx__away" role="status">
            <Icon name="cloud" size={16} />
            <span>
              <b>{t("desktop.settings.away.title", { name: awayName })}</b> {t("desktop.settings.away.body")}
            </span>
            <button
              type="button"
              className="ac-link dk-link"
              onClick={() => current && void host.chooseServer(current).catch(() => {})}
            >
              {t("desktop.common.retry")}
            </button>
          </p>
        )}
        {body}
      </main>
      {/* With the site behind it; without it, nothing would be under (the settings stay). */}
      {site.there && (
        <span className="dk-sx__close">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="close"
            className="ac-btn--glyph"
            aria-label={t("desktop.common.close")}
            onClick={() => void host.hideLayer().catch(() => {})}
          />
        </span>
      )}
    </div>
  );
}
