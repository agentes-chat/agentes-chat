import { useCallback, useEffect } from "react";
import { type FrameInfo, type SharedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";

/** A late frame moves a drawing on by this much at most: a hitch (or a return from the background) never jumps it. */
const MAX_STEP_MS = 100;

/**
 * A drawing's time in ms, on the UI thread, that runs only while `moving`. Skia's `useClock` runs a frame callback on
 * every frame for as long as its drawing is mounted, moving or not, and each tick draws it again: a sky under a pushed
 * screen kept redrawing. Here a still drawing has no callback at all, and one that moves again carries on from where
 * it stopped instead of jumping. With `fps`, time moves in steps of that rate: between them nothing changes, so
 * nothing is drawn, which a slow drawing filling the screen doesn't miss.
 */
export function useDrawingClock(moving: boolean, fps?: number): SharedValue<number> {
  const clock = useSharedValue(0);
  const waited = useSharedValue(0);
  const tick = useCallback(
    (frame: FrameInfo) => {
      "worklet";
      waited.value += Math.min(frame.timeSincePreviousFrame ?? 0, MAX_STEP_MS);
      if (fps && waited.value < 1000 / fps) return;
      clock.value += waited.value;
      waited.value = 0;
    },
    [clock, waited, fps],
  );
  const frames = useFrameCallback(tick, false);
  useEffect(() => {
    frames.setActive(moving);
  }, [frames, moving]);
  return clock;
}
