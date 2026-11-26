import type { Channel } from "@agenteschat/client";
import { managesChannel } from "@agenteschat/client/lib/permissions";

/** Who may put a channel in a sector (ADR 0240): who manages it, as for renaming it. */
export const movesChannel = managesChannel;

/** "Setor" of a channel: pick where it sits. */
export const sectorHref = (channelId: string) => `/channel-sector?channelId=${encodeURIComponent(channelId)}` as const;

/** Moves `id` one step up (-1) or down (+1) in `ids`: the id it then sits before (null: the end). */
export function stepBefore(ids: readonly string[], id: string, step: -1 | 1): string | null | undefined {
  const i = ids.indexOf(id);
  const to = i + step;
  if (i < 0 || to < 0 || to >= ids.length) return undefined;
  const rest = ids.filter((x) => x !== id);
  return rest[to] ?? null;
}

/**
 * A channel among the ones of its sector (or the ones in none), in the list's order: where it is, how many they are,
 * and the move one step up or down (undefined at either end).
 */
export function channelSteps(channels: readonly Pick<Channel, "id" | "groupId">[], channelId: string) {
  const groupId = channels.find((c) => c.id === channelId)?.groupId ?? null;
  const ids = channels.filter((c) => (c.groupId ?? null) === groupId).map((c) => c.id);
  const move = (step: -1 | 1) => {
    const before = stepBefore(ids, channelId, step);
    return before === undefined ? undefined : { channelId, groupId, beforeChannelId: before };
  };
  return { at: ids.indexOf(channelId), count: ids.length, up: move(-1), down: move(1) };
}
