import { and, type Executor, eq, isNull, schema } from "@agenteschat/db";
import type { BrainKind } from "./brains/types";
import { thinkingAgent } from "./right-hand";

const BRAINS: readonly string[] = ["model", "claude_code", "codex", "cursor", "opencode", "grok", "antigravity"];
type AgentBrain = { brain?: string | null; brainModel?: string | null; machineId?: string | null };

export function executorBrain(executor: string, agent?: AgentBrain, missionMachineId?: string | null): BrainKind {
  if (executor === "codex") return "codex";
  if (executor !== "agent") return "claude_code";
  const configured = BRAINS.includes(agent?.brain ?? "") ? (agent?.brain as BrainKind) : "model";
  const sameMachine = Boolean(missionMachineId) && agent?.machineId === missionMachineId;
  return configured === "model" || sameMachine ? configured : "model";
}

export function missionBrain(
  mission: { executor: string; brain?: string | null; brainModel?: string | null; machineId?: string | null },
  agent?: AgentBrain,
): { brain: BrainKind; model?: string } {
  const brain = BRAINS.includes(mission.brain ?? "")
    ? (mission.brain as BrainKind)
    : executorBrain(mission.executor, agent, mission.machineId);
  const model = mission.brainModel ?? (agent?.brain === brain ? agent.brainModel : null);
  return model ? { brain, model } : { brain };
}

export async function missionAgent(
  db: Executor,
  mission: { orgId: string; agentId: string; ownerId: string | null },
  person = mission.ownerId,
) {
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.orgId, mission.orgId),
        eq(schema.agents.id, mission.agentId),
        isNull(schema.agents.deletedAt),
      ),
    );
  return agent ? thinkingAgent(db, agent, person) : null;
}
