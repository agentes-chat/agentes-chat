/** Experimental native Artifact integration. Product limits, not provider limits. */
export const CLAUDE_DESIGN_PROTOCOL = 65;
export const CLAUDE_DESIGN_LIMITS = {
  briefChars: 20_000,
  titleChars: 120,
  maxSources: 10,
  maxSourceBytes: 8 * 1024 * 1024,
  maxOutputFiles: 50,
  maxOutputBytes: 16 * 1024 * 1024,
  maxSeconds: 900,
} as const;

export type ClaudeDesignAction = "create" | "update";
export type ClaudeDesignState = "queued" | "running" | "published" | "succeeded" | "failed" | "canceled" | "unknown";
const failures = [
  "disabled",
  "unsupported",
  "auth_unverified",
  "unavailable",
  "forbidden",
  "conflict",
  "guard_failed",
  "canceled",
  "timeout",
  "result_unknown",
  "sources_incomplete",
  "interactive_consent_required",
] as const;
export type ClaudeDesignFailure = (typeof failures)[number];
export interface ClaudeDesignExecuteTask {
  mode: "execute";
  jobId: string;
  action: ClaudeDesignAction;
  title: string;
  brief: string;
  target?: { remoteId: string; remoteUrl: string; remoteVersion: string; revision: number };
  sources: { name: string; relativePath: string; sha256: string }[];
  grantRevision: number;
}
export interface ClaudeDesignRecoveryTask {
  mode: "recover";
  jobId: string;
  remoteCandidateUrl: string;
  grantRevision: number;
}
export type ClaudeDesignTask = ClaudeDesignExecuteTask | ClaudeDesignRecoveryTask;
export interface ClaudeDesignRemote {
  id: string;
  url: string;
  version: string;
}
export interface ClaudeDesignResult {
  jobId: string;
  state: ClaudeDesignState;
  remote?: ClaudeDesignRemote;
  /** Native publication phase in this task: shell 1, populated creation 2; updates 1. Never sorts opaque versions. */
  publicationSequence?: number;
  sourceFiles: { relativePath: string; sha256: string; size: number; contentType: string }[];
  error?: { code: ClaudeDesignFailure; message: string };
  recoveryEvidence?: "provider_checkpoint" | "owner_association";
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}
export interface ClaudeDesignEffectRequest {
  type: "design.authorize";
  requestId: string;
  taskId: string;
  jobId: string;
  grantRevision: number;
  sequence: number;
  effect: "create" | "read_target" | "publish";
  toolUseId?: string;
  inputHash?: string;
  consentRequestId?: string;
  remoteId?: string;
  remoteVersion?: string;
  /** A native checkpoint already durably recorded by this task, never model text. */
  checkpoint?: ClaudeDesignResult;
}
export interface ClaudeDesignEffectReply {
  type: "design.authorized";
  requestId: string;
  allow: boolean;
  error?: ClaudeDesignFailure;
}
export interface ClaudeDesignAuthorization {
  taskId: string;
  grantRevision: number;
  sequence: number;
  toolUseId: string;
  inputHash: string;
  effect: "create" | "read_target" | "publish";
  remoteId?: string;
  remoteVersion?: string;
  consentRequestId?: string;
}
export interface ClaudeDesignConsentRequest {
  type: "design.consent";
  requestId: string;
  jobId: string;
  taskId: string;
  grantRevision: number;
  sequence: number;
  toolUseId: string;
  inputHash: string;
  remoteId: string;
  description: string;
}
export interface ClaudeDesignConsentReply {
  type: "design.consented";
  requestId: string;
  pending: boolean;
  allow: boolean;
}
export interface ClaudeDesignCompatibility {
  version: string;
  platform: string;
  arch: string;
  runnerMode: string;
  authMethod: string;
}
/** Evidence: docs/superpowers/research/2026-11-13-claude-design.md. Never infer newer versions. */
export const CLAUDE_DESIGN_COMPATIBILITY: readonly ClaudeDesignCompatibility[] = [
  { version: "2.1.322", platform: "darwin", arch: "arm64", runnerMode: "user", authMethod: "cli_login" },
];
export function isClaudeDesignCompatible(value: ClaudeDesignCompatibility): boolean {
  return CLAUDE_DESIGN_COMPATIBILITY.some((row) =>
    Object.entries(row).every(([key, v]) => value[key as keyof ClaudeDesignCompatibility] === v),
  );
}
/** Inventory stores the CLI's first version line; only the measured format is recognized. */
export function claudeDesignVersion(value: string): string {
  return value.match(/^(\d+\.\d+\.\d+)(?: \(Claude Code\))?$/)?.[1] ?? "";
}

function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(v).every((k) => allowed.includes(k));
}
function text(v: unknown, max: number): v is string {
  return (
    typeof v === "string" &&
    v.trim().length > 0 &&
    v.length <= max &&
    ![...v].some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))
  );
}
function id(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
}
function positive(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) > 0;
}
function hash(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
export function isClaudeDesignRelativePath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 512 &&
    !/[ @\\:]/.test(v) &&
    ![...v].some((c) => c.charCodeAt(0) < 32) &&
    v.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
/** Canonical private editor reference; credentials, query strings and redirects are never inputs. */
export function claudeDesignRemoteId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://claude.ai" || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/artifact\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    return match && url.href === value ? (match[1] ?? null) : null;
  } catch {
    return null;
  }
}
export function parseClaudeDesignTask(value: unknown): ClaudeDesignTask | null {
  if (!object(value) || !id(value.jobId) || !positive(value.grantRevision)) return null;
  if (value.mode === "recover") {
    return keys(value, ["mode", "jobId", "grantRevision", "remoteCandidateUrl"]) &&
      claudeDesignRemoteId(value.remoteCandidateUrl)
      ? (value as unknown as ClaudeDesignRecoveryTask)
      : null;
  }
  if (
    value.mode !== "execute" ||
    !keys(value, ["mode", "jobId", "action", "title", "brief", "target", "sources", "grantRevision"])
  )
    return null;
  if (!text(value.title, CLAUDE_DESIGN_LIMITS.titleChars) || !text(value.brief, CLAUDE_DESIGN_LIMITS.briefChars))
    return null;
  if (value.action === "create") {
    if ("target" in value) return null;
  } else if (value.action === "update") {
    const t = value.target;
    if (
      !object(t) ||
      !keys(t, ["remoteId", "remoteUrl", "remoteVersion", "revision"]) ||
      !id(t.remoteId) ||
      claudeDesignRemoteId(t.remoteUrl) !== t.remoteId ||
      !text(t.remoteVersion, 256) ||
      !positive(t.revision)
    )
      return null;
  } else return null;
  if (!Array.isArray(value.sources) || value.sources.length > CLAUDE_DESIGN_LIMITS.maxSources) return null;
  const paths = new Set<string>();
  for (const s of value.sources) {
    if (
      !object(s) ||
      !keys(s, ["name", "relativePath", "sha256"]) ||
      !text(s.name, 255) ||
      !isClaudeDesignRelativePath(s.relativePath) ||
      !hash(s.sha256) ||
      paths.has(s.relativePath)
    )
      return null;
    paths.add(s.relativePath);
  }
  return value as unknown as ClaudeDesignExecuteTask;
}
export function parseClaudeDesignResult(value: unknown): ClaudeDesignResult | null {
  if (
    !object(value) ||
    !keys(value, [
      "jobId",
      "state",
      "remote",
      "publicationSequence",
      "sourceFiles",
      "error",
      "recoveryEvidence",
      "usage",
    ]) ||
    !id(value.jobId)
  )
    return null;
  if (!["queued", "running", "published", "succeeded", "failed", "canceled", "unknown"].includes(value.state as string))
    return null;
  if (value.remote !== undefined) {
    const r = value.remote;
    if (
      !object(r) ||
      !keys(r, ["id", "url", "version"]) ||
      !id(r.id) ||
      claudeDesignRemoteId(r.url) !== r.id ||
      !text(r.version, 256)
    )
      return null;
  }
  if (
    value.publicationSequence !== undefined &&
    (!value.remote ||
      !Number.isInteger(value.publicationSequence) ||
      (value.publicationSequence as number) < 1 ||
      (value.publicationSequence as number) > 2)
  )
    return null;
  if ((value.state === "published" || value.state === "succeeded") && !value.remote) return null;
  if (
    value.error !== undefined &&
    (!object(value.error) ||
      !keys(value.error, ["code", "message"]) ||
      !failures.includes(value.error.code as ClaudeDesignFailure) ||
      !text(value.error.message, 500))
  )
    return null;
  if (value.state === "succeeded" && value.error) return null;
  if (value.usage !== undefined) {
    const u = value.usage;
    if (
      !object(u) ||
      !keys(u, ["model", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) ||
      !text(u.model, 128) ||
      ![u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens].every(
        (n) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1_000_000_000,
      )
    )
      return null;
  }
  if (
    value.recoveryEvidence !== undefined &&
    ((value.recoveryEvidence !== "provider_checkpoint" && value.recoveryEvidence !== "owner_association") ||
      !value.remote)
  )
    return null;
  if (!Array.isArray(value.sourceFiles) || value.sourceFiles.length > CLAUDE_DESIGN_LIMITS.maxOutputFiles) return null;
  const paths = new Set<string>();
  let bytes = 0;
  for (const f of value.sourceFiles) {
    if (
      !object(f) ||
      !keys(f, ["relativePath", "sha256", "size", "contentType"]) ||
      !isClaudeDesignRelativePath(f.relativePath) ||
      !hash(f.sha256) ||
      !Number.isSafeInteger(f.size) ||
      (f.size as number) < 0 ||
      !text(f.contentType, 128) ||
      paths.has(f.relativePath)
    )
      return null;
    paths.add(f.relativePath);
    bytes += f.size as number;
  }
  return bytes <= CLAUDE_DESIGN_LIMITS.maxOutputBytes ? (value as unknown as ClaudeDesignResult) : null;
}
export function parseClaudeDesignEffectRequest(value: unknown): ClaudeDesignEffectRequest | null {
  if (
    !object(value) ||
    !keys(value, [
      "type",
      "requestId",
      "taskId",
      "jobId",
      "grantRevision",
      "sequence",
      "effect",
      "toolUseId",
      "inputHash",
      "consentRequestId",
      "remoteId",
      "remoteVersion",
      "checkpoint",
    ]) ||
    value.type !== "design.authorize" ||
    !id(value.requestId) ||
    !id(value.taskId) ||
    !id(value.jobId) ||
    !positive(value.grantRevision) ||
    !positive(value.sequence)
  )
    return null;
  if (value.checkpoint !== undefined) {
    const checkpoint = parseClaudeDesignResult(value.checkpoint);
    if (!checkpoint?.remote || checkpoint.jobId !== value.jobId || checkpoint.state !== "published") return null;
  }
  if (value.effect === "create") {
    if ("remoteId" in value || "remoteVersion" in value) return null;
  } else if (value.effect === "read_target" || value.effect === "publish") {
    if (
      !id(value.remoteId) ||
      (value.effect === "publish" && !text(value.remoteVersion, 256)) ||
      (value.remoteVersion !== undefined && !text(value.remoteVersion, 256))
    )
      return null;
  } else return null;
  if (
    (value.toolUseId !== undefined || value.inputHash !== undefined) &&
    (!id(value.toolUseId) || !hash(value.inputHash))
  )
    return null;
  if (
    value.consentRequestId !== undefined &&
    (!uuid(value.consentRequestId) || !value.toolUseId || value.effect !== "read_target")
  )
    return null;
  return value as unknown as ClaudeDesignEffectRequest;
}
export function parseClaudeDesignEffectReply(value: unknown): ClaudeDesignEffectReply | null {
  if (
    !object(value) ||
    !keys(value, ["type", "requestId", "allow", "error"]) ||
    value.type !== "design.authorized" ||
    !id(value.requestId) ||
    typeof value.allow !== "boolean"
  )
    return null;
  if (value.allow ? value.error !== undefined : !failures.includes(value.error as ClaudeDesignFailure)) return null;
  return value as unknown as ClaudeDesignEffectReply;
}

/** Validate the dedicated envelope at the real server→runner boundary, before any executor dispatch. */
export function validClaudeDesignEnvelope(v: Record<string, unknown>): boolean {
  if (
    !keys(v, ["type", "id", "op", "agent", "taskId", "executor", "account", "claudeDesign", "maxSeconds", "coAuthors"])
  )
    return false;
  return (
    v.executor === "claude" &&
    id(v.taskId) &&
    id(v.account) &&
    object(v.agent) &&
    id(v.agent.id) &&
    text(v.agent.handle, 80) &&
    !!parseClaudeDesignTask(v.claudeDesign) &&
    (v.maxSeconds === undefined ||
      (positive(v.maxSeconds) && (v.maxSeconds as number) <= CLAUDE_DESIGN_LIMITS.maxSeconds))
  );
}

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function parseClaudeDesignConsentRequest(value: unknown): ClaudeDesignConsentRequest | null {
  if (
    !object(value) ||
    !keys(value, [
      "type",
      "requestId",
      "jobId",
      "taskId",
      "grantRevision",
      "sequence",
      "toolUseId",
      "inputHash",
      "remoteId",
      "description",
    ]) ||
    value.type !== "design.consent" ||
    !uuid(value.requestId) ||
    !uuid(value.jobId) ||
    !uuid(value.taskId) ||
    !positive(value.grantRevision) ||
    !positive(value.sequence) ||
    !id(value.toolUseId) ||
    !hash(value.inputHash) ||
    !id(value.remoteId) ||
    !text(value.description, 2000)
  )
    return null;
  return value as unknown as ClaudeDesignConsentRequest;
}
export function parseClaudeDesignConsentReply(value: unknown): ClaudeDesignConsentReply | null {
  if (
    !object(value) ||
    !keys(value, ["type", "requestId", "pending", "allow"]) ||
    value.type !== "design.consented" ||
    !uuid(value.requestId) ||
    typeof value.pending !== "boolean" ||
    typeof value.allow !== "boolean" ||
    (value.pending && value.allow)
  )
    return null;
  return value as unknown as ClaudeDesignConsentReply;
}
