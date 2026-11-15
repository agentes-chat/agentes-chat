import type { ClaudeDesignConsent } from "../api/types";

export function designConsentIdOf(meta: Record<string, unknown> | null | undefined): string | null {
  const n = meta?.notice as { kind?: unknown; refs?: { designConsentId?: unknown } } | undefined;
  const id = n?.refs?.designConsentId;
  return n?.kind === "design_consent" &&
    typeof id === "string" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)
    ? id
    : null;
}
export const canApproveDesignConsent = (row: ClaudeDesignConsent, reviewed: boolean, now = Date.now()) =>
  reviewed && row.canDecide && row.status === "pending" && Date.parse(row.expiresAt) > now;

export function showDesignAccountControls(
  account: { mine: boolean; kind: string; provider: string | null },
  manageAgents: boolean,
) {
  return manageAgents && account.mine && account.kind === "claude_code" && account.provider === null;
}
export function designJobIdOf(meta: Record<string, unknown> | null | undefined): string | null {
  const id = (meta?.claudeDesign as { jobId?: unknown } | undefined)?.jobId;
  return typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) ? id : null;
}
export function canonicalDesignUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.origin === "https://claude.ai" &&
      /^\/artifact\/[A-Za-z0-9_-]{1,128}$/.test(u.pathname) &&
      u.href === value &&
      !u.search &&
      !u.hash &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

export function designJobIdsOf(meta: Record<string, unknown> | null | undefined): string[] {
  const ids = Array.isArray(meta?.claudeDesignJobs) ? meta.claudeDesignJobs : [];
  const single = designJobIdOf(meta);
  return [
    ...new Set(
      [...ids, ...(single ? [single] : [])].filter(
        (id): id is string => typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id),
      ),
    ),
  ].slice(0, 16);
}
