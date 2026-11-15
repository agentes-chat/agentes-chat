import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { ClaudeDesignConsentRequest } from "@agenteschat/adapters/claude-design";
import {
  CLAUDE_DESIGN_LIMITS,
  type ClaudeDesignEffectRequest,
  type ClaudeDesignFailure,
  type ClaudeDesignRemote,
  type ClaudeDesignTask,
  claudeDesignRemoteId,
  isClaudeDesignRelativePath,
} from "@agenteschat/adapters/claude-design";

export type GuardDecision = { allow: true } | { allow: false; reason: ClaudeDesignFailure };
export interface ApprovedDesignTool {
  name: string;
  input: Record<string, unknown>;
  authorization?: ClaudeDesignEffectRequest;
}
export interface DesignGuardSession {
  taskId: string;
  accountId: string;
  workspace: string;
  task: ClaudeDesignTask;
  sequence: number;
  created: boolean;
  publishing: boolean;
  typeUrl?: string;
  remote?: ClaudeDesignRemote;
  reads: Set<string>;
  approved: Map<string, ApprovedDesignTool>;
  authorizing?: boolean;
  completed?: Set<string>;
}
const denied: GuardDecision = { allow: false, reason: "guard_failed" };
const allow: GuardDecision = { allow: true };
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function only(v: Record<string, unknown>, fields: string[]) {
  return Object.keys(v).every((k) => fields.includes(k));
}
function callOf(raw: unknown): { name: string; input: Record<string, unknown>; id?: string } | null {
  if (!record(raw) || typeof raw.tool_name !== "string" || !record(raw.tool_input)) return null;
  return {
    name: raw.tool_name,
    input: raw.tool_input,
    ...(typeof raw.tool_use_id === "string" && raw.tool_use_id.length <= 128 ? { id: raw.tool_use_id } : {}),
  };
}
/** Resolve every existing component, never a symlink or nonregular file. Also rejects lexically hidden traversals. */
export function designFile(session: DesignGuardSession, file: unknown, write = false): string | null {
  if (typeof file !== "string" || !path.isAbsolute(file)) return null;
  const relative = path.relative(session.workspace, file);
  if (!isClaudeDesignRelativePath(relative) || path.join(session.workspace, relative) !== file) return null;
  if (
    relative.startsWith("sources/") &&
    (session.task.mode !== "execute" || !session.task.sources.some((s) => s.relativePath === relative))
  )
    return null;
  if (
    write
      ? !/^project\/(?:[\w-]+\/)*[\w.-]+\.(?:json|html|css|svg)$/.test(relative)
      : !/^(?:project|sources|\.cli)\//.test(relative)
  )
    return null;
  try {
    if (realpathSync(session.workspace) !== session.workspace) return null;
    const parts = relative.split("/");
    let current = session.workspace;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(current);
      } catch {
        return write && index === parts.length - 1 ? relative : null;
      }
      if (
        st.isSymbolicLink() ||
        (index === parts.length - 1 && st.nlink > 1) ||
        (index < parts.length - 1 ? !st.isDirectory() : !st.isFile())
      )
        return null;
      if (index === parts.length - 1 && st.size > CLAUDE_DESIGN_LIMITS.maxSourceBytes) return null;
    }
    return relative;
  } catch {
    return null;
  }
}
function outputSize(root: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const child = outputSize(file);
      bytes += child.bytes;
      files += child.files;
    } else if (entry.isFile()) {
      bytes += statSync(file).size;
      files++;
    } else throw new Error("Nonregular output");
    if (files > CLAUDE_DESIGN_LIMITS.maxOutputFiles || bytes > CLAUDE_DESIGN_LIMITS.maxOutputBytes)
      throw new Error("Output limit exceeded");
  }
  return { bytes, files };
}
function targetUrl(s: DesignGuardSession): string | undefined {
  return s.remote?.url ?? (s.task.mode === "recover" ? s.task.remoteCandidateUrl : s.task.target?.remoteUrl);
}
export function decideClaudeDesignTool(s: DesignGuardSession, raw: unknown): GuardDecision {
  const call = callOf(raw);
  if (!call) return denied;
  const i = call.input;
  if (call.name === "Read")
    return only(i, ["file_path", "offset", "limit"]) && designFile(s, i.file_path) ? allow : denied;
  if (call.name === "Write") {
    if (
      s.task.mode === "recover" ||
      s.publishing ||
      !only(i, ["file_path", "content"]) ||
      typeof i.content !== "string" ||
      !designFile(s, i.file_path, true)
    )
      return denied;
    try {
      const size = outputSize(path.join(s.workspace, "project"));
      return Buffer.byteLength(i.content) <= CLAUDE_DESIGN_LIMITS.maxSourceBytes &&
        size.files < CLAUDE_DESIGN_LIMITS.maxOutputFiles &&
        size.bytes + Buffer.byteLength(i.content) <= CLAUDE_DESIGN_LIMITS.maxOutputBytes
        ? allow
        : denied;
    } catch {
      return denied;
    }
  }
  if (call.name !== "Artifact") return denied;
  if (i.action === "quickstart")
    return s.task.mode === "execute" && i.intent === "design" && only(i, ["action", "intent"]) ? allow : denied;
  if (i.action === "list")
    return s.reads.has("metadata") &&
      i.url === targetUrl(s) &&
      targetUrl(s) &&
      i.scope === "files" &&
      only(i, ["action", "url", "scope"])
      ? allow
      : denied;
  if (i.action === "read") {
    return i.url === targetUrl(s) &&
      targetUrl(s) &&
      only(i, ["action", "url", "path"]) &&
      (i.path === undefined ||
        (s.reads.has("metadata") &&
          !s.reads.has("empty") &&
          typeof i.path === "string" &&
          /^project\/[\w./-]+\.(?:html|json|css|svg)$/.test(i.path) &&
          isClaudeDesignRelativePath(i.path)))
      ? allow
      : denied;
  }
  if (s.task.mode !== "execute" || s.publishing || (i.action !== undefined && i.action !== "publish")) return denied;
  if ([...s.approved].some(([id, tool]) => tool.name === "Write" && !s.completed?.has(id))) return denied;
  if (s.task.action === "create" && !s.created && !s.remote) {
    return s.typeUrl &&
      i.type_url === s.typeUrl &&
      i.title === s.task.title &&
      i.auto_open === "after_first_write" &&
      only(i, ["action", "type_url", "title", "auto_open"])
      ? allow
      : denied;
  }
  if (
    !s.remote ||
    i.url !== s.remote.url ||
    i.root !== s.workspace ||
    !s.reads.has("metadata") ||
    !only(i, ["action", "url", "root", "file_path", "files"])
  )
    return denied;
  if (s.task.action === "update" && s.remote.version !== s.task.target?.remoteVersion)
    return { allow: false, reason: "conflict" };
  const relative = designFile(s, i.file_path);
  if (!relative?.startsWith("project/")) return denied;
  if (s.task.action === "update" && !s.reads.has(relative) && !s.reads.has("empty")) return denied;
  if (i.files !== undefined) {
    if (!record(i.files) || Object.keys(i.files).length > CLAUDE_DESIGN_LIMITS.maxOutputFiles) return denied;
    for (const [remote, local] of Object.entries(i.files)) {
      if (
        remote !== local ||
        typeof local !== "string" ||
        !isClaudeDesignRelativePath(local) ||
        !local.startsWith("project/") ||
        !designFile(s, path.join(s.workspace, local)) ||
        (s.task.action === "update" && !s.reads.has(remote) && !s.reads.has("empty"))
      )
        return denied;
    }
  }
  try {
    outputSize(path.join(s.workspace, "project"));
    return allow;
  } catch {
    return denied;
  }
}
export async function authorizeClaudeDesignTool(
  s: DesignGuardSession,
  raw: unknown,
  authorize: (request: ClaudeDesignEffectRequest) => Promise<boolean>,
  timeoutMs = 5000,
): Promise<GuardDecision> {
  const call = callOf(raw);
  const decision = decideClaudeDesignTool(s, raw);
  if (!call || !decision.allow || s.authorizing) return denied;
  if (call.name !== "Artifact" || call.input.action === "quickstart") {
    if (call.id) s.approved.set(call.id, { name: call.name, input: call.input });
    return allow;
  }
  if (
    !call.id ||
    s.approved.has(call.id) ||
    [...s.approved].some(([id, tool]) => tool.name === "Artifact" && !s.completed?.has(id))
  )
    return denied;
  s.authorizing = true;
  const effect =
    call.input.action === "read" || call.input.action === "list" ? "read_target" : s.remote ? "publish" : "create";
  const remoteId = claudeDesignRemoteId(targetUrl(s));
  const request: ClaudeDesignEffectRequest = {
    type: "design.authorize",
    requestId: crypto.randomUUID(),
    taskId: s.taskId,
    jobId: s.task.jobId,
    grantRevision: s.task.grantRevision,
    sequence: ++s.sequence,
    toolUseId: call.id,
    inputHash: designInputHash(call.input),
    effect,
    ...(remoteId ? { remoteId } : {}),
    ...(s.remote
      ? { remoteVersion: s.remote.version }
      : s.task.mode === "execute" && s.task.target
        ? { remoteVersion: s.task.target.remoteVersion }
        : {}),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ok = await Promise.race([
      authorize(request),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!ok) return { allow: false, reason: "forbidden" };
    if (effect === "create") s.created = true;
    if (effect === "publish") s.publishing = true;
    s.approved.set(call.id, { name: call.name, input: call.input, authorization: request });
    return allow;
  } catch {
    return denied;
  } finally {
    clearTimeout(timer);
    s.authorizing = false;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** The explicit CLI ask rule closes the path where PreToolUse was disabled or skipped. */
export function authorizeDesignPermission(
  s: DesignGuardSession,
  completed: Set<string>,
  granted: Set<string>,
  raw: unknown,
): boolean {
  const call = callOf(raw);
  if (!call || s.authorizing || (call.name === "Write" && s.publishing)) return false;
  let input = call.input;
  // Measured native 2.1.322 permission callback adds these fields after PreToolUse.
  // Model-supplied fields still fail the hook's exact schema; native disclosure bypass is never accepted.
  if (call.name === "Artifact" && Object.keys(input).some((k) => k.startsWith("__artifact"))) {
    if (input.action === "read" && "__artifactReadTargetPin" in input) {
      const {
        __artifactReadTargetPin: pin,
        __artifactConsentAskCanReachUser: reach,
        __artifactPlanConsentAsk: plan,
        __artifactUserOnlyConsentAsk: user,
        __artifactDisplayTarget: display,
        ...plain
      } = input;
      if (
        !record(pin) ||
        !only(pin, ["action", "slug"]) ||
        pin.action !== "read" ||
        typeof pin.slug !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pin.slug) ||
        reach !== false ||
        plan !== false ||
        user !== false ||
        !record(display) ||
        !only(display, ["url", "title"]) ||
        display.url !== targetUrl(s) ||
        typeof display.title !== "string" ||
        !display.title.length ||
        display.title.length > 500
      )
        return false;
      input = plain;
    } else if ("__artifactPublishSourcePin" in input) {
      const {
        __artifactPlanConsentAsk: plan,
        __artifactPublishTarget: target,
        __artifactRoomJoinDisclosed: disclosed,
        __artifactPublishSourcePin: pin,
        ...plain
      } = input;
      if (
        plan !== false ||
        disclosed !== false ||
        target !== targetUrl(s) ||
        plain.url !== targetUrl(s) ||
        !record(pin) ||
        !only(pin, ["path", "kind", "redirected", "root", "minted", "type"]) ||
        pin.path !== plain.file_path ||
        !designFile(s, pin.path) ||
        pin.kind !== "file" ||
        pin.redirected !== false ||
        pin.type !== false ||
        !record(pin.root) ||
        !only(pin.root, ["spelling", "base", "redirected"]) ||
        pin.root.spelling !== s.workspace ||
        pin.root.base !== s.workspace ||
        plain.root !== s.workspace ||
        pin.root.redirected !== false ||
        typeof pin.minted !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pin.minted)
      )
        return false;
      input = plain;
    } else {
      const { __artifactPublishTarget, __artifactRoomJoinDisclosed, __artifactTypeCreatePin, ...plain } = input;
      if (
        __artifactRoomJoinDisclosed !== false ||
        (__artifactPublishTarget !== null && __artifactPublishTarget !== targetUrl(s)) ||
        (__artifactTypeCreatePin !== undefined &&
          (typeof __artifactTypeCreatePin !== "string" ||
            !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(__artifactTypeCreatePin)))
      )
        return false;
      input = plain;
    }
  }
  for (const [id, tool] of s.approved) {
    if (completed.has(id)) continue;
    if (call.id && call.name !== "Read" && call.id !== id) continue;
    if (tool.name === call.name && canonical(tool.input) === canonical(input) && !granted.has(id)) {
      granted.add(id);
      return true;
    }
    // Artifact's internal Read remains confined, while its authorized operation is still in progress.
    if (tool.name === "Artifact" && call.name === "Read" && decideClaudeDesignTool(s, raw).allow) return true;
  }
  return false;
}

export function designInputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}
/** Only the measured, bounded SDK request schema is admitted. Future disclosure surfaces fail closed. */
export async function authorizeDesignSdkPermission(
  s: DesignGuardSession,
  granted: Set<string>,
  raw: unknown,
  authorize: (request: ClaudeDesignEffectRequest) => Promise<boolean>,
  consent: ((request: ClaudeDesignConsentRequest) => Promise<boolean>) | undefined,
  live: () => boolean,
): Promise<boolean> {
  if (
    !record(raw) ||
    !only(raw, [
      "subtype",
      "tool_name",
      "tool_use_id",
      "input",
      "description",
      "decision_reason",
      "display_name",
      "decision_reason_type",
      "decision_reason_rule_source",
      "matched_ask_rule",
      "requires_user_interaction",
      "suppress_always_allow_rule",
      "server_policy_ask_only",
    ]) ||
    typeof raw.tool_name !== "string" ||
    !record(raw.input) ||
    typeof raw.tool_use_id !== "string" ||
    (raw.requires_user_interaction !== undefined && typeof raw.requires_user_interaction !== "boolean") ||
    !live()
  )
    return false;
  // Measured create explanation, not a substitute for the native human-interaction flag.
  // Other operations carrying new disclosure text remain unsupported until measured and displayed.
  if (
    raw.decision_reason !== undefined &&
    (typeof raw.decision_reason !== "string" ||
      !raw.decision_reason.trim() ||
      raw.decision_reason.length > 2000 ||
      raw.tool_name !== "Artifact" ||
      typeof raw.input.type_url !== "string" ||
      raw.input.url !== undefined ||
      raw.requires_user_interaction === true)
  )
    return false;
  const id = raw.tool_use_id;
  if (granted.has(id) || s.completed?.has(id) || s.authorizing) return false;
  const tool = s.approved.get(id);
  // Artifact's internal confined Read can have no separate PreToolUse. It must never carry a human disclosure.
  if (!tool && raw.tool_name === "Read" && raw.requires_user_interaction !== true)
    return authorizeDesignPermission(s, s.completed ?? new Set(), granted, {
      tool_name: raw.tool_name,
      tool_input: raw.input,
    });
  if (!tool || tool.name !== raw.tool_name) return false;
  if (tool.name !== "Artifact" && canonical(tool.input) !== canonical(raw.input)) return false;
  // Use the same native annotation validator and exact original input match without consuming the real grant yet.
  if (
    !authorizeDesignPermission(s, s.completed ?? new Set(), new Set(granted), {
      tool_name: raw.tool_name,
      tool_input: raw.input,
      tool_use_id: id,
    })
  )
    return false;
  const a = tool.authorization;
  if (raw.requires_user_interaction === true) {
    if (
      tool.name !== "Artifact" ||
      tool.input.action !== "read" ||
      !a ||
      !a.remoteId ||
      !a.inputHash ||
      !consent ||
      typeof raw.description !== "string" ||
      !raw.description.trim() ||
      raw.description.length > 2000 ||
      raw.server_policy_ask_only === true ||
      raw.description !== "read an artifact (read-only)"
    )
      return false;
    const request: ClaudeDesignConsentRequest = {
      type: "design.consent",
      requestId: crypto.randomUUID(),
      jobId: s.task.jobId,
      taskId: s.taskId,
      grantRevision: s.task.grantRevision,
      sequence: a.sequence,
      toolUseId: id,
      inputHash: a.inputHash,
      remoteId: a.remoteId,
      description:
        raw.description +
        (record(raw.input.__artifactDisplayTarget)
          ? `\nClaude artifact: ${raw.input.__artifactDisplayTarget.title}`
          : ""),
    };
    try {
      if (
        !(await consent(request)) ||
        !live() ||
        granted.has(id) ||
        s.completed?.has(id) ||
        s.sequence !== a.sequence ||
        s.approved.get(id) !== tool
      )
        return false;
      if (
        !(await authorize({
          ...a,
          requestId: crypto.randomUUID(),
          sequence: ++s.sequence,
          consentRequestId: request.requestId,
        })) ||
        !live()
      )
        return false;
    } catch {
      return false;
    }
  }
  if (!live()) return false;
  granted.add(id);
  return true;
}
