import type { BottomTabBarProps } from "expo-router/js-tabs";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { FLOATING_BAR, TAB_BADGE, tabHasNewAction } from "@/lib/nav";
import { Count, Glass, Icon, PressScale, useTheme } from "@/ui";
import { type TabGlyph, tabGlyphSvg } from "@/ui/tabGlyphs";
import { openNew } from "../shared/tabHeader";

const { height: BAR, side: SIDE, below: BELOW, gap: GAP, inset: INSET } = FLOATING_BAR;
/** Each tab's press area and the lozenge of the selected one. */
const CELL = BAR - INSET * 2;
const GLYPH = 24;

/** A tab's glyph, outline or filled, parsed again only when it changes. */
export const TabGlyphIcon = memo(function TabGlyphIcon({
  glyph,
  selected,
  color,
}: {
  glyph: TabGlyph;
  selected: boolean;
  color: string;
}) {
  const xml = useMemo(() => tabGlyphSvg(glyph, selected, color), [glyph, selected, color]);
  return <SvgXml xml={xml} width={GLYPH} height={GLYPH} />;
});

/**
 * Android's tab bar: a capsule floating over the screen, above the gesture bar, with the tabs as icons alone and the
 * selected one on a lozenge. Conversas adds its "new" button beside it, as tall as the capsule; every other tab gives
 * the capsule the whole width. The surface is the kit's glass, opaque on Android (`Glass`). It leaves with the keyboard.
 * The navigator hands over only the tabs in sight, each with its label, icon and badge in its options.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { t } = useTranslation();
  const { colors, shadows, motion, reducedMotion } = useTheme();
  const keyboardUp = useKeyboardState((keyboard) => keyboard.isVisible);
  if (keyboardUp) return null;
  const hasAction = tabHasNewAction(state.routes[state.index]?.name);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.room,
        { paddingLeft: insets.left + SIDE, paddingRight: insets.right + SIDE, paddingBottom: insets.bottom + BELOW },
      ]}
    >
      <View pointerEvents="box-none" style={styles.row}>
        <Animated.View
          accessibilityRole="tablist"
          layout={reducedMotion ? undefined : LinearTransition.duration(motion.fast)}
          style={[styles.capsuleBox, { boxShadow: shadows.e2 }]}
        >
          <Glass style={[styles.capsule, { borderColor: colors.line2 }]}>
            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key] ?? {};
              const selected = index === state.index;
              const badge = options?.tabBarBadge;
              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={options?.tabBarAccessibilityLabel ?? options?.title}
                  onPress={() => {
                    const press = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                    if (!selected && !press.defaultPrevented) navigateToTab(route.key);
                  }}
                  style={styles.cell}
                >
                  {({ pressed }) => (
                    <>
                      <View
                        style={[
                          styles.lozenge,
                          selected
                            ? { backgroundColor: colors.rowLit }
                            : pressed
                              ? { backgroundColor: colors.plate }
                              : null,
                        ]}
                      />
                      {options?.tabBarIcon?.({
                        focused: selected,
                        color: selected ? colors.ink : colors.faint,
                        size: GLYPH,
                      })}
                      {badge !== undefined ? (
                        <View style={styles.badge}>
                          <Count
                            value={Number(badge)}
                            size={11}
                            max={99}
                            inverted
                            fill={TAB_BADGE.background}
                            color={TAB_BADGE.text}
                          />
                        </View>
                      ) : null}
                    </>
                  )}
                </Pressable>
              );
            })}
          </Glass>
        </Animated.View>
        {hasAction ? (
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(motion.fast)}
            exiting={reducedMotion ? undefined : FadeOut.duration(motion.fast)}
            style={{ boxShadow: shadows.e2, borderRadius: ACTION_RADIUS }}
          >
            <PressScale
              haptic={false}
              onPress={openNew}
              accessibilityRole="button"
              accessibilityLabel={t("mobile.new.title")}
              style={[styles.action, { backgroundColor: colors.agent }]}
              contentStyle={styles.center}
            >
              <Icon name="plus" size={GLYPH} color={colors.onAgent} />
            </PressScale>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/** The kit's 30% of a control's height. */
const ACTION_RADIUS = Math.round(BAR * 0.3);

const styles = StyleSheet.create({
  // Over the screens, which run to the display's edge; only the bar itself takes touches.
  room: { position: "absolute", left: 0, right: 0, bottom: 0 },
  // A wide screen (a tablet, an open foldable) keeps the bar at a phone's measure.
  row: { flexDirection: "row", gap: GAP, width: "100%", maxWidth: 560, alignSelf: "center" },
  capsuleBox: { flex: 1, minWidth: 0, height: BAR, borderRadius: BAR / 2 },
  capsule: {
    flex: 1,
    flexDirection: "row",
    padding: INSET - StyleSheet.hairlineWidth,
    borderRadius: BAR / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cell: { flex: 1, minWidth: 0, height: CELL, alignItems: "center", justifyContent: "center" },
  lozenge: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: CELL / 2 },
  // On the glyph's upper right corner, past the cell's edge when the count is long.
  badge: { position: "absolute", top: 2, left: "50%", marginLeft: 3 },
  action: { width: BAR, height: BAR, borderRadius: ACTION_RADIUS },
  center: { alignItems: "center", justifyContent: "center" },
});
