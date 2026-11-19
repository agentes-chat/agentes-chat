import {
  type ApiClient,
  channelMembersQuery,
  channelThreadsQuery,
  type DirectMessage,
  type DmTarget,
  keys,
  messagesQuery,
} from "@agenteschat/client";
import type { QueryClient } from "@tanstack/react-query";

export function knownDm(queryClient: QueryClient, orgId: string, target: DmTarget): DirectMessage | undefined {
  const type = "agentId" in target ? "agent" : "person";
  const id = "agentId" in target ? target.agentId : target.userId;
  return queryClient
    .getQueryData<DirectMessage[]>(keys.dms(orgId))
    ?.find((dm) => dm.with.type === type && dm.with.id === id);
}

/**
 * A DM's messages fetched before its page asks: the page first opens the DM (one request) and only then its messages
 * (another), so a click waited for both in a row. With a DM already in the list, its messages start on the hover
 * (`defaultPreload: "intent"`) or the click, next to the open. Never awaited, never opens a DM that doesn't exist.
 */
export function preloadDm(queryClient: QueryClient, api: ApiClient, orgId: string, target: DmTarget) {
  const dm = knownDm(queryClient, orgId, target);
  if (!dm) return;
  void queryClient.prefetchQuery(messagesQuery(api, orgId, dm.channelId));
  void queryClient.prefetchQuery(channelMembersQuery(api, orgId, dm.channelId));
  void queryClient.prefetchQuery(channelThreadsQuery(api, orgId, dm.channelId, "all"));
}
