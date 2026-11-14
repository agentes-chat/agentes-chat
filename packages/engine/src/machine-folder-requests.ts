import { and, type Database, desc, eq, schema, sql } from "@agenteschat/db";
import { readableChannelIds } from "./channels";
import { NotFoundError } from "./errors";
import { allowFolderCommand } from "./machine-access";
import { getMachine, requireMachineManager } from "./machines";
import { requirePermission } from "./organizations";

/**
 * Read-only views of a computer's folder requests (ADR 0036 §8). Its manager may list requests, but only from
 * conversations they can read. A conversation reader may look up one request by id, never enumerate the computer.
 * Decisions and grants still come only from the computer.
 */
export async function listFolderAccessRequests(
  db: Database,
  userId: string,
  orgId: string,
  machineId: string,
  requestId?: string,
) {
  await requirePermission(db, userId, orgId, "read");
  const machine = requestId
    ? await getMachine(db, orgId, machineId)
    : await requireMachineManager(db, userId, orgId, machineId);
  if (!machine) throw new NotFoundError("Computer not found", "machine.not_found");
  const { machineAccessRequests: requests, agents } = schema;
  const rows = await db
    .select({ request: requests, agent: { id: agents.id, name: agents.name, handle: agents.handle } })
    .from(requests)
    .innerJoin(agents, and(eq(agents.id, requests.agentId), eq(agents.orgId, requests.orgId)))
    .where(
      and(
        eq(requests.orgId, orgId),
        eq(requests.machineId, machineId),
        requestId ? eq(requests.id, requestId) : undefined,
      ),
    )
    .orderBy(
      sql`case when ${requests.status} = 'pending' and ${requests.expiresAt} > now() then 0 else 1 end`,
      desc(requests.createdAt),
      desc(requests.id),
    )
    .limit(requestId ? 1 : 200);
  const direct = await readableChannelIds(
    db,
    orgId,
    userId,
    rows.map(({ request: r }) => r.channelId),
  );
  const { consultationOrigin } = await import("./consultations");
  const origins = new Map<string, Awaited<ReturnType<typeof consultationOrigin>>>();
  for (const { request: r } of rows) {
    if (!direct.has(r.channelId) && r.runId && !origins.has(r.runId)) {
      origins.set(r.runId, await consultationOrigin(db, orgId, r.runId));
    }
  }
  const originChannels = [...origins.values()].flatMap((o) => (o ? [o.channelId] : []));
  const readableOrigins = await readableChannelIds(db, orgId, userId, originChannels);
  return rows
    .filter(({ request: r }) => {
      if (direct.has(r.channelId)) return true;
      const origin = r.runId ? origins.get(r.runId) : null;
      return origin ? readableOrigins.has(origin.channelId) : false;
    })
    .map(({ request: r, agent }) => ({
      id: r.id,
      machineId,
      agent,
      path: r.path,
      reason: r.reason,
      // Offline runners may not have delivered their expiry yet. Reading never changes the decision or wakes work.
      status: r.status === "pending" && r.expiresAt.getTime() <= Date.now() ? ("expired" as const) : r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      command:
        machine.kind === "managed"
          ? null
          : allowFolderCommand(r.path, agent.handle, machine.executors?.mode === "system"),
    }));
}
