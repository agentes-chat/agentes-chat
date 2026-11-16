import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { OPEN_LAYER } from "@agenteschat/ui";
import { useRouterState } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  type TouchEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "./org-context";
import { MyFace, OrgMark } from "./ProfilePhoto";

/**
 * Breakpoints (layout.css keeps the same numbers):
 * phone ≤ 640px · compact ≤ 760px (tabs at the bottom, the sidebar a sheet behind Conversas, panels full-screen sheets)
 * · tablet 761–1199px (sidebar = icon rail, its toggle opens it over the page) · desktop ≥ 1200px.
 */
export const PHONE_QUERY = "(max-width: 640px)";
export const COMPACT_QUERY = "(max-width: 760px)";
export const DESKTOP_QUERY = "(min-width: 1200px)";
/** The sidebar's id: the menu buttons control it. */
export const NAV_ID = "app-nav";

/** A CSS media query, live (false where `matchMedia` is missing). */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

interface NavDrawer {
  /** The sidebar is a drawer (narrow screen). */
  compact: boolean;
  open: boolean;
  show: () => void;
  /** `restoreFocus`: back to the button that opened it (Esc, the scrim), not after navigating. */
  close: (options?: { restoreFocus?: boolean }) => void;
  toggle: () => void;
  /** Handlers for the sidebar: a link closes it; dragging it down closes it. */
  navProps: {
    id: string;
    "data-open": boolean;
    tabIndex: -1;
    onClick: (e: { target: EventTarget }) => void;
    onTouchStart: (e: TouchEvent) => void;
    onTouchMove: (e: TouchEvent) => void;
    onTouchEnd: (e: TouchEvent) => void;
  };
}

const NavDrawerContext = createContext<NavDrawer | null>(null);

/** The drawer state, or null outside the workspace shell. */
export const useNavDrawer = () => useContext(NavDrawerContext);

/** A drag past this share of the sheet's height, or a flick faster than this (px/ms), closes it. */
const CLOSE_SHARE = 0.3;
const CLOSE_SPEED = 0.5;

/**
 * The workspace navigation on narrow screens: the sidebar rises over the page
 * as a sheet (the Conversas tab, TabBar.tsx). Closes on Esc, on the scrim, when
 * dragged down and whenever the page changes; the page behind is inert while
 * it's open. The drag follows the finger itself (no transition), the scrim fading
 * with it, and on release the sheet goes on from where the finger left it.
 */
export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  // The drag: where it started, how far it is and how fast it last moved. `on` once it reads as a pull down.
  const drag = useRef<{ x: number; y: number; t: number; dy: number; v: number; on: boolean } | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Where focus goes once the page behind is reachable again.
  const restore = useRef<HTMLElement | null>(null);
  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    restore.current = options?.restoreFocus ? opener.current : null;
    opener.current = null;
    setOpen(false);
  }, []);
  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const toggle = useCallback(() => (open ? close({ restoreFocus: true }) : show()), [open, close, show]);

  // A new page closes it (links, the palette, redirects).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setOpen(false);
    opener.current = null;
  }, [pathname]);

  // Wide again: the sidebar is back in the layout.
  useEffect(() => {
    if (!compact) setOpen(false);
  }, [compact]);

  // Esc closes it, before the page sees the key (Esc in a channel would stop an agent). A menu or
  // dialog opened from the drawer closes first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(OPEN_LAYER)) return;
      e.preventDefault();
      close({ restoreFocus: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Open: focus moves into the navigation, and (as a drawer) the page behind can't be reached.
  useEffect(() => {
    if (!open) return;
    const nav = document.getElementById(NAV_ID);
    nav?.focus({ preventScroll: true });
    const behind =
      compact && nav?.parentElement
        ? Array.from(nav.parentElement.children).filter(
            (el): el is HTMLElement =>
              el !== nav && el instanceof HTMLElement && !el.classList.contains("shell__scrim"),
          )
        : [];
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
      const back = restore.current;
      restore.current = null;
      if (back?.isConnected) back.focus();
    };
  }, [open, compact]);

  const value = useMemo<NavDrawer>(
    () => ({
      compact,
      open,
      show,
      close,
      toggle,
      navProps: {
        id: NAV_ID,
        "data-open": open,
        tabIndex: -1,
        onClick: (e) => {
          // Following a link closes it even when the page doesn't change (the current channel).
          if (open && e.target instanceof Element && e.target.closest("a[href]")) close();
        },
        onTouchStart: (e) => {
          const t = e.touches[0];
          // Inside the list only from its top: further down, a pull down scrolls it.
          const list = e.target instanceof Element ? e.target.closest(".sidebar__scroll") : null;
          drag.current =
            open && t && !(list && list.scrollTop > 0)
              ? { x: t.clientX, y: t.clientY, t: e.timeStamp, dy: 0, v: 0, on: false }
              : null;
        },
        onTouchMove: (e) => {
          const d = drag.current;
          const t = e.touches[0];
          if (!d || !t) return;
          const dy = t.clientY - d.y;
          if (!d.on) {
            if (Math.abs(dy) < 6 && Math.abs(t.clientX - d.x) < 6) return;
            // Sideways or up first: not ours (a row's own drag, a scroll).
            if (dy <= 0 || Math.abs(t.clientX - d.x) > dy) {
              drag.current = null;
              return;
            }
            d.on = true;
          }
          const sheet = e.currentTarget as HTMLElement;
          d.v = (dy - d.dy) / Math.max(1, e.timeStamp - d.t);
          d.t = e.timeStamp;
          d.dy = dy;
          // Above where it opened it gives a fifth of the pull, so its top edge reads as an edge.
          sheet.dataset.dragging = "";
          sheet.style.transform = `translateY(${dy < 0 ? dy * 0.2 : dy}px)`;
          const scrim = document.querySelector<HTMLElement>(".shell__scrim");
          if (scrim) scrim.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
        },
        onTouchEnd: (e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.on) return;
          const sheet = e.currentTarget as HTMLElement;
          // Back to the stylesheet: its transition takes the sheet on (or back) from where the finger left it.
          delete sheet.dataset.dragging;
          sheet.style.transform = "";
          const scrim = document.querySelector<HTMLElement>(".shell__scrim");
          if (scrim) scrim.style.opacity = "";
          if (d.dy > sheet.offsetHeight * CLOSE_SHARE || d.v > CLOSE_SPEED) close();
        },
      },
    }),
    [compact, open, show, close, toggle],
  );
  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}

/** Behind the open drawer: dims the page; a tap closes the drawer. */
export function NavScrim() {
  const { t } = useTranslation();
  const drawer = useNavDrawer();
  if (!drawer?.compact || !drawer.open) return null;
  return (
    <button
      type="button"
      className="shell__scrim"
      tabIndex={-1}
      aria-label={t("shell.closeNav")}
      onClick={() => drawer.close({ restoreFocus: true })}
    />
  );
}

/**
 * The top bar on narrow screens: the workspace's name (the tabs at the bottom carry the rest, TabBar.tsx). Chat pages
 * hide it (their header is the top there; see responsive.css). A personal workspace shows the person, as its sidebar
 * does on top (ADR 0159).
 */
export function ShellBar() {
  const { org, me } = useOrg();
  const drawer = useNavDrawer();
  if (!drawer?.compact) return null;
  return (
    <header className="shell__bar">
      <span className="shell__bar-org">
        {isPersonal(org) ? <MyFace size="sm" /> : <OrgMark logo={org.logo} size={22} />}
        <span className="shell__bar-name">{isPersonal(org) ? me.user.name : org.name}</span>
      </span>
    </header>
  );
}
