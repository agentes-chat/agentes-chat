import type { BrainEffort } from "@agenteschat/adapters";
import { and, type Database, eq, schema } from "@agenteschat/db";
import { isAutoModel } from "@agenteschat/providers";
import type { Agent } from "./agents";
import { recordPlanUsage, toolOff } from "./brains/claude-code";
import type { GatewayResult } from "./gateway";
import type { MachineCaller } from "./machine-hub";
import { assertCanWork } from "./standing";

export interface InstructionPlanDeps {
  db: Database;
  hub?: Pick<MachineCaller, "call" | "status"> | null;
}

export type InstructionPlanResult = GatewayResult & {
  /** A settled call still counts towards the plan, even when its output is rejected. */
  failure?: "instructionTests.modelChanged" | "instructionTests.outputLimited" | "instructionTests.failed";
};

/** The selected account only. Never borrow another account or fall back to the API. */
export async function instructionPlanAvailable(deps: InstructionPlanDeps, agent: Agent): Promise<boolean> {
  if (
    !deps.hub ||
    !agent.machineId ||
    !agent.brainModel ||
    isAutoModel(agent.brainModel) ||
    (agent.brain !== "claude_code" && agent.brain !== "codex")
  )
    return false;
  if (agent.brainAccountId) {
    const [account] = await deps.db
      .select()
      .from(schema.machineAccounts)
      .where(
        and(
          eq(schema.machineAccounts.orgId, agent.orgId),
          eq(schema.machineAccounts.id, agent.brainAccountId),
          eq(schema.machineAccounts.machineId, agent.machineId),
          eq(schema.machineAccounts.kind, agent.brain),
        ),
      );
    if (account?.status !== "active" || account.provider || account.authMethod === "api_key") return false;
  } else {
    // The machine's own sign-in is already a supported brain choice for its owner's agents.
    if (!agent.ownerUserId) return false;
    const [machine] = await deps.db
      .select()
      .from(schema.machines)
      .where(
        and(
          eq(schema.machines.id, agent.machineId),
          eq(schema.machines.orgId, agent.orgId),
          eq(schema.machines.pairedByUserId, agent.ownerUserId),
        ),
      );
    if (!machine || machine.executors?.mode === "system") return false;
  }
  const status = await deps.hub.status(agent.machineId).catch(() => null);
  return Boolean(
    status?.orgId === agent.orgId &&
      status.online &&
      !status.paused &&
      status.executors.instructionTests &&
      !toolOff(status, agent.brain === "codex" ? "codex" : "claude"),
  );
}

export async function callInstructionPlan(
  deps: InstructionPlanDeps,
  agent: Agent,
  input: {
    system: string;
    message: string;
    effort: BrainEffort | null;
    personId: string;
    signal: AbortSignal;
  },
): Promise<InstructionPlanResult> {
  await assertCanWork(deps.db, agent.orgId, agent.id);
  if (
    !(await instructionPlanAvailable(deps, agent)) ||
    !deps.hub ||
    !agent.machineId ||
    !agent.brainModel ||
    (agent.brain !== "codex" && agent.brain !== "claude_code")
  )
    throw new Error("instructionTests.planUnavailable");
  const reply = await deps.hub
    .call(
      agent.machineId,
      {
        op: "brain.route",
        kind: agent.brain,
        ...(agent.brainAccountId ? { account: agent.brainAccountId } : {}),
        agent: { id: agent.id, handle: agent.handle },
        comparison: { model: agent.brainModel, effort: input.effort },
        system: input.system,
        prompt: `${input.message}\n\nReturn your answer in the text field of the required JSON object.`,
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
      { signal: input.signal, timeoutMs: 60_000 },
    )
    .catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("instructionTests.planUnavailable"))
        throw new Error("instructionTests.planUnavailable");
      throw error;
    });
  if ("busy" in reply) throw new Error("instructionTests.planBusy");
  const usageRecordId = await recordPlanUsage(deps.db, {
    orgId: agent.orgId,
    agentId: agent.id,
    personId: input.personId,
    provider: agent.brain,
    machineId: agent.machineId,
    accountId: agent.brainAccountId,
    model: reply.model,
    inputTokens: reply.usage.input,
    outputTokens: reply.usage.output,
    cacheReadTokens: reply.usage.cacheRead,
    cacheWriteTokens: reply.usage.cacheWrite,
  });
  const compatible =
    reply.model === agent.brainModel ||
    (agent.brain === "claude_code" &&
      ["haiku", "sonnet", "opus"].includes(agent.brainModel) &&
      reply.model.startsWith(`claude-${agent.brainModel}-`));
  const text = typeof reply.json.text === "string" ? reply.json.text : "";
  const failure = !compatible
    ? "instructionTests.modelChanged"
    : typeof reply.json.text !== "string"
      ? "instructionTests.failed"
      : text.length > 16_000
        ? "instructionTests.outputLimited"
        : undefined;
  return {
    text,
    content: [{ type: "text", text }],
    model: compatible ? agent.brainModel : reply.model,
    ...(failure ? { failure } : {}),
    stopReason: "end_turn",
    usage: {
      inputTokens: reply.usage.input,
      outputTokens: reply.usage.output,
      cacheReadTokens: reply.usage.cacheRead,
      cacheWriteTokens: reply.usage.cacheWrite,
    },
    usageRecordId: usageRecordId ?? "",
    costNanoUsd: 0,
    maxTokens: 1024,
  };
}
