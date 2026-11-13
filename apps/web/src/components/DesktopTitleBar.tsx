import { Button, Icon, Kbd, modKey } from "@agenteschat/ui";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { desktopPlatform, desktopWindowAction, useWindowMaximized } from "@/lib/desktop";
import { openPalette } from "./CommandMenu";
import { useMediaQuery } from "./NavDrawer";
import { TABLET_QUERY, useSidebarCollapsed } from "./Sidebar";
import { WorkspaceSky } from "./Sky";

/**
 * The Mac app's title bar (ADR 0036): room for the
 * window's own buttons, the sidebar toggle, back and forward, and ⌘K in the
 * middle (the sidebar's own ⌘K row goes, desktop.css; in a personal workspace,
 * ADR 0159, its Go to… row and the collapse beside the person). Anywhere
 * that isn't a button drags the window (`data-tauri-drag-region`, the only
 * thing the window may ask of the app). In the workspace only; elsewhere
 * `DesktopDragStrip` keeps the top draggable.
 */
export function DesktopTitleBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  // Tablet widths always show the icon rail: nothing to toggle.
  const tablet = useMediaQuery(TABLET_QUERY);

  // ⌘[ and ⌘], as in every Mac app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === "[") router.history.back();
      else if (e.key === "]") router.history.forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <header className="titlebar" data-tauri-drag-region="deep">
      {/* Over the sidebar, the workspace's sky goes on up behind the window's buttons (one sky with its header). */}
      <WorkspaceSky part="bar" rail={collapsed || tablet} />
      <nav className="titlebar__nav">
        {!tablet && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="sidebar"
            aria-label={collapsed ? t("shell.expandNav") : t("shell.collapseNav")}
            title={collapsed ? t("shell.expandNav") : t("shell.collapseNav")}
            aria-expanded={!collapsed}
            onClick={toggleSidebar}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="chevronLeft"
          aria-label={t("shell.titleBar.back")}
          title={`${t("shell.titleBar.back")} (⌘[)`}
          onClick={() => router.history.back()}
        />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="chevronRight"
          aria-label={t("shell.titleBar.forward")}
          title={`${t("shell.titleBar.forward")} (⌘])`}
          onClick={() => router.history.forward()}
        />
      </nav>
      <button type="button" className="titlebar__search" onClick={openPalette}>
        <Icon name="search" />
        <span className="titlebar__search-label">{t("palette.jump")}</span>
        <Kbd>{modKey()}</Kbd>
        <Kbd>K</Kbd>
      </button>
    </header>
  );
}

/** Outside the workspace (sign-in, onboarding): an empty strip on top that drags the window. */
export function DesktopDragStrip() {
  return <div className="titlebar-strip" data-tauri-drag-region="deep" aria-hidden="true" />;
}

/**
 * The Windows app's window buttons: the app builds its window without a system frame there (main_window.rs),
 * so its bar is the title bar as a Mac's already is, and these three stand at the bar's right end — over the
 * workspace bar's free right side, and over the strip's on every other page (desktop.css). The middle button
 * puts the window at its largest or, drawn as restore, back.
 */
export function DesktopWindowControls() {
  const { t } = useTranslation();
  const maximized = useWindowMaximized();
  if (desktopPlatform() !== "windows") return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of window buttons, not a fieldset
    <div className="titlebar__controls" role="group" aria-label={t("shell.titleBar.window")}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="minimize"
        aria-label={t("shell.titleBar.minimize")}
        title={t("shell.titleBar.minimize")}
        onClick={() => desktopWindowAction("minimize")}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={maximized ? "restore" : "maximize"}
        aria-label={t(maximized ? "shell.titleBar.restore" : "shell.titleBar.maximize")}
        title={t(maximized ? "shell.titleBar.restore" : "shell.titleBar.maximize")}
        onClick={() => desktopWindowAction("maximize")}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="close"
        aria-label={t("shell.titleBar.close")}
        title={t("shell.titleBar.close")}
        onClick={() => desktopWindowAction("close")}
      />
    </div>
  );
}
