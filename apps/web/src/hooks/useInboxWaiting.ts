import { useNotificationCount, useNotifications, useOverview } from "@agenteschat/client";
import { allItems } from "@agenteschat/client/lib/notifications";

/**
 * How many things wait on me in the inbox: what the notifications count, and each proposal I may decide (the inbox
 * lists them one by one, in place of the one notice that says "proposals wait on you", which is left out here).
 */
export function useInboxWaiting(orgId: string): number {
  const waiting = useNotificationCount(orgId).data?.waiting ?? 0;
  const proposals = useOverview(orgId).data?.proposalsWaitingForMe ?? 0;
  const list = useNotifications(orgId, "waiting");
  const notice = allItems(list.data).some((n) => n.kind === "proposal_waiting" && n.waiting && !n.doneAt);
  return Math.max(0, waiting + proposals - (notice ? 1 : 0));
}
