/**
 * The server here, when it runs on this computer: its state in a word of its colour, `···` with Restart, Stop (how
 * long: an hour, until Start, or not with the app; ADR 0158) and This computer's settings (inline, as the pause menu:
 * the popover is a window of its own size), `also` (the other workspaces using this computer). Stopped or not
 * starting, the row's word is the title and what to do goes right under it, on the text edge: why, then Start or
 * Try again (stopped by the person, the line says until when and Start sits at the row's end). An update that went
 * back is a note after it, until dismissed. Whether the phone and the team reach it is an essential (the note above).
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

/** The version whose "went back" note the person dismissed. */
const BACK_SEEN_PREF = "hereBackSeen";

/** Where the server here writes its log (`logs/server.log` in its folder), with the folder's own separator. */
const logsFolder = (dir: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}logs`;

/** `strong`: the first thing on the popover that needs the person, whose button is the one filled button there. */
export function HereCard({
  local,
  also,
  onSettings,
  strong = false,
}: {
  local: LocalServerStatus;
  also?: ReactNode;
  onSettings: () => void;
  strong?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [stopMenu, setStopMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  // The "went back" note, dismissed for that version (it comes back for another one).
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
  // Stopped by the person, the line already says until when: Start at the row's end, nothing under it.
  const detail = banner === "failing" ? "failing" : banner === "stopped" && !local.held ? "stopped" : null;
  const line = local.held
    ? local.heldUntil
      ? t("desktop.server.stoppedUntil", { time: clock(new Date(local.heldUntil).toISOString(), i18n.language) })
      : t("desktop.server.stoppedHeld")
    : t(state.key);
  const start = (
    <Button
      size="sm"
      variant={strong ? "primary" : "default"}
      icon="play"
      loading={busy}
      onClick={act(() => host.startLocalServer())}
    >
      {t("desktop.server.start")}
    </Button>
  );
  return (
    <>
      <section className="dk-trayhere">
        <div className="dk-trayhere__row">
          <span className="dk-tray__lead">
            <Icon name="computer" size={16} />
          </span>
          <span className="dk-trayhere__text">
            <b>{t("desktop.server.title")}</b>
            <small data-tone={local.held ? "warn" : state.tone} className={state.busy ? "dk-shimmer" : undefined}>
              {line}
            </small>
          </span>
          <span className="ac-acts dk-trayhere__end">
            {!running && !detail && start}
            <Button
              size="sm"
              variant="ghost"
              icon="more"
              className="dk-trayhere__morebtn"
              aria-expanded={more}
              aria-label={t("desktop.servers.more", { host: t("desktop.server.title") })}
              onClick={() => {
                setStopMenu(false);
                setMore((v) => !v);
              }}
            />
          </span>
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
                  trailing={<Icon name={stopMenu ? "chevronDown" : "chevronRight"} size={16} />}
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
        {detail === "stopped" && (
          <div className="dk-trayhere__detail">
            <p>{t("desktop.server.stoppedBody")}</p>
            <div className="dk-trayhere__acts">{start}</div>
          </div>
        )}
        {detail === "failing" && (
          <div className="dk-trayhere__detail">
            <p>
              {t("desktop.server.failingWhy")} <CopyDetails as="link" /> ·{" "}
              <HelpLink slug="run-on-your-computer">{t("desktop.server.help")}</HelpLink>
            </p>
            <div className="dk-trayhere__acts">
              <Button size="sm" onClick={() => void host.revealFolder(logsFolder(local.dir)).catch(() => {})}>
                {t("desktop.server.showLogs")}
              </Button>
              <Button
                size="sm"
                variant={strong ? "primary" : "default"}
                icon="refresh"
                loading={busy}
                onClick={act(() => host.startLocalServer())}
              >
                {t("desktop.common.retry")}
              </Button>
            </div>
          </div>
        )}
      </section>
      {banner === "back" && local.backTo !== backSeen && (
        <Banner
          icon="alert"
          tone="warn"
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
    </>
  );
}
