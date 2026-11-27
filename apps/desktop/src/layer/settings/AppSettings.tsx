/**
 * Settings › This computer › App settings (ADR 0256 §7): the app's own choices. Its notifications; the app itself
 * (language, opening at login, the menu bar icon, the notch, Linux's compatibility mode); with the server here, whether
 * people reach it from their devices and its usage statistics; the servers and accounts this app opens; updates and
 * About; and, while agents work here, the advanced limits.
 */
import type { AppLocale } from "@agenteschat/i18n/locale";
import { Button, Dialog, DialogFooter, Select, Switch } from "@agenteschat/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { BROWSER_NOTIFY_PREF } from "../../control/browser";
import { MENU_BAR_PREF, menuBarShown } from "../../control/dock";
import { NOTCH_PREF } from "../../control/notch";
import { SITE_NOTIFY_PREF } from "../../control/notify";
import { useLocalServer, usePending, usePref } from "../../hooks";
import { detectedLocale, LOCALE_PREF, locales, switchDesktopLocale } from "../../i18n";
import { CardTitle, hintFor, PrefCard, PrefHead, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { Advanced } from "./Advanced";
import { ReachChooser, ReachRows, useReach } from "./fixes";
import { Servers } from "./Servers";
import type { SettingsContext } from "./Settings";
import { About, Updates } from "./Updates";

export function AppSettings({ ctx }: { ctx: SettingsContext }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const local = useLocalServer();
  const works = ctx.homes.length > 0;
  const mac = host.platform === "mac";
  const linux = host.platform === "linux";
  const [launch, setLaunch] = useState<boolean | null>(null);
  const [notifySite, setNotifySite] = usePref(SITE_NOTIFY_PREF, true);
  const [notify, setNotify] = usePref("notify", true);
  // Off by default: the request already comes by push and in the site's "Waiting for you".
  const [notifyBrowser, setNotifyBrowser] = usePref(BROWSER_NOTIFY_PREF, false);
  // Off by default: the window only exists while it's on.
  const [notch, setNotch] = usePref(NOTCH_PREF, false);
  const [menuBar, setMenuBar] = usePref<boolean | null>(MENU_BAR_PREF, null);
  const [language, setLanguage] = usePref<AppLocale | "auto">(LOCALE_PREF, "auto");
  // Linux: Compatibility mode as the next opening will have it; null until read.
  const [compat, setCompat] = useState<boolean | null>(null);
  const [compatSaving, setCompatSaving] = useState(false);
  // The system's own WEBKIT_DISABLE_DMABUF_RENDERER decides, not the switch.
  const [compatOwn, setCompatOwn] = useState(false);
  const [askReopen, setAskReopen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const iconShown = menuBarShown(menuBar, works || local.run);
  useEffect(() => {
    void host.setTrayVisible(iconShown).catch(() => {});
  }, [host, iconShown]);

  // Pairing turns it on: read again when a workspace joins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger
  useEffect(() => {
    host
      .autostart()
      .then(setLaunch)
      .catch(() => setLaunch(false));
  }, [host, ctx.homes.length]);

  // An opening that fell back to compatibility mode says so here once, with the way back to the graphics card.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per window
  useEffect(() => {
    if (!linux) return;
    host
      .compatMode()
      .then((mode) => {
        setCompat(mode.on);
        setCompatOwn(mode.own);
        if (!mode.fellBack) return;
        toast(t("desktop.prefs.general.compatFellBack"), "alert", {
          label: t("desktop.prefs.general.compatTryCard"),
          run: () => void changeCompat(false, true),
        });
      })
      .catch(() => setCompat(true));
  }, [host, linux]);

  const reopenNow = async () => {
    setReopening(true);
    try {
      await host.reopen();
    } catch {
      setReopening(false);
      setAskReopen(false);
      toast(t("desktop.common.error"), "alert");
    }
  };
  // Read when pressed: a toast's action keeps the render it was made in.
  const askFirst = useRef(false);
  askFirst.current = works || local.run;
  /** While agents work here or agentes.chat runs here, asks first, as Quit does. */
  const reopen = () => (askFirst.current ? setAskReopen(true) : void reopenNow());

  /** The drawing mode changes only on a new start: reopen now, or say it will. */
  const changeCompat = async (on: boolean, reopenAfter = false) => {
    setCompatSaving(true);
    try {
      await host.setCompatMode(on);
      setCompat(on);
      if (reopenAfter) reopen();
      else
        toast(t("desktop.prefs.general.compatReopen"), "info", {
          label: t("desktop.prefs.general.reopenNow"),
          run: reopen,
        });
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setCompatSaving(false);
    }
  };

  // Open at login has an ⓘ only where it changes something: agentes.chat running here, or agents working here.
  const launchHint = local.run || works;

  return (
    <>
      <PrefHead title={t("desktop.settings.app.title")} />

      <section data-focus="notifications">
        <CardTitle>{t("desktop.settings.app.notifications")}</CardTitle>
        <PrefCard>
          <PrefRow
            title={t("desktop.prefs.general.notifySiteTitle")}
            hint={hintFor(t, t("desktop.prefs.general.notifySiteTitle"), t("desktop.prefs.general.notifySiteDesc"))}
            htmlFor="notify-site"
            end={
              <Switch
                id="notify-site"
                aria-describedby="notify-site-hint"
                checked={notifySite}
                onCheckedChange={(on) => {
                  setNotifySite(on);
                  void host.setSiteNotify(on).catch(() => {});
                }}
              />
            }
          />
          {works && (
            <>
              <PrefRow
                title={t("desktop.prefs.general.notifyTitle")}
                htmlFor="notify"
                end={<Switch id="notify" checked={notify} onCheckedChange={setNotify} />}
              />
              <PrefRow
                title={t("desktop.prefs.general.notifyBrowserTitle")}
                hint={hintFor(
                  t,
                  t("desktop.prefs.general.notifyBrowserTitle"),
                  t("desktop.prefs.general.notifyBrowserDesc"),
                )}
                htmlFor="notify-browser"
                end={
                  <Switch
                    id="notify-browser"
                    aria-describedby="notify-browser-hint"
                    checked={notifyBrowser}
                    onCheckedChange={setNotifyBrowser}
                  />
                }
              />
            </>
          )}
        </PrefCard>
      </section>

      <CardTitle>{t("desktop.settings.app.thisApp")}</CardTitle>
      <PrefCard>
        <PrefRow
          title={t("shell.language")}
          htmlFor="language"
          end={
            <Select
              id="language"
              size="sm"
              align="end"
              // Never picked: the system's language shows as the one chosen (and keeps following it until a pick).
              value={language === "auto" ? detectedLocale() : language}
              onValueChange={(v) => {
                setLanguage(v);
                switchDesktopLocale(i18n, v, host.platform);
              }}
              options={locales.map((l) => ({ value: l.code, label: l.label }))}
            />
          }
        />
        <PrefRow
          title={t("desktop.prefs.general.launchTitle")}
          hint={
            launchHint
              ? hintFor(t, t("desktop.prefs.general.launchTitle"), t("desktop.prefs.general.launchWork"))
              : undefined
          }
          htmlFor="launch"
          end={
            <Switch
              id="launch"
              aria-describedby={launchHint ? "launch-hint" : undefined}
              checked={launch === true}
              disabled={launch === null}
              onCheckedChange={(on) => {
                setLaunch(on);
                host
                  .setAutostart(on)
                  .then(ctx.essentials.reread)
                  .catch(() => {
                    setLaunch(!on);
                    toast(t("desktop.common.error"), "alert");
                  });
              }}
            />
          }
        />
        {mac && (
          <PrefRow
            title={t("desktop.prefs.general.menuBarTitle")}
            htmlFor="menu-bar"
            end={<Switch id="menu-bar" checked={iconShown} onCheckedChange={setMenuBar} />}
          />
        )}
        {mac && works && (
          <PrefRow
            title={t("desktop.prefs.general.notchTitle")}
            hint={hintFor(t, t("desktop.prefs.general.notchTitle"), t("desktop.prefs.general.notchDesc"))}
            htmlFor="notch"
            end={
              <Switch
                id="notch"
                aria-describedby="notch-hint"
                checked={notch}
                onCheckedChange={(on) => {
                  setNotch(on);
                  host.setNotch(on).catch(() => {
                    setNotch(!on);
                    toast(t("desktop.common.error"), "alert");
                  });
                }}
              />
            }
          />
        )}
        {linux && (
          <PrefRow
            title={t("desktop.prefs.general.compatTitle")}
            hint={hintFor(
              t,
              t("desktop.prefs.general.compatTitle"),
              compatOwn
                ? t("common.joinSentences", {
                    a: t("desktop.prefs.general.compatDesc"),
                    b: t("desktop.prefs.general.compatOwn"),
                  })
                : t("desktop.prefs.general.compatDesc"),
            )}
            htmlFor="compat"
            end={
              <Switch
                id="compat"
                aria-describedby="compat-hint"
                checked={compat !== false}
                disabled={compat === null || compatSaving || compatOwn}
                onCheckedChange={(on) => void changeCompat(on)}
              />
            }
          />
        )}
      </PrefCard>

      {local.run && <HereChoices />}

      <section data-focus="servers">
        <CardTitle>{t("desktop.settings.app.servers")}</CardTitle>
        <Servers />
      </section>

      <Updates update={ctx.update} />
      <About />
      {works && <Advanced />}

      <Dialog
        open={askReopen}
        onOpenChange={(open) => !open && !reopening && setAskReopen(false)}
        title={t("desktop.prefs.general.reopenTitle")}
        description={t(local.run ? "desktop.tray.quitHereBody" : "desktop.prefs.general.reopenBody")}
        closeLabel={t("desktop.common.close")}
        width={440}
      >
        <DialogFooter bar>
          <Button variant="ghost" onClick={() => setAskReopen(false)} disabled={reopening}>
            {t("desktop.common.cancel")}
          </Button>
          <Button variant="primary" loading={reopening} onClick={() => void reopenNow()}>
            {t("desktop.prefs.general.reopenNow")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/**
 * The server here's own choices: whether people reach it from their devices (off, it is only on this computer;
 * turning it on chooses how, with the picker inline, ADR 0256 §4; turning it off asks first) and its usage statistics
 * (changing it restarts it a moment).
 */
function HereChoices() {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const local = useLocalServer();
  const reach = useReach();
  const [busy, run] = usePending<"usage">();
  // How people get here, being chosen under the switch before it turns on.
  const [choosing, setChoosing] = useState(false);
  const running = local.phase === "running";
  // The way's words under the switch while it is on.
  const way = local.way?.kind === "address" ? "wayAddress" : "wayTailscale";
  return (
    <section data-focus="telemetry">
      <CardTitle>{t("desktop.server.title")}</CardTitle>
      <PrefCard>
        <PrefRow
          top
          title={t("desktop.here.reach")}
          hint={hintFor(t, t("desktop.here.reach"), t("desktop.here.reachText"))}
          htmlFor="here-reach"
          desc={local.reach ? t(`desktop.settings.server.${way}`) : null}
          end={
            <Switch
              id="here-reach"
              aria-describedby="here-reach-hint"
              checked={local.reach}
              disabled={reach.reaching || !running || (choosing && !local.reach)}
              onCheckedChange={(on) => {
                if (!on) {
                  reach.askOff();
                  return;
                }
                reach.clear();
                setChoosing(true);
              }}
            />
          }
          under={
            choosing &&
            !local.reach && (
              <ReachChooser
                local={local}
                control={reach}
                apply={t("desktop.settings.essentials.turnOn")}
                done={() => setChoosing(false)}
              />
            )
          }
        />
        <ReachRows control={reach} port={local.port} choosing={choosing && !local.reach} />
        <PrefRow
          title={t("desktop.here.usage")}
          hint={hintFor(
            t,
            t("desktop.here.usage"),
            t("common.joinSentences", { a: t("desktop.here.usageText"), b: t("desktop.server.usageRestart") }),
          )}
          htmlFor="here-usage-prefs"
          end={
            <Switch
              id="here-usage-prefs"
              aria-describedby="here-usage-prefs-hint"
              checked={local.usage}
              disabled={busy !== null}
              onCheckedChange={(on) =>
                void run("usage", () => host.setLocalUsage(on).catch(() => toast(t("desktop.common.error"), "alert")))
              }
            />
          }
        />
      </PrefCard>
      {reach.dialog}
    </section>
  );
}
