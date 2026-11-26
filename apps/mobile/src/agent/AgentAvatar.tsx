import {
  bodyTones,
  drawAccessory,
  drawAgent,
  drawnKey,
  drawSleep,
  type Expression,
  EYE_COLOR,
} from "@agenteschat/ui/agent/engine";
import { avatarSkyCell, avatarSkyCells, avatarSkyTones } from "@agenteschat/ui/sky/avatar";
import { Canvas, createPicture, Picture, type SkPicture } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, StyleSheet, View } from "react-native";
import { useReducedMotion, useTheme } from "@/ui/theme";
import { kept, stillFaceKey, stillImageKey } from "./kept";
import { useFrameTime } from "./live";
import type { AgentLookInput } from "./looks";
import { type AgentMode, agentLayout, framedByDefault, framedLayout, poseFor, STILL_T, seedOf } from "./poses";
import { asCtx, compile, RecordingContext } from "./recorder";
import { replay } from "./skia-ctx";
import { stillImage } from "./still-image";

export interface AgentAvatarProps {
  agent: AgentLookInput;
  /** Box size in points (the body sits at the bottom; room above for an accessory). */
  size: number;
  mode?: AgentMode;
  /** false: one still frame (use it in long lists). Default true. */
  live?: boolean;
  /** The agent's name, for screen readers. */
  name?: string;
  /**
   * The agent standing in its own pixel sky, in a rounded tile (like the web's framed avatar). Default:
   * framed from 20 to 63pt; the tiny faces and the big hero stand on their own.
   */
  framed?: boolean;
  /** Holds one face (the sign-in screens: eyes shut while a password is typed); writing still wins. */
  expression?: Expression;
  /**
   * Where it looks for a moment, up or down the screen (at a field being typed in, at a newcomer's row): the eyes and
   * the head turn that way and hold, instead of wandering.
   */
  gaze?: Gaze;
  /** Only its sky, no body (framed only): out on a routine, it comes back into the frame when the run ends. */
  bodyless?: boolean;
  /** The tile's corner (framed only). Default 30% of the side; `size / 2` inside a fully round pill. */
  radius?: number;
}

/** Up or down the screen. */
export type Gaze = "up" | "down";

/** The eyes and the head turned toward `gaze` (fractions of the body, as the engine's `look` and `turn`). */
const GAZE: Record<Gaze, { look: [number, number]; turn: [number, number] }> = {
  up: { look: [0, -0.14], turn: [0, -0.35] },
  down: { look: [0, 0.14], turn: [0, 0.35] },
};

/** One frame of an agent as drawing commands (the engine draws, the recorder keeps the commands). */
export function agentFrame(
  agent: AgentLookInput,
  size: number,
  mode: AgentMode,
  t: number,
  seed: number,
  reduced: boolean,
  frame?: { dark: boolean },
  expression?: Expression,
  dark = frame?.dark ?? false,
  extra?: { gaze?: Gaze | undefined; bodyless?: boolean | undefined; sky?: boolean | undefined },
) {
  const accessory = agent.accessory && agent.accessory !== "none" ? agent.accessory : undefined;
  const box = frame ? framedLayout(size, Boolean(accessory)) : agentLayout(size, Boolean(accessory));
  const rec = new RecordingContext();
  if (frame && extra?.sky !== false) drawSky(rec, agent.color, size, frame.dark);
  // Away on a routine: the frame keeps its sky and waits for it.
  if (frame && extra?.bodyless) return compile(rec.commands);
  const base = poseFor(mode, t, seed, reduced);
  const looked = extra?.gaze ? { ...base, ...GAZE[extra.gaze] } : base;
  drawAgent(asCtx(rec), box.x, box.y, box.inner, {
    color: agent.color,
    eyes: agent.eyes,
    cells: box.cells,
    pose: expression ? { ...looked, expression, blink: false } : looked,
    after: (ctx, side, body) => {
      if (box.withAccessory && accessory) drawAccessory(ctx, side, accessory, body, t, mode === "run");
      // A sleeping agent's zz: the body's darkest tone on a light page, white on a dark one.
      if (mode === "sleep")
        drawSleep(
          ctx,
          side,
          body,
          dark ? EYE_COLOR : (bodyTones(agent.color)[0] ?? EYE_COLOR),
          // A still frame shows both z's.
          reduced || t === STILL_T ? undefined : t,
        );
    },
  });
  return compile(rec.commands);
}

/** The tile's sky (`@agenteschat/ui/sky/avatar`): a Bayer dither from the top tone to the bottom one. */
function drawSky(rec: RecordingContext, color: AgentLookInput["color"], size: number, dark: boolean) {
  const [top, bottom] = avatarSkyTones(color, dark);
  const n = avatarSkyCells(size * 2);
  const cell = size / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      rec.fillStyle = avatarSkyCell(x, y, n) ? bottom : top;
      rec.fillRect(x * cell, y * cell, cell, cell);
    }
}

/**
 * Pictures and images kept across mounts (`kept`): a sky under every frame of a living face, a still face recorded
 * once, and that still face as an image (by its look and the screen's pixel ratio). Recording one costs hundreds of
 * rects and a path parse each.
 */
const skies = new Map<string, SkPicture>();
const stills = new Map<string, SkPicture>();
const images = new Map<string, string | null>();

/** Everything a face is drawn from, but the moment. */
interface FaceLook {
  look: AgentLookInput;
  size: number;
  mode: AgentMode;
  seed: number;
  reduced: boolean;
  tile: boolean;
  dark: boolean;
  expression: Expression | undefined;
  gaze: Gaze | undefined;
  bodyless: boolean;
}

/** The face at `t`, without its sky (drawn once, under it). */
function facePicture(f: FaceLook, t: number): SkPicture {
  const frame = agentFrame(
    f.look,
    f.size,
    f.mode,
    t,
    f.seed,
    f.reduced,
    f.tile ? { dark: f.dark } : undefined,
    f.expression,
    f.dark,
    { gaze: f.gaze, bodyless: f.bodyless, sky: false },
  );
  return createPicture((canvas) => replay(canvas, frame), { width: f.size, height: f.size });
}

/** What is on screen: the still image or the canvas (each stays until the other has drawn, so a swap never blinks). */
type Layer = "image" | "canvas";

function AgentAvatarView({
  agent,
  size,
  mode = "idle",
  live = true,
  name,
  framed,
  expression,
  gaze,
  bodyless = false,
  radius,
}: AgentAvatarProps) {
  const reduced = useReducedMotion();
  const { scheme, colors: c } = useTheme();
  const tile = framed ?? framedByDefault(size);
  const dark = scheme === "dark";
  const { t: tr } = useTranslation();
  const { color, eyes, accessory, id } = agent;
  const seed = useMemo(() => seedOf(id ?? `${color}:${eyes}:${accessory ?? ""}`), [id, color, eyes, accessory]);
  // A face that never moves here (a long list's, reduced motion) is a plain image; a living one keeps its canvas, also
  // while the clock holds it still (a scroll, a slide), so holding never swaps one for the other.
  const moving = live && !reduced;
  const t = useFrameTime(moving, STILL_T);
  const [layer, setLayer] = useState<Layer>(moving ? "canvas" : "image");
  // Starting to move: the canvas draws the still frame over the image, which goes once the canvas has had a frame.
  useEffect(() => {
    if (!moving || layer === "canvas") return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setLayer("canvas"));
    });
    return () => cancelAnimationFrame(id);
  }, [moving, layer]);
  // By the colors it resolves to: `sky` follows the workspace's accent.
  const drawn = drawnKey(color);
  // The sky never moves: drawn once per color, size and theme (`drawn`: what `color` draws as now), under every frame.
  const sky = useMemo(() => {
    if (!tile) return null;
    return kept(skies, `${drawn}|${size}|${dark}`, () => {
      const rec = new RecordingContext();
      drawSky(rec, color, size, dark);
      const ops = compile(rec.commands);
      return createPicture((canvas) => replay(canvas, ops), { width: size, height: size });
    });
  }, [color, drawn, size, dark, tile]);
  const face = useMemo<FaceLook>(
    () => ({
      look: { color, eyes, accessory },
      size,
      mode,
      seed,
      reduced,
      tile,
      dark,
      expression,
      gaze,
      bodyless,
    }),
    [color, eyes, accessory, size, mode, seed, reduced, tile, dark, expression, gaze, bodyless],
  );
  const key = useMemo(
    () =>
      stillFaceKey({
        drawn,
        eyes,
        accessory,
        size,
        mode,
        seed,
        reduced,
        tile,
        dark,
        expression,
        gaze,
        bodyless,
      }),
    [drawn, eyes, accessory, size, mode, seed, reduced, tile, dark, expression, gaze, bodyless],
  );
  const ratio = PixelRatio.get();
  // A still face is the same image wherever it shows: drawn once per look and density, never per mount.
  const showImage = !moving || layer === "image";
  const image = useMemo(() => {
    if (!showImage) return null;
    return kept(images, stillImageKey(key, ratio), () => {
      const still = kept(stills, key, () => facePicture(face, STILL_T));
      return stillImage(sky ? [sky, still] : [still], size, ratio);
    });
  }, [showImage, key, ratio, face, sky, size]);
  // No image (Skia couldn't make one): the canvas draws the still frame instead.
  const showCanvas = moving || layer === "canvas" || !image;
  // Over the image, the canvas shows the still frame, so the two never differ while both are up.
  const at = moving && layer === "canvas" ? t : STILL_T;
  const picture = useMemo(() => {
    if (!showCanvas) return null;
    // A still face is the same picture wherever it shows: kept, never recorded again on the next mount.
    if (at === STILL_T) return kept(stills, key, () => facePicture(face, STILL_T));
    return facePicture(face, at);
  }, [showCanvas, at, key, face]);
  const label = name
    ? tr(mode === "run" ? "mobile.a11y.agentWorking" : "mobile.a11y.agent", { name })
    : tr("mobile.a11y.agentPlain");
  const box = { position: "absolute", width: size, height: size } as const;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        { width: size, height: size },
        tile && {
          borderRadius: radius ?? size * 0.3,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.line,
        },
      ]}
    >
      {image && showImage ? (
        <Image
          source={{ uri: image }}
          recyclingKey={image}
          cachePolicy="memory"
          transition={0}
          contentFit="fill"
          // Stopping: the canvas, already on the still frame, goes once the image is on screen.
          onDisplay={moving ? undefined : () => setLayer("image")}
          style={box}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {showCanvas && picture ? (
        <Canvas style={box}>
          {sky ? <Picture picture={sky} /> : null}
          <Picture picture={picture} />
        </Canvas>
      ) : null}
    </View>
  );
}

/**
 * An agent, drawn by the shared engine (`@agenteschat/ui/agent/engine`) through Skia: never any other way. Living
 * agents share one ~25 fps clock on a canvas; with reduced motion, an off-screen screen or the app in the background
 * they hold a still frame. A face that doesn't move here (`live={false}`, reduced motion) is that still frame drawn once
 * into an image, shared by every identical face, instead of a canvas of its own.
 */
export const AgentAvatar = memo(
  AgentAvatarView,
  (a, b) =>
    a.size === b.size &&
    a.mode === b.mode &&
    a.live === b.live &&
    a.name === b.name &&
    a.framed === b.framed &&
    a.expression === b.expression &&
    a.gaze === b.gaze &&
    a.bodyless === b.bodyless &&
    a.radius === b.radius &&
    a.agent.color === b.agent.color &&
    a.agent.eyes === b.agent.eyes &&
    a.agent.accessory === b.agent.accessory &&
    a.agent.id === b.agent.id,
);
