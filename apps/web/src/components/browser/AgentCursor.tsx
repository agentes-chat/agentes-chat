import {
  AGENT_ARROW,
  type CountedPointer,
  CURSOR_FLIP_AT,
  CURSOR_IDLE_MS,
  type CursorSpot,
  glideMs,
  glidePoint,
  glideStart,
} from "@agenteschat/client";
import { gradientOf } from "@agenteschat/ui";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface AgentCursorProps {
  agentId: string;
  name: string;
  /** The agent's color (its name in the palette). */
  color: string | undefined;
  /** Where its pointer last went; `n` changes with every gesture. Null draws nothing. */
  pointer: CountedPointer | null;
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
  const at = useRef<CursorSpot | null>(null);
  const [rings, setRings] = useState<{ key: number; x: number; y: number }[]>([]);
  const [look, setLook] = useState({ press: false, quiet: false, idle: false, flip: false });
  const ratio = pointer ? pointer.height / pointer.width : 1;

  const place = (p: CursorSpot) => {
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
    const from = glideStart(at.current, to);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let frame = 0;
    setLook({ press: false, quiet: false, idle: false, flip: to.x > CURSOR_FLIP_AT });
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
            {AGENT_ARROW.flatMap((row, y) =>
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
