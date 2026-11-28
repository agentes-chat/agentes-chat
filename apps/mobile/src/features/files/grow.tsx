import { Image } from "expo-image";
import type { VideoThumbnail } from "expo-video";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Corners } from "@/ui/radius";
import { fitIn, frameAt, type GrowFrame, growTransforms, pulledFrame, type Rect, tileFrame } from "./grow-geometry";

/**
 * A message's picture (or a video's cover) grows out of its tile into the viewer, and shrinks back into it when the
 * viewer closes, on a layer over the whole app (`GrowLayer`, mounted once over the screens): the picture already drawn
 * in the tile, from the tile's box to its whole box on the screen as the black comes up under it; at the end the
 * viewer is pushed under the layer with no animation, and the layer goes once the viewer has drawn the same picture
 * in the same place. Closing, the layer takes the picture where the viewer leaves it (a pull's place, or whole), the
 * viewer goes at once, and the picture shrinks into its tile, measured again. Where the system's zoom opens the viewer
 * (`MediaLink`, iOS 18 and later) this isn't used. Not with reduced motion: the viewer fades in, as before.
 */

/** What the layer draws: a picture's source (the tile's own, from the image cache) or a video's cover. */
export type GrowPicture = { uri: string; headers?: Record<string, string>; cacheKey?: string } | VideoThumbnail;

/** One spring for both ways, settling without overshoot; lighter on Android, as its frames come faster. */
const SPRING = { mass: Platform.OS === "ios" ? 1.25 : 0.75, damping: 300, stiffness: 800, overshootClamping: true };
/** The viewer has this long to draw its picture under the layer before the layer goes anyway. */
const READY_WAIT_MS = 700;
/** The layer's fade once the viewer has the picture (or when a tile is gone). */
const FADE = { duration: 120 };
/** Starting as soon as the layer's picture is drawn, at the latest after this. */
const DRAWN_WAIT_MS = 150;

// ── Tiles ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Tile {
  measure: (done: (rect: Rect | null) => void) => void;
}
const tiles = new Map<string, Tile>();
/** The tile whose picture is out on the layer: hidden, so the picture seems lifted off it. */
let lifted: string | null = null;
const liftListeners = new Set<() => void>();
function setLifted(key: string | null) {
  lifted = key;
  for (const listener of liftListeners) listener();
}
const subscribeLift = (listener: () => void) => {
  liftListeners.add(listener);
  return () => {
    liftListeners.delete(listener);
  };
};

/**
 * A tile a picture grows out of, under the viewer page's key (`pictureKey` with `viewerVersion`): `ref` goes on the
 * view that shows the picture (not collapsed, so it can be measured), `hidden` while its picture is out on the layer.
 */
export function useGrowTile(key: string | null) {
  const ref = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!key) return;
    const tile: Tile = {
      measure: (done) => {
        const view = ref.current;
        if (!view) {
          done(null);
          return;
        }
        view.measureInWindow((x, y, width, height) => done(width > 0 && height > 0 ? { x, y, width, height } : null));
      },
    };
    tiles.set(key, tile);
    return () => {
      if (tiles.get(key) === tile) tiles.delete(key);
    };
  }, [key]);
  const hidden = useSyncExternalStore(subscribeLift, () => key !== null && lifted === key);
  return { ref, hidden };
}

// ── The layer ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Shown {
  picture: GrowPicture;
  whole: Rect;
  /** The tile's corners, on screen. */
  corners: Corners | null;
  /** Once the layer's picture is drawn. */
  onDrawn: () => void;
}

interface Layer {
  /** Draws `shown` at `from`, then (once drawn) moves it to `to` as the black goes from `dimFrom` to `dimTo`. */
  run(shown: Omit<Shown, "onDrawn">, from: GrowFrame, to: GrowFrame, dim: [number, number], hooks: Hooks): void;
  /** Fades the layer out and clears it. */
  fadeOut(done?: () => void): void;
  /** Clears it at once (the picture landed on its tile, which shows it again in the same frame). */
  clear(): void;
}
interface Hooks {
  /** The picture is on the layer (the tile may hide, the viewer may go). */
  drawn?: () => void;
  /** The move ended. */
  done?: () => void;
  /** Moves only once something else says so (closing: once the tile is measured again). */
  hold?: boolean;
}
let layer: Layer | null = null;
/** A held run's move, given its target once the tile is measured again. */
let release: ((to: GrowFrame) => void) | null = null;

const NONE: GrowFrame = { rect: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 };

/** The layer over the screens, mounted once (`AppLayout`). Nothing and no touches while no picture is out. */
export function GrowLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const from = useSharedValue<GrowFrame>(NONE);
  const to = useSharedValue<GrowFrame>(NONE);
  const whole = useSharedValue<Rect>(NONE.rect);
  const t = useSharedValue(0);
  const dim = useSharedValue<[number, number]>([0, 0]);
  const shownOpacity = useSharedValue(0);
  // The tile's corners at the tile's end of the move (0 at the whole picture's).
  const corners = useSharedValue<[number, number, number, number]>([0, 0, 0, 0]);
  const opening = useSharedValue(true);
  useEffect(() => {
    layer = {
      run(next, a, b, [d0, d1], hooks) {
        whole.value = next.whole;
        from.value = a;
        to.value = b;
        t.value = 0;
        dim.value = [d0, d1];
        opening.value = d1 > d0;
        const c = next.corners;
        corners.value = c
          ? [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius]
          : [0, 0, 0, 0];
        shownOpacity.value = 1;
        let started = false;
        const move = (target?: GrowFrame) => {
          if (target) {
            from.value = frameAt(from.value, to.value, t.value);
            to.value = target;
            t.value = 0;
          }
          t.value = withSpring(1, SPRING, (finished) => {
            if (finished && hooks.done) scheduleOnRN(hooks.done);
          });
        };
        const start = () => {
          if (started) return;
          started = true;
          hooks.drawn?.();
          if (hooks.hold) release = (target) => move(target);
          else move();
        };
        setShown({ ...next, onDrawn: start });
        setTimeout(start, DRAWN_WAIT_MS);
      },
      clear() {
        release = null;
        shownOpacity.value = 0;
        setShown(null);
      },
      fadeOut(done) {
        release = null;
        shownOpacity.value = withTiming(0, FADE, (finished) => {
          if (finished)
            scheduleOnRN(() => {
              setShown(null);
              done?.();
            });
        });
      },
    };
    return () => {
      layer = null;
    };
  }, [from, to, whole, t, dim, shownOpacity, corners, opening]);

  const black = useAnimatedStyle(() => {
    const [d0, d1] = dim.value;
    const d = Math.max(0, d0 + (d1 - d0) * t.value);
    return { opacity: shownOpacity.value * Math.sqrt(d) };
  });
  const windowStyle = useAnimatedStyle(() => {
    const frame = frameAt(from.value, to.value, t.value);
    const m = growTransforms(frame, whole.value);
    // The tile's corners at its end, square at the whole picture's, in the window's own units (it is stretched).
    const toward = opening.value ? 1 - t.value : t.value;
    const unit = Math.max(0.0001, Math.min(m.window.scaleX, m.window.scaleY));
    const [tl, tr, br, bl] = corners.value;
    return {
      opacity: shownOpacity.value,
      borderTopLeftRadius: (tl * toward) / unit,
      borderTopRightRadius: (tr * toward) / unit,
      borderBottomRightRadius: (br * toward) / unit,
      borderBottomLeftRadius: (bl * toward) / unit,
      transform: [
        { translateX: m.window.translateX },
        { translateY: m.window.translateY },
        { scaleX: m.window.scaleX },
        { scaleY: m.window.scaleY },
      ],
    };
  });
  const pictureStyle = useAnimatedStyle(() => {
    const m = growTransforms(frameAt(from.value, to.value, t.value), whole.value);
    return { transform: [{ scaleX: m.picture.scaleX }, { scaleY: m.picture.scaleY }] };
  });

  return (
    <View pointerEvents={shown ? "auto" : "none"} style={StyleSheet.absoluteFill}>
      {shown ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, styles.black, black]} />
          <Animated.View
            style={[
              styles.window,
              { left: shown.whole.x, top: shown.whole.y, width: shown.whole.width, height: shown.whole.height },
              windowStyle,
            ]}
          >
            <Animated.View style={[StyleSheet.absoluteFill, pictureStyle]}>
              <Image
                source={shown.picture}
                contentFit="contain"
                transition={0}
                onDisplay={shown.onDrawn}
                accessible={false}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

// ── Opening and closing ─────────────────────────────────────────────────────────────────────────────────────────────

/** The viewer page waiting under the layer for its picture (`growReady`), and its time limit. */
let waiting: string | null = null;
let waitTimer: ReturnType<typeof setTimeout> | null = null;
function endWait() {
  waiting = null;
  if (waitTimer) clearTimeout(waitTimer);
  waitTimer = null;
  layer?.fadeOut(() => setLifted(null));
}

export interface GrowOpen {
  /** The viewer page's key (`pictureKey` with `viewerVersion`), the tile's. */
  key: string;
  picture: GrowPicture | null;
  /** The picture's shape (width over height); null when not known yet. */
  aspect: number | null;
  corners?: Corners | null | undefined;
  /** Opens the viewer (pushed with no animation: the layer is over it). */
  open: () => void;
  reduced: boolean;
}

/**
 * Opens the viewer from a tile with the picture growing out of it; or straight away (the viewer's fade) when there is
 * no layer, no tile on screen, no picture yet, or reduced motion.
 */
export function growOpen({ key, picture, aspect, corners, open, reduced }: GrowOpen, fallback: () => void) {
  const tile = tiles.get(key);
  if (!layer || !tile || !picture || !aspect || reduced) {
    fallback();
    return;
  }
  tile.measure((rect) => {
    if (!rect || !layer) {
      fallback();
      return;
    }
    const screen = Dimensions.get("window");
    const whole = fitIn(aspect, screen);
    layer.run({ picture, whole, corners: corners ?? null }, tileFrame(rect, whole), { rect: whole, scale: 1 }, [0, 1], {
      drawn: () => setLifted(key),
      done: () => {
        open();
        waiting = key;
        waitTimer = setTimeout(endWait, READY_WAIT_MS);
      },
    });
  });
}

/** A viewer page drew its picture (or its video's cover): the layer over it goes, if it was waiting for that page. */
export function growReady(key: string) {
  if (waiting === key) endWait();
}

export interface GrowClose {
  key: string;
  picture: GrowPicture | null;
  aspect: number | null;
  corners?: Corners | null | undefined;
  /** Where a pull left the picture (from the screen's middle, and its scale); whole when not given. */
  pulled?: { x: number; y: number; scale: number } | undefined;
  /** How dark the black behind it is now (0 to 1). */
  dim: number;
  /** Closes the viewer (popped with no animation: the layer is over it). */
  close: () => void;
  reduced: boolean;
}

/**
 * Closes the viewer with its picture shrinking back into its tile. False when it can't (no layer, no picture, no tile
 * registered, reduced motion): the caller closes its own way.
 */
export function growClose({ key, picture, aspect, corners, pulled, dim, close, reduced }: GrowClose): boolean {
  if (!layer || !picture || !aspect || reduced || !tiles.has(key)) return false;
  const screen = Dimensions.get("window");
  const whole = fitIn(aspect, screen);
  const start = pulled ? pulledFrame(whole, { x: pulled.x, y: pulled.y }, pulled.scale) : { rect: whole, scale: 1 };
  layer.run({ picture, whole, corners: corners ?? null }, start, start, [dim, 0], {
    hold: true,
    drawn: () => {
      setLifted(key);
      // The picture is on the layer: the viewer goes from under it, and its conversation comes back with the tile.
      close();
      // Measured once the conversation is laid out again (two frames), the picture shrinks into the tile.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const tile = tiles.get(key);
          if (!tile || !release) {
            layer?.fadeOut(() => setLifted(null));
            return;
          }
          tile.measure((rect) => {
            if (!rect || !release) {
              layer?.fadeOut(() => setLifted(null));
              return;
            }
            const go = release;
            release = null;
            go(tileFrame(rect, whole));
          });
        }),
      );
    },
    // Landed on the tile: the tile shows the picture again and the layer goes in the same frame, no fade between.
    done: () => {
      setLifted(null);
      layer?.clear();
    },
  });
  return true;
}

const styles = StyleSheet.create({
  black: { backgroundColor: "#000" },
  window: { position: "absolute", overflow: "hidden" },
});
