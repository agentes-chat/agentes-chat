import type { Agent, Message } from "@agenteschat/client";
import { useDms, useFirstDeliveryRow, useMessages } from "@agenteschat/client";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useStreams } from "@/realtime/context";

/** How long after it fired a delivery with no run seen yet still reads as being made (its run is about to start). */
const STARTING_MS = 10 * 60_000;

/**
 * The first agent's first delivery (ADR 0260, addendum of 2026-11-27), the onboarding's last promise: kept by the
 * server when the agent was made, it fires once the workspace has a plan and the agent an AI, as a run in the person's
 * DM with the agent. `working` while that run is live there (or just fired); `done` once its reply landed, marked by the
 * server as the first delivery (`meta.firstDelivery`, with its one-line summary). Null while it waits for a plan or
 * an AI: nothing is on its way yet.
 */
export interface FirstDelivery {
  agent: Agent;
  channelId: string;
  state: "working" | "done";
  summary: string | null;
}

/** The newest reply of the agent marked as its first delivery, if one landed. */
export function deliveryMessage(messages: readonly Message[] | undefined, agentId: string): Message | null {
  const marked = (messages ?? []).filter(
    (m) => m.author.type === "agent" && m.author.id === agentId && m.meta?.firstDelivery,
  );
  return marked[marked.length - 1] ?? null;
}

export function useFirstDelivery(): FirstDelivery | null {
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const row = useFirstDeliveryRow(org.id).data ?? null;
  const agent = row ? dir.agents.find((a) => a.id === row.agentId) : undefined;
  const dms = useDms(org.id);
  const channelId =
    (agent && dms.data?.find((d) => d.with.type === "agent" && d.with.id === agent.id)?.channelId) ?? "";
  const messages = useMessages(org.id, channelId, channelId !== "");
  const live = useStreams(
    (s) =>
      agent !== undefined &&
      channelId !== "" &&
      Object.values(s.runs).some((r) => r.agentId === agent.id && r.channelId === channelId && !r.provisional),
  );
  if (!row || !agent || !row.firedAt) return null;
  const landed = deliveryMessage(messages.data, agent.id);
  if (landed && !live) {
    const said = landed.meta?.firstDelivery as { summary?: unknown } | undefined;
    return { agent, channelId, state: "done", summary: typeof said?.summary === "string" ? said.summary : null };
  }
  const recent = Date.now() - Date.parse(row.firedAt) < STARTING_MS;
  return live || recent ? { agent, channelId, state: "working", summary: null } : null;
}
