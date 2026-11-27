import { type ApiClient, keys, meQuery, useApi } from "@agenteschat/client";
import { makesAgents } from "@agenteschat/client/lib/permissions";
import { isRightHand } from "@agenteschat/client/lib/right-hand";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

/**
 * Where someone lands once they joined a workspace (an invitation accepted, a request approved): their own onboarding
 * (`/welcome/$orgId`, ADR 0264, addendum of 2026-11-26) when they may create agents there and have none of their own
 * yet, else the workspace, as before. A read that fails lands in the workspace: joining never waits on it.
 */
export async function joinedLanding(qc: QueryClient, api: ApiClient, orgId: string): Promise<"welcome" | "workspace"> {
  try {
    // `me` as the join left it (read again by the caller): the new membership with its permissions.
    const me = await qc.fetchQuery(meQuery(api));
    if (!me || !makesAgents(me.organizations.find((o) => o.id === orgId))) return "workspace";
    const agents = await qc.fetchQuery({
      queryKey: keys.agents(orgId),
      queryFn: () => api.agents.list(orgId),
      staleTime: 30_000,
    });
    return agents.some((a) => !isRightHand(a) && a.ownerUserId === me.user.id) ? "workspace" : "welcome";
  } catch {
    return "workspace";
  }
}

/** Opens a workspace the person just joined, where `joinedLanding` says. */
export function useOpenJoined() {
  const qc = useQueryClient();
  const api = useApi();
  const navigate = useNavigate();
  return async (orgId: string) => {
    const landing = await joinedLanding(qc, api, orgId);
    if (landing === "welcome") await navigate({ to: "/welcome/$orgId", params: { orgId } });
    else await navigate({ to: "/org/$orgId", params: { orgId } });
  };
}
