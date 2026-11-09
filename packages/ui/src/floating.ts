/**
 * Room every floating layer (menu, list, popover, hover card, tooltip) keeps from the viewport's edges: `--space-3`.
 * `.ac-popover, .ac-menu--dropdown` in `styles/components.css` cap their width at twice this.
 */
export const EDGE_ROOM = 12;

/** How far a tip (`Tip`) stands from the element it is about. */
export const TIP_GAP = 6;

/**
 * Where a tip goes in the window (`Tip`): `TIP_GAP` over its element, under it when the window has no room over it, its
 * start, middle or end on the element's, moved along only as far as it takes to stay `EDGE_ROOM` inside the window, and
 * inside `within` too when given (a list's ⓘ keeps that room from the list's edges).
 */
export function placeTip(
  anchor: { left: number; top: number; right: number; bottom: number },
  tip: { width: number; height: number },
  align: "start" | "center" | "end",
  windowWidth: number,
  within?: { left: number; right: number },
) {
  const x =
    align === "start"
      ? anchor.left
      : align === "end"
        ? anchor.right - tip.width
        : (anchor.left + anchor.right - tip.width) / 2;
  const over = anchor.top - TIP_GAP - tip.height;
  const min = Math.max(EDGE_ROOM, (within?.left ?? 0) + EDGE_ROOM);
  const max = Math.min(windowWidth, within?.right ?? windowWidth) - EDGE_ROOM - tip.width;
  return {
    left: Math.max(min, Math.min(x, max)),
    top: over >= EDGE_ROOM ? over : anchor.bottom + TIP_GAP,
  };
}

/**
 * An open list joined to its trigger, one shape: the sides that meet are square (`data-join` on both, the side it
 * opened on), and where the list reaches past the trigger's edge its own corner stays round (`data-wide`). Follows a
 * list that flips side. Returns what undoes it, for when the list closes.
 */
export function joinList(list: HTMLElement, trigger: HTMLElement | null | undefined): () => void {
  if (!trigger) return () => {};
  const apply = () => {
    const side = list.dataset.side === "top" || list.dataset.side === "bottom" ? list.dataset.side : null;
    if (!side) {
      delete trigger.dataset.join;
      delete list.dataset.join;
      return;
    }
    trigger.dataset.join = side;
    list.dataset.join = side;
    const t = trigger.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const start = l.left < t.left - 0.5;
    const end = l.right > t.right + 0.5;
    list.dataset.wide = start && end ? "both" : start ? "start" : end ? "end" : "";
  };
  apply();
  const watch = new MutationObserver(apply);
  watch.observe(list, { attributes: true, attributeFilter: ["data-side"] });
  return () => {
    watch.disconnect();
    delete trigger.dataset.join;
  };
}

/**
 * How far a popover moves over its trigger to show whole: a card taller than the room on its side (its height clamped to
 * that room, and still overflowing) gains what it lacks over `base`, the room it had before moving, up to the whole
 * window between the edges. 0 for one that fits, or that its own cap clamps (a menu's 280px scrolls where it is).
 * Measured from `base`, not from the room now: one that already moved but isn't placed again yet asks the same, not more.
 */
export function pullToFit(box: {
  scroll: number;
  client: number;
  height: number;
  room: number;
  base: number;
  window: number;
}) {
  if (box.scroll <= box.client || !(box.height >= box.room - 1)) return 0;
  const natural = box.scroll + box.height - box.client;
  return Math.max(0, Math.ceil(Math.min(natural - box.base, box.window - 2 * EDGE_ROOM - box.base)));
}
