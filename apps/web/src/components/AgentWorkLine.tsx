import type { WorkLine } from "@agenteschat/client/lib/agent-work";
import { cx } from "@agenteschat/ui";
import { type CSSProperties, useRef } from "react";
import { useFitStep } from "@/hooks/useFitStep";

/**
 * An agent's work in a list's line (ADR 0084 addendum of 2026-11-13): its status as a badge in the state's colour
 * ("Working" in the agent's own, "Waiting on you" in amber, a wait or a return in the neutral plate), then its time
 * as plain text. Short of room it drops the time, then says its short form ("Waiting"); only a short form that still
 * doesn't fit ends in "…". The badge turns with a small rise. `tone`: the agent's colour, for its work.
 */
export function AgentWorkLine({ line, tone, className }: { line: WorkLine; tone?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const forms = line.time ? 3 : 2;
  const step = useFitStep(ref, forms, `${line.text}|${line.time ?? ""}|${line.short}`, ".work-line__words");
  const words = step === forms - 1 && step > 0 ? line.short : line.text;
  return (
    <span
      ref={ref}
      className={cx("work-line", className)}
      data-tone={line.tone}
      style={tone ? ({ "--work-tone": tone } as CSSProperties) : undefined}
    >
      <span key={words} className="work-line__words">
        {words}
      </span>
      {/* A space for the line's words (the flex gap draws the room), so it reads "working 22 min". */}
      {line.time && step === 0 && (
        <>
          {" "}
          <span className="work-line__time">{line.time}</span>
        </>
      )}
    </span>
  );
}
