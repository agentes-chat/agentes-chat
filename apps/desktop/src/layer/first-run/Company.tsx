/**
 * A company's server (ADR 0265 §2): by its address (the one opened in the browser), what discovery found on this
 * computer and the Tailscale network, and how to install one for the team on a server, in the first run's frame. A
 * connect link (`agenteschat://connect`) shows here too, the server in large type: nothing changes before Open.
 */
import { Button, ComputerPortrait, Icon, Input, PixelSpinner } from "@agenteschat/ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { INSTALL_COMMAND, type LinkView, type OwnAddresses, PROBLEM_TEXT } from "../../control/first-run";
import { tailscaleFrom } from "../../control/local-server";
import { serverKind, serverName } from "../../control/server";
import { useTailnet } from "../../hooks";
import { CommandCopy } from "../../ui/bits";
import { ServerTile } from "../../ui/here";
import { SHEET_TITLE_ID } from "../sheets/SheetFrame";
import { type Discovery, ProblemLine, type ServerWays, useServerUse } from "./discovery";
import { Flow } from "./Flow";
import "./first-run.css";

/** The address form's id: the footer's Sign in submits it. */
const FORM_ID = "dk-first-connect";

/**
 * The address, what was found, and the install for a server that has none yet. Each found server shows as soon as its
 * check answers (one that answered with a problem, with that problem), and discovery can look again. While this
 * computer's Tailscale is off it says the servers there can't show up. The address typed stays when a sheet about it
 * is cancelled (`address` lives in the first run).
 */
export function Connect({
  discovery,
  ways,
  address,
  onAddress,
  onBack,
  onInstall,
}: {
  discovery: Discovery;
  ways: ServerWays;
  address: string;
  onAddress: (address: string) => void;
  onBack: () => void;
  /** "Don't have one yet?": installing one for the team. */
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const tailnet = useTailnet();
  const use = useServerUse(ways);
  const { found, looking, again } = discovery;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (address.trim()) void use.submit(address);
  };
  const hereCount = found.filter((o) => o.where === "here").length;
  const own = ways.own;
  // The typed address is being checked (not one of the servers found, whose own button shows it).
  const typedChecking = use.checking !== null && !found.some((f) => f.server === use.checking);

  return (
    <Flow
      screen="company"
      place="box"
      title={t("desktop.connect.title")}
      lead={t("desktop.connect.lead")}
      onBack={onBack}
      action={
        <Button
          type="submit"
          form={FORM_ID}
          variant="primary"
          disabled={!address.trim() || (use.checking !== null && !typedChecking)}
          loading={typedChecking}
        >
          {t("desktop.connect.go")}
        </Button>
      }
    >
      <form id={FORM_ID} className="dk-first__address" onSubmit={onSubmit}>
        <Input
          autoFocus
          value={address}
          placeholder={t("desktop.connect.placeholder")}
          aria-label={t("desktop.connect.label")}
          aria-describedby="connect-address-hint"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          invalid={use.problem !== null}
          onChange={(e) => {
            onAddress(e.target.value);
            use.setProblem(null);
          }}
        />
        {use.problem ? (
          <ProblemLine problem={use.problem.problem} host={use.problem.host} id="connect-address-hint" />
        ) : (
          <span className="dk-first__hint" id="connect-address-hint">
            {t("desktop.connect.addressHint")}
          </span>
        )}
      </form>
      {found.length > 0 && (
        <section className="dk-first__found" aria-label={t("desktop.connect.found")}>
          <h2 className="dk-first__label">{t("desktop.connect.found")}</h2>
          {found.map((f) => {
            const mine = f.where === "here" || own.all.includes(f.server);
            const claim = f.problem === "no-owner" ? use.claimHere(f.server) : null;
            // Used as is; one with a problem only when the app can take it from there (its owner page here).
            const usable = !f.problem || claim !== null;
            return (
              <div key={f.server} className="dk-first__foundrow">
                <ServerTile kind={f.where} />
                <span className="dk-first__foundtext">
                  {/* This computer by its name; its address only when more than one answers here. */}
                  <b>{mine ? t("desktop.link.chipHere") : serverName(f.server)}</b>
                  <small>
                    {f.problem && !claim
                      ? t(PROBLEM_TEXT[f.problem], { host: mine ? t("desktop.link.thisServer") : serverName(f.server) })
                      : f.where === "tailnet"
                        ? t("desktop.connect.foundTailnet")
                        : hereCount > 1
                          ? `${t("desktop.connect.foundHere")} · ${serverName(f.server)}`
                          : claim
                            ? t("desktop.connect.foundNoOwner")
                            : t("desktop.connect.foundHere")}
                  </small>
                </span>
                {usable && (
                  <Button
                    size="sm"
                    disabled={use.checking !== null}
                    loading={use.checking === f.server}
                    onClick={() => void use.pick(f)}
                  >
                    {claim ? t("desktop.connect.setUp") : t("desktop.connect.use")}
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      )}
      {looking ? (
        <p className="dk-first__looking" aria-live="polite">
          <PixelSpinner size={14} color="sky" />
          <span className="dk-shimmer">{t("desktop.connect.looking")}</span>
        </p>
      ) : (
        <p className="dk-first__hint dk-first__lookagain">
          {found.length === 0 && <>{t("desktop.connect.noneFound")} </>}
          <button type="button" className="ac-link dk-link" onClick={again}>
            {t("desktop.connect.lookAgain")}
          </button>
        </p>
      )}
      {tailnet?.state === "off" && (
        <p className="dk-first__hint ac-iconline">
          <Icon name="globe" size={14} />
          <span>
            {t("desktop.connect.tailnetOff")}
            {tailscaleFrom(host.platform, tailnet) === "app" && (
              <>
                {" "}
                <button
                  type="button"
                  className="ac-link dk-link"
                  onClick={() => void host.openTailscale("app").catch(() => {})}
                >
                  {t("desktop.here.openTailscale")}
                </button>
              </>
            )}
          </span>
        </p>
      )}
      <p className="dk-first__hint">
        {t("desktop.connect.noneYet")}{" "}
        <button type="button" className="ac-link dk-link" onClick={onInstall}>
          {t("desktop.place.goBox")}
        </button>
      </p>
    </Flow>
  );
}

/**
 * Installing for the team on a server (ADR 0060 §1): the one-command install in two steps, run on the computer that
 * stays on, whose last line is the link that opens it here; and the same as words to send to whoever installs it.
 */
export function Install({ onBack, onConnect }: { onBack: () => void; onConnect: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    void navigator.clipboard
      .writeText(t("desktop.install.text", { command: INSTALL_COMMAND }))
      .then(() => setCopied(true))
      .catch(() => {});
  return (
    <Flow
      screen="install"
      place="box"
      title={t("desktop.install.title")}
      lead={t("desktop.install.lead")}
      onBack={onBack}
    >
      <ol className="dk-first__numbered">
        <li>
          <b>{t("desktop.install.step1")}</b>
          <CommandCopy command={INSTALL_COMMAND} />
        </li>
        <li>
          <b>{t("desktop.install.step2")}</b>
          <small>
            {t("desktop.install.noLink")}{" "}
            <button type="button" className="ac-link dk-link" onClick={onConnect}>
              {t("desktop.place.haveOneLink")}
            </button>
          </small>
        </li>
      </ol>
      {/* The question carries its answer: the instructions to send to whoever installs it. */}
      <p className="dk-first__hint">
        {t("desktop.install.someoneElse")}{" "}
        <button type="button" className="ac-link dk-link" onClick={copy}>
          {t(copied ? "desktop.install.copied" : "desktop.install.copy")}
        </button>
      </p>
    </Flow>
  );
}

/**
 * A server in large type, asked about before anything changes. The agentes.chat this computer runs reads as such (at
 * its local or its Tailscale address alike), never as an address; one on a Tailscale network says what that means.
 * Shown in a sheet's card over the site, or in the middle of the window.
 */
export function LinkSheet({
  view,
  own,
  onRetry,
  onAccept,
  onCancel,
}: {
  view: LinkView;
  own: OwnAddresses;
  onRetry: () => void;
  onAccept: (server: string, page?: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const server = view.kind === "notALink" ? null : view.server;
  const mine = server !== null && (own.all.includes(server) || serverKind(server) === "here");
  const kind = server ? serverKind(server) : null;
  const name = server ? (mine ? t("desktop.link.thisServer") : serverName(server)) : "";
  let body: ReactNode;
  let acts: ReactNode;
  if (view.kind === "notALink") {
    body = (
      <p className="dk-linksheet__question" id={SHEET_TITLE_ID}>
        {t("desktop.link.notALink")}
      </p>
    );
    acts = (
      <Button variant="primary" autoFocus onClick={onCancel}>
        {t("desktop.common.close")}
      </Button>
    );
  } else if (view.kind === "checking" || view.kind === "front") {
    body = (
      <p className="dk-linksheet__question dk-linksheet__checking" aria-live="polite">
        <PixelSpinner size={14} color="sky" />
        <span className="dk-shimmer">{t("desktop.link.checking")}</span>
      </p>
    );
    acts = (
      <>
        <Button variant="ghost" onClick={onCancel}>
          {t("desktop.common.cancel")}
        </Button>
        <Button variant="primary" disabled>
          {t("desktop.link.connect")}
        </Button>
      </>
    );
  } else if (view.kind === "problem") {
    body = <ProblemLine problem={view.problem} host={name} />;
    acts = (
      <>
        <Button variant="ghost" onClick={onCancel}>
          {t("desktop.common.cancel")}
        </Button>
        <Button variant="primary" icon="refresh" autoFocus onClick={onRetry}>
          {t("desktop.common.retry")}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="dk-linksheet__question">{t(`desktop.link.${view.question}`)}</p>
        {view.question === "questionClaim" && <p className="dk-first__hint">{t("desktop.link.claimLead")}</p>}
        {view.leave && (
          <p className="dk-first__hint">
            {t("desktop.link.leave", {
              current: own.all.some((o) => serverName(o) === view.leave) ? t("desktop.link.thisServer") : view.leave,
            })}
          </p>
        )}
      </>
    );
    acts = (
      <>
        <Button variant="ghost" onClick={onCancel}>
          {t("desktop.common.cancel")}
        </Button>
        <Button variant="primary" autoFocus onClick={() => onAccept(view.server, view.page)}>
          {view.button === "connect" ? t("desktop.link.open") : t(`desktop.link.${view.button}`)}
        </Button>
      </>
    );
  }
  return (
    <div className="dk-first dk-linksheet" data-step="link">
      <div className="dk-linksheet__main">
        {view.kind === "ask" && view.question === "questionClaim" && (
          <ComputerPortrait kind="linux" state="online" size={96} className="dk-linksheet__art" />
        )}
        {server && (
          <div className="dk-linksheet__server">
            {/* On a Tailscale network: Tailscale's own tile over its address, never a tag beside it. */}
            {kind === "tailnet" && !mine && <ServerTile kind="tailnet" />}
            <span className="dk-linksheet__host" id={SHEET_TITLE_ID}>
              {name}
            </span>
          </div>
        )}
        {kind === "tailnet" && !mine && <p className="dk-first__hint">{t("desktop.link.tailnetHelp")}</p>}
        {body}
      </div>
      <div className="dk-linksheet__acts">{acts}</div>
    </div>
  );
}
