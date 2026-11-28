/**
 * How the phone and the team get to the server here (ADR 0265 §4), shared by the first run and Settings: two rows with
 * a hairline, a tile and the kit's Radio, and under the chosen row its own part, with no card. Through Tailscale: the
 * official app the person installs (its download page, its app, its icon by the clock or the command to connect it),
 * read again every 2 s while it isn't on, with no time limit, and `onReady` once it turns on. Through an address of
 * the person's own (a tunnel on this computer that leads here): its field, where the tunnel points (with Copy), and
 * what is wrong with it, inline. The app never carries Tailscale itself.
 */
import { Button, Field, Icon, Input, PixelSpinner, Radio, RadioGroup } from "@agenteschat/ui";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../app";
import {
  type AddressProblem,
  addressWords,
  type ReachWay,
  type Tailnet,
  tailscaleFrom,
  tunnelTarget,
} from "../control/local-server";
import type { Platform } from "../control/platform";
import { BrandFace, CommandCopy } from "./bits";
import { ServerTile } from "./here";
import "./reach-way.css";

/** How often the system's Tailscale is read while the person installs it or signs in (it is cheap). */
export const TAILSCALE_POLL_MS = 2000;

/** Connecting Tailscale where it has no app or icon of its own to open (Linux, a Mac with only its command line). */
const TAILSCALE_UP = "sudo tailscale up";

export interface ReachWayPickerProps {
  /** The way chosen; an address carries what is typed in its field so far. */
  value: ReachWay;
  onChange: (way: ReachWay) => void;
  /** This computer's system: where Tailscale gets connected (its app, its icon by the clock, the terminal). */
  platform: Platform;
  /** The system's Tailscale as last read; null: not read yet (the picker reads it). */
  tailnet: Tailnet | null;
  /** The server here's port at loopback, where a tunnel points (`status.port`); null: not known, no line. */
  port: number | null;
  /** The system's Tailscale turned on while the Tailscale row waited for it. */
  onReady?: () => void;
  /** Each read of the system's Tailscale (the screen around it may want it too). */
  onTailnet?: (tailnet: Tailnet) => void;
  /** What is wrong with the address, said under its field. */
  problem?: { why: AddressProblem; status?: number } | null;
  /** Enter in the address field (the screen's Continue). */
  onSubmit?: () => void;
  /** Settings' size: smaller tiles, no drawing while waiting. */
  compact?: boolean;
}

export function ReachWayPicker({
  value,
  onChange,
  platform,
  tailnet,
  port,
  onReady,
  onTailnet,
  problem,
  onSubmit,
  compact = false,
}: ReachWayPickerProps) {
  const { t } = useTranslation();
  // The address typed so far stays when the person looks at Tailscale's row and comes back.
  const typed = useRef(value.kind === "address" ? value.url : "");
  if (value.kind === "address") typed.current = value.url;
  const field = useRef<HTMLInputElement>(null);
  // Picked by the person (not how the screen opened): the field takes the keyboard.
  const picked = useRef(false);
  useEffect(() => {
    if (value.kind === "address" && picked.current) field.current?.focus();
  }, [value.kind]);

  const pick = (kind: ReachWay["kind"]) => {
    picked.current = true;
    onChange(kind === "tailscale" ? { kind: "tailscale" } : { kind: "address", url: typed.current });
  };

  const row = (kind: ReachWay["kind"], tile: ReactNode, title: string, text: string, part: ReactNode) => (
    <div className="dk-way__item" data-way={kind} data-chosen={value.kind === kind || undefined}>
      <label className="dk-way__row" htmlFor={`way-${kind}`}>
        {tile}
        <span className="dk-way__text">
          <b>{title}</b>
          <small>{text}</small>
        </span>
        <Radio value={kind} id={`way-${kind}`} />
      </label>
      {value.kind === kind && <div className="dk-way__part">{part}</div>}
    </div>
  );

  return (
    <RadioGroup
      value={value.kind}
      onValueChange={pick}
      aria-label={t("desktop.reach.label")}
      className={compact ? "dk-way dk-way--compact" : "dk-way"}
    >
      {row(
        "tailscale",
        <ServerTile kind="tailnet" small={compact} />,
        t("desktop.reach.tailscale"),
        t("desktop.reach.tailscaleText"),
        <TailscalePart
          platform={platform}
          tailnet={tailnet}
          onReady={onReady}
          onTailnet={onTailnet}
          compact={compact}
        />,
      )}
      {row(
        "address",
        <span className={compact ? "dk-logo dk-logo--soft" : "dk-logo dk-logo--soft dk-logo--lg"} aria-hidden="true">
          <Icon name="link" size={compact ? 16 : 20} />
        </span>,
        t("desktop.reach.address"),
        t("desktop.reach.addressText"),
        <AddressPart
          url={value.kind === "address" ? value.url : ""}
          onUrl={(url) => onChange({ kind: "address", url })}
          port={port}
          problem={problem ?? null}
          onSubmit={onSubmit}
          field={field}
        />,
      )}
    </RadioGroup>
  );
}

/**
 * Tailscale's part: what turns it on here, by what it is doing now, and while it isn't on, the waiting look (the app
 * and Tailscale joined by the pixel trail, what it waits for with the spinner, what to do there). Read every 2 s with
 * no time limit; `onReady` when it turns on.
 */
function TailscalePart({
  platform,
  tailnet,
  onReady,
  onTailnet,
  compact,
}: {
  platform: Platform;
  tailnet: Tailnet | null;
  onReady?: () => void;
  onTailnet?: (tailnet: Tailnet) => void;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [now, setNow] = useState<Tailnet | null>(tailnet);
  // The newest read, for the timer (which starts again only when Tailscale turns on or off, not at every read).
  const latest = useRef(now);
  latest.current = now;
  // Its download page was opened: the person is installing it.
  const [fetching, setFetching] = useState(false);
  // The newest callbacks, for the timer that reads it.
  const ready = useRef(onReady);
  ready.current = onReady;
  const told = useRef(onTailnet);
  told.current = onTailnet;
  // A newer read from the screen around it wins over the picker's own.
  useEffect(() => {
    if (tailnet) setNow(tailnet);
  }, [tailnet]);

  const on = now?.state === "on";
  useEffect(() => {
    if (on) return;
    let live = true;
    const read = () =>
      void host
        .tailscale()
        .then((next) => {
          if (!live) return;
          const was = latest.current?.state;
          latest.current = next;
          setNow(next);
          told.current?.(next);
          // Turned on while it waited (seen off or missing before): the screen goes on by itself.
          if (next.state === "on" && (was === "off" || was === "missing")) ready.current?.();
        })
        .catch(() => {});
    if (!latest.current) read();
    const timer = setInterval(read, TAILSCALE_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [host, on]);

  if (!now)
    return (
      <p className="dk-way__line" aria-live="polite">
        <PixelSpinner size={14} color="sky" />
        <span className="dk-shimmer">{t("desktop.reach.checking")}</span>
      </p>
    );

  if (now.state === "on")
    return (
      <p className="dk-way__line dk-way__line--ok">
        <Icon name="check" size={16} />
        <span>{t("desktop.reach.tailscaleOn")}</span>
      </p>
    );

  const open = (page: "download" | "app") => {
    if (page === "download") setFetching(true);
    void host.openTailscale(page).catch(() => {});
  };
  const missing = now.state === "missing";
  const from = tailscaleFrom(platform, now);
  const action = missing ? (
    <span className="dk-way__acts">
      <Button size="sm" variant={fetching ? "default" : "primary"} icon="download" onClick={() => open("download")}>
        {t("desktop.reach.download")}
      </Button>
      {!fetching && <span className="dk-way__note">{t("desktop.reach.downloadNote")}</span>}
    </span>
  ) : from === "app" ? (
    <span className="dk-way__acts">
      <Button size="sm" variant="primary" icon="external" onClick={() => open("app")}>
        {t("desktop.reach.openApp")}
      </Button>
    </span>
  ) : from === "tray" ? (
    <p className="dk-way__note">{t("desktop.reach.tray")}</p>
  ) : (
    <span className="dk-way__note">
      {t("desktop.reach.terminal")} <CommandCopy command={TAILSCALE_UP} inline />
    </span>
  );
  // Missing, the wait starts once its download page opened; installed but not on, at once.
  const waiting = !missing || fetching;

  return (
    <>
      {action}
      {waiting && (
        <div className="dk-way__wait">
          {!compact && (
            <span className="dk-way__hop" aria-hidden="true">
              <span className="dk-way__hoptile">
                <BrandFace size="md" />
              </span>
              <span className="dk-way__trail">
                <i />
                <i />
                <i />
              </span>
              <ServerTile kind="tailnet" />
            </span>
          )}
          <p className="dk-way__now" aria-live="polite">
            <PixelSpinner size={16} color="sky" />
            {t("desktop.reach.waitNow")}
          </p>
          <p className="dk-way__how">{missing ? t("desktop.reach.waitInstall") : t("desktop.reach.waitSignIn")}</p>
        </div>
      )}
    </>
  );
}

/**
 * The address's part: its field ("https://…"), where the tunnel points under it with Copy, and what is wrong with it
 * in place of that line. The form is all that is checked here; where it leads is checked once the server runs.
 */
function AddressPart({
  url,
  onUrl,
  port,
  problem,
  onSubmit,
  field,
}: {
  url: string;
  onUrl: (url: string) => void;
  port: number | null;
  problem: { why: AddressProblem; status?: number } | null;
  onSubmit?: () => void;
  field: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  const target = tunnelTarget(port);
  const words = problem ? addressWords(problem.why, problem.status, port) : null;
  return (
    <Field
      label={t("desktop.reach.addressLabel")}
      id="way-address-url"
      error={words ? t(words.key, words.values) : undefined}
      example={target ? <TunnelLine target={target} /> : undefined}
    >
      <Input
        ref={field}
        type="url"
        inputMode="url"
        placeholder="https://…"
        value={url}
        maxLength={300}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !onSubmit) return;
          e.preventDefault();
          onSubmit();
        }}
      />
    </Field>
  );
}

/** "Point it at http://127.0.0.1:4310", with Copy: where the person's tunnel on this computer leads. */
function TunnelLine({ target }: { target: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    void navigator.clipboard
      .writeText(target)
      .then(() => setCopied(true))
      .catch(() => {});
  return (
    <span className="dk-way__tunnel">
      <span>
        {t("desktop.reach.pointAt")} <b>{target}</b>
      </span>
      <button type="button" className="ac-link dk-link" onClick={copy}>
        {copied ? t("desktop.common.copied") : t("desktop.common.copy")}
      </button>
    </span>
  );
}
