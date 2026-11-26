import { ORBIT_RINGS, ORBIT_SPAN, orbitColors } from "@agenteschat/ui/agent/orbit";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { type CSSKeyframesRule, css } from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";
import { useReducedMotion } from "@/ui/theme";
import { useLivePaused } from "./live";
import { loopStyle } from "./loop";

/** One turn each way: the dot rides its ring, and turns back as much so it stays round. */
const TURN: CSSKeyframesRule = css.keyframes({
  from: { transform: [{ rotate: "0deg" }] },
  to: { transform: [{ rotate: "360deg" }] },
});
const UNTURN: CSSKeyframesRule = css.keyframes({
  from: { transform: [{ rotate: "0deg" }] },
  to: { transform: [{ rotate: "-360deg" }] },
});

/** The dot's side, in points, whatever the glyph's size. */
const DOT = 3.5;

/**
 * One half of the rings (the far one behind the glyph, the near one over it): each ring's arc, and its dot where the
 * dot is on that half. A ring is a circle squashed and tilted, so a plain turn moves its dot along the ellipse; the
 * half is the squashed box's top or bottom, clipped.
 */
function Half({
  half,
  size,
  colors,
  turning,
  paused,
}: {
  half: "back" | "front";
  size: number;
  colors: readonly string[];
  turning: boolean;
  paused: boolean;
}) {
  const box = size * ORBIT_SPAN;
  const c = box / 2;
  const back = half === "back";
  return (
    <View
      pointerEvents="none"
      style={[styles.layer, { width: box, height: box, left: -(box - size) / 2, top: -(box - size) / 2 }]}
    >
      <Svg width={box} height={box}>
        {ORBIT_RINGS.map((ring, i) => {
          const rx = (ring.r * size) / 2;
          const ry = rx * ring.flat;
          // The far half runs over the top (y < 0), the near one under it.
          const d = back ? `M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0` : `M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of rings
            <G key={i} transform={`translate(${c} ${c}) rotate(${ring.tilt})`}>
              <Path d={d} stroke={colors[i]} strokeWidth={1.25} fill="none" opacity={back ? 0.28 : 0.5} />
            </G>
          );
        })}
      </Svg>
      {ORBIT_RINGS.map((ring, i) => {
        const rx = (ring.r * size) / 2;
        const turn = ring.turn * 1000;
        // Where its dot is now, as a negative delay into its turn; still, it rests at its start.
        const delay = -(ring.start / 360) * turn;
        const spin = turning
          ? loopStyle(ring.back ? UNTURN : TURN, turn, "linear", delay, paused)
          : { transform: [{ rotate: `${ring.back ? -ring.start : ring.start}deg` }] };
        const unspin = turning
          ? loopStyle(ring.back ? TURN : UNTURN, turn, "linear", delay, paused)
          : { transform: [{ rotate: `${ring.back ? ring.start : -ring.start}deg` }] };
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of rings
            key={i}
            style={[
              styles.ring,
              {
                left: c - rx,
                top: c - rx,
                width: rx * 2,
                height: rx * 2,
                transform: [{ rotate: `${ring.tilt}deg` }, { scaleY: ring.flat }],
              },
            ]}
          >
            {/* The half's window: the top or the bottom of the squashed circle, a dot's width past it. */}
            <View
              style={[
                styles.clip,
                {
                  left: -DOT,
                  width: rx * 2 + DOT * 2,
                  top: back ? -DOT / ring.flat : rx,
                  height: rx + DOT / ring.flat,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.ring,
                  { left: DOT, top: back ? DOT / ring.flat : -rx, width: rx * 2, height: rx * 2 },
                  spin,
                ]}
              >
                <Animated.View
                  style={[
                    styles.dot,
                    {
                      left: rx * 2 - DOT / 2,
                      top: rx - DOT / ring.flat / 2,
                      width: DOT,
                      height: DOT / ring.flat,
                      borderRadius: DOT,
                      backgroundColor: colors[i],
                    },
                    unspin,
                  ]}
                />
              </Animated.View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * An agent at work (the web's `OrbitGlyph`): its face with two or three tilted rings orbiting it, in its colour and two
 * neighbours of it, each with a dot riding it, the far half of each ring behind the face and the near half in front.
 * It turns on the UI thread (Reanimated CSS animations, transforms only); it holds still with Reduce Motion and stops
 * where it is on a screen that isn't showing (`LivePause`). The rings take no room: they reach past the face.
 */
export function OrbitFace({ color, size, children }: { color: string; size: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const paused = useLivePaused();
  const colors = orbitColors(color);
  const turning = !reduced;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Half half="back" size={size} colors={colors} turning={turning} paused={paused} />
      {children}
      <Half half="front" size={size} colors={colors} turning={turning} paused={paused} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute" },
  ring: { position: "absolute" },
  clip: { position: "absolute", overflow: "hidden" },
  dot: { position: "absolute" },
});
