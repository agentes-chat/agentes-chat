/**
 * The geometry of a picture growing out of its tile into the viewer, and back (`grow.tsx`). Two boxes: a window (the
 * part of the picture that shows, `rect`) that goes from the tile's box to the picture's whole box on the screen, and
 * the picture in it, scaled evenly (`scale`, against its whole box) from covering the tile to its own size. A tile that
 * shows the picture whole (a message's single picture, a video's cover) has its shape, so only the scale changes; a
 * deck's square card crops it, and the window uncrops as it grows. Pure, and worklets (no default naming a constant:
 * on the UI thread a default is read before the captured values).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window and the picture's even scale at one moment. */
export interface GrowFrame {
  rect: Rect;
  scale: number;
}

/** A picture of `aspect` (width over height) whole on a `screen`, in its middle. */
export function fitIn(aspect: number, screen: { width: number; height: number }): Rect {
  "worklet";
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : screen.width / screen.height;
  const wide = a > screen.width / screen.height;
  const width = wide ? screen.width : screen.height * a;
  const height = wide ? screen.width / a : screen.height;
  return { x: (screen.width - width) / 2, y: (screen.height - height) / 2, width, height };
}

/** The scale at which the picture's whole box (`whole`) covers `tile`: a cropped tile's, or a whole one's. */
export function coverScale(tile: Rect, whole: Rect): number {
  "worklet";
  return Math.max(tile.width / whole.width, tile.height / whole.height);
}

/** The tile's frame: the window is the tile, the picture covering it. */
export const tileFrame = (tile: Rect, whole: Rect): GrowFrame => ({ rect: tile, scale: coverScale(tile, whole) });

/** The picture as the viewer shows it, pulled to `offset` and `scale` from the middle (a pull to close). */
export function pulledFrame(whole: Rect, offset: { x: number; y: number }, scale: number): GrowFrame {
  "worklet";
  const width = whole.width * scale;
  const height = whole.height * scale;
  return {
    rect: {
      x: whole.x + whole.width / 2 + offset.x - width / 2,
      y: whole.y + whole.height / 2 + offset.y - height / 2,
      width,
      height,
    },
    scale,
  };
}

const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

/** Between two frames at `t` (0 at `from`). */
export function frameAt(from: GrowFrame, to: GrowFrame, t: number): GrowFrame {
  "worklet";
  return {
    rect: {
      x: lerp(from.rect.x, to.rect.x, t),
      y: lerp(from.rect.y, to.rect.y, t),
      width: lerp(from.rect.width, to.rect.width, t),
      height: lerp(from.rect.height, to.rect.height, t),
    },
    scale: lerp(from.scale, to.scale, t),
  };
}

/**
 * The transforms that draw `frame` with views laid out at the picture's whole box (`whole`): the window's (moved to
 * its middle, stretched to its size; it clips) and the picture's inside it (stretched back, so the picture is scaled
 * evenly by `frame.scale`).
 */
export function growTransforms(frame: GrowFrame, whole: Rect) {
  "worklet";
  const sx = frame.rect.width / whole.width;
  const sy = frame.rect.height / whole.height;
  return {
    window: {
      translateX: frame.rect.x + frame.rect.width / 2 - (whole.x + whole.width / 2),
      translateY: frame.rect.y + frame.rect.height / 2 - (whole.y + whole.height / 2),
      scaleX: sx,
      scaleY: sy,
    },
    picture: { scaleX: sx > 0 ? frame.scale / sx : 1, scaleY: sy > 0 ? frame.scale / sy : 1 },
  };
}
