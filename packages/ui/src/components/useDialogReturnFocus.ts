import { type RefObject, useRef } from "react";
import { focusHeld } from "../device";

export type DialogFocusTarget = RefObject<HTMLElement | null> | (() => HTMLElement | null);

/** A controlled Radix dialog has no trigger of its own. Resolve an explicit trigger at close, since it may remount. */
export function useDialogReturnFocus(open: boolean, returnFocus?: DialogFocusTarget, rememberOpener = true) {
  const wasOpen = useRef(false);
  const target = useRef<DialogFocusTarget | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    target.current = returnFocus;
    opener.current = rememberOpener && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  return (event: Event) => {
    if (focusHeld()) {
      event.preventDefault();
      return;
    }
    const explicit = typeof target.current === "function" ? target.current() : target.current?.current;
    const element = explicit?.isConnected ? explicit : opener.current;
    if (element?.isConnected) {
      event.preventDefault();
      element.focus();
    }
  };
}
