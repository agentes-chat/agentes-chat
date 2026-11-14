import type { Channel } from "@agenteschat/client";
import { useSetChannelDashboard } from "@agenteschat/client";
import { managesChannel } from "@agenteschat/client/lib/permissions";
import { useOrg } from "@/components/org-context";

/**
 * A channel's dashboard (ADR 0135 §21): the board linked to it, whether the viewer may change it (the rule of its
 * name and topic, nothing while the workspace is being deleted) and the change, which takes null to remove it.
 */
export function useChannelDashboard(channel: Channel) {
  const { org, me } = useOrg();
  const set = useSetChannelDashboard(org.id, channel.id);
  return {
    dashboardId: channel.dashboardId ?? null,
    manages: managesChannel(channel, me.user.id, org) && !org.deletion,
    set,
  };
}
