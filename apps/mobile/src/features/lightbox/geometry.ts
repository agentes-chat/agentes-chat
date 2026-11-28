/**
 * The lightbox's geometry: where a picture is between its tile and its place on the screen, and where a pull to close
 * leaves it. All worklets, run on the UI thread each frame. Two rules keep them safe there: a helper is declared above
 * every worklet that calls it (a module's worklet captures what it calls when it is defined, so one declared below
 * would be captured as undefined), and no parameter has a default naming a value (a default is read before the
 * captured values, where that value doesn't exist).
 */

/** A box on the screen, in points. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the picture's box is moved and how much it is scaled, from its place at rest; its corners, on the screen. */
export interface Placement {
  translateX: number;
  translateY: number;
  scale: number;
  radius: number;
}

/** The picture at rest: whole in the middle of the screen, square corners. */
export const AT_REST: Placement = { translateX: 0, translateY: 0, scale: 1, radius: 0 };

/**
 * One frame's transforms: the picture's box moved and scaled (`move`), the window that crops it (`crop`, its scale
 * from the box) and the picture inside undoing that crop (`content`), so a tile's crop opens up as the picture grows.
 */
export interface Frame {
  translateX: number;
  translateY: number;
  scale: number;
  cropX: number;
  cropY: number;
  /** The window's corner radius, in its own units (it is scaled). */
  radius: number;
}

/** From the pull's start, how much a pull is (0 at rest, 1 at half a screen away). */
export const PULL_FULL = 0.5;
/** How small the picture gets at a full pull. */
export const PULL_MIN_SCALE = 0.75;
/** How closely it follows the finger, sideways and up and down, before tapering off. */
export const FOLLOW_X = 0.8;
export const FOLLOW_Y = 0.8;
/** A release slower than this (points a second) closes by distance, faster by direction. */
export const CLOSE_SPEED = 200;
/** A slow release closes past this much travel. */
export const CLOSE_DISTANCE = 100;

/** The picture of `aspect` (width over height) whole in `screen`, in its middle. */
export function fitIn(aspect: number, screen: { width: number; height: number }): Box {
  "worklet";
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : screen.width / screen.height;
  const wide = a > screen.width / screen.height;
  const width = wide ? screen.width : screen.height * a;
  const height = wide ? screen.width / a : screen.height;
  return { x: (screen.width - width) / 2, y: (screen.height - height) / 2, width, height };
}

/**
 * The part of a tile its picture shows: all of it when the picture covers it, the picture's own box inside it when it
 * is drawn whole there (`contain`).
 */
export function shownBox(tile: Box, aspect: number, contain: boolean): Box {
  "worklet";
  if (!contain) return tile;
  const inner = fitIn(aspect, tile);
  return { x: tile.x + inner.x, y: tile.y + inner.y, width: inner.width, height: inner.height };
}

/** A drag damped to start at `coefficient` of the finger and taper off, never quite reaching `limit`. */
export function rubberBand(distance: number, limit: number, coefficient: number): number {
  "worklet";
  const magnitude = Math.abs(distance);
  const damped = (1 - 1 / ((magnitude * coefficient) / limit + 1)) * limit;
  return Math.sign(distance) * damped;
}

/** How far through a pull the finger is: 0 at rest, 1 at half a screen away. */
export function pullProgress(translateY: number, screenHeight: number): number {
  "worklet";
  return Math.min(Math.abs(translateY) / (screenHeight * PULL_FULL), 1);
}

/**
 * Where the picture is for a pull of the finger: a little smaller as it goes, following it loosely sideways and more
 * closely up and down, its corners rounding to the tile's by the time letting go would close it.
 */
export function pulledPlacement(
  translateX: number,
  translateY: number,
  screen: { width: number; height: number },
  tileRadius: number,
): Placement {
  "worklet";
  const progress = pullProgress(translateY, screen.height);
  const rounding = Math.min(Math.abs(translateY) / CLOSE_DISTANCE, 1);
  return {
    translateX: rubberBand(translateX, screen.width / 2, FOLLOW_X),
    translateY: rubberBand(translateY, screen.height, FOLLOW_Y),
    scale: 1 - (1 - PULL_MIN_SCALE) * progress,
    radius: tileRadius * rounding,
  };
}

/** Whether a pull let go at `travel` and `velocity` closes: by its direction when fast, by its distance when slow. */
export function pullCloses(travel: number, velocity: number): boolean {
  "worklet";
  return Math.abs(velocity) > CLOSE_SPEED ? velocity * travel >= 0 : Math.abs(travel) > CLOSE_DISTANCE;
}

/** Between two numbers at `t` (0 at `a`). */
export function mix(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

/**
 * The picture's frame at `progress` between its tile (`tile`, 0) and `open` (1, at rest or where a pull left it), for
 * a picture of `aspect` whole in `area` (the screen, or a video's room between the bars), both boxes in the
 * lightbox's own points; the frame moves and scales the area's box about its middle. At 0 the picture covers the tile
 * exactly as the tile showed it (scaled to its cover, cropped to its box, the tile's corners); at 1 it is whole, or as
 * the pull placed it.
 */
export function frameAt(
  progress: number,
  tile: Box,
  area: Box,
  aspect: number,
  open: Placement,
  tileRadius: number,
): Frame {
  "worklet";
  const whole = fitIn(aspect, area);
  // The picture scaled to cover the tile (a whole tile has its shape: this is the tile itself).
  const cover = Math.max(tile.width / whole.width, tile.height / whole.height);
  // The tile's box in the picture's own units at that scale: the window starts there.
  const cropX = tile.width / cover / whole.width;
  const cropY = tile.height / cover / whole.height;
  const fromX = tile.x + tile.width / 2 - (area.x + area.width / 2);
  const fromY = tile.y + tile.height / 2 - (area.y + area.height / 2);
  const scale = mix(cover, open.scale, progress);
  const sx = mix(cropX, 1, progress);
  const sy = mix(cropY, 1, progress);
  // The corners as they show on the screen, undone from the scales so they read as the tile's at 0.
  const shown = mix(tileRadius, open.radius, progress);
  return {
    translateX: mix(fromX, open.translateX, progress),
    translateY: mix(fromY, open.translateY, progress),
    scale,
    cropX: sx,
    cropY: sy,
    radius: shown / Math.max(0.0001, scale * Math.min(sx, sy)),
  };
}

/** A placement as a frame (no crop), for the picture at rest or under a pull. */
export function restingFrame(placement: Placement): Frame {
  "worklet";
  return {
    translateX: placement.translateX,
    translateY: placement.translateY,
    scale: placement.scale,
    cropX: 1,
    cropY: 1,
    radius: placement.radius / Math.max(0.0001, placement.scale),
  };
}
