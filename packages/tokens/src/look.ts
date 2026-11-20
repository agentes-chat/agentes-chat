/** An agent's look, the allow-list the server keeps too: plain values every platform and `@agenteschat/client` share. */

/** The agent symbol's preset colors (sky is the default identity); a custom "#rrggbb" is allowed too. */
export const AGENT_COLORS = ["sky", "indigo", "violet", "rose", "amber", "green", "teal", "graphite"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number] | `#${string}`;

/** Mirrors `isHexColor` in packages/ui/src/agent/engine.js, which imports nothing so plain pages can load it. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const AGENT_EYES = ["round", "dots", "wide", "happy", "sleepy"] as const;
export type AgentEyes = (typeof AGENT_EYES)[number];

/** Pixel accessories drawn by the agent engine (`ACCESSORIES` in `@agenteschat/ui`'s agent engine; same list, "none" first). */
export const AGENT_ACCESSORIES = [
  "none",
  "hat",
  "cap",
  "headphones",
  "bow",
  "crown",
  "antenna",
  "headset",
  "beanie",
  "party",
  "flower",
  "scarf",
] as const;
export type AgentAccessory = (typeof AGENT_ACCESSORIES)[number];

export interface AgentAppearance {
  color?: AgentColor;
  eyes?: AgentEyes;
  accessory?: AgentAccessory;
}

/** VPS Zen: a look with the agent's uploaded photo, drawn instead of the symbol (`/api/app/agent-photos/…` only). */
export type AgentPhotoLook = AgentAppearance & { photo?: string };

/** VPS Zen: the only addresses an agent's photo may have (the server's `AGENT_PHOTO_PATH`). */
const AGENT_PHOTO = /^\/api\/app\/agent-photos\/[^/]+\/[^/]+\/[0-9a-f]{16}\.(jpg|png|webp)$/;

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Only known values (the backend's allow-list); anything else falls back to the default look. */
export function normalizeAppearance(raw: unknown): AgentPhotoLook {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    color:
      pick(AGENT_COLORS, o.color) ??
      (typeof o.color === "string" && HEX_COLOR.test(o.color) ? (o.color.toLowerCase() as AgentColor) : undefined),
    eyes: pick(AGENT_EYES, o.eyes),
    accessory: pick(AGENT_ACCESSORIES, o.accessory),
    ...(typeof o.photo === "string" && AGENT_PHOTO.test(o.photo) ? { photo: o.photo } : {}),
  };
}
