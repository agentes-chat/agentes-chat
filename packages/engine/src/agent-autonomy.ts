// VPS Zen: "Autonomia dos agentes", the workspace's switch for agents that do what they were asked without asking
// first. It is the workspace's approvals level (ADR 0173, addendum 2026-11-15) seen as one switch, kept in the same
// column (`organization_settings.approvals_level`, text: no migration, so a merge of upstream's migrations never
// collides with ours):
// - off: whatever level the workspace had (`risky`, upstream's default, or `always`);
// - on: every agent that follows the workspace is at `never` (no approval card, nothing held on its computer);
// - on, still asking before what is destructive: the workspace's row holds `autonomous` and its agents `never`, and
//   the Tool Gateway still asks for a connected app's delete, payment or send (`destructiveTool`), the actions that
//   can't be undone or that reach people outside the workspace.
// An agent with its own level (`agents.approvals_level_own`) keeps it either way.
import type { PubSub } from "@agenteschat/adapters";
import { and, type Database, type Executor, eq, schema } from "@agenteschat/db";
import { nameWords } from "./connectors/classify";
import { type ApprovalsLevel, type PolicyTool, toolKind } from "./tools/run-policy";
import { setWorkspaceApprovalsLevel } from "./workspace-approvals";

const { agents, organizationSettings } = schema;

/** The workspace row's value for autonomy that still asks before what is destructive. Never an agent's level. */
export const AUTONOMOUS = "autonomous";

export interface AgentAutonomy {
  /** Agents that follow the workspace do what they were asked without an approval card. */
  on: boolean;
  /** With `on`: a connected app's delete, payment or send still asks a person. */
  asksDestructive: boolean;
}

/** The switch as the workspace's stored level says it. */
export const autonomyOf = (stored: string | null | undefined): AgentAutonomy =>
  stored === AUTONOMOUS
    ? { on: true, asksDestructive: true }
    : stored === "never"
      ? { on: true, asksDestructive: false }
      : { on: false, asksDestructive: true };

/** The level the workspace's agents take from its stored value: `autonomous` is `never` for each of them. */
export const agentLevelOf = (stored: string | null | undefined, fallback: ApprovalsLevel): ApprovalsLevel =>
  stored === AUTONOMOUS ? "never" : stored === "always" || stored === "risky" || stored === "never" ? stored : fallback;

/**
 * Deletions, money and sends: what can't be undone or reaches people outside the workspace. Read on a connected app's
 * tool name (`delete_message`, `create_payment`, `send_email`, `gmail_reply`).
 */
const DESTRUCTIVE =
  /^(delete|deletes|remove|removes|destroy|drop|purge|erase|wipe|trash|truncate|revoke|pay|pays|payment|payments|payout|payouts|refund|refunds|charge|charges|transfer|transfers|purchase|buy|checkout|withdraw|withdrawal|send|sends|reply|forward|email|sms|publish|tweet)$/;

/** A connected app's (or a mailbox's) write whose name says it deletes, pays or sends. */
export function destructiveTool(tool: PolicyTool): boolean {
  const external = Boolean(tool.connectionId) || tool.scope.startsWith("mail:");
  if (!external) return false;
  if (tool.connectionId && toolKind(tool).kind !== "external") return false;
  return nameWords(tool.name).some((w) => DESTRUCTIVE.test(w));
}

/**
 * Whether this agent's calls still ask before what is destructive: the workspace is at `autonomous` and the agent
 * follows it. Read on every call, like the level itself.
 */
export async function asksDestructiveOf(db: Executor, orgId: string, agentId: string): Promise<boolean> {
  const [row] = await db
    .select({ stored: organizationSettings.approvalsLevel, own: agents.approvalsLevelOwn })
    .from(agents)
    .innerJoin(organizationSettings, eq(organizationSettings.orgId, agents.orgId))
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)));
  return (row?.stored as string | undefined) === AUTONOMOUS && row?.own === false;
}

/**
 * Turns "Autonomia dos agentes" on or off (owners and administrators, as the workspace's level). Off puts the
 * workspace back at `risky`, upstream's default. Every agent that follows the workspace takes it at once.
 */
export async function setAgentAutonomy(
  db: Database,
  actorId: string,
  orgId: string,
  autonomy: AgentAutonomy,
  options: { pubsub?: PubSub } = {},
): Promise<AgentAutonomy & { ownAgents: number }> {
  const level: ApprovalsLevel = autonomy.on ? "never" : "risky";
  const stored = autonomy.on && autonomy.asksDestructive ? AUTONOMOUS : level;
  const out = await setWorkspaceApprovalsLevel(db, actorId, orgId, level, { ...options, stored });
  return { ...autonomyOf(stored), ownAgents: out.ownAgents };
}
