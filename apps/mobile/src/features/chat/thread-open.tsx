import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { motion, useTheme } from "@/ui";

/*
 * A thread opened from its message, as on the web: the message stays marked in its conversation (a soft plate and a
 * 2pt mark on its left edge) while its thread's screen is open, and the mark fades once back. On the thread's screen,
 * the rows of its first load fade in 35ms apart.
 */

const open = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** This thread's screen is on the stack: its message in the conversation under it shows marked. */
export function useMarkThreadOpen(threadId: string | null) {
  useEffect(() => {
    if (!threadId) return;
    open.set(threadId, (open.get(threadId) ?? 0) + 1);
    changed();
    return () => {
      const n = (open.get(threadId) ?? 1) - 1;
      if (n > 0) open.set(threadId, n);
      else open.delete(threadId);
      changed();
    };
  }, [threadId]);
}

/** After its thread's screen closes, the mark stays this long before it fades (the web's 700ms, fade included). */
const LINGER_MS = 520;

/** The root message of a thread, marked while that thread's screen is open. */
export function ThreadRootMark({ threadId, children }: { threadId: string; children: ReactNode }) {
  const { colors: c } = useTheme();
  const shown = useSyncExternalStore(subscribe, () => open.has(threadId));
  const opacity = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    opacity.set(
      shown ? withTiming(1, { duration: motion.base }) : withDelay(LINGER_MS, withTiming(0, { duration: motion.base })),
    );
  }, [shown, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[styles.mark, { backgroundColor: c.plateSoft, borderLeftColor: c.lineStrong }, style]}
      />
      {children}
    </View>
  );
}

/** Rows fade in for this long after a thread's screen opens; the ones of its first load, 35ms apart. */
const LANDING_MS = 1200;
const ROW_STEP_MS = 35;
const ROW_STEPS = 8;
const RowIn = FadeIn.duration(160);

const Landing = createContext<{ at: number; rows: number } | null>(null);

/** Around a thread's screen: its first rows fade in, in turn. */
export function ThreadLanding({ on, children }: { on: boolean; children: ReactNode }) {
  const [value] = useState(() => (on ? { at: Date.now(), rows: 0 } : null));
  return <Landing.Provider value={value}>{children}</Landing.Provider>;
}

/** The entrance of a row mounting while its thread's screen lands, else none. Decided once, as the row mounts. */
export function useLandingEntrance(reduced: boolean) {
  const landing = useContext(Landing);
  const [entering] = useState(() => {
    if (!landing || reduced || Date.now() - landing.at > LANDING_MS) return undefined;
    const step = Math.min(landing.rows++, ROW_STEPS);
    return RowIn.delay(step * ROW_STEP_MS);
  });
  return entering;
}

const styles = StyleSheet.create({
  mark: { ...StyleSheet.absoluteFill, borderLeftWidth: 2, borderRadius: 14 },
});
