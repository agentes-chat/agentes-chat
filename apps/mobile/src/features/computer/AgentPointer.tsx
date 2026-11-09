import { cursorTones } from "@agenteschat/ui/agent/engine";
import { CURSOR, type CursorPoint, glideControl, glideMs, type TagGap, tagSide } from "@agenteschat/ui/cursor";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "@/ui";
import { AgentFace } from "../shared/Face";

/** One step of the agent's pointer, in the desktop's pixels (`cursorStep`; its words are the steps under the screen). */
export interface PointerStep {
  x?: number;
  y?: number;
  presses: number;
}

export interface AgentPointerHandle {
  step(step: PointerStep): void;
}

/** The camera the screen is seen through: its scale, the desktop point at the box's top left, and the box. */
export interface PointerCamera {
  s: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  box: SharedValue<{ width: number; height: number }>;
}

const GLIDE = Easing.bezier(0.5, 0, 0.2, 1);
const OUT = Easing.bezier(0.2, 0.8, 0.2, 1);
/** Steps that wait while one plays: a burst keeps only its newest few. */
const WAITING_MAX = 3;
/** The arrow's side in points, and where its tip is in it (the path's tip is a twelfth in). */
const ARROW = 20;
const TIP = ARROW / 12;
/** The tag's near corner from the tip: right of and below it, or (turned) left of and above it. */
const TAG: TagGap = { right: 13, below: 17, left: 4, above: 4 };
/** Turned, the tag moves this much past its own size. */
const TAG_GAP = { x: TAG.right + TAG.left, y: TAG.below + TAG.above };
/** The tag's sharp corner, toward the tip wherever it turns. */
const CORNER = {
  se: { borderTopLeftRadius: 3 },
  sw: { borderTopRightRadius: 3 },
  ne: { borderBottomLeftRadius: 3 },
  nw: { borderBottomRightRadius: 3 },
} as const;

type Phase = "gone" | "on" | "rest";

/**
 * The agent's own pointer over its screen on the phone (protocol 54), as the web's `AgentCursor`: the arrow in the
 * agent's color with its face and name, gliding to each step's place along a gentle curve, pressing there with a
 * ripple; quiet, it rests fainter, then goes. The step in words is the screen's own list of steps under it, so the
 * tag says only who. Drawn through the screen's `camera`, so it follows a pinch or a pan. Hidden (`shown` false), it
 * drops its steps. `reduced`: it jumps, with no press or ripple. Never takes a touch.
 */
export function AgentPointer({
  agentId,
  name,
  color,
  camera,
  desk,
  shown,
  reduced,
  ref,
}: {
  agentId: string;
  name: string;
  color?: string;
  camera: PointerCamera;
  desk: { width: number; height: number };
  shown: boolean;
  reduced: boolean;
  ref?: Ref<AgentPointerHandle>;
}) {
  const tones = cursorTones(color);
  const from = useSharedValue<CursorPoint>({ x: 0, y: 0 });
  const bend = useSharedValue<CursorPoint>({ x: 0, y: 0 });
  const to = useSharedValue<CursorPoint>({ x: 0, y: 0 });
  const t = useSharedValue(1);
  const seen = useSharedValue(0);
  const squash = useSharedValue(1);
  const rippleAt = useSharedValue<CursorPoint>({ x: 0, y: 0 });
  const rippleT = useSharedValue(1);
  const [side, setSide] = useState({ west: false, north: false });
  // The tag turns by its own size: measured, as long as its name makes it.
  const tagSize = useRef({ width: 0, height: 0 });
  const flipX = useSharedValue(0);
  const flipY = useSharedValue(0);
  const live = useRef({
    shown,
    reduced,
    desk,
    phase: "gone" as Phase,
    placed: false,
    mounted: true,
    /** Where the step under way takes it. */
    bound: null as CursorPoint | null,
  });
  live.current.shown = shown;
  live.current.reduced = reduced;
  live.current.desk = desk;
  const waiting = useRef<PointerStep[]>([]);
  const playing = useRef(false);
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const where = useDerivedValue(() => {
    const k = t.value;
    const u = 1 - k;
    return {
      x: u * u * from.value.x + 2 * u * k * bend.value.x + k * k * to.value.x,
      y: u * u * from.value.y + 2 * u * k * bend.value.y + k * k * to.value.y,
    };
  });
  const pointer = useAnimatedStyle(() => ({
    opacity: seen.value,
    transform: [
      { translateX: (where.value.x - camera.x.value) * camera.s.value },
      { translateY: (where.value.y - camera.y.value) * camera.s.value },
    ],
  }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ scale: squash.value }] }));
  const tag = useAnimatedStyle(() => ({ transform: [{ translateX: flipX.value }, { translateY: flipY.value }] }));
  const ripple = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - rippleT.value),
    transform: [
      { translateX: (rippleAt.value.x - camera.x.value) * camera.s.value },
      { translateY: (rippleAt.value.y - camera.y.value) * camera.s.value },
      { scale: 0.3 + 1.2 * rippleT.value },
    ],
  }));

  /**
   * The tag right and below the tip while it fits there, else on the side with more room (`tagSide`), by its own size
   * at the step's place: again whenever it lays out.
   */
  const turn = () => {
    const p = live.current.bound;
    if (!p) return;
    const { width, height } = live.current.desk;
    const k = camera.s.value;
    const { width: w, height: h } = tagSize.current;
    // What shows of the screen: all of it watching, a part where the person zoomed in.
    const box = camera.box.value;
    const room = {
      width: Math.min(box.width, (width - camera.x.value) * k),
      height: Math.min(box.height, (height - camera.y.value) * k),
    };
    const at = { x: (p.x - camera.x.value) * k, y: (p.y - camera.y.value) * k };
    const { west, north } = tagSide(at, { width: w, height: h }, room, TAG);
    setSide((was) => (was.west === west && was.north === north ? was : { west, north }));
    const duration = live.current.reduced ? 0 : 180;
    flipX.value = withTiming(west ? -(w + TAG_GAP.x) : 0, { duration, easing: OUT });
    flipY.value = withTiming(north ? -(h + TAG_GAP.y) : 0, { duration, easing: OUT });
  };
  const enter = (next: Phase) => {
    live.current.phase = next;
    const opacity = next === "on" ? 1 : next === "rest" ? CURSOR.rest : 0;
    const duration = live.current.reduced ? 120 : next === "on" ? 140 : next === "rest" ? 400 : 240;
    seen.value = withTiming(opacity, { duration, easing: OUT });
  };
  /** Quiet from now: it rests, then it goes. */
  const quiet = () => {
    clearTimeout(rest.current);
    if (!live.current.mounted) return;
    rest.current = setTimeout(() => {
      enter("rest");
      rest.current = setTimeout(() => enter("gone"), CURSOR.goneMs - CURSOR.restMs);
    }, CURSOR.restMs);
  };
  const jump = (p: CursorPoint) => {
    from.value = p;
    bend.value = p;
    to.value = p;
    t.value = 1;
  };
  const glide = (p: CursorPoint) =>
    new Promise<void>((resolve) => {
      // From where it is now, mid-way through another glide too.
      const now = where.value;
      from.value = now;
      bend.value = glideControl(now, p);
      to.value = p;
      t.value = 0;
      t.value = withTiming(1, { duration: glideMs(now, p), easing: GLIDE }, () => scheduleOnRN(resolve));
    });
  const press = async (times: number, p: CursorPoint) => {
    for (let i = 0; i < times; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, CURSOR.pressGapMs));
      const half = { duration: CURSOR.pressMs / 2 };
      squash.value = withSequence(withTiming(0.82, half), withTiming(1, half));
      rippleAt.value = p;
      rippleT.value = 0;
      rippleT.value = withTiming(1, { duration: CURSOR.rippleMs, easing: OUT });
    }
  };
  const play = async (s: PointerStep) => {
    const place = s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : null;
    // Typing with no place shows only where it already stands.
    if (!place && !live.current.placed) return;
    const gone = live.current.phase === "gone";
    clearTimeout(rest.current);
    enter("on");
    if (place) {
      live.current.bound = place;
      turn();
      if (gone || live.current.reduced || !live.current.placed) jump(place);
      else await glide(place);
      live.current.placed = true;
      if (s.presses > 0 && !live.current.reduced && live.current.shown) await press(s.presses, place);
    }
    quiet();
  };
  const run = async () => {
    if (playing.current) return;
    playing.current = true;
    try {
      for (let s = waiting.current.shift(); s; s = waiting.current.shift()) {
        if (live.current.shown) await play(s);
      }
    } finally {
      playing.current = false;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one handle; what it reads lives in refs and shared values
  useImperativeHandle(
    ref,
    () => ({
      step(s) {
        if (!live.current.shown) return;
        waiting.current.push(s);
        waiting.current.splice(0, Math.max(0, waiting.current.length - WAITING_MAX));
        void run();
      },
    }),
    [],
  );
  // Hidden, it drops what it was doing: the next step shown brings it back where that one lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when it shows or hides; the rest lives in refs
  useEffect(() => {
    if (shown) return;
    waiting.current = [];
    clearTimeout(rest.current);
    enter("gone");
  }, [shown]);
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      waiting.current = [];
      clearTimeout(rest.current);
    };
  }, []);

  const corner = side.north ? (side.west ? CORNER.nw : CORNER.ne) : side.west ? CORNER.sw : CORNER.se;
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.ripple, { backgroundColor: tones.arrow }, ripple]} />
      <Animated.View pointerEvents="none" style={[styles.pointer, pointer]}>
        <Animated.View style={[styles.arrow, arrow]}>
          <Svg width={ARROW} height={ARROW} viewBox="4 3 12 12">
            <Path
              d="m5 4 10 4.17-4.17 1.66L9.17 14 5 4Z"
              fill={tones.arrow}
              stroke="#ffffff"
              strokeWidth={0.9}
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
        <Animated.View
          onLayout={(e) => {
            tagSize.current = e.nativeEvent.layout;
            turn();
          }}
          style={[styles.tag, { backgroundColor: tones.tag }, corner, tag]}
        >
          <View style={styles.face}>
            <AgentFace agentId={agentId} size={16} live={false} />
          </View>
          <Text variant="label" style={styles.name}>
            {name}
          </Text>
        </Animated.View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  // As large as the picture, its corner on the tip: the tag measures its name against that room, never against none.
  pointer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  arrow: {
    position: "absolute",
    left: -TIP,
    top: -TIP,
    transformOrigin: [TIP, TIP, 0],
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
  // A long name wraps: never cut.
  tag: {
    position: "absolute",
    left: TAG.right,
    top: TAG.below,
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    paddingLeft: 2,
    paddingRight: 8,
    borderRadius: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  face: { marginRight: 4 },
  name: { flexShrink: 1, color: "#ffffff" },
  ripple: { position: "absolute", left: -14, top: -14, width: 28, height: 28, borderRadius: 14, opacity: 0 },
});
