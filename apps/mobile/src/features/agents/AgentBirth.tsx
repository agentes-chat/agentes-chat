import { drawAccessory, drawAgent, type Pose } from "@agenteschat/ui/agent/engine";
import { Canvas, createPicture, Picture } from "@shopify/react-native-skia";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useFrameTime } from "@/agent/live";
import type { AgentLookInput } from "@/agent/looks";
import { agentLayout } from "@/agent/poses";
import { asCtx, compile, RecordingContext } from "@/agent/recorder";
import { replay } from "@/agent/skia-ctx";
import { burstTones, PixelBurst } from "@/sky/PixelBurst";
import { haptics, Sky, Text, useTheme } from "@/ui";

/** The body's box: the big face, standing on its own (no tile). */
const FACE = 120;
/** The body starts forming once the sky is on its way in, and takes this long. */
const FORM_AT = 200;
const FORM_MS = 820;
/** Formed, it looks to one side, then the other. */
const LOOK_AT = FORM_AT + FORM_MS;
const LOOK_MS = 280;
/** How far the head turns (the engine's `turn`, -1..1) and how far the eyes go with it. */
const TURN = 0.5;
const EYES = 0.25;
/** Then it smiles and hops, its pixels burst and its name comes in. */
const CHEER_AT = LOOK_AT + 2 * LOOK_MS;
/** The whole scene. */
const SCENE_MS = 2200;

/** Where the big face stands in the window when the scene ends, for whoever takes it from there. */
export interface BirthFace {
  x: number;
  y: number;
  size: number;
  framed: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

/** The head's turn at `ms` into the scene: left, right, then back to the front as it smiles. */
function turnAt(ms: number): number {
  const k = (ms - LOOK_AT) / LOOK_MS;
  if (k <= 0 || k >= 2.5) return 0;
  // Each turn takes half its beat and holds for the rest.
  if (k < 1) return -TURN * smooth(clamp01(k * 2));
  if (k < 2) return TURN * (2 * smooth(clamp01((k - 1) * 2)) - 1);
  return TURN * (1 - smooth(clamp01((k - 2) * 2)));
}

/**
 * One frame of the agent coming to be, as drawing commands: the engine's own `progress` (the body forming out of the
 * sky's pixels, its eyes once it is whole), then its pose. `AgentAvatar` draws a whole agent only, so the scene
 * records its frames itself, the same way.
 */
function birthFrame(agent: AgentLookInput, progress: number, turn: number, happy: boolean) {
  const accessory = agent.accessory && agent.accessory !== "none" ? agent.accessory : undefined;
  const box = agentLayout(FACE, Boolean(accessory));
  const rec = new RecordingContext();
  const pose: Pose = { turn: [turn, 0], look: [turn * EYES, 0], blink: false };
  if (happy) pose.expression = "happy";
  drawAgent(asCtx(rec), box.x, box.y, box.inner, {
    color: agent.color,
    eyes: agent.eyes,
    cells: box.cells,
    pose,
    progress,
    after: (ctx, side, body) => {
      if (accessory) drawAccessory(ctx, side, accessory, body, 0, false);
    },
  });
  return compile(rec.commands);
}

/**
 * An agent was created: over the whole screen, its sky fades in and its body forms out of the sky's pixels; it looks
 * to one side and the other, smiles and hops while its pixels burst, and the news comes in under it. About two
 * seconds, once, then `onDone` with where the face stands (the conversation that opens next can take it from there).
 * It covers what is under it and takes its touches. Never mounted with reduced motion: the caller says the news its
 * usual way.
 */
export function AgentBirth({
  agent,
  title,
  faceHidden = false,
  onDone,
}: {
  agent: AgentLookInput;
  /** The news, under the agent. */
  title: string;
  /** The face left for the next screen: only its sky and the news stay. */
  faceHidden?: boolean;
  onDone: (face: BirthFace | null) => void;
}) {
  const { colors: c, motion } = useTheme();
  const [startedAt] = useState(() => Date.now());
  // The shared clock redraws the scene; where it is comes from the time since it started.
  useFrameTime(true, 0);
  const ms = Date.now() - startedAt;
  const formed = clamp01((ms - FORM_AT) / FORM_MS);
  // Fast at first, settling (ease-out quad), in steps so two redraws in one step draw once.
  const progress = Math.round((1 - (1 - formed) * (1 - formed)) * 50) / 50;
  const turn = Math.round(turnAt(ms) * 50) / 50;
  const happy = ms >= CHEER_AT;
  const { color, eyes, accessory } = agent;
  const picture = useMemo(() => {
    const frame = birthFrame({ color, eyes, accessory }, progress, turn, happy);
    return createPicture((canvas) => replay(canvas, frame), { width: FACE, height: FACE });
  }, [color, eyes, accessory, progress, turn, happy]);

  const sky = useSharedValue(0);
  const hop = useSharedValue(0);
  const news = useSharedValue(0);
  const [burst, setBurst] = useState(false);
  const face = useRef<ComponentRef<typeof View>>(null);
  const done = useRef(onDone);
  done.current = onDone;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scene plays once, as it appears
  useEffect(() => {
    const ease = Easing.bezier(...motion.ease);
    haptics.medium();
    sky.value = withTiming(1, { duration: 420, easing: ease });
    hop.value = withDelay(
      CHEER_AT,
      withSequence(withTiming(-18, { duration: 140, easing: ease }), withSpring(0, motion.bounce)),
    );
    news.value = withDelay(CHEER_AT, withTiming(1, { duration: 360, easing: ease }));
    const cheer = setTimeout(() => {
      haptics.success();
      setBurst(true);
    }, CHEER_AT);
    const end = setTimeout(() => {
      const view = face.current;
      if (!view) return done.current(null);
      view.measureInWindow((x, y) => {
        done.current(Number.isFinite(x) && Number.isFinite(y) ? { x, y, size: FACE, framed: false } : null);
      });
    }, SCENE_MS);
    return () => {
      clearTimeout(cheer);
      clearTimeout(end);
    };
  }, []);
  const skyStyle = useAnimatedStyle(() => ({ opacity: sky.value }));
  const hopStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }] }));
  const newsStyle = useAnimatedStyle(() => ({
    opacity: news.value,
    transform: [{ translateY: (1 - news.value) * 12 }],
  }));

  return (
    <View style={styles.scene} accessibilityViewIsModal>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, skyStyle]}>
        <Sky color={agent.color} depth={1} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {/* The face's own box: it is measured where it rests, and the burst starts from its middle. */}
      <View ref={face} collapsable={false} style={styles.face}>
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[hopStyle, faceHidden ? styles.gone : null]}
        >
          <Canvas style={styles.canvas}>
            <Picture picture={picture} />
          </Canvas>
        </Animated.View>
        {burst ? (
          <PixelBurst
            at={{ x: FACE / 2, y: FACE / 2 }}
            tones={burstTones(agent.color)}
            onDone={() => setBurst(false)}
          />
        ) : null}
      </View>
      <Animated.View style={[styles.news, newsStyle]}>
        <Text variant="display2" style={styles.center} accessibilityRole="header">
          {title}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Over the whole screen, the agent a little above its middle.
  scene: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 72,
  },
  face: { width: FACE, height: FACE },
  canvas: { width: FACE, height: FACE },
  gone: { opacity: 0 },
  news: { marginTop: 20, paddingHorizontal: 32, alignSelf: "stretch" },
  center: { textAlign: "center" },
});
