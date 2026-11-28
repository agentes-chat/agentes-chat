/**
 * The first run's one frame (ADR 0265 §3): the team's sky in a band on top, then the step, the title, the lead and
 * the step's own content in one column, and a footer with Back on the left and the step's actions on the right. Every
 * step of Run here, its setup and the phone's code, and a company's server and its install share it, so moving
 * between them only changes what the column says.
 */
import { Button, type Place, PlaceScene } from "@agenteschat/ui";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { useHost } from "../../app";
import "./first-run.css";

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
  /** The band's drawing: this computer (`here`), a server (`box`), or the cloud. */
  place?: Place;
  /** "Run on this Mac · 1 of 3", over the title. */
  step?: string;
  title: string;
  /** The title, focused for screen readers where a step starts something (never by the keyboard). */
  titleRef?: Ref<HTMLHeadingElement>;
  lead?: ReactNode;
  children?: ReactNode;
  /** Back, in the footer; none where going back means nothing (the setup, the phone's code). */
  onBack?: () => void;
  /** The quiet actions before the main one ("Do it later", "Cancel"). */
  quiet?: ReactNode;
  /** The step's main action, last in the footer. */
  action?: ReactNode;
  /** Which step it is (`data-step`), for the tests and the screenshots. */
  screen?: string;
}) {
  const { t } = useTranslation();
  const host = useHost();
  return (
    <div className="dk-first dk-flow" data-step={screen}>
      <div className="dk-flow__band">
        <PlaceScene place={place} computer={host.platform} shape="band" />
      </div>
      <div className="dk-flow__scroll">
        <div className="dk-flow__col">
          {step && <span className="dk-flow__step">{step}</span>}
          <h1 ref={titleRef} className="dk-first__h1 dk-first__h1--sm" tabIndex={titleRef ? -1 : undefined}>
            {title}
          </h1>
          {lead && <p className="dk-first__lead">{lead}</p>}
          {children && <div className="dk-flow__body">{children}</div>}
        </div>
      </div>
      <div className="dk-flow__foot">
        {onBack ? (
          <Button variant="ghost" icon="chevronLeft" onClick={onBack}>
            {t("desktop.common.back")}
          </Button>
        ) : (
          <span />
        )}
        <span className="dk-flow__acts">
          {quiet}
          {action}
        </span>
      </div>
    </div>
  );
}
