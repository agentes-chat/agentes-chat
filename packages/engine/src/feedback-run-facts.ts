import { and, desc, type Executor, eq, schema, sql } from "@agenteschat/db";

const { agentRunSteps, agentRuns, agents, machines, usageRecords } = schema;

/*
 * What a run knew of itself when an agent writes feedback (ADR 0160 §11 and §12, amended 2026-11-11): the server's
 * side of the failure, from stored data and no model call, so whoever reads the email can find it. The person reads
 * the same lines before it goes (the approval's card, the offer's row), and the email carries those lines, no more.
 */

export const SEND_FEEDBACK_TOOL = "send_feedback";

/** The run's own tool failures a report carries, the latest ones. */
export const FEEDBACK_TOOL_ERRORS = 3;
/** One failure's line: its first line, cut. */
const ERROR_LINE_MAX = 160;

const BRAIN_NAMES: Record<string, string> = {
  model: "API key",
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  grok: "Grok Build",
  antigravity: "Antigravity",
};

const firstLine = (text: string) =>
  (text.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim().slice(0, ERROR_LINE_MAX);

/**
 * The run's facts, as label and value: what it thought with (the brain, and the model that last answered with its
 * provider, never an account or a key), the computer it ran on (its system and runner, never its name), the last
 * failures of the app's own tools (a connected app's errors stay out: their text is that app's data), and the run
 * itself (its id and start). Empty without a run.
 */
export async function runFeedbackFacts(
  db: Executor,
  at: { orgId: string; runId: string | null | undefined; agentId: string },
): Promise<[string, string][]> {
  if (!at.runId) return [];
  const runId = at.runId;
  const [[run], [usage], errors, [machine]] = await Promise.all([
    db
      .select({ brain: agentRuns.brain, createdAt: agentRuns.createdAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.orgId, at.orgId), eq(agentRuns.id, runId))),
    db
      .select({ model: usageRecords.model, provider: usageRecords.provider })
      .from(usageRecords)
      .where(and(eq(usageRecords.orgId, at.orgId), eq(usageRecords.runId, runId)))
      .orderBy(desc(usageRecords.createdAt))
      .limit(1),
    db
      .select({
        name: sql<string>`coalesce(${agentRunSteps.data}->>'name', '')`,
        content: sql<string>`coalesce(${agentRunSteps.data}->>'content', '')`,
      })
      .from(agentRunSteps)
      .where(
        and(
          eq(agentRunSteps.runId, runId),
          eq(agentRunSteps.kind, "tool_result"),
          sql`${agentRunSteps.data}->>'isError' = 'true'`,
          sql`coalesce(${agentRunSteps.data}->>'external', 'false') <> 'true'`,
        ),
      )
      .orderBy(desc(agentRunSteps.seq))
      .limit(FEEDBACK_TOOL_ERRORS),
    db
      .select({ os: machines.os, arch: machines.arch, runner: machines.runnerVersion })
      .from(agents)
      .innerJoin(machines, eq(machines.id, agents.machineId))
      .where(and(eq(agents.orgId, at.orgId), eq(agents.id, at.agentId))),
  ]);
  if (!run) return [];
  const facts: [string, string][] = [];
  if (run.brain) facts.push(["Brain", BRAIN_NAMES[run.brain] ?? run.brain]);
  if (usage) facts.push(["Model", `${usage.model} (${usage.provider})`]);
  if (machine && run.brain && run.brain !== "model") {
    const system = [machine.os, machine.arch].filter(Boolean).join(" ");
    facts.push(["Computer", machine.runner ? `${system}, runner ${machine.runner}` : system]);
  }
  for (const e of errors.reverse()) {
    const line = firstLine(e.content);
    if (e.name && line) facts.push(["Tool error", `${e.name}: ${line}`]);
  }
  facts.push(["Run", runId], ["Run started", run.createdAt.toISOString()]);
  return facts;
}
