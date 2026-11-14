import type { FolderAccessRequest } from "../api/types";

/** Only the server's request notice. Old notices without ids keep their old rendering. */
export function folderRequestOf(meta: Record<string, unknown> | null | undefined) {
  if (meta?.bodyCode !== "machine_access_requested") return null;
  const a = meta.machineAccess as { machineId?: unknown; requestId?: unknown; computer?: unknown } | undefined;
  if (typeof a?.machineId !== "string" || typeof a.requestId !== "string") return null;
  return {
    machineId: a.machineId,
    requestId: a.requestId,
    computer: typeof a.computer === "string" ? a.computer : "",
  };
}

/** Duplicate pending asks stay separate on the server; one row here represents the latest ask for that agent/path. */
export function groupFolderRequests(requests: readonly FolderAccessRequest[]) {
  const seen = new Set<string>();
  return requests.filter((r) => {
    if (r.status !== "pending") return true;
    const key = JSON.stringify([r.machineId, r.agent.id, r.path]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STATUS_KEYS = {
  pending: "machines.folderRequests.pending",
  granted: "machines.folderRequests.granted",
  denied: "machines.folderRequests.denied",
  expired: "machines.folderRequests.expired",
  failed: "machines.folderRequests.failed",
} as const;

export const folderStatusKey = (status: string) =>
  STATUS_KEYS[status as keyof typeof STATUS_KEYS] ?? STATUS_KEYS.failed;
