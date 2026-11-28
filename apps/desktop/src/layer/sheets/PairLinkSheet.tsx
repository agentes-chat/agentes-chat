/**
 * "Connect this Mac to Acme?" (route `pairLink`, ADR 0265): a pair link from the web, with who made it and where from,
 * read from its server. Connect starts the runner with the link and waits for its maker to let it in on the web; once
 * in, agentes.chat opens at login and, on a Mac with a permission still off, Prepare follows (route `prepare`), so the
 * sheet says where it is in that setup as Get this Mac ready does. What agents can do here is a switch each, as the
 * link's maker may not be the person at this computer. A link that can't go on says what happened in its title, and
 * the way forward is the primary button.
 */
import { Button, Icon, type IconName, ProviderLogo, Switch } from "@agenteschat/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import { type LinkFailure, type LinkInfo, pairWithLink } from "../../control/pair";
import { serverName } from "../../control/server";
import { type PairTools, pairTools, toolsFound } from "../../control/this-mac";
import { useOpenPrefs } from "../../hooks";
import { needsPrepare } from "../../ui/permissions";
import { CardTitle, hintFor, PrefRow } from "../../ui/settings";
import { ConnectArt, Sheet, SheetIcon, SheetWaiting } from "./SheetFrame";

/**
 * "What agents can do here": the pairing's tools as switches, on as `pairTools` starts them (Claude Code's and Codex's
 * rows only once a runner here found them); `chosen` holds the ones the person changed. Folders come later.
 */
function ToolSwitches({
  chosen,
  onChange,
  disabled,
}: {
  chosen: Partial<PairTools>;
  onChange: (next: Partial<PairTools>) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const snap = useSnapshot();
  const found = toolsFound(snap);
  const tools = { ...pairTools(snap), ...chosen };
  const row = (tool: keyof PairTools, icon: IconName | ReactNode, name: string, desc: string, under?: ReactNode) => (
    <PrefRow
      key={tool}
      lead={<SheetIcon icon={icon} />}
      htmlFor={`pair-${tool}`}
      title={name}
      hint={hintFor(t, name, desc)}
      under={under}
      end={
        <Switch
          id={`pair-${tool}`}
          aria-describedby={under ? `pair-${tool}-hint pair-${tool}-warn` : `pair-${tool}-hint`}
          checked={tools[tool]}
          disabled={disabled}
          onCheckedChange={(on) => onChange({ ...chosen, [tool]: on })}
        />
      }
    />
  );
  return (
    <section className="dk-sh__group">
      <CardTitle>{t("desktop.pair.canDo")}</CardTitle>
      <div className="dk-sh__rows">
        {row(
          "commands",
          "code",
          t("desktop.tools.commandsName"),
          t("desktop.tools.commandsDesc"),
          <span className="dk-sh__warn ac-iconline">
            <Icon name="alert" size={16} />
            <span id="pair-commands-warn">{t("desktop.tools.commandsWarn")}</span>
          </span>,
        )}
        {found?.claude &&
          row(
            "claude",
            <ProviderLogo id="claude_code" size="xs" />,
            t("desktop.tools.claudeName"),
            t("desktop.tools.claudeDesc"),
          )}
        {found?.codex &&
          row(
            "codex",
            <ProviderLogo id="codex" size="xs" />,
            t("desktop.tools.codexName"),
            t("desktop.tools.codexDesc"),
          )}
        {row("browser", "globe", t("desktop.tools.browserName"), t("desktop.tools.browserDesc"))}
      </div>
    </section>
  );
}

type LinkState =
  | { kind: "checking" }
  | { kind: "expired" }
  | { kind: "unreachable" }
  | { kind: "ask"; info: LinkInfo }
  | { kind: "waiting"; info: LinkInfo }
  | { kind: "done"; org: string }
  | { kind: "failed"; info: LinkInfo; code: LinkFailure };

const isFailure = (code: string): code is LinkFailure =>
  ["expired", "denied", "network", "internal", "link_invalid"].includes(code);

export function PairLinkSheet({ server, code, onClose }: { server: string; code: string; onClose: () => void }) {
  const { t } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const [state, setState] = useState<LinkState>({ kind: "checking" });
  const [asked, setAsked] = useState(0);
  const [tools, setTools] = useState<Partial<PairTools>>({});
  const from = serverName(server);
  const openPrefs = useOpenPrefs();
  // The sheet gone (Cancel, Esc, a newer link): the runner stops asking, even if it hadn't started yet.
  const pairing = useRef<{ cancel: () => Promise<void> } | null>(null);
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      void pairing.current?.cancel();
    };
  }, []);
  // On a Mac with a permission still off, Prepare comes next: this is the first of two steps, as in Get this Mac ready.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` is Try again
  useEffect(() => {
    let live = true;
    setState({ kind: "checking" });
    host
      .pairLinkInfo(server, code)
      .then((info) => live && setState({ kind: "ask", info }))
      .catch((err: unknown) => live && setState({ kind: err === "link_expired" ? "expired" : "unreachable" }));
    return () => {
      live = false;
    };
  }, [host, server, code, asked]);

  const connect = async (info: LinkInfo) => {
    setState({ kind: "waiting", info });
    try {
      const started = await pairWithLink(store, server, code, tools);
      pairing.current = started;
      if (gone.current) return void started.cancel();
      const org = await started.done;
      pairing.current = null;
      // Agents of a computer paired here work while the app runs: open at login, always (ADR 0265 §7).
      await host.setAutostart(true).catch(() => {});
      const prepare = await needsPrepare(host).catch(() => false);
      if (gone.current) return;
      if (prepare) await host.showLayer({ screen: "prepare", org, server });
      else setState({ kind: "done", org });
    } catch (err) {
      pairing.current = null;
      const word = err instanceof Error ? err.message : "";
      if (gone.current || word === "canceled") return;
      setState({ kind: "failed", info, code: isFailure(word) ? word : "internal" });
    }
  };

  // Every button but the forward one is bordered: one primary per sheet (ADR 0265).
  const cancel = <Button onClick={onClose}>{t("desktop.common.cancel")}</Button>;
  const notNow = <Button onClick={onClose}>{t("desktop.pair.notNow")}</Button>;
  const close = (primary: boolean) => (
    <Button variant={primary ? "primary" : "default"} autoFocus={primary} onClick={onClose}>
      {t("desktop.common.close")}
    </Button>
  );
  // A link that ran out is made again in the site's Devices, on the server that made it: the way forward.
  const expiredActs = (
    <>
      {close(false)}
      <Button
        variant="primary"
        autoFocus
        onClick={() => void host.openExternal(`${server}/?open=devices`).catch(() => {})}
      >
        {t("desktop.pair.openDevices")}
      </Button>
    </>
  );
  const retry = (onClick: () => void) => (
    <Button variant="primary" icon="refresh" autoFocus onClick={onClick}>
      {t("desktop.common.retry")}
    </Button>
  );
  const step = prepareNext ? t("desktop.sheets.step", { at: 1, total: 2 }) : t("desktop.sheets.stepOnly");

  if (state.kind === "checking")
    return (
      <Sheet screen="pairLink" size="sm" title={t("desktop.pair.connectTitle")} acts={cancel}>
        <SheetWaiting>{t("desktop.link.checking")}</SheetWaiting>
      </Sheet>
    );
  if (state.kind === "expired")
    return (
      <Sheet
        screen="pairLink"
        size="sm"
        title={t("desktop.pair.expiredTitle")}
        lead={t("desktop.pair.expiredLead", { server: from })}
        acts={expiredActs}
      />
    );
  if (state.kind === "unreachable")
    return (
      <Sheet
        screen="pairLink"
        size="sm"
        title={t("desktop.pair.unreachableTitle", { server: from })}
        lead={t("desktop.pair.unreachableLead")}
        acts={
          <>
            {cancel}
            {retry(() => setAsked((n) => n + 1))}
          </>
        }
      />
    );
  if (state.kind === "done")
    return (
      <Sheet
        screen="pairLink"
        art={<ConnectArt org={state.org} kind={host.platform} />}
        title={t("desktop.pair.done", { org: state.org })}
        lead={t("desktop.pair.doneLead")}
        acts={
          <>
            <Button onClick={() => openPrefs("folders")}>{t("desktop.pair.addFolders")}</Button>
            {close(true)}
          </>
        }
      />
    );

  const { info } = state;
  const computer = info.computer ?? snap.homes.find((h) => h.status?.machine)?.status?.machine?.name;
  // Who made the link, where from, and this computer: a label and its value, one line each.
  const facts = (
    <div className="dk-sh__rows dk-sh__facts">
      <PrefRow title={t("desktop.pair.askedBy")} end={info.by} />
      <PrefRow title={t("desktop.pair.from")} end={from} />
      {computer && <PrefRow title={t("desktop.prefs.general.thisMac")} end={computer} />}
    </div>
  );
  const title = t("desktop.pair.linkTitle", { org: info.org });
  const art = <ConnectArt org={info.org} kind={host.platform} />;
  if (state.kind === "waiting")
    return (
      <Sheet screen="pairLink" step={step} art={art} title={title} acts={cancel}>
        {facts}
        <SheetWaiting>{t("desktop.pair.waiting", { by: info.by })}</SheetWaiting>
      </Sheet>
    );
  if (state.kind === "failed") {
    // What happened is the title; what to do about it, the lead and the primary button.
    if (state.code === "denied")
      return (
        <Sheet
          screen="pairLink"
          title={t("desktop.pair.deniedTitle", { by: info.by })}
          lead={t("desktop.pair.deniedLead")}
          acts={close(true)}
        >
          {facts}
        </Sheet>
      );
    if (state.code === "network" || state.code === "internal")
      return (
        <Sheet
          screen="pairLink"
          title={
            state.code === "network"
              ? t("desktop.pair.unreachableTitle", { server: from })
              : t("desktop.pair.failedTitle")
          }
          lead={state.code === "network" ? t("desktop.pair.unreachableLead") : t("desktop.common.error")}
          acts={
            <>
              {notNow}
              {retry(() => void connect(info))}
            </>
          }
        >
          {facts}
        </Sheet>
      );
    return (
      <Sheet
        screen="pairLink"
        title={t("desktop.pair.expiredTitle")}
        lead={t("desktop.pair.expiredLead", { server: from })}
        acts={expiredActs}
      >
        {facts}
      </Sheet>
    );
  }
  return (
    <Sheet
      screen="pairLink"
      step={step}
      art={art}
      title={title}
      lead={t("desktop.pair.linkBody")}
      help={t("desktop.pair.foldersLater")}
      acts={
        <>
          {notNow}
          {/* Never focused first: a page can open this link while the person types elsewhere, and Enter isn't a yes. */}
          <Button variant="primary" onClick={() => void connect(info)}>
            {t("desktop.link.connect")}
          </Button>
        </>
      }
    >
      {facts}
      <ToolSwitches chosen={tools} onChange={setTools} disabled={false} />
    </Sheet>
  );
}
