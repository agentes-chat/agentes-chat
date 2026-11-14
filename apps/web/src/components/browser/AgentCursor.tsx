import type { BrowserPointer } from "@agenteschat/client";
import { gradientOf } from "@agenteschat/ui";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** The arrow, one character a pixel: `X` its edge, `o` its body in the agent's color. */
const ARROW = [
  "X.......",
  "XX......",
  "XoX.....",
  "XooX....",
  "XoooX...",
  "XooooX..",
  "XoooooX.",
  "XooooooX",
  "XoooXXXX",
  "XoXoX...",
  "XX.XoX..",
  "....XX..",
];

/** After this long with no gesture the cursor fades; the next one brings it back where it was. */
export const CURSOR_IDLE_MS = 4000;
/** Past this share of the width the name opens to the arrow's left, so the picture's edge never cuts it. */
const FLIP_AT = 0.74;

type Spot = { x: number; y: number };

/** How long the cursor takes to cross `dist` (a share of the picture's width): 0.28 s to 0.64 s. */
export const glideMs = (dist: number) => Math.min(640, 280 + dist * 620);

/**
 * Where the cursor is `t` (0 to 1) of the way from `from` to `to`, both as shares of the picture: eased, on a
 * slight arc. `ratio` is the picture's height over its width, so the arc bends the same on any shape.
 */
export function glidePoint(from: Spot, to: Spot, t: number, ratio: number): Spot {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const dx = to.x - from.x;
  const dy = (to.y - from.y) * ratio;
  const dist = Math.hypot(dx, dy) || 1;
  const arc = Math.sin(Math.PI * e) * dist * 0.14 * (dx >= 0 ? 1 : -1);
  return {
    x: from.x + dx * e - (dy / dist) * arc,
    y: from.y + (to.y - from.y) * e + ((dx / dist) * arc) / ratio,
  };
}

interface AgentCursorProps {
  agentId: string;
  name: string;
  /** The agent's color (its name in the palette). */
  color: string | undefined;
  /** Where its pointer last went; `n` changes with every gesture. Null draws nothing. */
  pointer: (BrowserPointer & { n: number }) | null;
}

/**
 * The agent's cursor over the picture of its page (ADR 0040 §7.2): a pixel arrow in the agent's color carrying
 * its avatar and name, going to each point the computer says as the gesture starts. The page has no pointer of
 * its own (the agent's input goes straight to it), so this is drawn here, the same size whatever the picture's
 * scale. Decoration: the steps beside it say what the agent does.
 */
export function AgentCursor({ agentId, name, color, pointer }: AgentCursorProps) {
  const reduced = usePrefersReducedMotion();
  const cursor = useRef<HTMLSpanElement>(null);
  const at = useRef<Spot | null>(null);
  const [rings, setRings] = useState<{ key: number; x: number; y: number }[]>([]);
  const [look, setLook] = useState({ press: false, quiet: false, idle: false, flip: false });
  const ratio = pointer ? pointer.height / pointer.width : 1;

  const place = (p: Spot) => {
    at.current = p;
    const el = cursor.current;
    if (!el) return;
    el.style.left = `${p.x * 100}%`;
    el.style.top = `${p.y * 100}%`;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one run per gesture (`n`), reading the newest point.
  useLayoutEffect(() => {
    if (!pointer) return;
    const to = { x: pointer.x / pointer.width, y: pointer.y / pointer.height };
    // Its first gesture comes in from a little off the point, not from a corner it never was in.
    const from = at.current ?? { x: Math.min(1, to.x + 0.1), y: Math.min(1, to.y + 0.14) };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let frame = 0;
    setLook({ press: false, quiet: false, idle: false, flip: to.x > FLIP_AT });
    const arrived = () => {
      place(to);
      const ring = (delay: number) =>
        timers.push(setTimeout(() => setRings((r) => [...r, { key: pointer.n * 2 + (delay ? 1 : 0), ...to }]), delay));
      if (pointer.act === "click" || pointer.act === "double") {
        ring(0);
        setLook((l) => ({ ...l, press: true }));
        timers.push(setTimeout(() => setLook((l) => ({ ...l, press: false })), 140));
      }
      if (pointer.act === "double") ring(150);
      // While the keys go in only the avatar stays, off the field's text.
      if (pointer.act === "type") setLook((l) => ({ ...l, quiet: true }));
      timers.push(setTimeout(() => setLook((l) => ({ ...l, idle: true })), CURSOR_IDLE_MS));
    };
    const ms = glideMs(Math.hypot(to.x - from.x, (to.y - from.y) * ratio));
    if (reduced) arrived();
    else {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        if (t >= 1) return arrived();
        place(glidePoint(from, to, t, ratio));
        frame = requestAnimationFrame(step);
      };
      place(from);
      frame = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(frame);
      for (const id of timers) clearTimeout(id);
    };
  }, [pointer?.n, reduced]);

  // Rings that never ended (a hidden tab runs no animation) don't pile up.
  useEffect(() => {
    if (rings.length > 4) setRings((r) => r.slice(-2));
  }, [rings.length]);

  if (!pointer) return null;
  const [, deep] = gradientOf(color);
  const frame = {
    aspectRatio: `${pointer.width} / ${pointer.height}`,
    width: `min(100cqw, 100cqh * ${pointer.width / pointer.height})`,
    "--cursor": deep,
  } as CSSProperties;
  return (
    <span className="brw-cur-layer" aria-hidden="true">
      <span className="brw-cur-frame" style={frame}>
        {rings.map((r) => (
          <span
            key={r.key}
            className="brw-cur-ring"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
            onAnimationEnd={() => setRings((all) => all.filter((x) => x.key !== r.key))}
          />
        ))}
        <span
          ref={cursor}
          className={[
            "brw-cur",
            look.press && "is-press",
            look.quiet && "is-quiet",
            look.idle && "is-idle",
            look.flip && "is-flip",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <svg width="16" height="24" viewBox="0 0 8 12" shapeRendering="crispEdges" role="presentation">
            {ARROW.flatMap((row, y) =>
              [...row].map((c, x) =>
                c === "." ? null : (
                  <rect
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid.
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    width="1.02"
                    height="1.02"
                    className={c === "X" ? "brw-cur__edge" : "brw-cur__body"}
                  />
                ),
              ),
            )}
          </svg>
          <span className="brw-cur__who">
            <AgentAvatar agentId={agentId} name={name} size="xs" state="idle" />
            <b>{name}</b>
          </span>
        </span>
      </span>
    </span>
  );
}
