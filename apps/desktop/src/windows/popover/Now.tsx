/**
 * "Now": what agents do on this computer at this moment. An agent in its browser is its browser row (what it does
 * there, Open when it asked for help, See and Stop); every other agent is one row, "Ada read src/app.ts", with its
 * workspace and since when. Nothing going on: a calm line (or, paused, that nothing new starts).
 */
import type { ControlBrowser, ControlJob } from "@agenteschat/adapters/runner-control";
import { type AgentState, Button, Icon, normalizeAppearance, PixelSpinner } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useStore } from "../../app";
import { saidText } from "../../control/activity";
import { browserRowState, browsersOf, siteLink } from "../../control/browser";
import { homeServer } from "../../control/server";
import { type Home, orgName } from "../../control/store";
import { agentOf } from "../../hooks";
import { AgentFace, BrandFace } from "../../ui/bits";
import { useToast } from "../../ui/Toast";
import { clock, since } from "../../ui/time";
import { agentRows, type AgentRow as Row } from "./state";

export function NowList({ homes, paused, now }: { homes: Home[]; paused: boolean; now: number }) {
  const { t } = useTranslation();
  const browsers = homes.flatMap((home) => browsersOf(home.status).map((browser) => ({ home, browser })));
  const inBrowser = new Set(browsers.map(({ home, browser }) => `${home.homeId}:${browser.agentId}`));
  // An agent in its browser shows once, as its browser row (its thinking is what drives it).
  const rows = agentRows(
    homes,
    (home, job) => job.kind === "brain" && !!job.agent && inBrowser.has(`${home.homeId}:${job.agent.id}`),
  );
  if (browsers.length + rows.length === 0) {
    const someone = homes.flatMap((h) => h.status?.agents ?? [])[0];
    return (
      <div className="dk-empty">
        {someone ? (
          <AgentFace agent={someone} size="sm" state={paused ? "waiting" : "idle"} />
        ) : (
          <BrandFace size="sm" />
        )}
        <span className="dk-empty__text">
          <b>{paused ? t("desktop.tray.pausedEmptyTitle") : t("desktop.tray.calmTitle")}</b>
          <span>{paused ? t("desktop.tray.pausedEmptyBody") : t("desktop.tray.calmBody")}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="dk-now">
      {browsers.map(({ home, browser }) => (
        <BrowserRow key={`browser:${home.homeId}:${browser.agentId}`} home={home} browser={browser} />
      ))}
      {rows.map((row) => (
        <AgentRow key={row.key} row={row} now={now} />
      ))}
    </div>
  );
}

/** One agent: its latest job in its words, its workspace and since when. */
function AgentRow({ row, now }: { row: Row<Home>; now: number }) {
  const { t, i18n } = useTranslation();
  const { home, job } = row;
  const agent = row.agent ? agentOf(home, row.agent) : null;
  const what = saidText(t, job, (iso) => clock(iso, i18n.language, new Date()));
  return (
    <div className="dk-now__row">
      {agent ? <AgentFace agent={agent} size="sm" state={stateOf(job)} /> : <BrandFace size="sm" state="writing" />}
      <span className="dk-now__text">
        <span className="dk-now__what">
          {agent ? (
            <>
              <b>{agent.name}</b> {what}
            </>
          ) : (
            what
          )}
        </span>
        <small>
          {[orgName(home), job.background ? t("desktop.tray.background") : null, since(job.startedAt, t, now)]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
    </div>
  );
}

/** Thinking while it thinks, writing while it does something. */
const stateOf = (job: ControlJob): AgentState => (job.kind === "brain" ? "thinking" : "writing");

/**
 * An agent in its browser: "Theo in the browser" with the site and what it does, See and Stop; "Walter is in
 * control" while a person drives; "Theo needs you" with Open when it asked for help.
 */
function BrowserRow({ home, browser }: { home: Home; browser: ControlBrowser }) {
  const { t } = useTranslation();
  const host = useHost();
  const store = useStore();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = agentOf(home, { id: browser.agentId, name: t("desktop.tray.browser.someAgent") });
  const color = normalizeAppearance(agent.look).color;
  const state = browserRowState(browser);
  const open = (path?: string) => {
    const server = homeServer(home);
    if (server) void host.openExternal(siteLink(server, path, server)).catch(() => {});
    void host.hideWindow("popover").catch(() => {});
  };
  const stop = async () => {
    setBusy(true);
    try {
      await store.request(home.homeId, { type: "browser.stop", agentId: browser.agentId });
      toast(t("desktop.tray.browser.stopped", { agent: agent.name }), "stop");
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const where = browser.host ?? t("desktop.tray.browser.noSite");
  const detail =
    state.kind === "needs"
      ? state.request
        ? `${where} · ${state.request}`
        : where
      : state.kind === "control"
        ? state.controller
          ? t("desktop.tray.browser.inControl", { person: state.controller })
          : t("desktop.tray.browser.someoneInControl")
        : browser.doing
          ? `${where} · ${t(`desktop.tray.browser.doing.${browser.doing}`)}`
          : where;

  if (confirm) {
    return (
      <div className="dk-job dk-job--browser dk-job--confirm">
        <span className="dk-job__text">
          <b>
            <span>{t("desktop.tray.browser.stopAsk", { agent: agent.name })}</span>
          </b>
          <small>{t("desktop.tray.browser.stopHint")}</small>
        </span>
        <span className="dk-job__acts">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
            {t("desktop.common.cancel")}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void stop()}>
            {t("desktop.tray.browser.stopConfirm")}
          </Button>
        </span>
      </div>
    );
  }
  return (
    <div className={`dk-job dk-job--browser${state.kind === "needs" ? " dk-job--needs" : ""}`}>
      <span className="dk-job__av">
        <AgentFace agent={agent} size="sm" state={state.kind === "needs" ? "waiting" : "writing"} />
      </span>
      <span className="dk-job__text">
        <b>
          <span>
            {state.kind === "needs"
              ? t("desktop.tray.browser.needs", { agent: agent.name })
              : t("desktop.tray.browser.title", { agent: agent.name })}
          </span>
        </b>
        <small>
          {state.kind === "needs" ? <Icon name="globe" size={14} /> : <PixelSpinner size={14} color={color} />}
          <span className="dk-job__detail">{detail}</span>
        </small>
      </span>
      <span className="dk-job__acts">
        {state.kind === "needs" ? (
          <Button size="sm" variant="primary" onClick={() => open(state.link)}>
            {t("desktop.tray.browser.open")}
          </Button>
        ) : (
          <button
            type="button"
            className="dk-iconbtn"
            title={t("desktop.tray.browser.see")}
            aria-label={t("desktop.tray.browser.see")}
            onClick={() => open(state.link)}
          >
            <Icon name="external" size={14} />
          </button>
        )}
        <button
          type="button"
          className="dk-iconbtn"
          title={t("desktop.tray.browser.stop")}
          aria-label={t("desktop.tray.browser.stop")}
          onClick={() => setConfirm(true)}
        >
          <Icon name="stop" size={14} />
        </button>
      </span>
    </div>
  );
}
