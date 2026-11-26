import { BLANK_LOOK } from "@agenteschat/client/lib/new-agent";
import { type AgentAppearance, accessoryTop, normalizeAppearance } from "@agenteschat/ui";
import type { CSSProperties } from "react";

/** An agent's look for `<Avatar appearance>` (unknown values fall back to the default). */
export const lookOf = (agent: { appearance?: unknown } | undefined | null): AgentAppearance | undefined =>
  agent?.appearance ? normalizeAppearance(agent.appearance) : undefined;

/** Every part of a look, the blank one's where it has none (the editors need all three). */
export const fullLook = (a: AgentAppearance | undefined): Required<AgentAppearance> => ({
  color: a?.color ?? BLANK_LOOK.color,
  eyes: a?.eyes ?? BLANK_LOOK.eyes,
  accessory: a?.accessory ?? BLANK_LOOK.accessory,
});

/**
 * The room an agent's accessory takes over its face (a cap, a headset), as `--reach` in the face's heights, for the
 * face's box: what sits over the face (a bubble it says) starts above that room, so the accessory is never under it.
 */
export const reachOf = (look: AgentAppearance | undefined): CSSProperties =>
  ({ "--reach": accessoryTop(look?.accessory) }) as CSSProperties;
