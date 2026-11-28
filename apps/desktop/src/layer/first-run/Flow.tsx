/**
 * The first run's one frame (ADR 0265 §3): the team's sky behind the whole window, and the step on a card in its
 * middle. The card holds the team and the place drawn small at its top, where the step is, the title, the lead, the
 * step's own content and, as its last row, Back on its left edge and the step's actions ending on its right edge.
 * Every step of Run here, its setup and the phone's code, and a company's server and its install share it, so moving
 * between them only changes what the card says.
 */
import { Button, PixelSky, type Place, PlaceScene, teamSky } from "@agenteschat/ui";
import { type ReactNode, type Ref, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import type { Platform } from "../../control/platform";
import "./first-run.css";

/** The team's sky behind the whole window. */
export function FirstSky() {
  const options = useMemo(() => teamSky(1), []);
  return (
    <div className="dk-first__sky" aria-hidden="true">
      <PixelSky options={options} />
    </div>
  );
}

/**
 * The team and the place, drawn small at the top of the card: the band's drawing alone (its own sky unseen), shrunk
 * whole so the team and the computer keep one ground line.
 */
export function FirstArt({ place, computer }: { place: Place; computer: Platform }) {
  return (
    <div className="dk-first__art">
      <PlaceScene place={place} computer={computer} shape="band" />
    </div>
  );
}

export function Flow({
  place = "here",
  step,
  title,
  titleRef,
  lead,
  children,
  onBack,
  quiet,
  action,
  screen,
}: {
  /** The drawing's place: this computer (`here`), a server (`box`), or the cloud. */
  place?: Place;
  /** "Run on this Mac · 1 of 3", over the title. */
  step?: string;
  title: string;
  /** The title, focused for screen readers where a step starts something (never by the keyboard). */
  titleRef?: Ref<HTMLHeadingElement>;
  lead?: ReactNode;
  children?: ReactNode;
  /** Back, on the footer's left; none where going back means nothing (the setup, the phone's code). */
  onBack?: () => void;
  /** The other actions before the main one ("Do it later", "Cancel"), bordered. */
  quiet?: ReactNode;
  /** The step's main action, last in the footer. */
  action?: ReactNode;
  /** Which step it is (`data-step`), for the tests and the screenshots. */
  screen?: string;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const foot = Boolean(onBack || quiet || action);
  return (
    <div className="dk-first dk-flow" data-step={screen}>
      <FirstSky />
      <div className="dk-first__stage">
        <div className="dk-first__card">
          <FirstArt place={place} computer={host.platform} />
          {step && <span className="dk-flow__step">{step}</span>}
          <h1 ref={titleRef} className="dk-first__h1" tabIndex={titleRef ? -1 : undefined}>
            {title}
          </h1>
          {lead && <p className="dk-first__lead">{lead}</p>}
          {children && <div className="dk-flow__body">{children}</div>}
          {foot && (
            <div className="dk-flow__foot">
              {onBack && <Button onClick={onBack}>{t("desktop.common.back")}</Button>}
              <span className="dk-flow__acts">
                {quiet}
                {action}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
