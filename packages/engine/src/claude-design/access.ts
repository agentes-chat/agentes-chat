import {
  CLAUDE_DESIGN_PROTOCOL,
  type ClaudeDesignAction,
  claudeDesignVersion,
  isClaudeDesignCompatible,
  type PubSub,
} from "@agenteschat/adapters";
import { and, type Database, type Executor, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { runAuthorityById } from "../authority";
import { personAgentDmKey } from "../dms";
import { ForbiddenError, NotFoundError } from "../errors";
import { requirePermission } from "../organizations";
import type { ToolContext } from "../tools/types";

const {
  claudeDesignGrants: grants,
  claudeDesignJobs: jobs,
  claudeDesignArtifacts: designs,
  machineAccounts,
  machines,
  agents,
} = schema;
export interface ClaudeDesignDeps {
  db: Database;
  enabled: boolean;
  pubsub?: PubSub;
}
export interface AuthorizedClaudeDesign {
  grantId: string;
  grantRevision: number;
  accountId: string;
  machineId: string;
  ownerUserId: string;
  agentId: string;
  orgId: string;
}
export interface ClaudeDesignGrantView {
  enabled: boolean;
  available: boolean;
  accountId: string | null;
  revision: number;
  reason: "disabled" | "unsupported" | "unavailable" | null;
}
export async function getClaudeDesignGrant(
  deps: ClaudeDesignDeps,
  actorId: string,
  orgId: string,
  agentId: string,
  candidateAccountId?: string,
): Promise<ClaudeDesignGrantView> {
  await requirePermission(deps.db, actorId, orgId, "manage_agents");
  const [agent] = await deps.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId), isNull(agents.deletedAt)));
  if (!agent) throw new NotFoundError();
  const [grant] = await deps.db
    .select()
    .from(grants)
    .where(and(eq(grants.orgId, orgId), eq(grants.agentId, agentId), eq(grants.ownerUserId, actorId)));
  const base = {
    enabled: grant?.enabled ?? false,
    accountId: grant?.accountId ?? null,
    revision: grant?.revision ?? 0,
  };
  if (!deps.enabled) return { ...base, available: false, reason: "disabled" };
  const selectedId = candidateAccountId ?? (grant?.enabled ? grant.accountId : undefined);
  if (!selectedId) return { ...base, available: false, reason: "unavailable" };
  try {
    const selected = await eligibleAccount(deps.db, orgId, selectedId, actorId);
    await availableForAgent(deps.db, orgId, agentId, actorId, selected.account);
    return { ...base, available: true, reason: null };
  } catch {
    return { ...base, available: false, reason: "unsupported" };
  }
}
export const ACTIVE_DESIGN_STATES = ["queued", "running", "published", "unknown"] as const;

async function eligibleAccount(db: Executor, orgId: string, accountId: string, ownerId: string) {
  const [row] = await db
    .select({ account: machineAccounts, machine: machines })
    .from(machineAccounts)
    .innerJoin(machines, and(eq(machines.orgId, machineAccounts.orgId), eq(machines.id, machineAccounts.machineId)))
    .where(and(eq(machineAccounts.orgId, orgId), eq(machineAccounts.id, accountId)));
  if (
    !row ||
    row.account.createdBy !== ownerId ||
    row.account.kind !== "claude_code" ||
    row.account.status !== "active" ||
    row.account.statusUnknown ||
    row.account.provider ||
    row.machine.deletedAt ||
    !row.machine.execAllowed ||
    row.machine.protocol < CLAUDE_DESIGN_PROTOCOL ||
    row.machine.kind !== "connected" ||
    row.machine.pairedByUserId !== ownerId ||
    !isClaudeDesignCompatible({
      version: claudeDesignVersion(row.machine.executors.claude?.version ?? ""),
      platform: row.machine.os,
      arch: row.machine.arch,
      runnerMode: row.machine.executors.mode ?? "user",
      authMethod: row.account.authMethod ?? "",
    })
  )
    throw new ForbiddenError("Claude Design is unavailable for this account");
  // A login for one agent must not be lent to a different one; shared logins retain the existing account rules.
  return row;
}
async function availableForAgent(
  db: Executor,
  orgId: string,
  agentId: string,
  ownerId: string,
  account: typeof machineAccounts.$inferSelect,
) {
  const [existing] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.orgId, orgId), eq(grants.agentId, agentId)));
  if (existing && existing.ownerUserId !== ownerId) throw new ForbiddenError();
  if (!account.shared) {
    const [other] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.orgId, orgId),
          eq(agents.brainAccountId, account.id),
          sql`${agents.id} <> ${agentId}`,
          isNull(agents.deletedAt),
        ),
      );
    if (other) throw new ForbiddenError("This login serves a different agent");
  }
}
export async function setClaudeDesignGrant(
  deps: ClaudeDesignDeps,
  actorUserId: string,
  orgId: string,
  agentId: string,
  accountId: string | null,
): Promise<void> {
  await requirePermission(deps.db, actorUserId, orgId, "manage_agents");
  const [agent] = await deps.db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId), isNull(agents.deletedAt)));
  if (!agent) throw new NotFoundError();
  if (accountId && !deps.enabled) throw new ForbiddenError("Claude Design is disabled");
  const selected = accountId ? await eligibleAccount(deps.db, orgId, accountId, actorUserId) : null;
  if (selected) await availableForAgent(deps.db, orgId, agentId, actorUserId, selected.account);
  await deps.db.transaction(async (tx) => {
    // Serialize even the first grant; a missing grant row cannot itself be locked.
    await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).for("update");
    const [previous] = await tx
      .select()
      .from(grants)
      .where(and(eq(grants.orgId, orgId), eq(grants.agentId, agentId)))
      .for("update");
    if (previous && previous.ownerUserId !== actorUserId) throw new ForbiddenError();
    if (selected) await eligibleAccount(tx, orgId, selected.account.id, actorUserId);
    if (!previous && !selected) return;
    if (previous) {
      await tx
        .update(grants)
        .set({
          enabled: !!selected,
          revision: previous.revision + 1,
          updatedAt: new Date(),
          ...(selected ? { accountId: selected.account.id, machineId: selected.machine.id } : {}),
        })
        .where(eq(grants.id, previous.id));
      await tx
        .update(jobs)
        .set({ cancelRequestedAt: new Date() })
        .where(and(eq(jobs.grantId, previous.id), inArray(jobs.state, [...ACTIVE_DESIGN_STATES])));
    } else if (selected) {
      await tx.insert(grants).values({
        orgId,
        agentId,
        accountId: selected.account.id,
        machineId: selected.machine.id,
        ownerUserId: actorUserId,
        enabled: true,
      });
    }
  });
  const { publishMachineAgentsChanged } = await import("../machines");
  await publishMachineAgentsChanged(deps.pubsub, orgId);
  const { recordAudit } = await import("../audit");
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorUserId },
    action: "agent.claude_design_changed",
    target: { type: "agent", id: agentId },
    details: { enabled: !!selected, accountId },
  });
}

export async function authorizeClaudeDesign(
  deps: ClaudeDesignDeps,
  ctx: ToolContext,
  action: ClaudeDesignAction,
  designId?: string,
): Promise<AuthorizedClaudeDesign> {
  return authorizeDesignIn(deps.db, deps.enabled, ctx, action, designId);
}
export async function authorizeDesignIn(
  db: Executor,
  enabled: boolean,
  ctx: ToolContext,
  action: ClaudeDesignAction,
  designId?: string,
): Promise<AuthorizedClaudeDesign> {
  return designAuthorityIn(db, enabled, ctx, action, designId);
}
/** Explicit owner-initiated, read-only recovery may outlive its transient originating run. */
export async function authorizeDesignRecoveryIn(db: Executor, enabled: boolean, job: typeof jobs.$inferSelect) {
  const authority = await designAuthorityIn(
    db,
    enabled,
    { db: db as Database, ...job },
    "update",
    job.designId,
    job.ownerUserId,
  );
  if (
    authority.accountId !== job.accountId ||
    authority.machineId !== job.machineId ||
    authority.ownerUserId !== job.ownerUserId
  )
    throw new ForbiddenError("Recovery requires the original account");
  return authority;
}
async function designAuthorityIn(
  db: Executor,
  enabled: boolean,
  ctx: ToolContext,
  action: ClaudeDesignAction,
  designId?: string,
  recoveryOwner?: string,
): Promise<AuthorizedClaudeDesign> {
  if (!enabled) throw new ForbiddenError("Claude Design is disabled");
  const [grant] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.orgId, ctx.orgId), eq(grants.agentId, ctx.agentId), eq(grants.enabled, true)));
  if (!grant) throw new ForbiddenError("Enable Claude Design for this agent first");
  await requirePermission(db, grant.ownerUserId, ctx.orgId, "post");
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(eq(agents.orgId, ctx.orgId), eq(agents.id, ctx.agentId), isNull(agents.deletedAt), isNull(agents.archivedAt)),
    );
  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.orgId, ctx.orgId),
        eq(schema.agentRuns.id, ctx.runId),
        eq(schema.agentRuns.agentId, ctx.agentId),
        eq(schema.agentRuns.channelId, ctx.channelId),
      ),
    );
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.orgId, ctx.orgId),
        eq(schema.channels.id, ctx.channelId),
        isNull(schema.channels.deletedAt),
        isNull(schema.channels.archivedAt),
      ),
    );
  const authority = await runAuthorityById(db, ctx.orgId, ctx.runId);
  if (
    !agent ||
    (recoveryOwner
      ? recoveryOwner !== grant.ownerUserId
      : !run ||
        run.background ||
        run.triggerMessageId !== ctx.triggerMessageId ||
        run.threadRootId !== ctx.threadRootId ||
        authority.kind !== "person" ||
        authority.personId !== grant.ownerUserId) ||
    channel?.kind !== "dm" ||
    channel.dmKey !== personAgentDmKey(grant.ownerUserId, ctx.agentId)
  )
    throw new ForbiddenError("Claude Design is available only in the account owner's DM");
  const selected = await eligibleAccount(db, ctx.orgId, grant.accountId, grant.ownerUserId);
  if (selected.machine.id !== grant.machineId) throw new ForbiddenError();
  if (!selected.account.shared) {
    const [other] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.orgId, ctx.orgId),
          eq(agents.brainAccountId, grant.accountId),
          sql`${agents.id} <> ${ctx.agentId}`,
          isNull(agents.deletedAt),
        ),
      );
    if (other) throw new ForbiddenError();
  }
  if (action === "update") {
    const [design] = designId
      ? await db
          .select()
          .from(designs)
          .where(
            and(
              eq(designs.orgId, ctx.orgId),
              eq(designs.id, designId),
              eq(designs.agentId, ctx.agentId),
              eq(designs.channelId, ctx.channelId),
              eq(designs.ownerUserId, grant.ownerUserId),
              eq(designs.accountId, grant.accountId),
              eq(designs.machineId, grant.machineId),
              eq(designs.unavailable, false),
            ),
          )
      : [];
    if (!design) throw new NotFoundError();
  }
  return {
    orgId: ctx.orgId,
    agentId: ctx.agentId,
    grantId: grant.id,
    grantRevision: grant.revision,
    accountId: grant.accountId,
    machineId: grant.machineId,
    ownerUserId: grant.ownerUserId,
  };
}

/** Runs in the account-removal transaction. The pending cancellation is durable across disconnected runners. */
export async function invalidateClaudeDesignAccounts(db: Executor, orgId: string, ids: string[]) {
  if (!ids.length) return;
  await db
    .update(grants)
    .set({ enabled: false, revision: sql`${grants.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(grants.orgId, orgId), inArray(grants.accountId, ids)));
  await db
    .update(designs)
    .set({ unavailable: true })
    .where(and(eq(designs.orgId, orgId), inArray(designs.accountId, ids)));
  await db
    .update(jobs)
    .set({ cancelRequestedAt: new Date() })
    .where(and(eq(jobs.orgId, orgId), inArray(jobs.accountId, ids), inArray(jobs.state, [...ACTIVE_DESIGN_STATES])));
}
