/**
 * The first screen (ADR 0256 §2): sign in to agentes.chat first, in this window (Google and Apple through the browser,
 * e-mail on the site's own page), the team's sky beside it. A server found on this computer or the person's Tailscale
 * network shows on top with Sign in. Under the sign-in, the other ways: run agentes.chat free on this computer (where
 * the build carries the server) and a company's server by its address; installing for a team on a server is the line at
 * the end. `adding` (the site's "Add a workspace", ADR 0154): its own title, the same layout; with agentes.chat signed
 * in here already, making a new workspace there is the one button.
 */
import { Button, ComputerIcon, Icon, OptionLinks, PlaceScene } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import { type Found, topFound } from "../../control/first-run";
import { serverName } from "../../control/server";
import { BrandFace } from "../../ui/bits";
import { ServerTile } from "../../ui/here";
import { useToast } from "../../ui/Toast";
import { ProblemLine, type ServerWays, useServerUse } from "./discovery";
import { AppleMark, GoogleMark } from "./marks";
import "./first-run.css";

type Method = "google" | "apple" | "email";

export function Welcome({
  adding,
  cloudSignedIn,
  canRunHere,
  found,
  ways,
  onCloud,
  onHere,
  onCompany,
  onInstall,
}: {
  adding: boolean;
  /** Adding, with agentes.chat signed in here already: making a workspace there is the button. */
  cloudSignedIn: boolean;
  /** This build carries the server: "Run free on this computer" is offered. */
  canRunHere: boolean;
  /** Everything discovery found so far (the one offered on top is picked from it). */
  found: Found[];
  ways: ServerWays;
  /** agentes.chat's cloud on `page` (a new workspace while adding). */
  onCloud: (page: string) => void;
  onHere: () => void;
  onCompany: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [signing, setSigning] = useState<Method | null>(null);
  const use = useServerUse(ways);
  const makeFirst = adding && cloudSignedIn;
  const top = topFound(found, (server) => use.claimHere(server) !== null);

  const signIn = (method: Method) => {
    if (signing) return;
    setSigning(method);
    // The window loads the sign-in, and the layer steps aside once the site painted it.
    void host
      .firstRunSignIn(method)
      .catch(() => toast(t("desktop.common.error"), "alert"))
      .finally(() => setSigning(null));
  };

  return (
    <div className="dk-first dk-welcome" data-step={adding ? "add" : "welcome"}>
      <div className="dk-welcome__sky">
        <PlaceScene place="cloud" computer={host.platform} shape="tall" />
        <span className="dk-welcome__brand" aria-hidden="true">
          <BrandFace size="sm" />
          agentes.chat
        </span>
      </div>
      <div className="dk-welcome__main">
        <div className="dk-welcome__col">
          {top && (
            <div className="dk-welcome__found">
              <ServerTile kind={top.where} />
              <span className="dk-welcome__foundtext">
                <b>
                  {top.where === "here"
                    ? t("desktop.first.welcome.foundHere")
                    : t("desktop.first.welcome.foundTailnet")}
                </b>
                {/* This computer's by what it is, never its address; one on the network by its address. */}
                {top.problem === "no-owner" ? (
                  <small>{t("desktop.connect.foundNoOwner")}</small>
                ) : top.where === "tailnet" ? (
                  <small>{serverName(top.server)}</small>
                ) : null}
              </span>
              <Button
                size="sm"
                loading={use.checking === top.server}
                disabled={use.checking !== null}
                onClick={() => void use.pick(top)}
              >
                {top.problem === "no-owner" ? t("desktop.connect.setUp") : t("desktop.connect.go")}
              </Button>
            </div>
          )}
          {use.problem && (
            <div className="dk-welcome__problem">
              <ProblemLine problem={use.problem.problem} host={use.problem.host} />
            </div>
          )}
          <h1 className="dk-first__h1">{t(adding ? "desktop.first.addTitle" : "desktop.first.welcome.title")}</h1>
          <p className="dk-first__lead">{t(adding ? "desktop.first.addLead" : "desktop.first.welcome.lead")}</p>
          <div className="dk-welcome__signin">
            {makeFirst ? (
              <Button block size="lg" variant="primary" autoFocus onClick={() => onCloud("/onboarding")}>
                {t("desktop.first.addCloud")}
              </Button>
            ) : (
              <>
                <Button
                  block
                  size="lg"
                  className="dk-welcome__provider"
                  autoFocus
                  loading={signing === "google"}
                  onClick={() => signIn("google")}
                >
                  <GoogleMark />
                  {t("desktop.first.welcome.google")}
                </Button>
                <Button
                  block
                  size="lg"
                  className="dk-welcome__provider"
                  loading={signing === "apple"}
                  onClick={() => signIn("apple")}
                >
                  <AppleMark />
                  {t("desktop.first.welcome.apple")}
                </Button>
                <Button
                  block
                  size="lg"
                  variant="ghost"
                  className="dk-welcome__provider dk-welcome__provider--quiet"
                  loading={signing === "email"}
                  onClick={() => signIn("email")}
                >
                  <Icon name="mail" size={18} />
                  {t("desktop.first.welcome.email")}
                </Button>
              </>
            )}
          </div>
          {/* Adding, not signed in to the cloud here: a new workspace there is this line. */}
          {adding && !makeFirst && (
            <span className="dk-first__foot">
              {t("desktop.first.addNew")}{" "}
              <button type="button" className="ac-link dk-link" onClick={() => onCloud("/onboarding")}>
                {t("desktop.first.addNewLink")}
              </button>
            </span>
          )}
          <span className="dk-welcome__or">{t("desktop.first.welcome.others")}</span>
          <OptionLinks
            className="dk-welcome__ways"
            options={[
              ...(canRunHere
                ? [
                    {
                      value: "here",
                      leading: <ComputerIcon kind={host.platform} size={20} />,
                      title: t("desktop.first.welcome.here"),
                      description: t("desktop.first.welcome.hereText"),
                      onSelect: onHere,
                    },
                  ]
                : []),
              {
                value: "company",
                leading: <Icon name="globe" size={20} />,
                title: t("desktop.first.welcome.company"),
                description: t("desktop.first.welcome.companyText"),
                onSelect: onCompany,
              },
            ]}
          />
          <span className="dk-first__foot">
            {t("desktop.first.welcome.install")}{" "}
            <button type="button" className="ac-link dk-link" onClick={onInstall}>
              {t("desktop.first.welcome.installLink")}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
