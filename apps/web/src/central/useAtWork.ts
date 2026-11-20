import { useCentral } from "@agenteschat/client";
import { useMemo } from "react";
import { workingAgents } from "./model";

/** VPS Zen: who is at work in the workspace, from the Central's answer (shared by every row that asks). */
export function useAtWork(orgId: string): ReadonlySet<string> {
  const data = useCentral(orgId, 6_000).data;
  return useMemo(() => workingAgents(data), [data]);
}
