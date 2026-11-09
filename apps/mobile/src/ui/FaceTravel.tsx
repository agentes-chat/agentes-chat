import { type NativeStackNavigationOptions, useNavigation } from "expo-router";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dimensions, Platform, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AgentAvatar } from "@/agent/AgentAvatar";
import { type AgentLookInput, lookOf } from "@/agent/looks";
import { MOTION_GATES } from "./motion-gates";
import { motion, useTheme } from "./theme";

/**
 * One agent, one face: the face in a conversation's row is the one that lands in the conversation's header, and the
 * one in the header is the one that grows into the profile's cover. A copy of the face flies over the navigator from
 * where it was to where the next screen shows it, while both real faces stay hidden; on arrival the real one shows
 * and the copy goes. Whatever fails (nobody lands, a spot can't be measured, a screen goes away mid-flight), the
 * copy fades and the real faces show: a face never stays hidden. With reduced motion nothing here runs.
 */

/** What the engine needs to draw the agent. */
export type AgentLike = AgentLookInput;

/** Where a face lives: a list's row, the conversation's header, the profile's cover. */
export type FaceRole = "row" | "pill" | "cover";

/** The face's box in window coordinates. */
export interface FaceSpot {
  x: number;
  y: number;
  size: number;
  framed: boolean;
}

export interface FaceSpotOptions {
  size: number;
  framed: boolean;
  role: FaceRole;
  /**
   * Where the face's box sits inside the measured view (default: centered in it). `null`: not laid out yet, so
   * the spot isn't measured until it is.
   */
  inset?: { x: number; y: number } | null;
}

interface Entry {
  agentId: string;
  role: FaceRole;
  measure(done: (spot: FaceSpot | null) => void): void;
  setHidden(hidden: boolean): void;
  /** The role its face flew in from: where it flies back to when its screen closes. */
  cameFrom: FaceRole | null;
  /** Where its face stood when it last flew off (window coordinates). */
  leftFrom?: FaceSpot;
}

interface Flight {
  id: number;
  agentId: string;
  agent: AgentLike;
  from: FaceSpot;
  fromRole: FaceRole | null;
  to: FaceSpot | null;
  phase: "waiting" | "flying" | "leaving";
  /** How long the copy takes to fade once it leaves. */
  fade: number;
}

/** The copy is drawn at the largest face and scaled down, so it is sharp at every size on the way. */
const BASE = 96;
/** How long a departed face waits for a screen to land it. */
const WAIT_MS = 600;
/**
 * How long a flight is on screen: the springs read as arrived well before they come to rest, so the copy hands over to
 * the real face on this clock, never on the spring's own end (that left it standing still for half a second).
 */
const FLY_MAX_MS = 460;
/** The same for the slower spring a face takes when it grows into a cover. */
const FLY_SOFT_MS = 720;
const flyMs = (from: FaceSpot, to: FaceSpot) => (to.size >= BASE && to.size > from.size ? FLY_SOFT_MS : FLY_MAX_MS);
/** The copy's fade when nobody landed it, and over the real face once it did. */
const LOST_FADE_MS = 160;
const LANDED_FADE_MS = 90;
/** Frames a landing spot is followed for after it mounts: the header lays its title out over a few. */
const TRACK_FRAMES = 24;
/** A hidden face shows again by itself after this, whatever happened to its flight. */
const HIDDEN_MAX_MS = 1800;
/** The framed and the unframed drawing cross-fade over this. */
const FRAME_MS = 200;
/** The pushed screen fades in under the flying face (iOS). */
const SCREEN_FADE_MS = 240;

let enabled = false;
let serial = 0;
let flight: Flight | null = null;
let claimant: Entry | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let origin = { x: 0, y: 0 };
const hiddenBy = new Set<Entry>();
const entries = new Map<string, Entry[]>();
const listeners = new Set<() => void>();

const keyOf = (agentId: string, role: FaceRole) => `${agentId}:${role}`;
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const current = () => flight;

function latest(agentId: string, role: FaceRole): Entry | undefined {
  const list = entries.get(keyOf(agentId, role));
  return list?.[list.length - 1];
}

const validSpot = (s: FaceSpot) => [s.x, s.y, s.size].every(Number.isFinite) && s.size > 0;

/** Wholly on screen: a face scrolled away has nowhere to fly from or to. */
function onScreen(s: FaceSpot): boolean {
  const { width, height } = Dimensions.get("window");
  return s.x >= 0 && s.y >= 0 && s.x + s.size <= width && s.y + s.size <= height;
}

const moved = (a: FaceSpot, b: FaceSpot) =>
  Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || a.size !== b.size || a.framed !== b.framed;

function hide(entry: Entry) {
  hiddenBy.add(entry);
  entry.setHidden(true);
}

function release() {
  for (const e of hiddenBy) e.setHidden(false);
  hiddenBy.clear();
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Ends whatever flies, at once: the real faces show. */
function end() {
  stopTimer();
  release();
  claimant = null;
  flight = null;
}

/** The copy fades (over the real face when it landed) and the real faces show. */
function leave(id: number, fade: number) {
  if (!flight || flight.id !== id || flight.phase === "leaving") return;
  stopTimer();
  release();
  claimant = null;
  flight = { ...flight, phase: "leaving", fade };
  timer = setTimeout(() => {
    if (flight?.id !== id) return;
    timer = null;
    flight = null;
    emit();
  }, fade + 80);
  emit();
}

const land = (id: number) => leave(id, LANDED_FADE_MS);
const lose = (id: number) => leave(id, LOST_FADE_MS);

function begin(
  agentId: string,
  agent: AgentLike,
  from: FaceSpot,
  fromRole: FaceRole | null,
  source: Entry | null,
  target: { entry: Entry; spot: FaceSpot } | null,
) {
  end();
  const id = ++serial;
  flight = {
    id,
    agentId,
    agent,
    from,
    fromRole,
    to: target?.spot ?? null,
    phase: target ? "flying" : "waiting",
    fade: LOST_FADE_MS,
  };
  if (source) hide(source);
  if (target) {
    claimant = target.entry;
    hide(target.entry);
  }
  timer = setTimeout(() => (target ? land(id) : lose(id)), target ? flyMs(from, target.spot) : WAIT_MS);
  emit();
}

/** Whether a face that mounts now for this agent and role is the one a flying copy is headed to. */
function awaits(agentId: string, role: FaceRole): boolean {
  return (
    enabled &&
    flight !== null &&
    flight.phase === "waiting" &&
    claimant === null &&
    flight.agentId === agentId &&
    flight.fromRole !== role
  );
}

/** Follows the landing spot for a few frames: the first measure sends the copy, a later one corrects its course. */
function track(entry: Entry, id: number, frame: number) {
  if (!flight || flight.id !== id || flight.phase === "leaving" || claimant !== entry) return;
  entry.measure((spot) => {
    if (!flight || flight.id !== id || flight.phase === "leaving" || claimant !== entry) return;
    if (spot && (!flight.to || moved(flight.to, spot))) {
      const first = flight.to === null;
      flight = { ...flight, to: spot, phase: "flying" };
      if (first) {
        stopTimer();
        timer = setTimeout(() => land(id), flyMs(flight.from, spot));
      }
      emit();
    }
    if (frame < TRACK_FRAMES) requestAnimationFrame(() => track(entry, id, frame + 1));
  });
}

function register(entry: Entry) {
  const key = keyOf(entry.agentId, entry.role);
  const list = entries.get(key);
  if (list) list.push(entry);
  else entries.set(key, [entry]);
  if (flight && awaits(entry.agentId, entry.role)) {
    claimant = entry;
    entry.cameFrom = flight.fromRole;
    hide(entry);
    track(entry, flight.id, 0);
  } else if (!hiddenBy.has(entry)) {
    entry.setHidden(false);
  }
}

function unregister(entry: Entry) {
  const key = keyOf(entry.agentId, entry.role);
  const list = entries.get(key);
  if (list) {
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) entries.delete(key);
  }
  hiddenBy.delete(entry);
  // Its landing place went away mid-flight: the copy has nowhere to arrive.
  if (claimant === entry && flight) lose(flight.id);
}

/** The face of a screen that closes flies back to where it came from, if that face is still there and on screen. */
function returnFrom(agentId: string, role: FaceRole) {
  if (!enabled) return;
  const source = latest(agentId, role);
  if (!source?.cameFrom) return;
  const target = latest(agentId, source.cameFrom);
  const agent = lookOf(agentId);
  if (!target || !agent) return;
  source.measure((from) => {
    if (!from || !onScreen(from)) return;
    // Where the face left from is where it returns: the screen under a closing one is mid-transition (shifted under
    // an edge swipe), so measuring it now gives a place the face is not in once the transition ends.
    const known = target.leftFrom;
    if (known) {
      begin(agentId, agent, from, role, source, { entry: target, spot: known });
      return;
    }
    target.measure((to) => {
      if (!to || !onScreen(to)) return;
      begin(agentId, agent, from, role, source, { entry: target, spot: to });
    });
  });
}

/** A back swipe let go halfway: the screen stays, so its face does too. */
function abort(agentId: string) {
  if (!flight || flight.agentId !== agentId) return;
  end();
  emit();
}

// Which pushed screens fade in under a flying face: the one pushed right after a departure, for as long as it lives
// (so it fades out under the face flying back too). Routes already seen are never picked.
let armedUntil = 0;
const fadeRoutes = new Set<string>();
const seenRoutes = new Set<string>();
const SCREEN_FADE: NativeStackNavigationOptions = { animation: "fade", animationDuration: SCREEN_FADE_MS };

const arm = () => {
  armedUntil = Date.now() + WAIT_MS;
};

/**
 * Options for a route a face can land in (the conversation, the agent's profile), by the route's key: a cross-fade
 * instead of the slide when it was pushed with a face on its way, so the flight reads. iOS only (the edge swipe back
 * keeps the system's slide); `null` everywhere else, and with reduced motion, where the route keeps its own.
 */
export function faceTravelOptions(routeKey: string): NativeStackNavigationOptions | null {
  if (Platform.OS !== "ios") return null;
  if (fadeRoutes.has(routeKey)) return SCREEN_FADE;
  const fresh = !seenRoutes.has(routeKey);
  seenRoutes.add(routeKey);
  if (!fresh || !enabled || Date.now() >= armedUntil) return null;
  armedUntil = 0;
  fadeRoutes.add(routeKey);
  return SCREEN_FADE;
}

export const faceTravel = {
  /**
   * Call right before navigating. The host draws a copy of the agent's face at `from`; the next screen that
   * registers a landing for the same agent receives it. If nobody lands within about 600 ms the copy fades out.
   */
  depart(agentId: string, agent: AgentLike, from: FaceSpot): void {
    if (!enabled || !validSpot(from)) return;
    arm();
    begin(agentId, agent, from, null, null, null);
  },
};

/**
 * A face that can receive (and send) the traveler: a ref for the view that wraps it, whether the real face should be
 * hidden while the copy flies, and `depart()` to send it onward from here (call it right before navigating).
 */
export function useFaceSpot(
  agentId: string | undefined,
  opts: FaceSpotOptions,
): { ref: RefObject<View | null>; hidden: boolean; depart(): void } {
  const { role } = opts;
  const ref = useRef<View>(null);
  const options = useRef(opts);
  useLayoutEffect(() => {
    options.current = opts;
  });
  const entry = useRef<Entry | null>(null);
  // Hidden from its first frame when a copy is on its way here: the real face never shows under the flight.
  const [hidden, setHidden] = useState(() => Boolean(agentId) && awaits(agentId ?? "", role));
  useEffect(() => {
    if (!agentId) return;
    const mine: Entry = {
      agentId,
      role,
      cameFrom: null,
      setHidden,
      measure(done) {
        const node = ref.current;
        const o = options.current;
        if (!node || o.inset === null) {
          done(null);
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
            done(null);
            return;
          }
          const at = o.inset ?? { x: (width - o.size) / 2, y: (height - o.size) / 2 };
          done({ x: x + at.x, y: y + at.y, size: o.size, framed: o.framed });
        });
      },
    };
    entry.current = mine;
    register(mine);
    return () => {
      entry.current = null;
      unregister(mine);
      setHidden(false);
    };
  }, [agentId, role]);
  // Whatever became of the flight, the face comes back.
  useEffect(() => {
    if (!hidden) return;
    const back = setTimeout(() => setHidden(false), HIDDEN_MAX_MS);
    return () => clearTimeout(back);
  }, [hidden]);
  const depart = useCallback(() => {
    const mine = entry.current;
    if (!enabled || !mine) return;
    const agent = lookOf(mine.agentId);
    if (!agent) return;
    arm();
    mine.measure((from) => {
      if (!from) return;
      mine.leftFrom = from;
      begin(mine.agentId, agent, from, mine.role, mine, null);
    });
  }, []);
  return { ref, hidden, depart };
}

/** The native stack's events this file listens to. */
interface StackEvents {
  addListener(type: "beforeRemove" | "gestureCancel", listener: () => void): () => void;
  addListener(type: "transitionStart", listener: (e: { data: { closing: boolean } }) => void): () => void;
  isFocused(): boolean;
}

/**
 * On a screen whose face flew in (`useFaceSpot` with the same agent and role): as the screen closes, the face flies
 * back to where it came from. Called by the screen itself (the header has no navigation of its own).
 */
export function useFaceReturn(agentId: string | undefined, role: FaceRole): void {
  const navigation = useNavigation<StackEvents>();
  useEffect(() => {
    if (!agentId) return;
    let sent = false;
    const go = () => {
      if (sent) return;
      sent = true;
      returnFrom(agentId, role);
    };
    const offs = [
      // Closed from code (Android's back, a button): told before the screen goes.
      navigation.addListener("beforeRemove", go),
      // Closed by the system (the bar's back button, the edge swipe): told as it starts to leave. A screen covered by
      // a push also "disappears", but by then it no longer has the focus.
      navigation.addListener("transitionStart", (e) => {
        if (!e.data.closing) sent = false;
        else if (navigation.isFocused()) go();
      }),
      navigation.addListener("gestureCancel", () => {
        sent = false;
        abort(agentId);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [navigation, agentId, role]);
}

/**
 * The flying copy, over the navigator: mount it once, after the stack, filling the screen. It takes no touches and
 * screen readers never see it.
 */
export function FaceTravelHost() {
  const { reducedMotion } = useTheme();
  const f = useSyncExternalStore(subscribe, current, current);
  const root = useRef<View>(null);
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const scale = useSharedValue(1);
  const mix = useSharedValue(0);
  const alpha = useSharedValue(0);
  const done = useSharedValue(0);

  useEffect(() => {
    enabled = MOTION_GATES.faceTravel && !reducedMotion;
    if (!enabled && flight) {
      end();
      emit();
    }
    return () => {
      enabled = false;
      end();
    };
  }, [reducedMotion]);

  const id = f?.id;
  const from = f?.from;
  const to = f?.to ?? null;
  const phase = f?.phase;
  const fade = f?.fade ?? LOST_FADE_MS;
  // A new copy stands where its face was.
  useEffect(() => {
    if (id === undefined || !from) return;
    cx.value = from.x + from.size / 2 - origin.x;
    cy.value = from.y + from.size / 2 - origin.y;
    scale.value = from.size / BASE;
    mix.value = 0;
    done.value = 0;
    alpha.value = 1;
  }, [id, from, cx, cy, scale, mix, done, alpha]);
  // It flies once its landing is known, and again if the landing moves while the next screen lays out.
  useEffect(() => {
    if (id === undefined || !from || !to) return;
    // Growing into the cover takes the slower spring.
    const spring = to.size >= BASE && to.size > from.size ? motion.soft : motion.nav;
    cx.value = withSpring(to.x + to.size / 2 - origin.x, spring);
    cy.value = withSpring(to.y + to.size / 2 - origin.y, spring);
    scale.value = withSpring(to.size / BASE, spring);
    if (to.framed !== from.framed) {
      mix.value = withTiming(1, { duration: FRAME_MS, easing: Easing.bezier(...motion.ease) });
    }
    done.value = withSpring(1, spring, (finished) => {
      if (finished) scheduleOnRN(land, id);
    });
  }, [id, from, to, cx, cy, scale, mix, done]);
  useEffect(() => {
    // Gone at once (a flight called off): the next copy never shows where this one was.
    if (id === undefined) alpha.value = 0;
    else if (phase === "leaving") {
      alpha.value = withTiming(0, { duration: fade, easing: Easing.bezier(...motion.ease) });
    }
  }, [id, phase, fade, alpha]);

  const placed = useAnimatedStyle(() => ({
    opacity: alpha.value,
    transform: [{ translateX: cx.value - BASE / 2 }, { translateY: cy.value - BASE / 2 }, { scale: scale.value }],
  }));
  const under = useAnimatedStyle(() => ({ opacity: 1 - mix.value }));
  const over = useAnimatedStyle(() => ({ opacity: mix.value }));
  const turns = f !== null && to !== null && to.framed !== f.from.framed;

  return (
    <View
      ref={root}
      collapsable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      onLayout={() => {
        // Spots are measured in the window: where this view starts in it is taken off.
        root.current?.measureInWindow((x, y) => {
          if (Number.isFinite(x) && Number.isFinite(y)) origin = { x, y };
        });
      }}
    >
      {f ? (
        <Animated.View style={[styles.copy, placed]}>
          <Animated.View style={under}>
            <AgentAvatar agent={f.agent} size={BASE} framed={f.from.framed} live={false} />
          </Animated.View>
          {turns && to ? (
            <Animated.View style={[StyleSheet.absoluteFill, over]}>
              <AgentAvatar agent={f.agent} size={BASE} framed={to.framed} live={false} />
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { position: "absolute", left: 0, top: 0, width: BASE, height: BASE },
});
