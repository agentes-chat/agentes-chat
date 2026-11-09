import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cursorTones } from "../agent/engine.js";
import { CURSOR, type CursorPoint, fitBox, glideMs, glidePath, type TagGap, tagSide } from "../cursor";
import { prefersReducedMotion } from "../sky/engine";

/** One step of the agent's pointer, in the screen's own pixels. */
export interface AgentCursorStep {
  /** Where it goes; none: it stays where it is (typing where the focus is). */
  x?: number;
  y?: number;
  /** Presses where it lands: 1 a click, 2 a double click. */
  presses?: number;
  /** The step in words, after the name, for a moment. */
  words?: string;
}

export interface AgentCursorHandle {
  step(step: AgentCursorStep): void;
}

/** Steps that wait while one plays: a burst keeps only its newest few. */
const WAITING_MAX = 3;
/** A hand's glide, gentle at both ends. */
const GLIDE = "cubic-bezier(0.5, 0, 0.2, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The tag's near corner from the tip (`.ac-cursor__tag` in `components.css`). */
const TAG: TagGap = { right: 15, below: 19, left: 4, above: 4 };
/** The id of the tag's size morph, apart from its turn's CSS transition. */
const MORPH = "ac-cursor-morph";
/** Room beside the tip under which the tag drops the step's words (they'd wrap a line a word), and its least width. */
const WORDS_ROOM = 200;
const NAME_ROOM = 64;

type Phase = "gone" | "on" | "rest";

type Box = { left: number; top: number; width: number; height: number };

/** Where a picture of `size` is drawn in `el` (contained, as noVNC scales a screen), in the box of `el`'s offset parent. */
export function pictureBox(el: HTMLElement, size: { width: number; height: number }): Box {
  const fit = fitBox({ width: el.clientWidth, height: el.clientHeight }, size);
  return { ...fit, left: el.offsetLeft + el.clientLeft + fit.left, top: el.offsetTop + el.clientTop + fit.top };
}

/**
 * An agent's own pointer over a picture of its screen, from its steps (`step`): Lodi's cursor, in the agent's color
 * with its face and name. It glides to each place, presses there with a ripple, says the step in words for a moment,
 * rests fainter when quiet and goes after a while; the next step brings it back where that step lands. `over` is the
 * element the picture is drawn in, contained (a sibling, so they share an offset parent), `size` the screen's own
 * pixels. Hidden (`shown` false), it drops its steps. Reduced motion: it jumps, with no press, ripple or morph. It only
 * draws: the pointer goes through it.
 */
export function AgentCursor({
  name,
  face,
  color,
  size,
  over,
  shown,
  ref,
}: {
  name: string;
  face?: ReactNode;
  /** The agent's color (`AgentColor` or a custom hex). */
  color?: string;
  size: { width: number; height: number };
  over: RefObject<HTMLElement | null>;
  shown: boolean;
  ref?: Ref<AgentCursorHandle>;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  const what = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>("gone");
  const [words, setWords] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const live = useRef({ shown: false, size, phase: "gone" as Phase, mounted: true });
  live.current.shown = shown && box !== null && box.width > 0;
  live.current.size = size;
  /** Where it stands once a step placed it, and where the step under way takes it. */
  const at = useRef<CursorPoint | null>(null);
  const bound = useRef<CursorPoint | null>(null);
  /** The tag's size as last laid out, which a change of its words morphs from. */
  const tagSize = useRef<{ width: number; height: number } | null>(null);
  const waiting = useRef<AgentCursorStep[]>([]);
  const playing = useRef(false);
  const timers = useRef<{ words?: ReturnType<typeof setTimeout>; rest?: ReturnType<typeof setTimeout> }>({});
  const tones = cursorTones(color);

  const reduced = () => prefersReducedMotion() || typeof track.current?.animate !== "function";
  const to = (p: CursorPoint) => {
    const { width, height } = live.current.size;
    return `translate(${(p.x / width) * 100}%, ${(p.y / height) * 100}%)`;
  };
  const enter = (next: Phase) => {
    live.current.phase = next;
    setPhase(next);
  };
  /**
   * Turns the tag to the side with room for it at the step's place, as wide and tall as its words make it. Where
   * neither side holds it, it wraps to the wider one; where even that is narrow (a small screen), it says only who.
   */
  const turn = () => {
    const el = tag.current;
    const pic = layer.current;
    const p = bound.current;
    if (!el || !pic || !p) return;
    const { width, height } = live.current.size;
    const room = { width: pic.offsetWidth, height: pic.offsetHeight };
    const point = { x: (p.x / width) * room.width, y: (p.y / height) * room.height };
    el.removeAttribute("data-terse");
    el.style.maxWidth = "";
    const { west } = tagSide(point, { width: el.scrollWidth, height: el.scrollHeight }, room, TAG);
    const fits = west ? point.x - TAG.left : room.width - point.x - TAG.right;
    if (el.scrollWidth > fits) {
      el.toggleAttribute("data-terse", fits < WORDS_ROOM);
      if (el.scrollWidth > fits) el.style.maxWidth = `${Math.max(fits, NAME_ROOM)}px`;
    }
    const { north } = tagSide(point, { width: el.scrollWidth, height: el.scrollHeight }, room, TAG);
    el.toggleAttribute("data-west", west);
    el.toggleAttribute("data-north", north);
  };
  /** The words go: they fade, then the tag closes on the name. */
  const unsay = () => {
    const el = what.current;
    if (!el || reduced()) return setWords("");
    el.animate([{ opacity: 0.88 }, { opacity: 0 }], {
      duration: CURSOR.wordsOutMs,
      easing: OUT,
      fill: "forwards",
    }).finished.then(
      () => {
        if (live.current.mounted) setWords("");
      },
      // Cancelled: new words came, and stay.
      () => undefined,
    );
  };
  /** Quiet from now: its words go, then it rests, then it goes. */
  const quiet = () => {
    clearTimeout(timers.current.words);
    clearTimeout(timers.current.rest);
    if (!live.current.mounted) return;
    timers.current.words = setTimeout(unsay, CURSOR.wordsMs);
    timers.current.rest = setTimeout(() => {
      enter("rest");
      timers.current.rest = setTimeout(() => enter("gone"), CURSOR.goneMs - CURSOR.restMs);
    }, CURSOR.restMs);
  };
  const ripple = (p: CursorPoint) => {
    const el = layer.current;
    if (!el) return;
    const ring = document.createElement("span");
    ring.className = "ac-cursor__ripple";
    const { width, height } = live.current.size;
    ring.style.left = `${(p.x / width) * 100}%`;
    ring.style.top = `${(p.y / height) * 100}%`;
    el.append(ring);
    ring
      .animate(
        [
          { transform: "scale(0.3)", opacity: 0.35 },
          { transform: "scale(1.5)", opacity: 0 },
        ],
        { duration: CURSOR.rippleMs, easing: OUT },
      )
      .finished.catch(() => undefined)
      .then(() => ring.remove());
  };
  const press = async (times: number, p: CursorPoint) => {
    for (let i = 0; i < times; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, CURSOR.pressGapMs));
      arrow.current?.animate([{ transform: "scale(1)" }, { transform: "scale(0.82)" }, { transform: "scale(1)" }], {
        duration: CURSOR.pressMs,
        easing: "ease-out",
      });
      ripple(p);
    }
  };
  const play = async (s: AgentCursorStep) => {
    const place = s.x !== undefined && s.y !== undefined ? { x: s.x, y: s.y } : null;
    // Typing with no place shows only where it already stands.
    if (!place && !at.current) return;
    const still = reduced();
    const from = live.current.phase === "gone" ? null : at.current;
    clearTimeout(timers.current.words);
    clearTimeout(timers.current.rest);
    enter("on");
    if (s.words) {
      for (const a of what.current?.getAnimations?.() ?? []) a.cancel();
      setWords(s.words);
    }
    if (place) {
      bound.current = place;
      turn();
      const el = track.current;
      if (el && from && !still && (from.x !== place.x || from.y !== place.y)) {
        const glide = el.animate(
          glidePath(from, place).map((p) => ({ transform: to(p) })),
          { duration: glideMs(from, place), easing: GLIDE },
        );
        await glide.finished.catch(() => undefined);
        if (live.current.shown) el.style.transform = to(place);
        glide.cancel();
      } else if (el) el.style.transform = to(place);
      at.current = place;
      if (s.presses && !still && live.current.shown) await press(s.presses, place);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: one handle; what it reads lives in refs
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
  const visible = live.current.shown;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when it shows or hides; the rest lives in refs
  useEffect(() => {
    if (visible) return;
    waiting.current = [];
    for (const a of track.current?.getAnimations?.() ?? []) a.cancel();
    clearTimeout(timers.current.words);
    clearTimeout(timers.current.rest);
    enter("gone");
  }, [visible]);
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      waiting.current = [];
      clearTimeout(timers.current.words);
      clearTimeout(timers.current.rest);
    };
  }, []);
  // The picture's box, again whenever it or what holds it changes size.
  useLayoutEffect(() => {
    const el = over.current;
    if (!el) return;
    const measure = () =>
      setBox((was) => {
        const next = pictureBox(el, { width: size.width, height: size.height });
        const same =
          was &&
          was.left === next.left &&
          was.top === next.top &&
          was.width === next.width &&
          was.height === next.height;
        return same ? was : next;
      });
    measure();
    if (typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (el.parentElement) watch.observe(el.parentElement);
    return () => watch.disconnect();
  }, [over, size.width, size.height]);
  // New words: the tag turns to where they fit, morphs from its last size to theirs and the words fade in, so
  // nothing on it jumps; their going morphs it back to the name.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the words change; the rest lives in refs
  useLayoutEffect(() => {
    const el = tag.current;
    if (!el) return;
    // Only a morph of its own (its size, measured next): the turn's transition goes on.
    for (const a of el.getAnimations?.() ?? []) if (a.id === MORPH) a.cancel();
    el.removeAttribute("data-morphing");
    turn();
    const was = tagSize.current;
    const now = { width: el.offsetWidth, height: el.offsetHeight };
    tagSize.current = now;
    if (reduced() || !was || live.current.phase === "gone") return;
    if (was.width !== now.width || was.height !== now.height) {
      const morph = el.animate(
        [
          { width: `${was.width}px`, height: `${was.height}px` },
          { width: `${now.width}px`, height: `${now.height}px` },
        ],
        { duration: CURSOR.morphMs, easing: OUT },
      );
      morph.id = MORPH;
      // Meanwhile its words keep their place in one line, uncovered as it grows, never wrapped under the name.
      el.toggleAttribute("data-morphing", true);
      const settled = () => {
        if (!el.getAnimations?.().some((a) => a.id === MORPH && a.playState === "running")) {
          el.removeAttribute("data-morphing");
        }
      };
      morph.finished.then(settled, settled);
    }
    if (words) what.current?.animate([{ opacity: 0 }, { opacity: 0.88 }], { duration: CURSOR.morphMs, easing: OUT });
  }, [words]);

  return (
    <div
      ref={layer}
      className="ac-cursor"
      data-phase={phase}
      aria-hidden="true"
      // Its ripples take the arrow's color.
      style={
        box
          ? { left: box.left, top: box.top, width: box.width, height: box.height, color: tones.arrow }
          : { display: "none" }
      }
    >
      <div ref={track} className="ac-cursor__track">
        <svg ref={arrow} className="ac-cursor__arrow" viewBox="4 3 12 12" aria-hidden="true">
          <path d="m5 4 10 4.17-4.17 1.66L9.17 14 5 4Z" fill={tones.arrow} />
        </svg>
        <span ref={tag} className="ac-cursor__tag" style={{ background: tones.tag }}>
          <span className="ac-cursor__who">
            {face ? <span className="ac-cursor__face">{face}</span> : null}
            <span className="ac-cursor__name">{name}</span>
          </span>
          {words ? (
            <span ref={what} className="ac-cursor__what">
              {words}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
