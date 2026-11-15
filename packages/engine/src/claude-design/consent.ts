import {
  type ClaudeDesignConsentReply,
  type ClaudeDesignConsentRequest,
  parseClaudeDesignConsentRequest,
} from "@agenteschat/adapters";
import { and, type Executor, eq, inArray, isNull, or, schema } from "@agenteschat/db";
import { serverText } from "@agenteschat/i18n";
import { appLocale } from "@agenteschat/i18n/locale";
import { planState } from "@agenteschat/ui/plan-state";
import { recordAudit } from "../audit";
import { requireChannelAccess } from "../channels";
import { deliverNotice, publishDelivery } from "../delivery";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { notify, resolveNotifications } from "../notifications";
import { requirePermission } from "../organizations";
import { assertPersonUnderLimit } from "../person-usage";
import { assertCanWork } from "../standing";
import { freshGrantedKeys, isAllowed, toolAccess } from "../tools/scopes";
import { authorizeDesignIn, authorizeDesignRecoveryIn, type ClaudeDesignDeps } from "./access";
import { syncClaudeDesignIssue } from "./board";
import { designReplyThreadId } from "./delivery";

const { claudeDesignJobs: jobs, claudeDesignArtifacts: designs, claudeDesignConsents: consents } = schema;
type Consent = typeof consents.$inferSelect;
export interface ClaudeDesignConsentView {
  id: string;
  jobId: string;
  status: Consent["status"];
  title: string;
  accountLabel: string;
  remoteUrl: string;
  description: string;
  expiresAt: string;
  canDecide: boolean;
}
const same = (row: Consent, r: ClaudeDesignConsentRequest) =>
  row.jobId === r.jobId &&
  row.taskId === r.taskId &&
  row.grantRevision === r.grantRevision &&
  row.sequence === r.sequence &&
  row.toolUseId === r.toolUseId &&
  row.inputHash === r.inputHash &&
  row.remoteId === r.remoteId &&
  row.description === r.description;
const toRequest = (r: Consent): ClaudeDesignConsentRequest => ({
  type: "design.consent",
  requestId: r.id,
  jobId: r.jobId,
  taskId: r.taskId,
  grantRevision: r.grantRevision,
  sequence: r.sequence,
  toolUseId: r.toolUseId,
  inputHash: r.inputHash,
  remoteId: r.remoteId,
  description: r.description,
});
const active = (r: Consent) => r.status === "pending" || r.status === "approved";
/** Same lock order as effect authorization and grant revocation: grant, design, job, consent. */
async function lockJob(db: Executor, orgId: string, machineId: string, jobId: string) {
  const [initial] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.machineId, machineId), eq(jobs.id, jobId)));
  if (!initial) throw new NotFoundError();
  await db
    .select()
    .from(schema.claudeDesignGrants)
    .where(eq(schema.claudeDesignGrants.id, initial.grantId))
    .for("update");
  await db.select().from(designs).where(eq(designs.id, initial.designId)).for("update");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
  if (!job) throw new NotFoundError();
  return job;
}
async function authority(db: Executor, enabled: boolean, job: typeof jobs.$inferSelect, r: ClaudeDesignConsentRequest) {
  const recovery = job.recoveryTaskId === r.taskId;
  if (
    job.cancelRequestedAt ||
    !["running", "published", ...(recovery ? ["unknown"] : [])].includes(job.state) ||
    (!recovery && (job.taskId !== r.taskId || job.recoveryTaskId))
  )
    throw new ConflictError("Design task no longer active");
  const a = job.lastAuthorization;
  const counter = recovery ? job.recoveryEffectSequence : job.effectSequence;
  if (
    !a ||
    a.taskId !== r.taskId ||
    a.grantRevision !== r.grantRevision ||
    a.sequence !== r.sequence ||
    counter !== r.sequence ||
    a.toolUseId !== r.toolUseId ||
    a.inputHash !== r.inputHash ||
    a.effect !== "read_target" ||
    a.remoteId !== r.remoteId
  )
    throw new ConflictError("Native operation changed");
  const [task] = await db
    .select()
    .from(schema.machineTasks)
    .where(
      and(
        eq(schema.machineTasks.orgId, job.orgId),
        eq(schema.machineTasks.machineId, job.machineId),
        eq(schema.machineTasks.id, r.taskId),
      ),
    );
  if (
    !task ||
    task.endedAt ||
    task.agentId !== job.agentId ||
    task.requestedByUserId !== job.ownerUserId ||
    task.executor !== "claude" ||
    task.runId !== (recovery ? null : job.runId)
  )
    throw new NotFoundError();
  const granted = recovery
    ? await authorizeDesignRecoveryIn(db, enabled, job)
    : await authorizeDesignIn(
        db,
        enabled,
        { db: db as ClaudeDesignDeps["db"], ...job },
        job.action,
        job.action === "update" ? job.designId : undefined,
      );
  if (
    granted.grantRevision !== r.grantRevision ||
    granted.accountId !== job.accountId ||
    granted.machineId !== job.machineId ||
    granted.ownerUserId !== job.ownerUserId
  )
    throw new ConflictError("Design account changed");
  if (
    !isAllowed(
      toolAccess(await freshGrantedKeys(db, job.orgId, job.agentId), {
        name: recovery ? "get_claude_design_job" : `${job.action}_claude_design`,
        scope: recovery ? "claude-design:read" : "claude-design:write",
        connectionId: null,
      }),
    )
  )
    throw new ConflictError("Design scope revoked");
  await assertCanWork(db, job.orgId, job.agentId);
  await assertPersonUnderLimit(db, job.orgId, job.ownerUserId);
  const [account] = await db
    .select()
    .from(schema.machineAccounts)
    .where(and(eq(schema.machineAccounts.orgId, job.orgId), eq(schema.machineAccounts.id, job.accountId)));
  if (!account || (account.usage && planState(account.usage).state === "limited"))
    throw new ConflictError("Selected account unavailable");
  const [design] = await db.select().from(designs).where(eq(designs.id, job.designId));
  const url = recovery ? job.recoveryCandidateUrl : design?.remoteUrl;
  if (!url || (!recovery && design?.remoteId !== r.remoteId)) throw new ConflictError("Design target changed");
  const { claudeDesignRemoteId } = await import("@agenteschat/adapters");
  if (claudeDesignRemoteId(url) !== r.remoteId) throw new ConflictError("Design target changed");
  return {
    url,
    accountLabel: account.label,
    deadline: Math.min(Date.now() + 900000, (task.startedAt ?? task.createdAt).getTime() + 900000),
  };
}
async function audit(db: Executor, row: Consent, action: string, userId?: string) {
  await recordAudit(db, {
    orgId: row.orgId,
    actor: userId ? { type: "person", id: userId } : { type: "system", id: null },
    action: `claude_design.consent_${action}`,
    target: { type: "claude_design_consent", id: row.id },
    details: { jobId: row.jobId, taskId: row.taskId, toolUseId: row.toolUseId, sequence: row.sequence },
  });
}
const group = (id: string) => `claude-design-consent:${id}`;
/** Called only for an authenticated runner connection, never a model tool. Repeated pending polls are idempotent. */
export async function pollClaudeDesignConsent(
  deps: ClaudeDesignDeps,
  orgId: string,
  machineId: string,
  raw: ClaudeDesignConsentRequest,
): Promise<ClaudeDesignConsentReply> {
  const deny: ClaudeDesignConsentReply = {
    type: "design.consented",
    requestId: raw.requestId,
    pending: false,
    allow: false,
  };
  const r = parseClaudeDesignConsentRequest(raw);
  if (!r) return deny;
  let delivery: Awaited<ReturnType<typeof deliverNotice>> | undefined,
    noticeBody: string | undefined,
    created: Consent | undefined,
    closed = false;
  let answer: ClaudeDesignConsentReply;
  try {
    answer = await deps.db.transaction(async (tx) => {
      const job = await lockJob(tx, orgId, machineId, r.jobId);
      let [row] = await tx
        .select()
        .from(consents)
        .where(and(eq(consents.orgId, orgId), eq(consents.id, r.requestId)))
        .for("update");
      if (
        row &&
        (!same(row, r) ||
          row.machineId !== machineId ||
          row.accountId !== job.accountId ||
          row.ownerUserId !== job.ownerUserId)
      )
        return deny;
      if (row && !active(row)) return deny;
      if (row && row.expiresAt.getTime() <= Date.now()) {
        await tx.update(consents).set({ status: "expired" }).where(eq(consents.id, row.id));
        await audit(tx, row, "expired");
        closed = true;
        return deny;
      }
      let current: Awaited<ReturnType<typeof authority>>;
      try {
        current = await authority(tx, deps.enabled, job, r);
      } catch {
        if (row) {
          await tx.update(consents).set({ status: "canceled" }).where(eq(consents.id, row.id));
          await audit(tx, row, "canceled");
          closed = true;
        }
        return deny;
      }
      if (!row) {
        [row] = await tx
          .insert(consents)
          .values({
            id: r.requestId,
            orgId,
            jobId: job.id,
            taskId: r.taskId,
            accountId: job.accountId,
            machineId,
            ownerUserId: job.ownerUserId,
            grantRevision: r.grantRevision,
            sequence: r.sequence,
            toolUseId: r.toolUseId,
            inputHash: r.inputHash,
            remoteId: r.remoteId,
            remoteUrl: current.url,
            description: r.description,
            expiresAt: new Date(current.deadline),
          })
          .returning();
        if (!row) throw Error("Consent reservation failed");
        const [person] = await tx
          .select({ locale: schema.users.locale })
          .from(schema.users)
          .where(eq(schema.users.id, job.ownerUserId));
        noticeBody = serverText(appLocale([person?.locale]) ?? "en", "chat.body.claude_design_consent", {
          title: job.title,
        });
        delivery = await deliverNotice(tx, {
          orgId,
          agentId: job.agentId,
          channelId: job.channelId,
          threadId: await designReplyThreadId(tx, job),
          hop: 1,
          stretchId: null,
          wake: false,
          notice: {
            kind: "design_consent",
            text: "Claude requires the account owner to review one native Artifact read. The agent cannot decide this request.",
            refs: { designConsentId: row.id, jobId: job.id },
          },
          body: noticeBody,
        });
        await tx.update(consents).set({ messageId: delivery.message.id }).where(eq(consents.id, row.id));
        row.messageId = delivery.message.id;
        created = row;
        await audit(tx, row, "requested");
      }
      if (row.status === "approved") {
        await tx.update(consents).set({ status: "consumed", consumedAt: new Date() }).where(eq(consents.id, row.id));
        await audit(tx, row, "consumed");
        closed = true;
        return { ...deny, allow: true };
      }
      return { ...deny, pending: true };
    });
  } catch {
    return deny;
  }
  await syncClaudeDesignIssue(deps, r.jobId);
  if (delivery) await publishDelivery(deps.pubsub, delivery).catch(() => undefined);
  if (created && delivery && delivery.message.authorAgentId)
    await notify(
      { db: deps.db, pubsub: deps.pubsub },
      {
        orgId,
        userIds: [created.ownerUserId],
        kind: "dm",
        groupKey: group(created.id),
        waiting: true,
        actor: { type: "agent", id: delivery.message.authorAgentId },
        source: {
          dmId: delivery.message.channelId,
          channelId: delivery.message.channelId,
          threadId: delivery.message.threadId ?? undefined,
          messageId: created.messageId ?? undefined,
        },
        latest: { text: noticeBody, expiresAt: created.expiresAt.toISOString() },
      },
    ).catch(() => undefined);
  if (closed)
    await resolveNotifications({ db: deps.db, pubsub: deps.pubsub }, orgId, { groupKey: group(r.requestId) }).catch(
      () => undefined,
    );
  return answer;
}
/** Read-only predicate shared by the owner review route and every live progress surface. */
export async function isClaudeDesignConsentCurrent(
  db: Executor,
  job: typeof jobs.$inferSelect,
  row: Consent,
  enabled = true,
): Promise<boolean> {
  if (
    !active(row) ||
    row.expiresAt.getTime() <= Date.now() ||
    row.orgId !== job.orgId ||
    row.jobId !== job.id ||
    row.accountId !== job.accountId ||
    row.machineId !== job.machineId ||
    row.ownerUserId !== job.ownerUserId
  )
    return false;
  try {
    await authority(db, enabled, job, toRequest(row));
    return true;
  } catch {
    return false;
  }
}

async function ownerRow(deps: ClaudeDesignDeps, userId: string, orgId: string, id: string) {
  await requirePermission(deps.db, userId, orgId, "post");
  const [row] = await deps.db
    .select()
    .from(consents)
    .where(and(eq(consents.orgId, orgId), eq(consents.id, id), eq(consents.ownerUserId, userId)));
  if (!row) throw new NotFoundError();
  const [job] = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.id, row.jobId)));
  if (!job) throw new NotFoundError();
  await requireChannelAccess(deps.db, userId, orgId, job.channelId);
  return { row, job };
}
export async function getClaudeDesignConsentForOwner(
  deps: ClaudeDesignDeps,
  userId: string,
  orgId: string,
  id: string,
): Promise<ClaudeDesignConsentView> {
  const { row, job } = await ownerRow(deps, userId, orgId, id);
  const valid = await isClaudeDesignConsentCurrent(deps.db, job, row, deps.enabled);
  const [account] = await deps.db
    .select({ label: schema.machineAccounts.label })
    .from(schema.machineAccounts)
    .where(and(eq(schema.machineAccounts.orgId, orgId), eq(schema.machineAccounts.id, row.accountId)));
  return {
    id: row.id,
    jobId: row.jobId,
    status: active(row) && !valid ? (row.expiresAt.getTime() <= Date.now() ? "expired" : "canceled") : row.status,
    title: job.title,
    accountLabel: account?.label ?? "",
    remoteUrl: row.remoteUrl,
    description: row.description,
    expiresAt: row.expiresAt.toISOString(),
    canDecide: valid && row.status === "pending",
  };
}
export async function decideClaudeDesignConsent(
  deps: ClaudeDesignDeps,
  userId: string,
  orgId: string,
  id: string,
  input: { decision: "approve" | "deny"; reviewed: boolean },
): Promise<ClaudeDesignConsentView> {
  if (!["approve", "deny"].includes(input.decision) || (input.decision === "approve" && input.reviewed !== true))
    throw new ValidationError("Review the native request before approving it");
  const { row: initial } = await ownerRow(deps, userId, orgId, id);
  const accepted = await deps.db.transaction(async (tx) => {
    const job = await lockJob(tx, orgId, initial.machineId, initial.jobId);
    const [row] = await tx
      .select()
      .from(consents)
      .where(and(eq(consents.orgId, orgId), eq(consents.id, id), eq(consents.ownerUserId, userId)))
      .for("update");
    if (row?.status !== "pending") return false;
    if (row.expiresAt.getTime() <= Date.now()) {
      await tx.update(consents).set({ status: "expired" }).where(eq(consents.id, id));
      await audit(tx, row, "expired");
      return false;
    }
    try {
      await authority(tx, deps.enabled, job, toRequest(row));
    } catch {
      await tx.update(consents).set({ status: "canceled" }).where(eq(consents.id, id));
      await audit(tx, row, "canceled");
      return false;
    }
    await tx
      .update(consents)
      .set({
        status: input.decision === "approve" ? "approved" : "denied",
        decidedByUserId: userId,
        decidedAt: new Date(),
      })
      .where(eq(consents.id, id));
    await audit(tx, row, input.decision, userId);
    return true;
  });
  await syncClaudeDesignIssue(deps, initial.jobId);
  if (!accepted) throw new ConflictError("This native request is no longer available");
  await resolveNotifications({ db: deps.db, pubsub: deps.pubsub }, orgId, { groupKey: group(id) }).catch(
    () => undefined,
  );
  return getClaudeDesignConsentForOwner(deps, userId, orgId, id);
}

/** A task/connection end invalidates undelivered human decisions as well as pending reviews. */
export async function closeClaudeDesignConsents(
  deps: ClaudeDesignDeps,
  orgId: string,
  machineId: string,
  taskId?: string,
) {
  const rows = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.orgId, orgId),
          eq(consents.machineId, machineId),
          taskId ? eq(consents.taskId, taskId) : undefined,
          or(
            inArray(consents.status, ["pending", "approved"]),
            and(eq(consents.status, "consumed"), isNull(consents.reauthorizedAt)),
          ),
        ),
      )
      .for("update");
    for (const row of rows) {
      await tx.update(consents).set({ status: "canceled" }).where(eq(consents.id, row.id));
      await audit(tx, row, "canceled");
    }
    return rows;
  });
  for (const jobId of new Set(rows.map((row) => row.jobId))) await syncClaudeDesignIssue(deps, jobId);
  for (const row of rows)
    await resolveNotifications({ db: deps.db, pubsub: deps.pubsub }, orgId, { groupKey: group(row.id) }).catch(
      () => undefined,
    );
}
