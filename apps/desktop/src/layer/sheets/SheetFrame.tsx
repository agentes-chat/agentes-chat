/**
 * The app layer's sheets (ADR 0256): one frame and one layout for every question the app asks over the site.
 *
 * `SheetFrame` is where a sheet sits. Sheet mode (macOS with the site there): the layer is transparent, so it draws a
 * scrim over the site, the card in the middle and, over the scrim's top 48pt, a strip that drags the window as the
 * site's own title bar does. Full mode (Windows and Linux, where nothing can be drawn over the site, or no site at
 * all): the same card in the middle of the app's background.
 *
 * `Sheet` is what a card holds: where this setup is ("This Mac · 1 of 2"), a picture, the question as its title, one
 * lead line, the body, then a footer with a help line on the left and the buttons on the right. The body scrolls when
 * the window is short; the footer stays.
 */
import { Icon, PixelSpinner } from "@agenteschat/ui";
import type { ReactNode } from "react";
import "./sheets.css";

/** The id of the sheet's title, which names the dialog. */
export const SHEET_TITLE_ID = "dk-sheet-title";

export function SheetFrame({
  mode,
  mac,
  fill = false,
  children,
}: {
  mode: "sheet" | "full";
  /** A Mac: the top 48pt drags the window (and keeps the room for its buttons). */
  mac: boolean;
  /** A screen that fills a card of its own size (720×600) instead of a card sized to the sheet. */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="dk-shf" data-mode={mode} data-mac={mac || undefined}>
      {mode === "sheet" && <div className="dk-shf__scrim" />}
      {mac && <div className="dk-shf__drag" data-tauri-drag-region />}
      <div
        className="dk-shf__card"
        data-fill={fill || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
      >
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
  wide = false,
}: {
  /** `data-screen`, for the tests and the dev frame. */
  screen: string;
  /** Where this setup is, over everything ("This Mac · 1 of 2"). */
  step?: string;
  /** A picture over the title (it says nothing the title doesn't: hidden from screen readers). */
  art?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  /** The footer's line on the left: where to change it later, what happens next. */
  help?: ReactNode;
  acts: ReactNode;
  /** A sheet with a column beside its steps (the iPhone setup). */
  wide?: boolean;
}) {
  return (
    <div className="dk-sh" data-screen={screen} data-wide={wide || undefined}>
      <div className="dk-sh__body">
        {step && <span className="dk-sh__step">{step}</span>}
        {art && (
          <div className="dk-sh__art" aria-hidden="true">
            {art}
          </div>
        )}
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

/** What went wrong, in the sheet's body: a warning mark and one sentence. */
export const SheetProblem = ({ text }: { text: string }) => (
  <span className="dk-honest dk-sh__problem ac-iconline" role="alert">
    <Icon name="alert" size={16} />
    <span>{text}</span>
  </span>
);

/** Something the app waits on (a server's answer, the person in System Settings), with the pixel spinner. */
export const SheetWaiting = ({ children }: { children: ReactNode }) => (
  <span className="dk-sh__wait" aria-live="polite">
    <PixelSpinner size={14} color="sky" />
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
