import type { FestiveMood } from "@agenteschat/client/lib/festive";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { memo, useState } from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import { useDerivedValue } from "react-native-reanimated";
import { useLivePaused } from "@/agent/live";
import { useReducedMotion } from "@/ui/theme";
import { useSteppedClock } from "./clock";
import { particleRects } from "./particles";

/** The particles move this many times a second: a light layer, never at the screen's rate. */
const FPS = 12;

/**
 * A festive mood's particles over a sky (snow, confetti, fireworks…): two paths rebuilt on the UI thread at `FPS`, so
 * it costs the JS thread nothing. Off screen (`LivePause`) or with `still`, its clock stops and Skia draws nothing new;
 * with reduced motion they are drawn once, as a still decoration.
 */
export const FestiveLayer = memo(function FestiveLayer({
  mood,
  cell = 3,
  still = false,
  style,
}: {
  mood: FestiveMood;
  /** Points per particle pixel. */
  cell?: number;
  /** Hold it where it is (a splash on its way out). */
  still?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const paused = useLivePaused();
  const clock = useSteppedClock(!reduced && !paused && !still, FPS);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  const { particles } = mood;
  const { width, height } = size;
  const pathOf = (layer: number) => {
    "worklet";
    const rects = particleRects(particles, clock.value, width, height, cell, layer);
    const path = Skia.PathBuilder.Make();
    for (let i = 0; i < rects.length; i += 4)
      path.addRect(
        Skia.XYWHRect(rects[i] as number, rects[i + 1] as number, rects[i + 2] as number, rects[i + 3] as number),
      );
    return path.build();
  };
  const first = useDerivedValue(() => pathOf(0));
  const second = useDerivedValue(() => pathOf(1));
  return (
    <View
      style={style}
      onLayout={onLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 && height > 0 ? (
        <Canvas style={{ width, height }}>
          <Path path={first} color={mood.colors[0]} />
          <Path path={second} color={mood.colors[1]} />
        </Canvas>
      ) : null}
    </View>
  );
});
