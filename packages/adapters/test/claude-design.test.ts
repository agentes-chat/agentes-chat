import { expect, test } from "bun:test";
import {
  CLAUDE_DESIGN_LIMITS,
  isClaudeDesignCompatible,
  parseClaudeDesignConsentReply,
  parseClaudeDesignConsentRequest,
  parseClaudeDesignResult,
  parseClaudeDesignTask,
} from "../src/claude-design";
import { parseRunnerFrame, parseRunnerTask, parseServerFrame } from "../src/machine-protocol";

const create = {
  mode: "execute" as const,
  jobId: "job-1",
  action: "create" as const,
  title: "Sample",
  brief: "Make a design",
  sources: [],
  grantRevision: 1,
};
const target = {
  remoteId: "abc123",
  remoteUrl: new URL("/artifact/abc123", "https://claude.ai").href,
  remoteVersion: "opaque-1",
  revision: 1,
};
const wire = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "request",
    id: "req-1",
    op: "task.start",
    taskId: "task-1",
    agent: { id: "agent-1", handle: "dev" },
    executor: "claude",
    account: "account-1",
    claudeDesign: create,
    ...fields,
  });

test("design_task_requires_explicit_account", () => {
  expect(parseServerFrame(wire())).not.toBeNull();
  expect(parseServerFrame(wire({ account: undefined }))).toBeNull();
  expect(parseServerFrame(wire({ account: "" }))).toBeNull();
});
test("update_requires_target and create_refuses_target", () => {
  expect(parseClaudeDesignTask(create)).toEqual(create);
  expect(parseClaudeDesignTask({ ...create, action: "update" })).toBeNull();
  expect(parseClaudeDesignTask({ ...create, target })).toBeNull();
  expect(parseClaudeDesignTask({ ...create, action: "update", target })).not.toBeNull();
  expect(parseClaudeDesignTask({ ...create, action: "update", target: { ...target, remoteId: "other" } })).toBeNull();
});
test("design_task_refuses_shell_mission_and_generic_resume", () => {
  for (const fields of [
    { executor: "shell" },
    { command: "pwd" },
    { mission: {} },
    { session: "session" },
    { resume: true },
    { cwd: ".." },
    { branch: "branch" },
    { prompt: "override" },
    { model: "override" },
    { env: {} },
  ]) {
    expect(parseServerFrame(wire(fields))).toBeNull();
  }
  expect(parseServerFrame(wire({ maxSeconds: 901 }))).toBeNull();
  expect(parseServerFrame(wire({ claudeDesign: null }))).toBeNull();
});
test("recovery_mode_refuses_execution_fields", () => {
  const recover = { mode: "recover" as const, jobId: "job-1", grantRevision: 1, remoteCandidateUrl: target.remoteUrl };
  expect(parseClaudeDesignTask(recover)).toEqual(recover);
  expect(parseClaudeDesignTask({ ...recover, brief: "write" })).toBeNull();
  for (const url of [
    "https://example.com/a",
    `${target.remoteUrl}?x=1`,
    new URL("/artifact/a", "https://user:pass@claude.ai").href,
    new URL("/artifact/a", "http://claude.ai").href,
  ]) {
    expect(parseClaudeDesignTask({ ...recover, remoteCandidateUrl: url })).toBeNull();
  }
});
test("rejects_oversized_input and unsafe source paths", () => {
  expect(parseClaudeDesignTask({ ...create, brief: "x".repeat(CLAUDE_DESIGN_LIMITS.briefChars + 1) })).toBeNull();
  expect(parseClaudeDesignTask({ ...create, title: "x".repeat(121) })).toBeNull();
  expect(parseClaudeDesignTask({ ...create, action: "delete" })).toBeNull();
  expect(parseClaudeDesignTask({ ...create, extra: true })).toBeNull();
  for (const relativePath of [
    "/secret",
    "../secret",
    "a/../secret",
    "C:\\secret",
    "a\\secret",
    "@secret",
    "a//b",
    "a/./b",
  ]) {
    expect(
      parseClaudeDesignTask({ ...create, sources: [{ name: "file", relativePath, sha256: "a".repeat(64) }] }),
    ).toBeNull();
  }
  const source = { name: "file", relativePath: "sources/file.html", sha256: "a".repeat(64) };
  expect(parseClaudeDesignTask({ ...create, sources: [source] })).not.toBeNull();
  expect(parseClaudeDesignTask({ ...create, sources: [source, source] })).toBeNull();
  expect(
    parseClaudeDesignTask({
      ...create,
      sources: Array.from({ length: 11 }, (_, i) => ({ ...source, relativePath: `file${i}` })),
    }),
  ).toBeNull();
});
test("unknown_state_does_not_imply_success; opaque versions and result validation survive the wire", () => {
  const unknown = {
    jobId: "job-1",
    state: "unknown" as const,
    sourceFiles: [],
    error: { code: "result_unknown" as const, message: "Interrupted" },
  };
  expect(parseClaudeDesignResult(unknown)).toEqual(unknown);
  expect(parseClaudeDesignResult({ ...unknown, state: "succeeded" })).toBeNull();
  const published = {
    jobId: "job-1",
    state: "published" as const,
    sourceFiles: [],
    remote: { id: target.remoteId, url: target.remoteUrl, version: "opaque-string" },
  };
  expect(parseClaudeDesignResult(published)).toEqual(published);
  expect(parseClaudeDesignResult({ ...published, remote: { ...published.remote, version: 12 } })).toBeNull();
  const done = { type: "task.done", taskId: "task-1", exitCode: 0, seconds: 1, claudeDesign: published };
  expect(parseRunnerFrame(JSON.stringify(done))?.type).toBe("task.done");
  expect(parseRunnerFrame(JSON.stringify({ ...done, claudeDesign: {} }))).toBeNull();
  expect(
    parseRunnerTask({ taskId: "task-1", agentId: "agent-1", status: "done", startedAt: "now", claudeDesign: unknown })
      ?.claudeDesign,
  ).toEqual(unknown);
});
test("authorization frames require a linked task, positive sequence and correlation", () => {
  const request = {
    type: "design.authorize" as const,
    requestId: "request-1",
    taskId: "task-1",
    jobId: "job-1",
    grantRevision: 1,
    sequence: 1,
    effect: "create" as const,
  };
  expect(parseRunnerFrame(JSON.stringify(request))).toEqual(request);
  for (const fields of [
    { taskId: undefined },
    { sequence: 0 },
    { grantRevision: -1 },
    { effect: "delete" },
    { unexpected: true },
  ]) {
    expect(parseRunnerFrame(JSON.stringify({ ...request, ...fields }))).toBeNull();
  }
  expect(parseRunnerFrame(JSON.stringify({ ...request, effect: "publish" }))).toBeNull();
  const reply = {
    type: "design.authorized" as const,
    requestId: "request-1",
    allow: false,
    error: "forbidden" as const,
  };
  expect(parseServerFrame(JSON.stringify(reply))).toEqual(reply);
  expect(parseServerFrame(JSON.stringify({ ...reply, allow: true }))).toBeNull();
  expect(parseServerFrame(JSON.stringify({ ...reply, requestId: "" }))).toBeNull();
});
test("availability uses only the exact validated tuple", () => {
  const tuple = { version: "2.1.322", platform: "darwin", arch: "arm64", runnerMode: "user", authMethod: "cli_login" };
  expect(isClaudeDesignCompatible(tuple)).toBe(true);
  for (const fields of [
    { version: "2.1.323" },
    { platform: "linux" },
    { arch: "x64" },
    { runnerMode: "system" },
    { authMethod: "setup_token" },
  ]) {
    expect(isClaudeDesignCompatible({ ...tuple, ...fields })).toBe(false);
  }
});

test("consent frames are strict, bounded, correlated wire messages", () => {
  const request = {
    type: "design.consent" as const,
    requestId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    grantRevision: 1,
    sequence: 2,
    toolUseId: "toolu_read",
    inputHash: "a".repeat(64),
    remoteId: "synthetic",
    description: "read an artifact (read-only)",
  };
  expect(parseClaudeDesignConsentRequest(request)).toEqual(request);
  expect(parseRunnerFrame(JSON.stringify(request))).toEqual(request);
  for (const change of [
    { inputHash: "bad" },
    { description: "x".repeat(2001) },
    { sequence: 0 },
    { requires_user_interaction: false },
    { toolUseId: "bad\nvalue" },
    { requestId: "fake" },
  ])
    expect(parseClaudeDesignConsentRequest({ ...request, ...change })).toBeNull();
  const reply = { type: "design.consented" as const, requestId: request.requestId, pending: true, allow: false };
  expect(parseServerFrame(JSON.stringify(reply))).toEqual(reply);
  expect(parseClaudeDesignConsentReply({ ...reply, allow: true })).toBeNull();
  expect(parseClaudeDesignConsentReply({ ...reply, extra: "model" })).toBeNull();
});
