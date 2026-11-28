/**
 * "Now": what agents do on this computer at this moment. An agent in one of the person's apps is that row (with
 * Stop, ADR 0258); an agent in its browser is its browser row (what it does there, Open when it asked for help, See
 * and Stop); every other agent is one row, "Ada read src/app.ts", with its
 * workspace and since when. Nothing going on: a calm line (or, paused, that nothing new starts).
 */
import type { ControlAppUse, ControlBrowser, ControlJob } from "@agenteschat/adapters/runner-control";
import { type AgentState, Button, Icon, normalizeAppearance, PixelSpinner } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useStore } from "../../app";
import { saidText } from "../../control/activity";
import { appUsesOf, browserRowState, browsersOf, siteLink } from "../../control/browser";
import { homeServer } from "../../control/server";
import { type Home, orgName } from "../../control/store";
import { agentOf } from "../../hooks";
import { AgentFace, BrandFace } from "../../ui/bits";
import { useToast } from "../../ui/Toast";
import { clock, since } from "../../ui/time";
import { agentRows, type AgentRow as Row } from "./state";

export function NowList({ homes, paused, now }: { homes: Home[]; paused: boolean; now: number }) {
  const { t } = useTranslation();
  const uses = homes.flatMap((home) => appUsesOf(home.status, now).map((use) => ({ home, use })));
  const browsers = homes.flatMap((home) => browsersOf(home.status).map((browser) => ({ home, browser })));
  const inBrowser = new Set(browsers.map(({ home, browser }) => `${home.homeId}:${browser.agentId}`));
  // An agent in its browser shows once, as its browser row (its thinking is what drives it).
  const rows = agentRows(
    homes,
    (home, job) => job.kind === "brain" && !!job.agent && inBrowser.has(`${home.homeId}:${job.agent.id}`),
  );
  if (uses.length + browsers.length + rows.length === 0) {
    const someone = homes.flatMap((h) => h.status?.agents ?? [])[0];
    return (
      <div className="dk-empty">
        <span className="dk-tray__lead">
          {someone ? (
            <AgentFace agent={someone} size="sm" state={paused ? "waiting" : "idle"} />
          ) : (
            <BrandFace size="sm" />
          )}
        </span>
        <span className="dk-empty__text">
          <b>{paused ? t("desktop.tray.pausedEmptyTitle") : t("desktop.tray.calmTitle")}</b>
          <span>{paused ? t("desktop.tray.pausedEmptyBody") : t("desktop.tray.calmBody")}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="dk-now">
      {uses.map(({ home, use }) => (
        <AppUseRow key={`apps:${home.homeId}:${use.agentId}`} home={home} use={use} />
      ))}
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
      <span className="dk-tray__lead">
        {agent ? <AgentFace agent={agent} size="sm" state={stateOf(job)} /> : <BrandFace size="sm" state="writing" />}
      </span>
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
        <span className="dk-job__av">
          <AgentFace agent={agent} size="sm" state="waiting" />
        </span>
        <span className="dk-job__text">
          <b>
            <span>{t("desktop.tray.browser.stopAsk", { agent: agent.name })}</span>
          </b>
          <small>{t("desktop.tray.browser.stopHint")}</small>
        </span>
        <span className="dk-job__acts ac-acts">
          <Button size="sm" disabled={busy} onClick={() => setConfirm(false)}>
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
          {/* Asking for help: its words in the colour of what needs the person, never a band behind the row. */}
          <span data-tone={state.kind === "needs" ? "warn" : undefined}>
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
      <span className="dk-job__acts ac-acts">
        {state.kind === "needs" ? (
          <Button size="sm" onClick={() => open(state.link)}>
            {t("desktop.tray.browser.open")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="external"
            title={t("desktop.tray.browser.see")}
            aria-label={t("desktop.tray.browser.see")}
            onClick={() => open(state.link)}
          />
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="stop"
          title={t("desktop.tray.browser.stop")}
          aria-label={t("desktop.tray.browser.stop")}
          onClick={() => setConfirm(true)}
        />
      </span>
    </div>
  );
}

/**
 * An agent using one of the person's apps here (ADR 0258): "Theo is using Mail", through the system's accessibility
 * (the person's mouse and keyboard stay theirs), with Stop: its next commands in the apps are refused.
 */
function AppUseRow({ home, use }: { home: Home; use: ControlAppUse }) {
  const { t } = useTranslation();
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const agent = agentOf(home, { id: use.agentId, name: t("desktop.tray.browser.someAgent") });
  const color = normalizeAppearance(agent.look).color;
  const stop = async () => {
    setBusy(true);
    try {
      await store.request(home.homeId, { type: "apps.stop", agentId: use.agentId });
      toast(t("desktop.tray.apps.stopped", { agent: agent.name }), "stop");
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dk-job dk-job--browser">
      <span className="dk-job__av">
        <AgentFace agent={agent} size="sm" state="writing" />
      </span>
      <span className="dk-job__text">
        <b>
          <span>{t("desktop.tray.apps.title", { agent: agent.name, app: use.app })}</span>
        </b>
        <small>
          <PixelSpinner size={14} color={color} />
          <span className="dk-job__detail">{t("desktop.tray.apps.detail")}</span>
        </small>
      </span>
      <span className="dk-job__acts ac-acts">
        <Button
          size="sm"
          variant="ghost"
          icon="stop"
          disabled={busy}
          title={t("desktop.tray.apps.stop")}
          aria-label={t("desktop.tray.apps.stop")}
          onClick={() => void stop()}
        />
      </span>
    </div>
  );
}
