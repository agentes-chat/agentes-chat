import type { ImageSourcePropType } from "react-native";
import { iconSvg } from "./iconSvg";
import type { IconName } from "./icons.data";
import { rasterize } from "./tabIcons";

/**
 * A bar button's glyph in points: an `IconButton`'s, so a bar of the system's own buttons (iOS) and a bar of ours
 * (`HeaderCapsule`, a conversation's while a counted button shows) draw the same icons at the same size.
 */
const BAR_GLYPH_PT = 20;
const cache = new Map<IconName, ImageSourcePropType | null>();

/**
 * Our line icon as a template image for a native bar button (iOS): the system places the button and takes its tap,
 * our icon is what it shows, in the bar's tint. Drawn once per icon; null when it can't be (the button keeps its SF
 * Symbol then).
 */
export function barGlyph(name: IconName): ImageSourcePropType | null {
  if (!cache.has(name)) {
    let image: ImageSourcePropType | null = null;
    try {
      image = rasterize(iconSvg(name), BAR_GLYPH_PT);
    } catch {
      image = null;
    }
    cache.set(name, image);
  }
  return cache.get(name) ?? null;
}
