import { type CSSProperties, type HTMLAttributes, type ReactNode, useEffect, useId, useRef } from "react";
import { ORBIT_RINGS, ORBIT_SPAN, orbitColors } from "../agent/orbit-rings";
import { cx } from "../cx";
import { onScreenNow } from "../device";
import type { AgentAppearance } from "./AgentLook";

/** The glyph's half side in the overlay's units. */
const HALF = 50;

/**
 * One half of every ring, its dot riding it: the far half (`back`, drawn behind the glyph) or the near one. Each ring
 * is a circle squashed and tilted by static groups, so a plain turn (a transform, on the compositor) moves its dot
 * along the ellipse; the dot turns back as much, so it stays round.
 */
function Rings({ half, id }: { half: "back" | "front"; id: string }) {
  const box = ORBIT_SPAN * 2 * HALF;
  return (
    <svg
      className={`ac-orbit__${half}`}
      viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-${half}`} clipPathUnits="userSpaceOnUse">
          <rect x={-box} y={half === "back" ? -box : 0} width={box * 2} height={box} />
        </clipPath>
      </defs>
      {ORBIT_RINGS.map((ring, i) => {
        const rx = ring.r * HALF;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of rings
          <g key={i} className={`ac-orbit__ring ac-orbit__ring--${i + 1}`} transform={`rotate(${ring.tilt})`}>
            <g transform={`scale(1 ${ring.flat})`}>
              <g clipPath={`url(#${id}-${half})`}>
                <circle className="ac-orbit__path" r={rx} />
                <g
                  className="ac-orbit__spin"
                  style={
                    {
                      "--turn": `${ring.turn}s`,
                      "--start": `${ring.start}deg`,
                      "--dir": ring.back ? "reverse" : "normal",
                    } as CSSProperties
                  }
                >
                  <g transform={`translate(${rx} 0)`}>
                    <g className="ac-orbit__unspin">
                      <ellipse className="ac-orbit__dot" rx={4.5} ry={4.5 / ring.flat} />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * An agent at work: its glyph with two or three tilted rings orbiting it, in its colour and two neighbours of it, each
 * with a dot riding it, the far half of each ring behind the glyph and the near half in front. Only transforms move;
 * the rings hold still with reduced motion and pause off screen.
 */
export function OrbitGlyph({
  appearance,
  children,
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  /** The agent's look: its colour leads the rings. */
  appearance?: AgentAppearance;
  /** The glyph (an agent's `Avatar`). */
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const on = onScreenNow(entries);
      if (on !== undefined) el.dataset.paused = on ? "" : "true";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [lead, warm, cool] = orbitColors(appearance?.color);
  return (
    <span
      ref={host}
      className={cx("ac-orbit", className)}
      style={{ "--orbit": lead, "--orbit-2": warm, "--orbit-3": cool, ...style } as CSSProperties}
      {...rest}
    >
      <Rings half="back" id={id} />
      {children}
      <Rings half="front" id={id} />
    </span>
  );
}
