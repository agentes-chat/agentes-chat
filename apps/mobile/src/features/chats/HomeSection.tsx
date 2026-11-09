import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { readValueSync, STORED, writeValue } from "@/lib/storage";
import { Count, Icon, LIST_INSET, motion, SCREEN_X, Text, useReducedMotion, weights } from "@/ui";
import { useColors } from "../shared/hooks";
import {
  HOME_SECTIONS,
  type HomeSection,
  parseCollapsed,
  parseHomeCollapsed,
  toggleCollapsed,
  toggleHomeCollapsed,
} from "./logic";

/**
 * The sections the person collapsed, remembered across launches: Conversas' by default, or another list's
 * (`store`, `keys`: the Threads tab's Missões and Threads; null `keys`: any ids, Agentes' groups).
 */
export function useCollapsedSections<K extends string = HomeSection>(
  store: string = STORED.homeCollapsed,
  keys: readonly K[] | null = HOME_SECTIONS as unknown as readonly K[],
) {
  const [collapsed, setCollapsed] = useState<K[]>(() => parseCollapsed(readValueSync(store), keys));
  const toggle = useCallback(
    (key: K) => {
      setCollapsed((list) => {
        const next = toggleCollapsed(list, key, keys);
        void writeValue(store, next.length > 0 ? JSON.stringify(next) : null);
        return next;
      });
    },
    [store, keys],
  );
  return { collapsed, toggle };
}

/** Conversas' closed sections, remembered: the fixed ones and the channel categories (any key, ADR 0080). */
export function useHomeCollapsed() {
  const [collapsed, setCollapsed] = useState<string[]>(() => parseHomeCollapsed(readValueSync(STORED.homeCollapsed)));
  const toggle = useCallback((key: string) => {
    setCollapsed((list) => {
      const next = toggleHomeCollapsed(list, key);
      void writeValue(STORED.homeCollapsed, next.length > 0 ? JSON.stringify(next) : null);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

/**
 * What changes place in a list travels there (a conversation that goes to the top with a new message, the sections
 * under one that closes): the ruler's spring for things moving to a new place, which settles with no overshoot.
 */
export const LIST_MOVE = LinearTransition.springify().damping(motion.nav.damping).stiffness(motion.nav.stiffness);

/** A list's first rows arrive one after the other, this far apart; from the eighth on, together. */
const LAND_GAP = 30;
const LAND_ROWS = 8;
const LAND_RISE = 8;
const LAND_MS = 420;

/**
 * One row (or block) of a list. With `land` on its first render (the list's first load, `useFirstLoad`) it arrives:
 * clear and 8 points low, to its place, `index` rows after the first. It is a value we drive rather than an
 * `entering`, because the sections skip their rows' entering when the list mounts; a row that mounts later is just
 * there. With `moves` it travels to its new place when the list reorders or something above it changes size. Give it
 * the row's key. With reduced motion it is a plain box.
 */
export function LandRow({
  land = false,
  index = 0,
  moves = false,
  children,
}: {
  land?: boolean;
  index?: number;
  moves?: boolean;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  // Decided once, when the row mounts: later renders never replay it.
  const [arrives] = useState(land && !reduced);
  const [delay] = useState(Math.min(index, LAND_ROWS) * LAND_GAP);
  const shown = useSharedValue(arrives ? 0 : 1);
  useEffect(() => {
    if (!arrives) return;
    shown.value = withDelay(delay, withTiming(1, { duration: LAND_MS, easing: Easing.bezier(...motion.ease) }));
  }, [arrives, delay, shown]);
  const look = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * LAND_RISE }],
  }));
  return (
    // Only a row that arrives carries a style; the rest stay plain views.
    <Animated.View layout={moves && !reduced ? LIST_MOVE : undefined} style={arrives ? look : undefined}>
      {children}
    </Animated.View>
  );
}

/**
 * A section of Conversas: the title, its count (medium, faint) and a chevron that
 * turns when collapsed; tapping the header collapses or opens it.
 */
export function CollapsibleSection({
  title,
  count,
  collapsed,
  onToggle,
  onLongPress,
  holdLabel,
  kept,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** A channel category's header: its menu (admins). */
  onLongPress?: () => void;
  /** What the long press does, for screen readers. */
  holdLabel?: string;
  /** Shown while closed (a category's unread channels). */
  kept?: ReactNode;
  children: ReactNode;
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(collapsed ? "-90deg" : "0deg", { duration: reduced ? 0 : 200 }) }],
  }));
  return (
    // The section travels when one above it closes or opens, instead of jumping there.
    <Animated.View layout={reduced ? undefined : LIST_MOVE}>
      <Pressable
        onPress={onToggle}
        {...(onLongPress
          ? {
              onLongPress,
              delayLongPress: 380,
              accessibilityActions: [{ name: "menu", label: holdLabel ?? title }],
              onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
                if (e.nativeEvent.actionName === "menu") onLongPress();
              },
            }
          : {})}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: !collapsed }}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <Text variant="small" tone="ink" style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <Count value={count} size={15} weight={weights.medium} color={c.faint} />
        <View style={styles.grow} />
        <Animated.View style={chevron}>
          <Icon name="chev" size={15} color={c.faint} />
        </Animated.View>
      </Pressable>
      {collapsed ? (kept ?? null) : null}
      {/* Opened while the list shows, its rows fade in; open when the list mounts, they just show. Closed, they fade
          out where they were while what is under the section comes up. */}
      <LayoutAnimationConfig skipEntering>
        {collapsed ? null : (
          <Animated.View
            entering={reduced ? undefined : FadeIn.duration(160)}
            exiting={reduced ? undefined : FadeOut.duration(150)}
          >
            {children}
          </Animated.View>
        )}
      </LayoutAnimationConfig>
    </Animated.View>
  );
}

/** "Ver todos os agentes" under a section's first rows, aligned with the text column (`.more`). */
export function SeeAllRow({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.more, pressed && { backgroundColor: c.sunken }]}
    >
      <Text variant="small" tone="muted" style={styles.medium}>
        {label}
      </Text>
      <Icon name="right" size={15} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The kit's `SectionHeader` box: the screen's sides (SCREEN_X), 24 above and 8 below (the rhythm in eights).
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 24,
    paddingHorizontal: SCREEN_X,
    paddingBottom: 8,
  },
  pressed: { opacity: 0.6 },
  title: { fontWeight: "600", flexShrink: 1 },
  grow: { flex: 1 },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingLeft: LIST_INSET,
    paddingRight: 16,
  },
  medium: { fontWeight: "500" },
});
