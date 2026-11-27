/**
 * The popover's head: this computer's portrait, its name and its state in a line of its colour ("1 thing needs you",
 * "All set", paused, offline). With nothing of this computer at work (no workspace uses it, no server runs here):
 * the app's face, the server open in the window, and what waits for the person there.
 */
import type { ComputerState } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { BrandFace, MacPortrait } from "../../ui/bits";
import { clock } from "../../ui/time";
import { HEAD_TONE, type HeadLine } from "./state";

export function PopHead({ name, portrait, line }: { name: string; portrait: ComputerState; line: HeadLine }) {
  const { t, i18n } = useTranslation();
  const words =
    line.kind === "needs"
      ? t("desktop.tray.needsYou", { count: line.count })
      : line.kind === "paused"
        ? line.until
          ? t("desktop.tray.pausedUntil", { time: clock(line.until, i18n.language) })
          : t("desktop.tray.pausedUntilResume")
        : line.kind === "offline"
          ? t("desktop.status.offline")
          : t("desktop.tray.allSet");
  return (
    <header className="dk-trayhead">
      <MacPortrait state={portrait} size={48} />
      <span className="dk-trayhead__text">
        <b>{name}</b>
        <small data-tone={HEAD_TONE[line.kind]}>{words}</small>
      </span>
    </header>
  );
}

/** Nothing here at work: the way in, and what waits there. */
export function BrandHead({ name, waiting }: { name: string; waiting: number }) {
  const { t } = useTranslation();
  return (
    <header className="dk-trayhead">
      <BrandFace size="md" />
      <span className="dk-trayhead__text">
        <b>{name}</b>
        <small data-tone={waiting > 0 ? "warn" : "muted"}>
          {waiting > 0 ? t("desktop.tray.waiting", { count: waiting }) : t("desktop.tray.nothingWaiting")}
        </small>
      </span>
    </header>
  );
}
