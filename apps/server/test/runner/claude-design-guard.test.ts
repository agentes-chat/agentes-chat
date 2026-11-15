import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authorizeClaudeDesignTool,
  authorizeDesignPermission,
  authorizeDesignSdkPermission,
  type DesignGuardSession,
  decideClaudeDesignTool,
} from "../../runner/claude-design/guard";
import { buildClaudeDesignLaunch } from "../../runner/claude-design/manager";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function session(mode: "execute" | "recover" = "execute"): DesignGuardSession {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "design-guard-")));
  dirs.push(root);
  mkdirSync(path.join(root, "project"));
  mkdirSync(path.join(root, "sources"));
  mkdirSync(path.join(root, ".cli"));
  writeFileSync(path.join(root, "project/canvas.json"), "{}");
  return {
    taskId: "task-1",
    accountId: "account-1",
    workspace: root,
    task:
      mode === "execute"
        ? { mode, jobId: "job-1", action: "create", title: "Sample", brief: "A sample", sources: [], grantRevision: 1 }
        : {
            mode,
            jobId: "job-1",
            remoteCandidateUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
            grantRevision: 1,
          },
    sequence: 0,
    created: false,
    publishing: false,
    reads: new Set(),
    approved: new Map(),
    remote: undefined,
  };
}
test("denied tools never reach the provider or backend effect authorizer", async () => {
  const s = session();
  const effects: unknown[] = [];
  for (const tool_name of [
    "Bash",
    "Agent",
    "Skill",
    "ArtifactData",
    "ArtifactComments",
    "DesignSync",
    "mcp__foreign__send",
  ]) {
    const decision = await authorizeClaudeDesignTool(s, { tool_name, tool_input: {} }, async (effect) => {
      effects.push(effect);
      return true;
    });
    expect(decision.allow).toBe(false);
  }
  for (const action of ["list", "delete", "share", "search", "unknown"])
    expect(decideClaudeDesignTool(s, { tool_name: "Artifact", tool_input: { action } }).allow).toBe(false);
  expect(effects).toEqual([]);
});
test("write confinement rejects traversal, symlinks and immutable guard/config paths", () => {
  const s = session();
  const outside = path.join(s.workspace, "../outside-secret");
  expect(
    decideClaudeDesignTool(s, {
      tool_name: "Write",
      tool_input: { file_path: path.join(s.workspace, "project/new.html"), content: "sample" },
    }).allow,
  ).toBe(true);
  expect(
    decideClaudeDesignTool(s, {
      tool_name: "Read",
      tool_input: { file_path: path.join(s.workspace, "project/canvas.json") },
    }).allow,
  ).toBe(true);
  symlinkSync(os.tmpdir(), path.join(s.workspace, "project/link"));
  for (const file_path of [
    outside,
    path.join(s.workspace, "project/link/secret.json"),
    path.join(s.workspace, "settings.json"),
    path.join(s.workspace, "sources/input.html"),
    "@secret",
    "project/../settings.json",
  ]) {
    expect(decideClaudeDesignTool(s, { tool_name: "Write", tool_input: { file_path, content: "secret" } }).allow).toBe(
      false,
    );
  }
});
test("a create is one-shot and live backend rejection, timeout or errors fail closed", async () => {
  for (const authorize of [
    async () => false,
    async () => {
      throw new Error("offline");
    },
  ]) {
    const s = session();
    s.typeUrl = "https://claude.ai/types/synthetic-design";
    const call = {
      tool_use_id: "tool-1",
      tool_name: "Artifact",
      tool_input: { type_url: s.typeUrl, title: "Sample", auto_open: "after_first_write" },
    };
    expect((await authorizeClaudeDesignTool(s, call, authorize)).allow).toBe(false);
    expect(s.approved.size).toBe(0);
  }
  const s = session();
  s.typeUrl = "https://claude.ai/types/synthetic-design";
  const call = {
    tool_use_id: "tool-1",
    tool_name: "Artifact",
    tool_input: { type_url: s.typeUrl, title: "Sample", auto_open: "after_first_write" },
  };
  expect((await authorizeClaudeDesignTool(s, call, async () => true)).allow).toBe(true);
  expect((await authorizeClaudeDesignTool(s, { ...call, tool_use_id: "tool-2" }, async () => true)).allow).toBe(false);
  const timeout = session();
  timeout.typeUrl = s.typeUrl;
  expect((await authorizeClaudeDesignTool(timeout, call, async () => new Promise<boolean>(() => {}), 5)).allow).toBe(
    false,
  );
  expect(timeout.approved.size).toBe(0);
});
test("recovery permits only the selected reference's reads, never publication", async () => {
  const s = session("recover");
  if (s.task.mode !== "recover") throw new Error("not recovery");
  const read = {
    tool_use_id: "tool-1",
    tool_name: "Artifact",
    tool_input: { action: "read", url: s.task.remoteCandidateUrl },
  };
  expect((await authorizeClaudeDesignTool(s, read, async () => true)).allow).toBe(true);
  for (const tool_input of [
    { action: "read", url: "https://example.invalid" },
    { ...read.tool_input, out_dir: "/tmp" },
    { url: s.task.remoteCandidateUrl, file_path: "canvas.json" },
  ]) {
    expect(decideClaudeDesignTool(s, { tool_name: "Artifact", tool_input }).allow).toBe(false);
  }
  expect(
    decideClaudeDesignTool(s, {
      tool_name: "Write",
      tool_input: { file_path: path.join(s.workspace, "project/canvas.json"), content: "{}" },
    }).allow,
  ).toBe(false);
});
test("remote file reads wait for metadata and a proven empty target has no published files to read", () => {
  const s = session("recover");
  if (s.task.mode !== "recover") throw Error("not recovery");
  const metadata = { tool_name: "Artifact", tool_input: { action: "read", url: s.task.remoteCandidateUrl } };
  const file = { ...metadata, tool_input: { ...metadata.tool_input, path: "project/canvas.json" } };
  expect(decideClaudeDesignTool(s, metadata).allow).toBe(true);
  expect(decideClaudeDesignTool(s, file).allow).toBe(false);
  s.reads.add("metadata");
  expect(decideClaudeDesignTool(s, file).allow).toBe(true);
  s.reads.add("empty");
  expect(decideClaudeDesignTool(s, file).allow).toBe(false);
  expect(decideClaudeDesignTool(s, metadata).allow).toBe(true);
});
test("recovery lists only the validated target's own file inventory as a read effect", async () => {
  const s = session("recover");
  if (s.task.mode !== "recover") throw Error("not recovery");
  const input = { action: "list", url: s.task.remoteCandidateUrl, scope: "files" };
  const call = { tool_name: "Artifact", tool_use_id: "inventory", tool_input: input };
  expect(decideClaudeDesignTool(s, call).allow).toBe(false);
  s.reads.add("metadata");
  expect(decideClaudeDesignTool(s, call).allow).toBe(true);
  for (const extra of [
    { scope: "comments" },
    { url: new URL("/artifact/other", "https://claude.ai").href },
    { type: "Design" },
    { out_dir: s.workspace },
  ])
    expect(decideClaudeDesignTool(s, { ...call, tool_input: { ...input, ...extra } }).allow).toBe(false);
  let effect: string | undefined;
  expect(
    (
      await authorizeClaudeDesignTool(s, call, async (request) => {
        effect = request.effect;
        return true;
      })
    ).allow,
  ).toBe(true);
  expect(effect).toBe("read_target");
});
test("publication freezes writes, binds the exact target and denies force/embedded edits", async () => {
  const s = session();
  s.created = true;
  s.remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "version-1" };
  s.reads.add("metadata");
  const publish = { url: s.remote.url, root: s.workspace, file_path: path.join(s.workspace, "project/canvas.json") };
  for (const extra of [
    { force: true },
    { overwrite_unread: true },
    { edits: [] },
    { url: new URL("/artifact/other", "https://claude.ai").href },
    { root: "/tmp" },
  ]) {
    expect(decideClaudeDesignTool(s, { tool_name: "Artifact", tool_input: { ...publish, ...extra } }).allow).toBe(
      false,
    );
  }
  expect(
    (
      await authorizeClaudeDesignTool(
        s,
        { tool_use_id: "publish-1", tool_name: "Artifact", tool_input: publish },
        async () => true,
      )
    ).allow,
  ).toBe(true);
  expect(
    decideClaudeDesignTool(s, { tool_name: "Write", tool_input: { file_path: publish.file_path, content: "race" } })
      .allow,
  ).toBe(false);
});
test("dedicated launch has no personal MCP, generic resume or credential fallback", () => {
  const s = session();
  const launch = buildClaudeDesignLaunch({
    session: s,
    cli: "/test/claude",
    accountDir: "/test/account",
    settingsPath: "/test/guard/settings.json",
    capability: { version: "2.1.322", platform: "darwin", arch: "arm64", runnerMode: "user", authMethod: "cli_login" },
    baseEnv: { ANTHROPIC_API_KEY: "secret", CLAUDE_CODE_USE_BEDROCK: "1" },
  });
  expect(launch.args).toContain("--strict-mcp-config");
  expect(launch.args).not.toContain("--resume");
  expect(launch.args).not.toContain("--dangerously-skip-permissions");
  expect(launch.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(launch.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  expect(launch.env.CLAUDE_CONFIG_DIR).toBe("/test/account");
  expect(launch.env.CLAUDE_CODE_TMPDIR).toBe(path.join(s.workspace, ".cli"));
});

test("the second permission gate requires a live unconsumed hook decision", async () => {
  const s = session();
  const completed = new Set<string>();
  const granted = new Set<string>();
  const call = { tool_name: "Artifact", tool_input: { action: "quickstart", intent: "design" }, tool_use_id: "call-1" };
  expect(authorizeDesignPermission(s, completed, granted, call)).toBe(false);
  await authorizeClaudeDesignTool(s, call, async () => true);
  expect(authorizeDesignPermission(s, completed, granted, call)).toBe(true);
  expect(authorizeDesignPermission(s, completed, granted, call)).toBe(false);
  expect(authorizeDesignPermission(s, completed, granted, { ...call, tool_input: { action: "delete" } })).toBe(false);
  const newCall = { ...call, tool_use_id: "call-2" };
  await authorizeClaudeDesignTool(s, newCall, async () => true);
  completed.add("call-2");
  expect(authorizeDesignPermission(s, completed, granted, call)).toBe(false);
});

test("native create permission annotations match only a live hook and cannot change its target", async () => {
  const s = session();
  s.typeUrl = "https://claude.ai/types/synthetic";
  const input = {
    type_url: s.typeUrl,
    title: s.task.mode === "execute" ? s.task.title : "",
    auto_open: "after_first_write",
  };
  await authorizeClaudeDesignTool(
    s,
    { tool_name: "Artifact", tool_input: input, tool_use_id: "create-native" },
    async () => true,
  );
  const annotated = {
    ...input,
    __artifactPublishTarget: null,
    __artifactRoomJoinDisclosed: false,
    __artifactTypeCreatePin: "11111111-1111-4111-8111-111111111111",
  };
  expect(authorizeDesignPermission(s, new Set(), new Set(), { tool_name: "Artifact", tool_input: annotated })).toBe(
    true,
  );
  for (const extra of [
    { __artifactRoomJoinDisclosed: true },
    { __artifactPublishTarget: "foreign" },
    { __artifactTypeCreatePin: "bad" },
    { unexpected: true },
  ])
    expect(
      authorizeDesignPermission(s, new Set(), new Set(), {
        tool_name: "Artifact",
        tool_input: { ...annotated, ...extra },
      }),
    ).toBe(false);
  expect(decideClaudeDesignTool(s, { tool_name: "Artifact", tool_input: annotated }).allow).toBe(false);
});

test("native publication source pins bind the exact confined file and root without replacing the live hook", async () => {
  const s = session();
  s.created = true;
  s.remote = { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "v1" };
  s.reads.add("metadata");
  const input = { url: s.remote.url, root: s.workspace, file_path: path.join(s.workspace, "project/canvas.json") };
  expect(
    (
      await authorizeClaudeDesignTool(
        s,
        { tool_name: "Artifact", tool_use_id: "publish-native", tool_input: input },
        async () => true,
      )
    ).allow,
  ).toBe(true);
  const pin = {
    path: input.file_path,
    kind: "file",
    redirected: false,
    root: { spelling: s.workspace, base: s.workspace, redirected: false },
    minted: "11111111-1111-4111-8111-111111111111",
    type: false,
  };
  const native = {
    subtype: "can_use_tool",
    tool_name: "Artifact",
    display_name: "Artifact",
    tool_use_id: "publish-native",
    input: {
      ...input,
      __artifactPlanConsentAsk: false,
      __artifactPublishTarget: input.url,
      __artifactRoomJoinDisclosed: false,
      __artifactPublishSourcePin: pin,
    },
    description: "publish files to an Artifact created from an Artifact type",
    decision_reason_type: "rule",
    decision_reason_rule_source: "flagSettings",
    server_policy_ask_only: false,
    matched_ask_rule: { source: "flagSettings", tool_name: "Artifact" },
    suppress_always_allow_rule: true,
  };
  const unchanged = structuredClone(native.input);
  const granted = new Set<string>();
  const check = (raw: unknown) =>
    authorizeDesignSdkPermission(
      s,
      granted,
      raw,
      async () => true,
      undefined,
      () => true,
    );
  for (const extra of [
    { ...pin, path: path.join(s.workspace, "project/other.json") },
    { ...pin, redirected: true },
    { ...pin, type: true },
    { ...pin, minted: "not-a-pin" },
    { ...pin, root: { ...pin.root, base: os.tmpdir() } },
    { ...pin, root: { ...pin.root, spelling: os.tmpdir() } },
    { ...pin, root: { ...pin.root, redirected: true } },
    { ...pin, unexpected: true },
  ])
    expect(await check({ ...native, input: { ...native.input, __artifactPublishSourcePin: extra } })).toBe(false);
  expect(await check({ ...native, input: { ...native.input, __artifactPlanConsentAsk: true } })).toBe(false);
  expect(await check({ ...native, requires_user_interaction: true })).toBe(false);
  expect(await check({ ...native, tool_use_id: "another-publish" })).toBe(false);
  expect(
    await check({ ...native, input: { ...native.input, url: new URL("/artifact/other", "https://claude.ai").href } }),
  ).toBe(false);
  const approved = s.approved.get("publish-native");
  if (!approved) throw Error("missing hook authorization");
  s.approved.delete("publish-native");
  expect(await check(native)).toBe(false);
  s.approved.set("publish-native", approved);
  expect(await check(native)).toBe(true);
  expect(await check(native)).toBe(false);
  expect(native.input).toEqual(unchanged);
});

test("populating a proven empty owned target adds files without inventing a read of nonexistent remote files", () => {
  const s = session();
  const target = {
    remoteId: "synthetic",
    remoteUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
    remoteVersion: "v1",
    revision: 1,
  };
  s.task = {
    mode: "execute",
    jobId: "job-1",
    grantRevision: 1,
    action: "update",
    title: "Sample",
    brief: "Populate",
    sources: [],
    target,
  };
  s.remote = { id: target.remoteId, url: target.remoteUrl, version: target.remoteVersion };
  s.reads.add("metadata");
  const call = {
    tool_name: "Artifact",
    tool_input: { url: target.remoteUrl, root: s.workspace, file_path: path.join(s.workspace, "project/canvas.json") },
  };
  expect(decideClaudeDesignTool(s, call).allow).toBe(false);
  s.reads.add("empty");
  expect(decideClaudeDesignTool(s, call).allow).toBe(true);
});
