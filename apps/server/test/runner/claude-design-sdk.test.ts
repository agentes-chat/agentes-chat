import { expect, test } from "bun:test";
import type { ClaudeDesignConsentRequest, ClaudeDesignEffectRequest } from "@agenteschat/adapters/claude-design";
import {
  authorizeClaudeDesignTool,
  authorizeDesignSdkPermission,
  type DesignGuardSession,
} from "../../runner/claude-design/guard";
import { DesignSdkControl } from "../../runner/claude-design/sdk-control";

function at<T>(values: T[], i: number): T {
  const value = values[i];
  if (value === undefined) throw Error("Missing expected value");
  return value;
}
const url = new URL("/artifact/synthetic", "https://claude.ai").href;
const input = { action: "read", url };
function session(): DesignGuardSession {
  return {
    taskId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    workspace: "/tmp/unused",
    task: { mode: "recover", jobId: crypto.randomUUID(), grantRevision: 1, remoteCandidateUrl: url },
    sequence: 0,
    created: false,
    publishing: false,
    reads: new Set(),
    approved: new Map(),
    completed: new Set(),
  };
}
const request = (id = "read-1", extra = {}) => ({
  tool_name: "Artifact",
  tool_use_id: id,
  input: { ...input, __artifactPublishTarget: url, __artifactRoomJoinDisclosed: false },
  description: "read an artifact (read-only)",
  requires_user_interaction: true,
  ...extra,
});
test("SDK waits for matching initialize response before sending the user prompt and rejects duplicate controls", async () => {
  const sent: {
    type: string;
    request_id: string;
    request: { subtype: string };
    response: { response: { behavior: string; updatedInput: unknown } };
  }[] = [];
  let calls = 0;
  let failed = false;
  const sdk = new DesignSdkControl({
    write: (v) => sent.push(v as (typeof sent)[number]),
    permission: async () => {
      calls++;
      return true;
    },
    fail: () => {
      failed = true;
    },
  });
  sdk.start("prompt");
  expect(sent).toHaveLength(1);
  expect(at(sent, 0).request.subtype).toBe("initialize");
  await sdk.accept({ type: "control_response", response: { subtype: "success", request_id: "stale", response: {} } });
  expect(sent).toHaveLength(1);
  await sdk.accept({
    type: "control_response",
    response: { subtype: "success", request_id: at(sent, 0).request_id, response: {} },
  });
  expect(at(sent, 1).type).toBe("user");
  const frame = {
    type: "control_request",
    request_id: "permission-1",
    request: { subtype: "can_use_tool", ...request() },
  };
  await sdk.accept(frame);
  expect(at(sent, 2).response.response.behavior).toBe("allow");
  expect(at(sent, 2).response.response.updatedInput).toEqual(frame.request.input);
  await sdk.accept(frame);
  expect(calls).toBe(1);
  expect(failed).toBe(true);
});
test("native human review is exact, single use, and followed by a new bound authorization", async () => {
  const s = session();
  const effects: ClaudeDesignEffectRequest[] = [];
  let reviews = 0;
  const authorize = async (r: ClaudeDesignEffectRequest) => {
    effects.push(r);
    return true;
  };
  await authorizeClaudeDesignTool(s, { tool_name: "Artifact", tool_use_id: "read-1", tool_input: input }, authorize);
  const granted = new Set<string>();
  const consent = async (r: ClaudeDesignConsentRequest) => {
    reviews++;
    expect(r.inputHash).toBe(at(effects, 0).inputHash ?? "");
    expect(r.toolUseId).toBe("read-1");
    return true;
  };
  expect(await authorizeDesignSdkPermission(s, granted, request("forged"), authorize, consent, () => true)).toBe(false);
  expect(reviews).toBe(0);
  expect(await authorizeDesignSdkPermission(s, granted, request(), authorize, consent, () => true)).toBe(true);
  expect(reviews).toBe(1);
  expect(effects).toHaveLength(2);
  expect(at(effects, 1).sequence).toBe(2);
  expect(at(effects, 1).consentRequestId).toBeString();
  expect(await authorizeDesignSdkPermission(s, granted, request(), authorize, consent, () => true)).toBe(false);
  expect(reviews).toBe(1);
});
test("human denial, cancellation, unknown disclosure, absent hook and revoked final authority all deny", async () => {
  for (const mode of ["denied", "canceled", "rich", "read-reason", "nohook", "revoked"]) {
    const s = session();
    let checks = 0;
    let reviews = 0;
    const authorize = async () => ++checks === 1;
    if (mode !== "nohook")
      await authorizeClaudeDesignTool(
        s,
        { tool_name: "Artifact", tool_use_id: "read-1", tool_input: input },
        authorize,
      );
    const req = request(
      "read-1",
      mode === "rich"
        ? { unknown_disclosure: "unsupported" }
        : mode === "read-reason"
          ? { decision_reason: "New read disclosure not yet supported" }
          : {},
    );
    const ok = await authorizeDesignSdkPermission(
      s,
      new Set(),
      req,
      authorize,
      async () => {
        reviews++;
        return mode !== "denied";
      },
      () => mode !== "canceled",
    );
    expect(ok).toBe(false);
    if (mode === "rich" || mode === "read-reason" || mode === "nohook") expect(reviews).toBe(0);
  }
});
test("a second Artifact hook cannot replace an in-flight authorization even for a read", async () => {
  const s = session();
  let checks = 0;
  const authorize = async () => {
    checks++;
    return true;
  };
  expect(
    (await authorizeClaudeDesignTool(s, { tool_name: "Artifact", tool_use_id: "read-1", tool_input: input }, authorize))
      .allow,
  ).toBe(true);
  expect(
    (await authorizeClaudeDesignTool(s, { tool_name: "Artifact", tool_use_id: "read-2", tool_input: input }, authorize))
      .allow,
  ).toBe(false);
  expect(checks).toBe(1);
});

test("measured native read pins are validated, remain unchanged, and show their target title to the owner", async () => {
  const s = session();
  let shown = "";
  await authorizeClaudeDesignTool(
    s,
    { tool_name: "Artifact", tool_use_id: "read-1", tool_input: input },
    async () => true,
  );
  const annotations = {
    __artifactReadTargetPin: { action: "read", slug: "11111111-1111-4111-8111-111111111111" },
    __artifactConsentAskCanReachUser: false,
    __artifactPlanConsentAsk: false,
    __artifactUserOnlyConsentAsk: false,
    __artifactDisplayTarget: { url, title: "Private synthetic target" },
  };
  const native = { ...request(), input: { ...input, ...annotations } };
  expect(
    await authorizeDesignSdkPermission(
      s,
      new Set(),
      native,
      async () => true,
      async (r) => {
        shown = r.description;
        return true;
      },
      () => true,
    ),
  ).toBe(true);
  expect(shown).toContain("Private synthetic target");
  for (const extra of [
    { __artifactUserOnlyConsentAsk: true },
    { __artifactReadTargetPin: { action: "delete", slug: "bad" } },
    { __artifactDisplayTarget: { url: "https://foreign.invalid", title: "forged" } },
    { __artifactFutureDisclosed: true },
  ]) {
    expect(
      await authorizeDesignSdkPermission(
        s,
        new Set(),
        { ...native, input: { ...native.input, ...extra } },
        async () => true,
        async () => true,
        () => true,
      ),
    ).toBe(false);
  }
});

test("native create reason text preserves the exact hook gate and never replaces required human review", async () => {
  const s = session();
  s.task = {
    mode: "execute",
    action: "create",
    jobId: s.task.jobId,
    grantRevision: 1,
    title: "Sample",
    brief: "Synthetic design",
    sources: [],
  };
  s.typeUrl = "https://claude.ai/types/synthetic";
  const create = { title: "Sample", type_url: s.typeUrl, auto_open: "after_first_write" };
  await authorizeClaudeDesignTool(
    s,
    { tool_name: "Artifact", tool_use_id: "create-1", tool_input: create },
    async () => true,
  );
  const native = {
    subtype: "can_use_tool",
    tool_name: "Artifact",
    display_name: "Artifact",
    tool_use_id: "create-1",
    input: {
      ...create,
      __artifactPublishTarget: null,
      __artifactRoomJoinDisclosed: false,
      __artifactTypeCreatePin: "11111111-1111-4111-8111-111111111111",
    },
    description: "create a private Artifact from an Artifact type (no local files uploaded)",
    decision_reason:
      'Claude wants to create a new private artifact on claude.ai from an artifact type, titled "Sample". Its page was written by that type\'s publisher; no local file is uploaded.',
    decision_reason_type: "other",
    matched_ask_rule: { source: "flagSettings", tool_name: "Artifact" },
    suppress_always_allow_rule: true,
  };
  const granted = new Set<string>();
  let reviews = 0;
  const check = (r: unknown) =>
    authorizeDesignSdkPermission(
      s,
      granted,
      r,
      async () => true,
      async () => {
        reviews++;
        return true;
      },
      () => true,
    );
  for (const extra of [
    { decision_reason: { allow: true } },
    { decision_reason: "x".repeat(2001) },
    { future_disclosure: "unknown" },
    { requires_user_interaction: true },
    { tool_use_id: "another-create" },
    { input: { ...native.input, title: "Another title" } },
  ])
    expect(await check({ ...native, ...extra })).toBe(false);
  expect(await check(native)).toBe(true);
  expect(await check(native)).toBe(false);
  expect(native.input).toEqual({
    ...create,
    __artifactPublishTarget: null,
    __artifactRoomJoinDisclosed: false,
    __artifactTypeCreatePin: "11111111-1111-4111-8111-111111111111",
  });
  expect(reviews).toBe(0);
});
