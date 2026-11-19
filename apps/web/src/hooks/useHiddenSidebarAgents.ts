import { useHiddenSidebarAgentIds } from "@agenteschat/client";
import { useOrg } from "@/components/org-context";

/**
 * "Esconder da sidebar": the agents this person took off the sidebar's AGENTES list in this workspace. The agent keeps
 * working and answering, and stays one Ctrl K away; Personalizar brings it back. Saved with the sidebar view
 * (`…/me/sidebar/view`), so it holds on every device.
 */
export function useHiddenSidebarAgents() {
  const { org } = useOrg();
  const { ids, hide, show } = useHiddenSidebarAgentIds(org.id);
  return { ids, hide, show };
}
