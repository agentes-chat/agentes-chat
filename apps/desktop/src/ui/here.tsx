/**
 * The server here's own controls, shared by the first run, Settings and the popover: what turning reach on is doing,
 * why it didn't turn on (the system's Tailscale by what it is doing on this computer, or an address of the person's
 * own, ADR 0256 §4), and "Copy details"; and a server's tile by where it runs. How people get here is chosen with
 * `ReachWayPicker` (reach-way.tsx).
 */
import { Button, Icon, type IconName, PixelSpinner } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import { addressWords, REASON_TEXT, type ReachStage, type ServeProblem, tailscaleFrom } from "../control/local-server";
import type { ServerKind } from "../control/server";
import { useOpenPrefs } from "../hooks";
import { CommandCopy } from "./bits";
import { useToast } from "./Toast";
import { TAILSCALE_MARK } from "./tailscale-mark";

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
/** A server's tile: 48 px on its own, `small` (32 px) in a settings row, the size of the rows' other icons. */
export function ServerTile({ kind, small = false }: { kind: ServerKind; small?: boolean }) {
  return (
    <span className={small ? "dk-logo dk-logo--soft" : "dk-logo dk-logo--soft dk-logo--lg"} aria-hidden="true">
      {kind === "tailnet" ? (
        <svg className="dk-tailscale" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={TAILSCALE_MARK.solid} />
          <path d={TAILSCALE_MARK.faded} fillOpacity={0.4} />
        </svg>
      ) : (
        <Icon name={KIND_ICON[kind]} size={small ? 16 : 20} />
      )}
    </span>
  );
}

/** What each stage of turning reach on says. */
const STAGE_TEXT: Record<ReachStage["stage"], string> = {
  checking: "desktop.reach.stage.checking",
  sharing: "desktop.here.reachStage.sharing",
  approve: "desktop.here.reachStage.approve",
  restarting: "desktop.here.reachStage.restarting",
  done: "desktop.reach.stage.done",
};

/**
 * What turning reach on or off is doing while it takes, a line with the spinner. When Tailscale waits for HTTPS to be
 * allowed in the person's network, its page is a button away; waiting on the person has no time limit: "Stop
 * waiting" ends it.
 */
export function ReachProgress({ stage }: { stage: ReachStage }) {
  const { t } = useTranslation();
  const host = useHost();
  const waits = stage.stage === "approve";
  return (
    <span className="dk-reach-stage" aria-live="polite">
      <span className="dk-reach-stage__line">
        <PixelSpinner size={14} color="sky" />
        <span className={waits ? undefined : "dk-shimmer"}>{t(STAGE_TEXT[stage.stage])}</span>
      </span>
      {waits && (
        <span className="dk-reach-stage__acts">
          <Button size="sm" variant="primary" onClick={() => void host.openTailscale("https").catch(() => {})}>
            {t("desktop.here.approveOpen")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void host.stopLocalReach().catch(() => {})}>
            {t("desktop.here.approveStop")}
          </Button>
        </span>
      )}
    </span>
  );
}

/**
 * Why reach didn't turn on, with "Turn it on" where the Tailscale network's admin page fixes it, Open Tailscale (or the
 * command to connect it) when Tailscale isn't connected here, the command to copy where the terminal does, "Copy
 * details" when the server didn't answer again, and where to get Tailscale when it can't share. Turning it off that
 * failed, and an address of the person's own that doesn't lead here (`port`: where its tunnel should point), say so
 * in their own words. Under the setup's step its mark already says it (the alert icon is Settings' only), and where to
 * try again comes last, after the fix.
 */
export function ReachProblem({
  problem,
  text,
  port = null,
}: {
  problem: ServeProblem;
  text: "fail" | "prefs";
  port?: number | null;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const openPrefs = useOpenPrefs();
  const address = problem.reason === "address" ? addressWords(problem.why, problem.status, port) : null;
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
        {address
          ? t(address.key, address.values)
          : problem.reason === "back"
            ? reason
            : t("desktop.server.reachFailed", { reason })}
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
