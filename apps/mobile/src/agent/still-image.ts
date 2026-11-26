import { ImageFormat, Skia, type SkPicture } from "@shopify/react-native-skia";

/**
 * Pictures drawn once, at the screen's pixel ratio, into a PNG as a data URI: a still face shows as a plain image
 * instead of a canvas of its own (each canvas is a native surface to make and composite, again on every row mount).
 * Drawn at the device's pixels, the image is shown at 1:1 and stays crisp. Null when Skia can't make the surface.
 */
export function stillImage(pictures: readonly SkPicture[], size: number, ratio: number): string | null {
  const side = Math.max(1, Math.round(size * ratio));
  try {
    const surface = Skia.Surface.Make(side, side);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.scale(side / size, side / size);
    for (const picture of pictures) canvas.drawPicture(picture);
    surface.flush();
    const shot = surface.makeImageSnapshot();
    const png = shot.encodeToBase64(ImageFormat.PNG, 100);
    shot.dispose();
    surface.dispose();
    return png ? `data:image/png;base64,${png}` : null;
  } catch {
    return null;
  }
}
