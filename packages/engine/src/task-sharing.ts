import { and, type Executor, eq, rowsOf, schema, sql } from "@agenteschat/db";
import { fileSeenSql, taskSeenSql } from "./task-access";

/** Shared by graph mutations, work starts and audience-sensitive publication. */
export const lockIssueDependencies = (tx: Executor, orgId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`issue-dependencies:${orgId}`}, 0))`);

/** A destination's people must all still be allowed to see the task. Null is the shared Drive. */
export async function taskMayReportTo(tx: Executor, orgId: string, issueId: string, channelId: string | null) {
  const publicTask = sql`(not t.restricted and (t.channel_id is null or exists (
    select 1 from ${schema.channels} origin where origin.id = t.channel_id and origin.kind = 'channel' and origin.visibility = 'public')))`;
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`select t.id from ${schema.issues} t
    where t.org_id = ${orgId}::uuid and t.id = ${issueId}::uuid and (
      ${
        channelId === null
          ? publicTask
          : sql`exists (select 1 from ${schema.channels} destination
        where destination.id = ${channelId}::uuid and destination.org_id = t.org_id and (
          ${publicTask} or destination.id = t.conversation_channel_id or (
            destination.kind = 'task' and not exists (select 1 from ${schema.organizationMembers} reader
              where reader.org_id = t.org_id and exists (select 1 from ${schema.issues} destination_task
                where destination_task.conversation_channel_id = destination.id and ${taskSeenSql("destination_task", sql`reader.user_id`)})
                and not ${taskSeenSql("t", sql`reader.user_id`)})) or (
            destination.kind <> 'task' and not (destination.kind = 'channel' and destination.visibility = 'public')
            and not exists (select 1 from ${schema.channelMembers} recipient where recipient.channel_id = destination.id
              and recipient.user_id is not null and not ${taskSeenSql("t", sql`recipient.user_id`)}))))`
      }
    ) limit 1`),
  );
  return rows.length > 0;
}

/** Deleted tasks retain their binding through the start message and cannot publish as unbound work. */
async function taskOfRun(tx: Executor, orgId: string, runId: string) {
  const [run] = await tx
    .select({ issueId: schema.agentRuns.issueId, meta: schema.messages.meta })
    .from(schema.agentRuns)
    .leftJoin(
      schema.messages,
      and(eq(schema.messages.id, schema.agentRuns.triggerMessageId), eq(schema.messages.orgId, orgId)),
    )
    .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.id, runId)));
  return run?.issueId ?? (typeof run?.meta?.issueId === "string" ? run.meta.issueId : null);
}

export async function taskRunDestinationAllowed(tx: Executor, orgId: string, runId: string, channelId: string | null) {
  const bound = await taskOfRun(tx, orgId, runId);
  if (!bound) return true;
  await lockIssueDependencies(tx, orgId);
  return taskMayReportTo(tx, orgId, bound, channelId);
}

/** Existing files include conversation readers and explicit user/role sharing. Check their current union. */
export async function taskRunFileDestinationAllowed(tx: Executor, orgId: string, runId: string, artifactId: string) {
  const bound = await taskOfRun(tx, orgId, runId);
  if (!bound) return true;
  await lockIssueDependencies(tx, orgId);
  // Lock after the graph lock: a sharing change cannot slip between this check and the version write.
  const [file] = await tx
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.orgId, orgId), eq(schema.artifacts.id, artifactId)))
    .for("update");
  if (!file) return false;
  const permitted = rowsOf<{ id: string }>(
    await tx.execute(sql`
    select artifacts.id from ${schema.artifacts}
    join ${schema.issues} t on t.id = ${bound}::uuid and t.org_id = artifacts.org_id
    where artifacts.id = ${artifactId}::uuid and artifacts.org_id = ${orgId}::uuid and artifacts.deleted_at is null
      and (
        (not t.restricted and (t.channel_id is null or exists (
          select 1 from ${schema.channels} origin
          where origin.id = t.channel_id and origin.kind = 'channel' and origin.visibility = 'public')))
        or (
          artifacts.channel_id is not null and artifacts.share <> 'everyone'
          and not exists (select 1 from ${schema.channels} origin
            where origin.id = artifacts.channel_id and origin.kind = 'channel' and origin.visibility = 'public')
          and not exists (select 1 from ${schema.organizationMembers} recipient
            where recipient.org_id = artifacts.org_id and ${fileSeenSql(sql`recipient.user_id`)}
              and not ${taskSeenSql("t", sql`recipient.user_id`)})
        )
      ) limit 1`),
  );
  return permitted.length > 0;
}
