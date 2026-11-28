/**
 * The app layer's sheets (ADR 0265): one frame and one layout for every question the app asks over the site.
 *
 * `SheetFrame` is where a sheet sits. Sheet mode (macOS with the site there): the layer is transparent, so it draws a
 * scrim over the site, a strip over the scrim's top 48pt that drags the window as the site's own title bar does, and
 * the card hanging just under that bar, as a Mac's sheets do: a card that grows or shrinks with its state keeps its
 * top where it was. Full mode (Windows and Linux, where nothing can be drawn over the site, or no site at all): the
 * same card in the middle of the app's background. The card is as large as what it holds.
 *
 * `Sheet` is what a card holds, in one column with one inset: a picture, where this setup is ("This Mac · 1 of 2"),
 * the question or the outcome as its title, one lead line, the body, then a footer with a note on the left and the
 * buttons on the right (the note takes its own row above them when it doesn't fit beside them). The body scrolls when
 * the window is short; the footer stays.
 */
import {
  Avatar,
  ComputerPortrait,
  type ComputerPortraitProps,
  Icon,
  type IconName,
  PixelSpinner,
} from "@agenteschat/ui";
import type { ReactNode } from "react";
import "./sheets.css";

/** The id of the sheet's title, which names the dialog. */
export const SHEET_TITLE_ID = "dk-sheet-title";

export function SheetFrame({
  mode,
  mac,
  children,
}: {
  mode: "sheet" | "full";
  /** A Mac: the top 48pt drags the window (and keeps the room for its buttons). */
  mac: boolean;
  children: ReactNode;
}) {
  return (
    <div className="dk-shf" data-mode={mode} data-mac={mac || undefined}>
      {mode === "sheet" && <div className="dk-shf__scrim" />}
      {mac && <div className="dk-shf__drag" data-tauri-drag-region />}
      <div className="dk-shf__card" role="dialog" aria-modal="true" aria-labelledby={SHEET_TITLE_ID}>
        {children}
      </div>
    </div>
  );
}

export function Sheet({
  screen,
  step,
  art,
  title,
  lead,
  children,
  help,
  acts,
  size,
}: {
  /** `data-screen`, for the tests and the dev frame. */
  screen: string;
  /** Where this setup is, right over the title ("This Mac · 1 of 2"). */
  step?: string;
  /** A picture over everything (it says nothing the title doesn't: hidden from screen readers). */
  art?: ReactNode;
  /** The question, or what happened: never an address alone. */
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  /** The footer's note on the left: where to change it later, what happens next. One short line. */
  help?: ReactNode;
  acts: ReactNode;
  /** `sm` (440): a message and its buttons, no rows. `lg` (780): rows with a column beside them. Else 560. */
  size?: "sm" | "lg";
}) {
  return (
    <div className="dk-sh" data-screen={screen} data-size={size}>
      <div className="dk-sh__body">
        {art && (
          <div className="dk-sh__art" aria-hidden="true">
            {art}
          </div>
        )}
        {step && <span className="dk-sh__step">{step}</span>}
        <h1 id={SHEET_TITLE_ID} className="dk-sh__title">
          {title}
        </h1>
        {lead && <p className="dk-sh__lead">{lead}</p>}
        {children}
      </div>
      <div className="dk-sh__foot">
        {help ? <div className="dk-sh__help">{help}</div> : null}
        <span className="dk-sh__acts">{acts}</span>
      </div>
    </div>
  );
}

/** A row's picture in a sheet: a bare glyph (or a program's mark) in the rows' 20px column, never on a tile. */
export function SheetIcon({ icon }: { icon: IconName | ReactNode }) {
  return (
    <span className="dk-sh__icon" aria-hidden="true">
      {typeof icon === "string" ? <Icon name={icon as IconName} size={18} /> : icon}
    </span>
  );
}

/** What went wrong, in the sheet's body: a warning mark and one sentence. */
export const SheetProblem = ({ text }: { text: string }) => (
  <span className="dk-sh__problem ac-iconline" role="alert">
    <Icon name="alert" size={16} />
    <span>{text}</span>
  </span>
);

/** Something the app waits on (a server's answer, the person in System Settings), with the pixel spinner. */
export const SheetWaiting = ({ children }: { children: ReactNode }) => (
  <span className="dk-sh__wait ac-iconline" aria-live="polite">
    <PixelSpinner size={16} color="sky" />
    <span>{children}</span>
  </span>
);

/** The pixel trail between two things that connect (the agents and this computer). */
export const Trail = () => (
  <span className="dk-sh__trail" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

/** A workspace's agents, the trail, and this computer: the picture over a sheet that connects them. */
export const ConnectArt = ({ org, kind }: { org: string; kind: ComputerPortraitProps["kind"] }) => (
  <>
    <span className="dk-sh__cast">
      <Avatar kind="agent" name={org} appearance={{ color: "green" }} size="md" />
      <Avatar kind="agent" name={org} appearance={{ color: "amber" }} size="md" />
    </span>
    <Trail />
    <ComputerPortrait kind={kind} state="online" size={48} />
  </>
);
