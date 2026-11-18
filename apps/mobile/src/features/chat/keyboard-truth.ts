import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { restingKeyboard } from "./dock-height";

/** How long after a doubt the dock looks again at where the system says the keyboard is. */
export const KEYBOARD_CHECK_MS = 300;
/** A move the system announced and never finished stops counting as moving after this (its own length added). */
const MOVE_GRACE_MS = 400;

/**
 * The conversation's dock rides the keyboard library's shared values (`KeyboardStickyView`), and on iOS the library
 * sets them as a move starts and while the keyboard is dragged, from its own reading of the keyboard's view. A reading
 * that came late or wrong left the box floating over the conversation with the keyboard gone (seen on a phone, more
 * than once). The system's own notifications are the truth (`Keyboard`: shown or hidden, and how tall): each one that
 * says a move finished settles the dock at once, and a doubt (the library ending a move, the person letting go of the
 * list, the dock changing height, the screen or the app coming back) looks again a moment later, unless the system
 * says a move is under way. On iOS only: Android's numbers leave out the navigation bar the library counts, and there
 * the library ends every move itself. Returns what to call on a doubt.
 */
export function useKeyboardTruth(at: { height: SharedValue<number>; progress: SharedValue<number> }): () => void {
  const look = useRef<() => void>(() => {});
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let movingUntil = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (visible: boolean, height: number) => {
      const rest = restingKeyboard(visible, height);
      if (Math.abs(at.height.get() - rest.height) > 0.5) at.height.set(rest.height);
      if (at.progress.get() !== rest.progress) at.progress.set(rest.progress);
    };
    const check = () => {
      timer = null;
      // A move the system announced: its end settles the dock (and looks again here if it never comes).
      const wait = movingUntil - Date.now();
      if (wait > 0) {
        timer = setTimeout(check, wait);
        return;
      }
      settle(Keyboard.isVisible(), Keyboard.metrics()?.height ?? 0);
    };
    look.current = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, KEYBOARD_CHECK_MS);
    };
    const moving = (duration: number) => {
      movingUntil = Date.now() + duration + MOVE_GRACE_MS;
    };
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", (e) => moving(e.duration)),
      Keyboard.addListener("keyboardWillHide", (e) => moving(e.duration)),
      Keyboard.addListener("keyboardDidShow", (e) => {
        movingUntil = 0;
        settle(true, e.endCoordinates.height);
      }),
      Keyboard.addListener("keyboardDidHide", () => {
        movingUntil = 0;
        settle(false, 0);
      }),
      AppState.addEventListener("change", (state) => {
        if (state === "active") look.current();
      }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      look.current = () => {};
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [at]);
  return useCallback(() => look.current(), []);
}
