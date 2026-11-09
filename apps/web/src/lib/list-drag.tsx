import { prefersReducedMotion } from "@agenteschat/ui";
import {
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Reordering lists by dragging (the sidebar's parts, tools, channels, categories and agents, the agents in the org
 * chart's setores). The dragged row hides and a dashed spot of its own size (`DropSpot`) stands where it would land;
 * the rows around it slide to make room, as they do when the keys or a menu move one (`slideFrom`). Dropped, the spot
 * keeps its place until the list's data has the move, so the row shows up right there instead of going back first.
 */

const SLIDE_MS = 180;
const EASE = "cubic-bezier(.2,.8,.2,1)";
/** A drop the data never takes (a refused save) stops holding its spot after this. */
const HOLD_MS = 1500;
/** Where the rows were stays noted this long for a change that moves none of them yet (a save on its way). */
const NOTE_MS = 1000;

let noted: { at: number; rects: Map<string, DOMRect> } | null = null;

/** Moving a focused row one place up or down, in every list that reorders. */
export const MOVE_KEYS = "Alt+Shift+ArrowUp Alt+Shift+ArrowDown";

/** -1 or 1 for Alt+Shift+↑ or ↓, else null (an arrow alone is the page's). */
export const moveKey = (e: KeyboardEvent): -1 | 1 | null =>
  !e.altKey || !e.shiftKey ? null : e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : null;

/** A row moved by the keys keeps the focus: React moves its node, which blurs whatever was focused in it. */
export function keepFocus(el: HTMLElement) {
  window.setTimeout(() => {
    if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
  }, 0);
}

/**
 * Notes where every row that can slide (`[data-slide]`) is, for the next commit that moves any of them; a row hidden
 * while it is dragged comes from its spot (`[data-spot-for]`).
 */
export function slideFrom() {
  if (typeof document === "undefined") return;
  const rects = new Map<string, DOMRect>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-slide]")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) rects.set(el.dataset.slide ?? "", r);
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-spot-for]"))
    rects.set(el.dataset.spotFor ?? "", el.getBoundingClientRect());
  noted = { at: Date.now(), rects };
}

/**
 * In a component whose renders move rows: after a commit that moved what `slideFrom` noted, each row slides from
 * where it was, one inside a row that slides as well only its own part of the way.
 */
export function useSlides() {
  useLayoutEffect(() => {
    const was = noted;
    if (!was) return;
    if (Date.now() - was.at > NOTE_MS) {
      noted = null;
      return;
    }
    const rows = [...document.querySelectorAll<HTMLElement>("[data-slide]")];
    // Measured where they land, not where a slide still running has them.
    for (const el of rows) for (const a of el.getAnimations?.() ?? []) if (a.id === "slide") a.cancel();
    const moved = new Map<Element, number>();
    for (const el of rows) {
      const from = was.rects.get(el.dataset.slide ?? "");
      const to = el.getBoundingClientRect();
      if (from && to.height > 0 && Math.abs(from.top - to.top) >= 1) moved.set(el, from.top - to.top);
    }
    if (moved.size === 0) return;
    noted = null;
    if (prefersReducedMotion()) return;
    for (const [el, dy] of moved) {
      const outer = el.parentElement?.closest("[data-slide]");
      const own = dy - ((outer && moved.get(outer)) ?? 0);
      if (Math.abs(own) >= 1 && typeof el.animate === "function")
        el.animate([{ transform: `translateY(${own}px)` }, { transform: "none" }], {
          id: "slide",
          duration: SLIDE_MS,
          easing: EASE,
        });
    }
  });
}

export interface ListDrag<M> {
  /** The dragged row's key (its `data-slide`). */
  key: string;
  /** Its height, the spot's. */
  height: number;
  /** Where it would land; null: where it is. */
  mark: M | null;
  /** Hidden behind its spot, a moment after the drag starts: hidden at once, the browser would drop the drag. */
  lifted: boolean;
  /** Dropped: its spot stays until the list's data has the move. */
  held: boolean;
}

/**
 * One list's drag: the row that moves (`begin`), where it would land (`over`), the drop (`drop`) and its end. `data` is
 * what the list is drawn from, as a value that changes with its order: a new one ends a held drop.
 */
export function useListDrag<M>(data: unknown, same: (a: M, b: M) => boolean) {
  const [drag, setDrag] = useState<ListDrag<M> | null>(null);
  const ref = useRef(drag);
  const put = (next: ListDrag<M> | null) => {
    ref.current = next;
    setDrag(next);
  };
  const finish = () => {
    if (!ref.current) return;
    slideFrom();
    put(null);
  };
  // The data has the move: the row shows where its spot was, before this frame paints.
  const seen = useRef(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new `data` ends a held drop
  useLayoutEffect(() => {
    if (seen.current === data) return;
    seen.current = data;
    if (ref.current?.held) finish();
  }, [data]);
  const held = drag?.held ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a held drop's own timer
  useEffect(() => {
    if (!held) return;
    const timer = window.setTimeout(finish, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [held]);
  // A drag that ends anywhere else (outside the list, Esc) puts the row back.
  const dragging = drag !== null && !held;
  // biome-ignore lint/correctness/useExhaustiveDependencies: listening while a drag runs
  useEffect(() => {
    if (!dragging) return;
    const done = () => {
      if (ref.current && !ref.current.held) finish();
    };
    window.addEventListener("dragend", done);
    return () => window.removeEventListener("dragend", done);
  }, [dragging]);
  useSlides();
  const live = drag && !drag.held ? drag : null;
  return {
    drag,
    /** The key being dragged now, for the handlers: set at once, before React draws it. */
    current: () => (ref.current && !ref.current.held ? ref.current.key : null),
    /** Where it would land, while it moves (a row's `data-drop`). */
    marked: live?.mark ?? null,
    /** Whether `key`'s row is out of the list behind its spot. */
    hides: (key: string) => Boolean(drag?.lifted && drag.key === key),
    begin(key: string, row: Element) {
      put({ key, height: row.getBoundingClientRect().height, mark: null, lifted: false, held: false });
      window.setTimeout(() => {
        const d = ref.current;
        if (d?.key === key && !d.lifted) put({ ...d, lifted: true });
      }, 0);
    },
    /** Where it would land now (null: where it is). */
    over(mark: M | null) {
      const d = ref.current;
      if (!d || d.held) return;
      if (d.mark === mark || (d.mark !== null && mark !== null && same(d.mark, mark))) return;
      slideFrom();
      put({ ...d, mark });
    },
    /** Where it lands, read at the drop. */
    mark: () => ref.current?.mark ?? null,
    /** Dropped: `moved` holds the spot until the data has it; nothing to move puts the row back at once. */
    drop(moved: boolean) {
      const d = ref.current;
      if (!d) return;
      if (moved) put({ ...d, held: true });
      else finish();
    },
    /** The drag ended without a drop on the list. */
    end() {
      if (ref.current && !ref.current.held) finish();
    },
    /** Whether the spot stands at `mark` (null: in the row's own place). */
    spotAt(mark: M | null) {
      const d = drag;
      if (!d?.lifted) return false;
      return d.mark === null || mark === null ? d.mark === mark : same(d.mark, mark);
    },
  };
}

export type ListDragOf<M> = ReturnType<typeof useListDrag<M>>;

/**
 * The dashed spot where a dragged row would land, as tall as the row. The pointer over it changes nothing; a drop on
 * it lands where it stands (`onDrop`, else the list's own drop around it).
 */
export function DropSpot({ drag, onDrop }: { drag: ListDrag<unknown>; onDrop?: (e: DragEvent) => void }) {
  return (
    <div
      className="drop-spot"
      data-slide="spot"
      data-spot-for={drag.key}
      aria-hidden="true"
      style={{ height: drag.height }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDrop}
    />
  );
}

/**
 * `rows` with a drag's spot among them: `at` counts the rows without the one dragged (`lifted`, still drawn, hidden by
 * its `data-lifted`); null, no spot here.
 */
export function withSpot<T extends { id: string }>(
  rows: readonly T[],
  drag: ListDrag<unknown> | null,
  at: number | null,
  lifted: string | null,
  render: (row: T) => ReactNode,
) {
  const others = rows.filter((r) => r.id !== lifted);
  const spot = at !== null && drag ? <DropSpot drag={drag} /> : null;
  return (
    <>
      {rows.map((r) => (
        <Fragment key={r.id}>
          {at === others.indexOf(r) && spot}
          {render(r)}
        </Fragment>
      ))}
      {at !== null && at >= others.length && spot}
    </>
  );
}
