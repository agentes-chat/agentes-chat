import type { AgentAccessory } from "@agenteschat/tokens/look";

/**
 * Festive moods: on a few special days (Brazil's first), the apps' sky takes a tint, the logo agent wears something and
 * a light layer of particles drifts over it. Pure and local: the date is the device's, nothing is asked of the server,
 * and each app keeps its own switch to turn them off.
 */
export const FESTIVE_DAYS = [
  "christmas",
  "newYear",
  "carnival",
  "easter",
  "saoJoao",
  "childrensDay",
  "halloween",
  "valentines",
] as const;
export type FestiveDay = (typeof FESTIVE_DAYS)[number];

export const FESTIVE_PARTICLES = ["snow", "fireworks", "confetti", "petals", "bats", "hearts", "sparks"] as const;
export type FestiveParticles = (typeof FESTIVE_PARTICLES)[number];

export interface FestiveMood {
  day: FestiveDay;
  /** The sky's tones shift toward this color… */
  tint: string;
  /** …by this share (0–1): a hint, the sky stays the sky. */
  tintAmount: number;
  /** What the agent wears (an accessory the agent engine draws). */
  accessory: Exclude<AgentAccessory, "none">;
  particles: FestiveParticles;
  /** The particles' two colors (every other one takes the second). */
  colors: readonly [string, string];
}

type Variation = Omit<FestiveMood, "day">;

/** Several ways to dress each day; consecutive days of one date take the next, so it changes across them. */
export const FESTIVE_VARIATIONS: Record<FestiveDay, readonly Variation[]> = {
  christmas: [
    { tint: "#e0494f", tintAmount: 0.16, accessory: "beanie", particles: "snow", colors: ["#ffffff", "#dbe9ff"] },
    { tint: "#2f9e62", tintAmount: 0.14, accessory: "scarf", particles: "snow", colors: ["#ffffff", "#ffd27a"] },
    { tint: "#e0494f", tintAmount: 0.14, accessory: "hat", particles: "sparks", colors: ["#ffd27a", "#ff7a7a"] },
  ],
  newYear: [
    { tint: "#f2c14e", tintAmount: 0.14, accessory: "party", particles: "fireworks", colors: ["#ffd27a", "#ffffff"] },
    { tint: "#c9a8ff", tintAmount: 0.14, accessory: "crown", particles: "sparks", colors: ["#ffffff", "#ffd27a"] },
    { tint: "#f2c14e", tintAmount: 0.12, accessory: "hat", particles: "fireworks", colors: ["#7fd1ff", "#ff9ad5"] },
  ],
  carnival: [
    { tint: "#b05cff", tintAmount: 0.18, accessory: "party", particles: "confetti", colors: ["#ffd23f", "#3fe0c5"] },
    { tint: "#ff5fa2", tintAmount: 0.16, accessory: "crown", particles: "confetti", colors: ["#7c5cff", "#ffd23f"] },
    { tint: "#22c1a5", tintAmount: 0.16, accessory: "flower", particles: "sparks", colors: ["#ff5fa2", "#ffd23f"] },
  ],
  easter: [
    { tint: "#f6a5c8", tintAmount: 0.16, accessory: "bow", particles: "petals", colors: ["#ffc2dc", "#fff1a8"] },
    { tint: "#a5d8a8", tintAmount: 0.14, accessory: "flower", particles: "petals", colors: ["#ffffff", "#ffc2dc"] },
  ],
  saoJoao: [
    { tint: "#ff8a3d", tintAmount: 0.18, accessory: "hat", particles: "sparks", colors: ["#ffb347", "#ff6b3d"] },
    { tint: "#ffcf3f", tintAmount: 0.14, accessory: "scarf", particles: "confetti", colors: ["#ff4d4d", "#3fa7ff"] },
    { tint: "#ff8a3d", tintAmount: 0.16, accessory: "bow", particles: "sparks", colors: ["#ffd27a", "#ff6b3d"] },
  ],
  childrensDay: [
    { tint: "#4cc9f0", tintAmount: 0.16, accessory: "cap", particles: "confetti", colors: ["#ffd23f", "#ff5fa2"] },
    { tint: "#7bd88f", tintAmount: 0.14, accessory: "antenna", particles: "sparks", colors: ["#ffffff", "#ffd23f"] },
    { tint: "#ffb347", tintAmount: 0.14, accessory: "party", particles: "confetti", colors: ["#4cc9f0", "#b05cff"] },
  ],
  halloween: [
    { tint: "#ff7a1a", tintAmount: 0.18, accessory: "hat", particles: "bats", colors: ["#1b1030", "#2a1745"] },
    { tint: "#7b3fe4", tintAmount: 0.18, accessory: "antenna", particles: "bats", colors: ["#1b1030", "#ff7a1a"] },
  ],
  valentines: [
    { tint: "#ff4d8d", tintAmount: 0.16, accessory: "bow", particles: "hearts", colors: ["#ff4d8d", "#ff9ec0"] },
    { tint: "#ff7aa8", tintAmount: 0.14, accessory: "flower", particles: "hearts", colors: ["#ff2e6e", "#ffffff"] },
    { tint: "#e0494f", tintAmount: 0.14, accessory: "crown", particles: "petals", colors: ["#ff9ec0", "#ff4d8d"] },
  ],
};

const DAY_MS = 86_400_000;

/** A calendar date as a whole day count (UTC midnight, so no daylight saving shift moves it). */
const dayNumber = (year: number, month: number, day: number) => Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

/** Easter Sunday of a Gregorian year (the anonymous Gregorian algorithm): its month (1–12) and day. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Each date's days: an inclusive range of day numbers in that year. */
function ranges(year: number): [FestiveDay, number, number][] {
  const easter = easterSunday(year);
  const e = dayNumber(year, easter.month, easter.day);
  const on = (m: number, d: number) => dayNumber(year, m, d);
  return [
    ["newYear", on(1, 1), on(1, 1)],
    // Saturday before Carnival to Ash Wednesday (Easter − 46).
    ["carnival", e - 50, e - 46],
    // Good Friday to Easter Sunday.
    ["easter", e - 2, e],
    ["valentines", on(6, 12), on(6, 12)],
    ["saoJoao", on(6, 20), on(6, 29)],
    ["childrensDay", on(10, 12), on(10, 12)],
    ["halloween", on(10, 31), on(10, 31)],
    ["christmas", on(12, 20), on(12, 26)],
    ["newYear", on(12, 30), on(12, 31)],
  ];
}

/** The special date a local calendar day falls on, or null. */
export function festiveDayOf(date: Date): FestiveDay | null {
  const year = date.getFullYear();
  const today = dayNumber(year, date.getMonth() + 1, date.getDate());
  return ranges(year).find(([, from, to]) => today >= from && today <= to)?.[0] ?? null;
}

/**
 * The mood of a local calendar day, or null on an ordinary one. Its variation is picked by the day, so it stays
 * the same all day (and on every screen) and moves on to the next one tomorrow.
 */
export function festiveMoodOf(date: Date): FestiveMood | null {
  const day = festiveDayOf(date);
  if (!day) return null;
  const variations = FESTIVE_VARIATIONS[day];
  const today = dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const variation = variations[today % variations.length] as Variation;
  return { day, ...variation };
}
