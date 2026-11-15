import {
  type CountedPointer,
  CURSOR_FLIP_AT,
  CURSOR_IDLE_MS,
  type CursorSpot,
  type PointerView,
  pointerInView,
  pointerShare,
} from "@agenteschat/client";
import { fitScale, type Size } from "./screen-view";

/** How a box shows the picture, and the box's size: the edges that would cut the arrow's name. */
export type PointerBox = PointerView & { boxWidth: number; boxHeight: number };

/** Points from the tip to the bottom of the name's tag hung below the arrow (its offset, height and shadow). */
export const TAG_BELOW = 48;

/**
 * What the agent's arrow does for one gesture: where it goes, its rings, only its face while typing, the name turned
 * left where the tip lands past 0.74 of the box and lifted above the arrow where the box's bottom would cut it, both
 * by where the tip lands in the box (a pinch and a pan move the picture under it). Null for a gesture over by `now`:
 * a view shown again later (a card opened, control handed back) never replays it.
 */
export function pointerStep(
  p: CountedPointer,
  view: PointerBox,
  now: number,
): { to: CursorSpot; presses: 0 | 1 | 2; quiet: boolean; flip: boolean; lift: boolean } | null {
  if (now - p.at > CURSOR_IDLE_MS) return null;
  const to = pointerShare(p);
  const tip = pointerInView(to, view);
  return {
    to,
    presses: p.act === "double" ? 2 : p.act === "click" ? 1 : 0,
    quiet: p.act === "type",
    flip: tip.x > CURSOR_FLIP_AT * view.boxWidth,
    lift: tip.y > view.boxHeight - TAG_BELOW,
  };
}

/** The browser card's view of the desktop: the whole screen scaled to fit, pinned at the box's top left. */
export const watchView = (box: Size, desk: Size): PointerBox => ({
  s: fitScale(box, desk),
  x: 0,
  y: 0,
  ...desk,
  boxWidth: box.width,
  boxHeight: box.height,
});
