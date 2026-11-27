/**
 * The server here, when it runs on this computer: its state in a word of its colour, Start in sight while it's
 * stopped, `···` with Restart, Stop (how long: an hour, until Start, or not with the app; ADR 0158) and This computer's
 * settings (inline, as the pause menu: the popover is a window of its own size), `also` (the other workspaces using this
 * computer), and its banners: stopped (Start it), not starting (why, Copy details, the logs, Try again), an update
 * that went back (until dismissed). Whether the phone and the team reach it is an essential (the banner above).
 */
import { Button, Icon } from "@agenteschat/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { hereBanner, type LocalServerStatus } from "../../control/local-server";
import { readPref, writePref } from "../../hooks";
import { Banner, HelpLink, MenuRow } from "../../ui/bits";
import { CopyDetails } from "../../ui/here";
import { useToast } from "../../ui/Toast";
import { clock } from "../../ui/time";
import { hereState } from "./state";

/** The version whose "went back" banner the person dismissed. */
const BACK_SEEN_PREF = "hereBackSeen";

/** Where the server here writes its log (`logs/server.log` in its folder), with the folder's own separator. */
const logsFolder = (dir: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}logs`;

export function HereCard({
  local,
  also,
  onSettings,
}: {
  local: LocalServerStatus;
  also?: ReactNode;
  onSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [stopMenu, setStopMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  // The "went back" banner, dismissed for that version (it comes back for another one).
  const [backSeen, setBackSeen] = useState(() => readPref(BACK_SEEN_PREF, ""));
  const act = (run: () => Promise<void>) => async () => {
    setMore(false);
    setStopMenu(false);
    setBusy(true);
    try {
      await run();
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setBusy(false);
    }
  };
  const banner = hereBanner(local);
  const state = hereState(local);
  const running = local.phase === "running" || state.busy;
  const line = local.held
    ? local.heldUntil
      ? t("desktop.server.stoppedUntil", { time: clock(new Date(local.heldUntil).toISOString(), i18n.language) })
      : t("desktop.server.stoppedHeld")
    : t(state.key);
  const start = (
    <Button size="sm" variant="primary" icon="play" loading={busy} onClick={act(() => host.startLocalServer())}>
      {t("desktop.server.start")}
    </Button>
  );
  return (
    <section className="dk-trayhere">
      <div className="dk-trayhere__row">
        <span className="dk-logo dk-logo--soft dk-trayhere__icon">
          <Icon name="computer" size={16} />
        </span>
        <span className="dk-trayhere__text">
          <b>{t("desktop.server.title")}</b>
          <small data-tone={local.held ? "warn" : state.tone} className={state.busy ? "dk-shimmer" : undefined}>
            {line}
          </small>
        </span>
        {!running && start}
        <button
          type="button"
          className="dk-iconbtn"
          aria-expanded={more}
          aria-label={t("desktop.servers.more", { host: t("desktop.server.title") })}
          onClick={() => {
            setStopMenu(false);
            setMore((v) => !v);
          }}
        >
          <Icon name="more" size={16} />
        </button>
      </div>
      {more && (
        <div className="dk-sub dk-trayhere__more">
          {running && (
            <>
              <MenuRow icon="refresh" disabled={busy} onClick={act(() => host.restartLocalServer())}>
                {t("desktop.server.restart")}
              </MenuRow>
              <MenuRow
                icon="stop"
                disabled={busy}
                expanded={stopMenu}
                onClick={() => setStopMenu((v) => !v)}
                trailing={<Icon name={stopMenu ? "chevronDown" : "chevronRight"} size={14} />}
              >
                {t("desktop.server.stop")}
              </MenuRow>
              {stopMenu && (
                <div className="dk-sub dk-trayhere__stop">
                  <MenuRow icon="clock" onClick={act(() => host.stopLocalServer(false, 60))}>
                    {t("desktop.server.stopFor1h")}
                  </MenuRow>
                  <MenuRow icon="stop" onClick={act(() => host.stopLocalServer(false))}>
                    {t("desktop.server.stopUntilStart")}
                  </MenuRow>
                  {/* Not with the app any more: the server's settings ask first and say where its data stays. */}
                  <MenuRow
                    icon="power"
                    onClick={() => {
                      setMore(false);
                      setStopMenu(false);
                      onSettings();
                    }}
                  >
                    {t("desktop.server.stopForget")}
                  </MenuRow>
                  <span className="dk-help dk-sub__hint">{t("desktop.server.stopNote")}</span>
                </div>
              )}
            </>
          )}
          <MenuRow icon="settings" onClick={onSettings}>
            {t("desktop.tray.settings")}
          </MenuRow>
        </div>
      )}
      {also}
      {/* Stopped by the person, the line already says until when, with Start: no banner over it. */}
      {banner === "stopped" && !local.held && (
        <Banner icon="alert" title={t("desktop.server.stoppedBanner")} actions={start}>
          {t("desktop.server.stoppedBody")}
        </Banner>
      )}
      {banner === "failing" && (
        <Banner
          icon="alert"
          title={t("desktop.server.failingBanner")}
          actions={
            <>
              <CopyDetails />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void host.revealFolder(logsFolder(local.dir)).catch(() => {})}
              >
                {t("desktop.server.showLogs")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="refresh"
                loading={busy}
                onClick={act(() => host.startLocalServer())}
              >
                {t("desktop.common.retry")}
              </Button>
            </>
          }
        >
          {t("desktop.server.failingWhy")} <HelpLink slug="run-on-your-computer">{t("desktop.server.help")}</HelpLink>
        </Banner>
      )}
      {banner === "back" && local.backTo !== backSeen && (
        <Banner
          icon="alert"
          title={t("desktop.server.updateBack", { version: local.backTo })}
          actions={
            <>
              <CopyDetails />
              <Button
                size="sm"
                onClick={() => {
                  writePref(BACK_SEEN_PREF, local.backTo ?? "");
                  setBackSeen(local.backTo ?? "");
                }}
              >
                {t("desktop.server.gotIt")}
              </Button>
            </>
          }
        >
          {t("desktop.server.updateBackBody")}
        </Banner>
      )}
    </section>
  );
}
