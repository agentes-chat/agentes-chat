/**
 * "Connect this Mac to Acme?" (route `pairLink`, and the first run's connect link, ADR 0256): a pair link from the
 * web, with who made it and where from, read from its server. Connect starts the runner with the link and waits for
 * its maker to let it in on the web; once in, agentes.chat opens at login and, on a Mac with a permission still off,
 * Prepare follows (route `prepare`). What agents can do here is a switch each, as the link's maker may not be the
 * person at this computer.
 */
import { Button, Icon, ProviderLogo, Switch } from "@agenteschat/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../../app";
import { type LinkFailure, type LinkInfo, pairWithLink } from "../../control/pair";
import { serverName } from "../../control/server";
import { type PairTools, pairTools, toolsFound } from "../../control/this-mac";
import { useOpenPrefs } from "../../hooks";
import { needsPrepare } from "../../ui/permissions";
import { CardTitle, hintFor, PrefCard, PrefRow } from "../../ui/settings";
import { Sheet, SheetProblem, SheetWaiting } from "./SheetFrame";

const logo = (mark: ReactNode) => <span className="dk-logo">{mark}</span>;

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
  const row = (tool: keyof PairTools, lead: ReactNode, name: string, desc: string, under?: ReactNode) => (
    <PrefRow
      key={tool}
      lead={lead}
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
    <div>
      <CardTitle>{t("desktop.pair.canDo")}</CardTitle>
      <PrefCard>
        {row(
          "commands",
          logo(<Icon name="code" size={16} />),
          t("desktop.tools.commandsName"),
          t("desktop.tools.commandsDesc"),
          <span className="dk-honest ac-iconline">
            <Icon name="alert" size={14} />
            <span id="pair-commands-warn">{t("desktop.tools.commandsWarn")}</span>
          </span>,
        )}
        {found?.claude &&
          row(
            "claude",
            logo(<ProviderLogo id="claude_code" size="xs" />),
            t("desktop.tools.claudeName"),
            t("desktop.tools.claudeDesc"),
          )}
        {found?.codex &&
          row(
            "codex",
            logo(<ProviderLogo id="codex" size="xs" />),
            t("desktop.tools.codexName"),
            t("desktop.tools.codexDesc"),
          )}
        {row(
          "browser",
          logo(<Icon name="globe" size={16} />),
          t("desktop.tools.browserName"),
          t("desktop.tools.browserDesc"),
        )}
      </PrefCard>
      <p className="dk-under-card dk-help">{t("desktop.pair.foldersLater")}</p>
    </div>
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
      // Agents of a computer paired here work while the app runs: open at login, always (ADR 0256 §7).
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

  const cancel = (
    <Button variant="ghost" onClick={onClose}>
      {t("desktop.common.cancel")}
    </Button>
  );
  const notNow = (
    <Button variant="ghost" onClick={onClose}>
      {t("desktop.pair.notNow")}
    </Button>
  );
  const close = (
    <Button variant="primary" autoFocus onClick={onClose}>
      {t("desktop.common.close")}
    </Button>
  );
  // A link that ran out is made again in the site's Devices, on the server that made it.
  const openDevices = (
    <Button variant="ghost" onClick={() => void host.openExternal(`${server}/?open=devices`).catch(() => {})}>
      {t("desktop.pair.openDevices")}
    </Button>
  );

  if (state.kind === "checking")
    return (
      <Sheet screen="pairLink" title={from} acts={cancel}>
        <SheetWaiting>{t("desktop.link.checking")}</SheetWaiting>
      </Sheet>
    );
  if (state.kind === "expired")
    return (
      <Sheet
        screen="pairLink"
        title={from}
        acts={
          <>
            {openDevices}
            {close}
          </>
        }
      >
        <SheetProblem text={t("desktop.pair.expired")} />
      </Sheet>
    );
  if (state.kind === "unreachable")
    return (
      <Sheet
        screen="pairLink"
        title={from}
        acts={
          <>
            {cancel}
            <Button variant="primary" icon="refresh" autoFocus onClick={() => setAsked((n) => n + 1)}>
              {t("desktop.common.retry")}
            </Button>
          </>
        }
      >
        <SheetProblem text={t("desktop.prefs.thisMac.unreachable", { server: from })} />
      </Sheet>
    );
  if (state.kind === "done")
    return (
      <Sheet
        screen="pairLink"
        title={t("desktop.pair.done", { org: state.org })}
        acts={
          <>
            <Button variant="ghost" icon="drive" onClick={() => openPrefs("folders")}>
              {t("desktop.pair.addFolders")}
            </Button>
            {close}
          </>
        }
      />
    );

  const { info } = state;
  const computer = info.computer ?? snap.homes.find((h) => h.status?.machine)?.status?.machine?.name;
  const facts = (
    <PrefCard>
      <PrefRow title={t("desktop.pair.askedBy")} end={info.by} />
      <PrefRow title={t("desktop.pair.from")} end={from} />
      {computer && <PrefRow title={t("desktop.prefs.general.thisMac")} end={computer} />}
    </PrefCard>
  );
  const title = t("desktop.pair.linkTitle", { org: info.org });
  if (state.kind === "waiting")
    return (
      <Sheet screen="pairLink" title={title} acts={cancel}>
        {facts}
        <SheetWaiting>{t("desktop.pair.waiting", { by: info.by })}</SheetWaiting>
      </Sheet>
    );
  if (state.kind === "failed") {
    const again = state.code === "network" || state.code === "internal";
    const text =
      state.code === "denied"
        ? t("desktop.pair.denied", { by: info.by })
        : state.code === "network"
          ? t("desktop.prefs.thisMac.unreachable", { server: from })
          : state.code === "internal"
            ? t("desktop.common.error")
            : t("desktop.pair.expired");
    return (
      <Sheet
        screen="pairLink"
        title={title}
        acts={
          again ? (
            <>
              {notNow}
              <Button variant="primary" icon="refresh" autoFocus onClick={() => void connect(info)}>
                {t("desktop.common.retry")}
              </Button>
            </>
          ) : state.code === "denied" ? (
            close
          ) : (
            <>
              {openDevices}
              {close}
            </>
          )
        }
      >
        {facts}
        <SheetProblem text={text} />
      </Sheet>
    );
  }
  return (
    <Sheet
      screen="pairLink"
      title={title}
      lead={t("desktop.pair.linkBody")}
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
