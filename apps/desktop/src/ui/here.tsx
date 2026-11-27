/**
 * The server here's own controls, shared by the first run, Preferences and the popover: reach through
 * Tailscale by what Tailscale is doing on this computer, why reach didn't turn on, and "Copy details";
 * and a server's tile by where it runs. The Tailscale the app carries (ADR 0256 §4) needs no terminal and nothing
 * installed: its states offer a sign-in, or the tailnet's admin page, from here.
 */
import { Button, Icon, type IconName, PixelSpinner, Switch } from "@agenteschat/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import {
  type LocalServerStatus,
  REASON_TEXT,
  type ReachStage,
  type ServeProblem,
  type Tailnet,
  type TailnetSignIn,
  type TailnetState,
  tailnetNeedsSignIn,
  tailscaleFrom,
} from "../control/local-server";
import type { ServerKind } from "../control/server";
import { useOpenPrefs } from "../hooks";
import { CommandCopy } from "./bits";
import { hintFor, PrefRow } from "./settings";
import { useToast } from "./Toast";

/** Connecting Tailscale where it has no app or icon of its own to open (Linux, a Mac with only its command line). */
const TAILSCALE_UP = "sudo tailscale up";
/** What lets this computer's user change what Tailscale shares (Linux). */
const TAILSCALE_OPERATOR = "sudo tailscale set --operator=$USER";

const KIND_ICON: Record<Exclude<ServerKind, "tailnet">, IconName> = { cloud: "cloud", here: "computer", own: "globe" };

/**
 * A server's tile by where it runs. One on the person's Tailscale network shows Tailscale's own icon (its press
 * kit's black file, its white one on a dark theme) on a tile beside the server's name, never as a small icon inside
 * a line of text. Tailscale's brand toolkit asks for its logo at 48×48 px at least, with clear space around it; its
 * press kit's tile (the squircle) is that logo's own edge, so the tile is 48 px and the mark sits in it as in the
 * squircle (`.dk-tailscale`). Lists that can show one draw every row's tile at that size.
 */
export function ServerTile({ kind }: { kind: ServerKind }) {
  return (
    <span className="dk-logo dk-logo--soft dk-logo--lg" aria-hidden="true">
      {kind === "tailnet" ? (
        <svg className="dk-tailscale" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4.331 14.556C5.737 14.556 6.888 13.406 6.888 12C6.888 10.594 5.737 9.444 4.331 9.444C2.925 9.444 1.775 10.594 1.775 12C1.775 13.406 2.925 14.556 4.331 14.556ZM12 14.556C13.406 14.556 14.556 13.406 14.556 12C14.556 10.594 13.406 9.444 12 9.444C10.594 9.444 9.444 10.594 9.444 12C9.444 13.406 10.594 14.556 12 14.556ZM12 22.225C13.406 22.225 14.556 21.075 14.556 19.669C14.556 18.263 13.406 17.112 12 17.112C10.594 17.112 9.444 18.263 9.444 19.669C9.444 21.075 10.594 22.225 12 22.225ZM19.669 14.556C21.075 14.556 22.225 13.406 22.225 12C22.225 10.594 21.075 9.444 19.669 9.444C18.263 9.444 17.112 10.594 17.112 12C17.112 13.406 18.263 14.556 19.669 14.556Z" />
          <path
            d="M4.331 22.225C5.737 22.225 6.888 21.075 6.888 19.669C6.888 18.263 5.737 17.112 4.331 17.112C2.925 17.112 1.775 18.263 1.775 19.669C1.775 21.075 2.925 22.225 4.331 22.225ZM19.669 22.225C21.075 22.225 22.225 21.075 22.225 19.669C22.225 18.263 21.075 17.112 19.669 17.112C18.263 17.112 17.112 18.263 17.112 19.669C17.112 21.075 18.263 22.225 19.669 22.225ZM4.331 6.888C5.737 6.888 6.888 5.737 6.888 4.331C6.888 2.925 5.737 1.775 4.331 1.775C2.925 1.775 1.775 2.925 1.775 4.331C1.775 5.737 2.925 6.888 4.331 6.888ZM12 6.888C13.406 6.888 14.556 5.737 14.556 4.331C14.556 2.925 13.406 1.775 12 1.775C10.594 1.775 9.444 2.925 9.444 4.331C9.444 5.737 10.594 6.888 12 6.888ZM19.669 6.888C21.075 6.888 22.225 5.737 22.225 4.331C22.225 2.925 21.075 1.775 19.669 1.775C18.263 1.775 17.112 2.925 17.112 4.331C17.112 5.737 18.263 6.888 19.669 6.888Z"
            fillOpacity={0.4}
          />
        </svg>
      ) : (
        <Icon name={KIND_ICON[kind]} size={20} />
      )}
    </span>
  );
}

/**
 * Whether reach goes through the Tailscale the app carries: it is the one chosen, or nothing is chosen yet, this build
 * carries it and the system's Tailscale isn't connected (the system's, connected, is used as it is: ADR 0256 §4).
 */
export const throughOwnTailnet = (tailnet: Tailnet | null, own: LocalServerStatus | null | undefined) =>
  !!own && (own.tailnet.mode === "app" || (own.tailnet.mode === "none" && own.ownTailnet && tailnet?.state !== "on"));

/** "Sign in to Tailscale" for the app's own Tailscale; its stages arrive at `onTailnetSignIn`. */
function SignInButton({ again }: { again?: boolean }) {
  const { t } = useTranslation();
  const host = useHost();
  return (
    <button type="button" className="ac-link dk-link" onClick={() => void host.signInTailnet().catch(() => {})}>
      {again ? t("desktop.tailnet.signInAgain") : t("desktop.tailnet.signIn")}
    </button>
  );
}

/** The device's sign-in expiring within this long is said ahead of time (`tailnet_app.rs` `EXPIRY_WARN_MS`). */
const EXPIRY_WARN_MS = 14 * 24 * 3600 * 1000;

/** The line under the reach switch for the app's own Tailscale: what keeps it from sharing, and its fix. */
function OwnTailnetLine({ tailnet, on }: { tailnet: TailnetState; on: boolean }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  if (!on) return <span>{t("desktop.tailnet.rowApp")}</span>;
  if (tailnet.mode !== "app") return null;
  if (tailnetNeedsSignIn(tailnet))
    return (
      <span>
        {tailnet.state === "expired" ? t("desktop.tailnet.expired") : t("desktop.tailnet.signedOut")}{" "}
        <SignInButton again />
      </span>
    );
  if (tailnet.state === "needsApproval")
    return (
      <span>
        {t("desktop.tailnet.needsApproval")}{" "}
        <button
          type="button"
          className="ac-link dk-link"
          onClick={() => void host.openTailscale("approve").catch(() => {})}
        >
          {t("desktop.tailnet.approve")}
        </button>
      </span>
    );
  if (tailnet.state === "starting") return <span>{t("desktop.tailnet.starting")}</span>;
  if (tailnet.state === "failing" || tailnet.state === "off") return <span>{t("desktop.tailnet.failing")}</span>;
  if (tailnet.state === "on" && tailnet.keyExpiry && tailnet.keyExpiry - Date.now() < EXPIRY_WARN_MS)
    return (
      <span>
        {t("desktop.tailnet.expiring", {
          date: new Date(tailnet.keyExpiry).toLocaleDateString(i18n.language, { day: "numeric", month: "long" }),
        })}{" "}
        <SignInButton again />
      </span>
    );
  return null;
}

/**
 * "Reach it from your phone and teammates", what it does behind its ⓘ. Through the Tailscale the app carries
 * (`own`: the server here's status), the switch is always there (turning it on signs in when needed) and the line says
 * what its Tailscale needs. Through the system's: while it is missing or not connected the switch can't be used, and
 * one line under the label says why, with what fixes it. `tailnet` null: not read yet (it can take a couple of
 * seconds), so the line says it is checking, and the switch waits unless reach is on already (turning it off needs no
 * Tailscale).
 */
export function ReachRow({
  tailnet,
  own,
  on,
  onChange,
  busy,
}: {
  tailnet: Tailnet | null;
  own?: LocalServerStatus | null;
  on: boolean;
  onChange: (on: boolean) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const host = useHost();
  if (own && throughOwnTailnet(tailnet, own))
    return (
      <PrefRow
        top
        title={t("desktop.here.reach")}
        hint={hintFor(t, t("desktop.here.reach"), t("desktop.here.reachText"))}
        htmlFor="here-reach"
        desc={<OwnTailnetLine tailnet={own.tailnet} on={on} />}
        end={
          <Switch
            id="here-reach"
            aria-describedby="here-reach-hint"
            checked={on}
            disabled={busy}
            onCheckedChange={onChange}
          />
        }
      />
    );
  const usable = tailnet?.state === "on" || on;
  const missing = tailnet?.state === "missing";
  const from = tailscaleFrom(host.platform, tailnet);
  const fromTerminal = !usable && !missing && from === "terminal";
  let line: ReactNode = null;
  if (!tailnet && !on)
    line = (
      <span className="dk-reach-stage__line" aria-live="polite">
        <PixelSpinner size={14} color="sky" />
        <span className="dk-shimmer">{t("desktop.here.reachChecking")}</span>
      </span>
    );
  else if (tailnet && !usable && !missing && from === "tray") line = t("desktop.here.reachTray");
  else if (tailnet && !usable)
    line = (
      <span>
        {missing
          ? t("desktop.here.reachMissing")
          : fromTerminal
            ? t("desktop.here.reachOffTerminal")
            : t("desktop.here.reachOff")}{" "}
        {fromTerminal ? (
          <CommandCopy command={TAILSCALE_UP} inline />
        ) : (
          <button
            type="button"
            className="ac-link dk-link"
            onClick={() => void host.openTailscale(missing ? "download" : "app").catch(() => {})}
          >
            {missing ? t("desktop.here.getTailscale") : t("desktop.here.openTailscale")}
          </button>
        )}
      </span>
    );
  return (
    <PrefRow
      top
      title={t("desktop.here.reach")}
      hint={hintFor(t, t("desktop.here.reach"), t("desktop.here.reachText"))}
      htmlFor="here-reach"
      desc={line}
      end={
        <Switch
          id="here-reach"
          aria-describedby="here-reach-hint"
          checked={on}
          disabled={!usable || busy}
          onCheckedChange={onChange}
        />
      }
    />
  );
}

/** What each stage of turning reach on says. */
const STAGE_TEXT: Record<ReachStage["stage"], string> = {
  joining: "desktop.tailnet.stage.joining",
  sharing: "desktop.here.reachStage.sharing",
  approve: "desktop.here.reachStage.approve",
  restarting: "desktop.here.reachStage.restarting",
  done: "desktop.tailnet.stage.done",
};

/**
 * What turning reach on or off is doing while it takes, a line with the spinner. Signing the app's own Tailscale in,
 * its page is in the browser ("Open the page again"), or the tailnet's admin approves the new device; when Tailscale
 * waits for HTTPS to be allowed in the tailnet, its page is a button away. Waiting on the person has no time limit:
 * "Stop waiting" ends it.
 */
export function ReachProgress({ stage }: { stage: ReachStage }) {
  const { t } = useTranslation();
  const host = useHost();
  const [signIn, setSignIn] = useState<TailnetSignIn | null>(null);
  const joining = stage.stage === "joining";
  useEffect(() => (joining ? host.onTailnetSignIn(setSignIn) : undefined), [host, joining]);
  const approval = joining && signIn?.stage === "approval";
  const waits = stage.stage === "approve" || joining;
  return (
    <span className="dk-reach-stage" aria-live="polite">
      <span className="dk-reach-stage__line">
        <PixelSpinner size={14} color="sky" />
        <span className={waits ? undefined : "dk-shimmer"}>
          {approval ? t("desktop.tailnet.needsApproval") : t(STAGE_TEXT[stage.stage])}
        </span>
      </span>
      {waits && (
        <span className="dk-reach-stage__acts">
          {stage.stage === "approve" && (
            <Button size="sm" variant="primary" onClick={() => void host.openTailscale("https").catch(() => {})}>
              {t("desktop.here.approveOpen")}
            </Button>
          )}
          {joining && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void host.openTailscale(approval ? "approve" : "signIn").catch(() => {})}
            >
              {approval ? t("desktop.tailnet.approve") : t("desktop.tailnet.openAgain")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void host.stopLocalReach().catch(() => {})}>
            {t("desktop.here.approveStop")}
          </Button>
        </span>
      )}
    </span>
  );
}

/**
 * Why reach didn't turn on, with "Turn it on" where the tailnet's admin page fixes it, Open Tailscale (or the
 * command to connect it) when Tailscale isn't connected here, the command to copy where the terminal does, "Copy
 * details" when the server didn't answer again, and where to get Tailscale when it can't share. Turning it off that
 * failed says so in its own words. Under the setup's step its mark already says it (the alert icon is Preferences'
 * only), and where to try again comes last, after the fix.
 */
export function ReachProblem({ problem, text }: { problem: ServeProblem; text: "fail" | "prefs" }) {
  const { t } = useTranslation();
  const host = useHost();
  const openPrefs = useOpenPrefs();
  const reason = t(REASON_TEXT[problem.reason]);
  const connectFrom =
    problem.reason === "notConnected" ? tailscaleFrom(host.platform, { state: "off", app: problem.app }) : null;
  return (
    <span
      className={text === "prefs" ? "dk-honest dk-fr__problem ac-iconline" : "dk-honest dk-fr__problem"}
      role="alert"
    >
      {text === "prefs" && <Icon name="alert" size={16} />}
      <span>
        {problem.reason === "back" ? reason : t("desktop.server.reachFailed", { reason })}
        {problem.reason === "serve" && ` ${t("desktop.here.serveFix")}`}
        {connectFrom === "terminal" && (
          <>
            {" "}
            <CommandCopy command={TAILSCALE_UP} inline />
          </>
        )}
        {connectFrom === "tray" && ` ${t("desktop.here.connectTray")}`}
        {connectFrom === "app" && (
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
        {problem.reason === "https" && (
          <>
            {" "}
            <button
              type="button"
              className="ac-link dk-link"
              onClick={() => void host.openTailscale("https").catch(() => {})}
            >
              {t("desktop.here.turnOn")}
            </button>
          </>
        )}
        {(problem.reason === "signIn" || problem.reason === "expired") && (
          <>
            {" "}
            <SignInButton again={problem.reason === "expired"} />
          </>
        )}
        {problem.reason === "needsApproval" && (
          <>
            {" "}
            <button
              type="button"
              className="ac-link dk-link"
              onClick={() => void host.openTailscale("approve").catch(() => {})}
            >
              {t("desktop.tailnet.approve")}
            </button>
          </>
        )}
        {problem.reason === "operator" && (
          <>
            {" "}
            {t("desktop.here.operatorRun")}
            <CommandCopy command={TAILSCALE_OPERATOR} />
          </>
        )}
        {(problem.reason === "start" || problem.reason === "back") && (
          <>
            {" "}
            <CopyDetails as="link" />
          </>
        )}
        {text === "fail" && (
          <>
            {" "}
            <button type="button" className="ac-link dk-link dk-fr__retry" onClick={() => openPrefs("servers")}>
              {t("desktop.here.fail.retry")}
            </button>
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Copies what the app knows about the server here (versions, its state, the setup's steps, the end of its log): a
 * button, or a link on the line of the problem it describes.
 */
export function CopyDetails({ as = "button", size = "sm" }: { as?: "button" | "link"; size?: "sm" | "md" }) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const copy = () =>
    void host
      .localDiagnostics()
      .then((text) => navigator.clipboard.writeText(text))
      .then(() => toast(t("desktop.common.copied"), "check"))
      .catch(() => toast(t("desktop.common.error"), "alert"));
  return as === "link" ? (
    <button type="button" className="ac-link dk-link" onClick={copy}>
      {t("desktop.here.copyDetails")}
    </button>
  ) : (
    <Button size={size} icon="copy" onClick={copy}>
      {t("desktop.here.copyDetails")}
    </Button>
  );
}
