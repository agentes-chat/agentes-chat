/**
 * "Done, take it to your phone" (ADR 0265 §3): once agentes.chat runs here and people reach it, the phone's code beside
 * its steps (Tailscale on the phone too when it is the way here; an address of the person's own needs nothing more,
 * ADR 0265 §4), and the address people use with Copy. The code is a one-time sign-in made with this window's own
 * session (`phoneLink`), asked again before it runs out while it shows. One button: Open agentes.chat, which is also
 * how the phone is left for later.
 */
import { Button, Icon, PixelSpinner, QrCode } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { phoneLinkRefreshMs } from "../../control/first-run";
import type { PhoneLink, ReachWay } from "../../control/local-server";
import { serverName } from "../../control/server";
import { Flow } from "./Flow";

export function Phone({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const host = useHost();
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [failed, setFailed] = useState(false);
  // "Try again" asks for a new code from the start.
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState(false);
  // How people get here, as the server here says: Tailscale until it says otherwise.
  const [way, setWay] = useState<ReachWay["kind"]>("tailscale");
  useEffect(() => {
    let live = true;
    void host
      .localServer()
      .then((s) => {
        if (live && s.way) setWay(s.way.kind);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [host]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` asks for the code again
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      void host.phoneLink().then(
        (next) => {
          if (!live) return;
          setLink(next);
          setFailed(false);
          timer = setTimeout(ask, phoneLinkRefreshMs(next.expiresIn));
        },
        () => {
          if (!live) return;
          setLink(null);
          setFailed(true);
        },
      );
    ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [host, round]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const copy = (server: string) =>
    void navigator.clipboard
      .writeText(server)
      .then(() => setCopied(true))
      .catch(() => {});

  return (
    <Flow
      screen="done"
      step={t("desktop.first.run.flow")}
      title={t("desktop.first.run.doneTitle")}
      // One way on: opening agentes.chat is also how the phone is left for later.
      action={
        <Button variant="primary" autoFocus onClick={onDone}>
          {t("desktop.first.run.open")}
        </Button>
      }
    >
      <div className="dk-first__phone">
        <span className="dk-first__qr" data-state={link ? "ready" : failed ? "failed" : "loading"}>
          {link ? (
            <QrCode text={link.link} label={t("desktop.first.run.qrLabel")} />
          ) : failed ? (
            <Icon name="alert" size={20} />
          ) : (
            <PixelSpinner size={16} color="sky" />
          )}
        </span>
        <ol className="dk-first__numbered">
          <li>
            <b>{t("desktop.first.run.phone1")}</b>
            <small>{t("desktop.first.run.phone1Text")}</small>
          </li>
          {way === "tailscale" && (
            <li>
              <b>{t("desktop.first.run.phone2")}</b>
              <small>{t("desktop.first.run.phone2Text")}</small>
            </li>
          )}
          <li>
            <b>{t("desktop.first.run.phone3")}</b>
            <small>{t("desktop.first.run.phone3Text")}</small>
          </li>
        </ol>
      </div>
      {failed && (
        <p className="dk-honest dk-first__problem" role="alert">
          {t("desktop.first.run.qrFailed")}{" "}
          <button type="button" className="ac-link dk-link" onClick={() => setRound((n) => n + 1)}>
            {t("desktop.common.retry")}
          </button>
        </p>
      )}
      {link && (
        <p className="dk-first__addr">
          <span className="dk-first__glyph" aria-hidden="true">
            <Icon name="lock" size={16} />
          </span>
          <span>
            <Trans
              i18nKey="desktop.first.run.address"
              values={{ address: serverName(link.server) }}
              components={{ b: <b /> }}
            />
          </span>
          <button type="button" className="ac-link dk-link" onClick={() => copy(link.server)}>
            {copied ? t("desktop.common.copied") : t("desktop.common.copy")}
          </button>
        </p>
      )}
    </Flow>
  );
}
