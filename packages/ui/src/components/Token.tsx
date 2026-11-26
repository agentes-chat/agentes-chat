import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icon } from "../icons/Icon";
import { Tip } from "./Tip";

export interface TokenProps {
  children: ReactNode;
  /** E.g. a small avatar. */
  leading?: ReactNode;
  /** "Remover Ada". */
  removeLabel?: string;
  onRemove?: () => void;
  /** `sm`: inside a field (a search's filters), clear of its edges. */
  size?: "sm";
  /**
   * `invalid`: it can't go as it is, in the danger tone; `soft`: it's fine but won't count (already in, already
   * invited), quiet; `done`: it went (an invitation just sent), its note in the ok tone after a check. `note` says
   * which.
   */
  state?: "invalid" | "soft" | "done";
  /** A word or two after the label: why it's `invalid` or `soft` ("confira", "já convidado"), or what became of it. */
  note?: ReactNode;
  /**
   * A choice of its own after the label (an address's role, a `Select size="sm"`): drawn as its words and chevron on
   * the token's line, never as a box inside the token, which would read as a card in a card.
   */
  choice?: ReactNode;
  /** It stays whatever the person does: no ✕ (its `tip` says why). */
  fixed?: boolean;
  /** Where it comes from or why it stays, in a tip on the token, and for screen readers after its label. */
  tip?: ReactNode;
  /** Just added by something else (a cargo bringing its channels): it fades in, at once with reduced motion. */
  fresh?: boolean;
}

/** A picked item (a participant, a member) with a button to remove it (none without `onRemove`: it stays). */
export function Token({
  children,
  leading,
  removeLabel,
  onRemove,
  size,
  state,
  note,
  choice,
  fixed,
  tip,
  fresh,
}: TokenProps) {
  const token = (
    <span
      className={cx("ac-token", size && `ac-token--${size}`)}
      data-state={state}
      data-fixed={fixed || undefined}
      data-fresh={fresh || undefined}
    >
      {leading}
      <span className="ac-token__label">{children}</span>
      {note && (
        <span className="ac-token__note">
          {state === "done" && <Icon name="check" size={14} />}
          {note}
        </span>
      )}
      {choice && <span className="ac-token__choice">{choice}</span>}
      {tip && <span className="ac-visually-hidden">{tip}</span>}
      {onRemove && !fixed && (
        <button type="button" className="ac-token__remove" aria-label={removeLabel} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
  if (!tip) return token;
  return (
    <Tip tip={tip} look="ac-msg__note-tip ac-glass" className="ac-token__tip">
      {token}
    </Tip>
  );
}

export function TokenList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="ac-tokens" aria-label={label}>
      {children}
    </ul>
  );
}
