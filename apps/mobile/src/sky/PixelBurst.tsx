import { type AgentColorName, bodyTones } from "@agenteschat/ui/agent/engine";
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { Easing, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/ui/theme";
import { paletteUniform } from "./math";

/**
 * A burst of square pixels in an agent's tones, thrown up from a point and falling: the app's one big effect, kept for
 * the moments that unblock work (a request approved, an agent created). It plays once, in under a second, and takes
 * itself away. Time runs on the UI thread and one shader draws every pixel, so it costs the JS thread nothing.
 */

/** Points per pixel of the burst (the web's). */
const PIXEL = 3;
/** How long it plays. */
const BURST_MS = 900;
/** The most pixels a burst throws (the shader's array). */
const MAX_PARTS = 48;
/** Where the pixels start, as a share of the canvas's height: most of the room is above, where they go. */
const ORIGIN_Y = 0.7;

const SIZES = {
  lg: { count: 48, width: 300, height: 240, speed: 1 },
  sm: { count: 16, width: 132, height: 108, speed: 0.45 },
} as const;

export type BurstSize = keyof typeof SIZES;

/**
 * Each pixel is (vx, vy, life, tone) in cells and seconds: it leaves the origin at that speed, the air slows it (as the
 * web's 0.96 a frame), gravity pulls it down, and it fades over its last moments. `tone` is its color's index, plus a
 * half when it is two cells wide. Arrays are only read with loop indices (SkSL rule).
 */
const SOURCE = `
uniform float px;
uniform float t;
uniform float n;
uniform float2 origin;
uniform float4 pal[8];
uniform float4 parts[48];

float4 tone(float idx) {
  float4 c = pal[0];
  for (int i = 1; i < 8; i++) {
    if (abs(float(i) - idx) < 0.5) c = pal[i];
  }
  return c;
}

half4 main(float2 pos) {
  float x = floor(pos.x / px);
  float y = floor(pos.y / px);
  float e = (1.0 - exp(-2.45 * t)) / 2.45;
  float4 hit = float4(0.0);
  for (int i = 0; i < 48; i++) {
    float4 p = parts[i];
    float rest = p.z - t;
    if (float(i) < n && rest > 0.0) {
      float cx = floor(origin.x + p.x * e + 0.5);
      float cy = floor(origin.y + p.y * e + 18.0 * t * t + 0.5);
      float side = fract(p.w) > 0.25 ? 2.0 : 1.0;
      if (x >= cx && x < cx + side && y >= cy && y < cy + side) {
        float a = clamp(rest * 2.2, 0.0, 1.0);
        hit = float4(tone(floor(p.w)).rgb * a, a);
      }
    }
  }
  return half4(hit);
}
`;

let effect: SkRuntimeEffect | null | undefined;

/** The compiled shader (compiled once; null if the device refuses it: then nothing bursts). */
function burstEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    try {
      effect = Skia.RuntimeEffect.Make(SOURCE);
    } catch {
      effect = null;
    }
    if (!effect) console.warn("the pixel burst's shader did not compile");
  }
  return effect ?? null;
}

/** The pixels of one burst, as the shader's `parts[48]` (flat, padded): thrown mostly up, each with its own life. */
function particles(count: number, speed: number, tones: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < MAX_PARTS; i++) {
    if (i >= count) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const v = (20 + Math.random() * 70) * speed;
    const life = (BURST_MS / 1000) * (0.5 + Math.random() * 0.5);
    const tone = Math.floor(Math.random() * Math.max(1, tones));
    out.push(Math.cos(angle) * v, Math.sin(angle) * v, life, tone + (Math.random() < 0.15 ? 0.5 : 0));
  }
  return out;
}

/** An agent's tones for its burst, deep to light, plus white (the web's). */
export function burstTones(color?: AgentColorName | string | null): string[] {
  return [...bodyTones(color ?? undefined).slice(1), "#ffffff"];
}

export interface PixelBurstProps {
  /** Where the pixels start, in the parent's own coordinates (the parent must not clip). */
  at: { x: number; y: number };
  /** The pixels' colors (`burstTones`). */
  tones: readonly string[];
  /** `lg` for the moment itself; `sm` a third as many pixels, closer in. */
  size?: BurstSize;
  /** It ended (or could not play): take it away. */
  onDone?: () => void;
}

/** One burst, absolutely placed around `at` in its parent; it never takes a touch. */
export function PixelBurst({ at, tones, size = "lg", onDone }: PixelBurstProps) {
  const reduced = useReducedMotion();
  const shader = burstEffect();
  const s = SIZES[size];
  const [parts] = useState(() => particles(s.count, s.speed, tones.length));
  const t = useSharedValue(0);
  const done = useRef(onDone);
  done.current = onDone;
  const live = !reduced && shader !== null && tones.length > 0;
  useEffect(() => {
    const finish = () => done.current?.();
    if (!live) {
      finish();
      return;
    }
    t.value = withTiming(BURST_MS / 1000, { duration: BURST_MS, easing: Easing.linear }, (ended) => {
      if (ended) scheduleOnRN(finish);
    });
  }, [live, t]);
  const { pal } = paletteUniform(tones);
  const base = {
    px: PIXEL,
    n: s.count,
    origin: [s.width / PIXEL / 2, (s.height * ORIGIN_Y) / PIXEL],
    pal,
    parts,
  };
  const uniforms = useDerivedValue(() => ({ ...base, t: t.value }));
  if (!live || !shader) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.burst,
        {
          left: Math.round(at.x - s.width / 2),
          top: Math.round(at.y - s.height * ORIGIN_Y),
          width: s.width,
          height: s.height,
        },
      ]}
    >
      <Canvas style={{ width: s.width, height: s.height }}>
        <Fill>
          <Shader source={shader} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

/** Anything that can say where it is in the window (a view). */
interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/** Where bursts are fired from: a card's decision aims it at itself when pressed, and fires once it went through. */
export interface BurstHost {
  /** The next burst starts at this view's center (read now: the view may be gone when the action goes through). */
  aim(target: Measurable | null): void;
  /** Bursts from where it was aimed, in the agent's tones. False when nothing played (reduced motion, never aimed). */
  fire(color?: AgentColorName | string | null, size?: BurstSize): boolean;
}

const BurstContext = createContext<BurstHost | null>(null);

export const BurstProvider = BurstContext.Provider;

/** The burst host around this view, if any (a card outside one fires nothing). */
export const useBurst = () => useContext(BurstContext);

interface Fired {
  id: number;
  at: { x: number; y: number };
  tones: string[];
  size: BurstSize;
}

/**
 * A place for bursts over a card or a screen's content: `layer` goes last inside a parent that doesn't clip (it sits
 * at the parent's top left and draws over its siblings), `burst` to whoever fires (`BurstProvider`). The bursts live
 * in the host, so what started one may fold or leave while it plays.
 */
export function useBurstHost(): { burst: BurstHost; layer: ReactNode } {
  const reduced = useReducedMotion();
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const spot = useRef<{ x: number; y: number } | null>(null);
  const next = useRef(0);
  const [fired, setFired] = useState<Fired[]>([]);
  const burst = useMemo<BurstHost>(
    () => ({
      aim(target) {
        const origin = anchor.current;
        if (!target || !origin) return;
        target.measureInWindow((x, y, width, height) => {
          origin.measureInWindow((ox, oy) => {
            spot.current = { x: x + width / 2 - ox, y: y + height / 2 - oy };
          });
        });
      },
      fire(color, size = "lg") {
        const at = spot.current;
        if (reduced || !at) return false;
        next.current += 1;
        const id = next.current;
        setFired((list) => [...list, { id, at, size, tones: burstTones(color) }]);
        return true;
      },
    }),
    [reduced],
  );
  const drop = useCallback((id: number) => setFired((list) => list.filter((b) => b.id !== id)), []);
  const layer = (
    <View ref={anchor} collapsable={false} pointerEvents="none" style={styles.anchor}>
      {fired.map((b) => (
        <PixelBurst key={b.id} at={b.at} tones={b.tones} size={b.size} onDone={() => drop(b.id)} />
      ))}
    </View>
  );
  return { burst, layer };
}

const styles = StyleSheet.create({
  burst: { position: "absolute" },
  // A point at the parent's top left: bursts are placed from it and overflow it.
  anchor: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
});
