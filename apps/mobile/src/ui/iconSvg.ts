import { ICONS, type IconName, type IconShape } from "./icons.data";

/**
 * The design system's line icons as SVG documents, drawn as `Icon` draws them (24×24, stroke 1.7, round caps and
 * joins), in one color: the native bars tint them as template images. Pure: `barGlyphs.ts` rasterizes them with Skia.
 */

const STROKE = 1.7;

function shapeSvg(s: IconShape): string {
  if (s.t === "circle")
    return s.fill
      ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="#000"/>`
      : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="none" stroke="#000" stroke-width="${STROKE}"/>`;
  if (s.t === "rect") {
    const paint = s.fill ? `fill="#000"` : `fill="none" stroke="#000" stroke-width="${STROKE}"`;
    const fade = s.opacity === undefined ? "" : ` opacity="${s.opacity}"`;
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}" ${paint}${fade}/>`;
  }
  return `<path d="${s.d}" fill="none" stroke="#000" stroke-width="${s.sw ?? STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A line icon of the design system as an SVG document, as `Icon` draws it (one color: the bar tints it). */
export function iconSvg(name: IconName): string {
  const shapes = ICONS[name] ?? ICONS.circle;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">${shapes
    .map(shapeSvg)
    .join("")}</svg>`;
}
