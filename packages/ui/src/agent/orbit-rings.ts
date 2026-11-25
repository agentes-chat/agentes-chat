import { type AgentColorName, gradientOf, mixHex } from "./engine.js";

/**
 * The rings an agent at work wears (web `OrbitGlyph`, phone `OrbitFace`): radius in halves of the glyph's side,
 * flatness (ry / rx), tilt in degrees, one turn's seconds, where its dot starts (degrees) and whether it turns the other
 * way. Different speeds, one the other way round, so they never line up into one shape.
 */
export const ORBIT_RINGS = [
  { r: 1.42, flat: 0.26, tilt: -16, turn: 2.4, start: 20, back: false },
  { r: 1.3, flat: 0.34, tilt: 22, turn: 3.6, start: 200, back: true },
  { r: 1.52, flat: 0.18, tilt: 4, turn: 5.2, start: 120, back: false },
] as const;

/** The rings' box, in glyph sides: the widest ring and its dot fit. */
export const ORBIT_SPAN = 3.6;

/** The rings' colours: the agent's own tone, then two neighbours mixed toward a warm and a cool hue. */
export function orbitColors(color?: AgentColorName | string): [string, string, string] {
  const [top, lead] = gradientOf(color);
  return [lead, mixHex(lead, "#ff4fb8", 0.42), mixHex(top, "#22c3b0", 0.42)];
}
