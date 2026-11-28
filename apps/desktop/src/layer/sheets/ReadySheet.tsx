/**
 * "Get this Mac ready for Acme's agents?" (route `pairOffer`, ADR 0265 §7): shown once after sign-in for a workspace
 * this computer doesn't work for yet. The card is the ask, so no system dialog follows. It says what agents get here
 * in four lines and asks nothing else: no switches (the tools start open, `pairTools`, and change in Settings), no
 * checkbox (a computer made ready opens agentes.chat at login). Get it ready pairs it with the main window's session,
 * then goes on to Prepare on a Mac with a permission still off (route `prepare`), else the sheet steps aside.
 */
import { errorText } from "@agenteschat/client/lib/errors";
import { Avatar, Button, ComputerPortrait, Icon, type IconName } from "@agenteschat/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import { isHereServer } from "../../control/local-server";
import { type PairTarget, pairWithSession } from "../../control/pair";
import { serverKind } from "../../control/server";
import { toolsFound } from "../../control/this-mac";
import { useLocalServer } from "../../hooks";
import { needsPrepare } from "../../ui/permissions";
import { Sheet, SheetProblem, Trail } from "./SheetFrame";

function Line({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="dk-sh__line">
      <Icon name={icon} size={18} />
      <span>
        <b>{title}</b>
        <small>{children}</small>
      </span>
    </li>
  );
}

export function ReadySheet({ target, onClose }: { target: PairTarget; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const local = useLocalServer();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // On a Mac with a permission still off, Prepare comes next: this is the first of two steps.
  const [prepareNext, setPrepareNext] = useState(false);
  useEffect(() => {
    let live = true;
    void needsPrepare(host)
      .then((next) => live && setPrepareNext(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [host]);

  const org = target.name;
  // A server elsewhere that this computer already opens: getting it ready is about lending it, not about getting in.
  const kind = serverKind(target.server);
  const onlyOpens = (kind === "tailnet" || kind === "own") && !isHereServer(local, target.server);
  // Claude Code and Codex by name once a runner here found them (they are for the whole computer).
  const found = toolsFound(snap);
  const tools: string[] = [];
  if (found?.claude) tools.push(t("desktop.tools.claudeName"));
  if (found?.codex) tools.push(t("desktop.tools.codexName"));
  const code =
    tools.length === 2
      ? t("desktop.sheets.ready.codeTwo", { a: tools[0], b: tools[1] })
      : tools.length === 1
        ? t("desktop.sheets.ready.codeOne", { tool: tools[0] })
        : t("desktop.sheets.ready.codeNone");

  const allow = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await pairWithSession(host, store, target);
      // Its agents work while the app runs: open at login, always (ADR 0265 §7).
      await host.setAutostart(true).catch(() => {});
      if (await needsPrepare(host).catch(() => false))
        await host.showLayer({ screen: "prepare", org, server: target.server });
      else onClose();
    } catch (err) {
      setFailed(errorText(t, err, i18n.language));
      setBusy(false);
    }
  };

  return (
    <Sheet
      screen="ready"
      step={prepareNext ? t("desktop.sheets.step", { at: 1, total: 2 }) : t("desktop.sheets.stepOnly")}
      art={
        <>
          <span className="dk-sh__cast">
            <Avatar kind="agent" name={org} appearance={{ color: "green" }} size="md" />
            <Avatar kind="agent" name={org} appearance={{ color: "amber" }} size="md" />
          </span>
          <Trail />
          <ComputerPortrait kind={host.platform} state="online" size={48} />
        </>
      }
      title={t("desktop.sheets.ready.title", { org })}
      lead={onlyOpens ? t("desktop.pair.offerOnlyIf", { org }) : t("desktop.sheets.ready.lead")}
      help={t("desktop.sheets.ready.help")}
      acts={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("desktop.pair.notNow")}
          </Button>
          {/* Never focused first: it opens by itself after sign-in, while the person may be typing. */}
          <Button variant="primary" loading={busy} onClick={() => void allow()}>
            {t("desktop.sheets.ready.allow")}
          </Button>
        </>
      }
    >
      <ul className="dk-sh__lines">
        <Line icon="globe" title={t("desktop.sheets.ready.browser")}>
          {t("desktop.sheets.ready.browserDesc")}
        </Line>
        <Line icon="code" title={t("desktop.sheets.ready.code")}>
          {code}
        </Line>
        <Line icon="lock" title={t("desktop.sheets.ready.folders")}>
          {t(host.platform === "mac" ? "desktop.sheets.ready.foldersDescMac" : "desktop.sheets.ready.foldersDesc")}
        </Line>
        <Line icon="power" title={t("desktop.sheets.ready.login")}>
          {t("desktop.sheets.ready.loginDesc")}
        </Line>
      </ul>
      {failed && <SheetProblem text={failed} />}
    </Sheet>
  );
}
