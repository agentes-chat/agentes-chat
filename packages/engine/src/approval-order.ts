import { and, type Executor, eq, isNull, rowsOf, schema, sql } from "@agenteschat/db";
import { enqueue } from "./outbox";
import type { Approval } from "./tools/gateway";

const { approvals } = schema;

/**
 * Approvals keep the order they were asked in. An agent's requests on one card (the same agent in the same
 * conversation, `openApprovalCard`) are its line: a person may decide them in any order, but an approved action runs
 * only once every request asked before it on that card is settled (refused, expired, canceled or done), and one
 * approved before an earlier request was refused or expired doesn't run at all: what it came after never happened.
 * A run already does its own calls in the order asked (the executor's resume); this orders the runs sharing a card,
 * as when a message sent while the agent waited started a run of its own whose requests joined the same card.
 * Actions approved ahead (`run_at`, done at their routine's time) and a mission's requests (no run) stand outside.
 */

/**
 * The request a run's approved actions still wait for, if any: one asked before them on their card by another run of
 * the agent and not settled yet (still waiting for a person, or approved and not done while its run goes on). A run's
 * place is its earliest approved action left on the card, so of two runs whose requests interleave, the one asked
 * first always goes: they never wait on each other.
 */
export async function heldBehind(db: Executor, runId: string): Promise<{ id: string; title: string } | null> {
  const [row] = rowsOf<{ id: string; title: string }>(
    await db.execute(sql`with mine as (
        select distinct on (a.message_id) a.org_id, a.message_id, a.created_at, a.id
        from approvals a
        where a.run_id = ${runId}::uuid and a.status = 'approved' and a.executed_at is null and a.result is null
          and a.run_at is null and a.message_id is not null
        order by a.message_id, a.created_at, a.id
      )
      select b.id, b.title from mine
      join approvals b on b.org_id = mine.org_id and b.message_id = mine.message_id
        and b.run_id is not null and b.run_id <> ${runId}::uuid and b.run_at is null
        and (b.created_at, b.id) < (mine.created_at, mine.id)
        and b.status in ('pending', 'approved')
      where b.status = 'pending' or (b.executed_at is null and b.result is null
        and exists (select 1 from agent_runs r where r.id = b.run_id
          and r.status in ('queued', 'running', 'waiting_approval', 'waiting_input')))
      order by b.created_at, b.id
      limit 1`),
  );
  return row ?? null;
}

/**
 * Why an approved action must not run: a request asked before it on its card (by this run or another) was refused, or
 * expired unanswered, after this one was approved. The person approved it counting on that earlier one; one approved
 * after the refusal was approved knowing it, and runs.
 */
export async function notRunAfter(
  db: Executor,
  approval: Pick<Approval, "id" | "status" | "messageId" | "runId" | "runAt" | "decidedAt">,
): Promise<{ id: string; title: string; status: "refused" | "expired" } | null> {
  if (approval.status !== "approved" || !approval.messageId || !approval.runId || approval.runAt) return null;
  if (!approval.decidedAt) return null;
  const [row] = rowsOf<{ id: string; title: string; status: "refused" | "expired" }>(
    await db.execute(sql`select b.id, b.title, b.status from approvals a
      join approvals b on b.org_id = a.org_id and b.message_id = a.message_id and b.id <> a.id
        and b.run_id is not null and b.run_at is null
        and (b.created_at, b.id) < (a.created_at, a.id)
      where a.id = ${approval.id}::uuid and b.status in ('refused', 'expired')
        and coalesce(b.decided_at, b.expires_at) > a.decided_at
      order by b.created_at, b.id
      limit 1`),
  );
  return row ?? null;
}

/** What the agent reads (and the request's result says) for an action kept from running by `notRunAfter`. */
export function notRunText(before: { title: string; status: "refused" | "expired" }) {
  const what = before.status === "refused" ? "was refused" : "expired unanswered";
  return `Not done: "${before.title}", asked before this, ${what} after this one was approved, so this didn't run. If it still makes sense on its own, ask for it again.`;
}

/**
 * Keeps an approved action from running (`notRunAfter`): its result says why and names the earlier request
 * (`notRunAfter` in the stored result, read by the apps). Null when it already ran or was kept already.
 */
export async function markNotRun(
  db: Executor,
  approvalId: string,
  before: { id: string; title: string; status: "refused" | "expired" },
): Promise<Approval | null> {
  const [row] = await db
    .update(approvals)
    .set({ result: { content: notRunText(before), isError: true, notRunAfter: before.id } })
    .where(and(eq(approvals.id, approvalId), isNull(approvals.executedAt), isNull(approvals.result)))
    .returning();
  return row ?? null;
}

/**
 * These requests just settled: wakes the agent's other runs waiting behind them on their cards (`heldBehind`), each
 * once per request settled. A run still behind another request goes back to waiting; the last to settle wakes it.
 */
export async function wakeLine(
  tx: Executor,
  rows: Pick<Approval, "id" | "orgId" | "messageId" | "runId" | "runAt">[],
): Promise<void> {
  const ids = rows.filter((r) => r.messageId && r.runId && !r.runAt).map((r) => r.id);
  if (ids.length === 0) return;
  const later = rowsOf<{ org_id: string; run_id: string; after: string }>(
    await tx.execute(sql`select distinct on (b.run_id) b.org_id, b.run_id, a.id as after
      from approvals a
      join approvals b on b.org_id = a.org_id and b.message_id = a.message_id
        and b.run_id is not null and b.run_id <> a.run_id and b.run_at is null
        and (b.created_at, b.id) > (a.created_at, a.id)
      join agent_runs r on r.id = b.run_id and r.status in ('waiting_approval', 'waiting_input')
      where a.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by b.run_id, a.created_at, a.id`),
  );
  for (const row of later) {
    await enqueue(tx, {
      orgId: row.org_id,
      kind: "agent_run.execute",
      payload: { runId: row.run_id },
      dedupeKey: `agent_run.execute:${row.run_id}:after:${row.after}`,
      maxAttempts: 4,
    });
  }
}

/** A run ended or let go of its requests: wakes the runs waiting behind any of them (`wakeLine`). */
export async function wakeLineOfRun(tx: Executor, runId: string): Promise<void> {
  const rows = rowsOf<Pick<Approval, "id" | "orgId" | "messageId" | "runId" | "runAt">>(
    await tx.execute(sql`select id, org_id as "orgId", message_id as "messageId", run_id as "runId", run_at as "runAt"
      from approvals where run_id = ${runId}::uuid and message_id is not null and run_at is null`),
  );
  await wakeLine(tx, rows);
}

/**
 * The safety net (with the expiry worker, every minute): a run held behind a request whose own run ended without a
 * word to the line (a failure, a restart) resumes once nothing it waits for is left. Only runs this order can hold:
 * every request of theirs decided, an approved action not done (decided within a day) behind another run's request on
 * its card, and no job of theirs already on its way.
 */
export async function resumeHeldRuns(db: Executor, now = new Date()): Promise<number> {
  const candidates = rowsOf<{ id: string; org_id: string }>(
    await db.execute(sql`select r.id, r.org_id from agent_runs r
      where r.status = 'waiting_approval' and r.updated_at < ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz
        and exists (select 1 from approvals a
          join approvals b on b.org_id = a.org_id and b.message_id = a.message_id and b.run_id is not null
            and b.run_id <> a.run_id and b.run_at is null and (b.created_at, b.id) < (a.created_at, a.id)
          where a.run_id = r.id and a.status = 'approved' and a.executed_at is null and a.result is null
            and a.run_at is null and a.message_id is not null
            and a.decided_at > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz)
        and not exists (select 1 from approvals a where a.run_id = r.id and a.status = 'pending')
        and not exists (select 1 from outbox o where o.kind = 'agent_run.execute'
          and o.status in ('pending', 'processing') and o.payload->>'runId' = r.id::text)
      limit 50`),
  );
  let woken = 0;
  const minute = Math.floor(now.getTime() / 60_000);
  for (const run of candidates) {
    if (await heldBehind(db, run.id)) continue;
    await enqueue(db, {
      orgId: run.org_id,
      kind: "agent_run.execute",
      payload: { runId: run.id },
      dedupeKey: `agent_run.execute:${run.id}:after:sweep:${minute}`,
      maxAttempts: 4,
    });
    woken++;
  }
  return woken;
}
