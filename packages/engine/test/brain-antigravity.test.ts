import { expect, test } from "bun:test";
import { ANTIGRAVITY_PROTOCOL, LOCKED_BRAIN_PROTOCOL, SHARED_GEMINI_PROTOCOL } from "@agenteschat/adapters";
import {
  ANTIGRAVITY_MODELS,
  GEMINI_ENTERPRISE_PROVIDER,
  sharedSignIn,
  signInProviderOf,
} from "@agenteschat/providers/plans";
import { antigravityModels, brainOptions, defaultBrainModel, isBrainKind } from "../src/brain-settings";
import { AntigravityBrain, type BrainTurnRequest, type ComputerBrainLink } from "../src/brains/codex";
import { antigravityGroupLimit, computerBrainUnavailable, NO_AI_CODES, UNAVAILABLE_CODES } from "../src/brains/select";
import { BRAIN_NAMES, BRAIN_PLAN_NAMES, type BrainEvent, type BrainTurn, isComputerBrain } from "../src/brains/types";
import { defaultAccountLabel, sharesSignIns } from "../src/machine-accounts";
import type { MachineStatus } from "../src/machine-hub";
import { scrubSignIns } from "../src/tool-detail";

const SESSION = "0193aaaa-0000-7000-8000-00000000f0df";
const ACCOUNT = { id: "0193eeee-0000-7000-8000-000000000002", label: "Gemini", status: "active" as const };

const turn = (over: Partial<BrainTurn> = {}): BrainTurn => ({
  runId: "0193aaaa-0000-7000-8000-000000000002",
  orgId: "org",
  agentId: "agent",
  channelId: "channel",
  threadRootId: null,
  system: "You are Dev.",
  messages: [{ role: "user", content: "run the tests" }],
  tools: [],
  trigger: "run the tests",
  session: { id: SESSION, resume: false, machineId: "m1", cwd: "" },
  account: ACCOUNT,
  ...over,
});

function link(opts: {
  protocol?: number;
  installed?: boolean;
  tools?: { claude: boolean; codex: boolean; antigravity?: boolean; commands: boolean };
  events?: BrainEvent[];
}): ComputerBrainLink & { sent: BrainTurnRequest[] } {
  const sent: BrainTurnRequest[] = [];
  return {
    sent,
    async status() {
      return {
        online: true,
        execAllowed: true,
        protocol: opts.protocol ?? ANTIGRAVITY_PROTOCOL,
        executors: opts.installed === false ? {} : { antigravity: { version: "agy 1.4.12" } },
        ...(opts.tools ? { access: { tools: opts.tools } } : {}),
      };
    },
    async turn(_machineId, request, { onEvent }) {
      sent.push(request);
      for (const e of opts.events ?? []) onEvent(e);
    },
  };
}

const io = () => ({
  signal: new AbortController().signal,
  executeTool: async () => {
    throw new Error("computer brains don't execute tools in the engine");
  },
});

async function collect(it: AsyncIterable<BrainEvent>) {
  const out: BrainEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const brain = (l: ComputerBrainLink, permissions?: BrainTurnRequest["permissions"]) =>
  new AntigravityBrain({
    link: l,
    mcp: async () => ({ token: "tok" }),
    ...(permissions ? { permissions: async () => permissions } : {}),
  });

test("a Gemini turn goes to the runner as kind antigravity with its account; its usage passes through as the person's plan", async () => {
  const l = link({
    events: [
      { type: "text_delta", text: "All good." },
      { type: "usage", input: 1000, output: 40, source: "plan", model: "gemini-4-argon-high", cacheRead: 400 },
      { type: "done", text: "All good.", session: { id: "c3b6" } },
    ],
  });
  const events = await collect(brain(l).run(turn({ model: "gemini-4-argon-high" }), io()));
  expect(l.sent[0]).toMatchObject({ kind: "antigravity", account: ACCOUNT.id, model: "gemini-4-argon-high" });
  expect(events.at(-1)).toEqual({ type: "done", text: "All good.", session: { id: SESSION } });
  expect(events.find((e) => e.type === "usage")).toMatchObject({ source: "plan", cacheRead: 400 });
});

test("Gemini refuses before the runner: an older runner, its CLI missing, its switch off (following Codex's when unset)", async () => {
  const first = async (l: ComputerBrainLink) => (await collect(brain(l).run(turn(), io())))[0];
  expect(await first(link({ protocol: ANTIGRAVITY_PROTOCOL - 1 }))).toMatchObject({ code: "runner_outdated" });
  expect(await first(link({ installed: false }))).toMatchObject({ code: "antigravity_missing" });
  expect(await first(link({ tools: { claude: true, codex: false, commands: true } }))).toMatchObject({
    code: "tool_off",
  });
  expect(await first(link({ tools: { claude: true, codex: true, antigravity: false, commands: true } }))).toMatchObject(
    { code: "tool_off" },
  );
  expect(ANTIGRAVITY_PROTOCOL).toBeGreaterThan(LOCKED_BRAIN_PROTOCOL);
  const l = link({ events: [{ type: "done", text: "ok" }] });
  await collect(brain(l, { mode: "chat" }).run(turn(), io()));
  expect(l.sent[0]?.permissions).toEqual({ mode: "chat" });
  expect(UNAVAILABLE_CODES.has("antigravity_missing") && NO_AI_CODES.has("antigravity_missing")).toBe(true);
});

test("Quem pensa: Gemini where its runner and CLI are, its models as the CLI listed them (else the known ones), each with its catalog model", () => {
  const machine = (over: Record<string, unknown> = {}) =>
    ({
      id: "m1",
      name: "box",
      execAllowed: true,
      protocol: ANTIGRAVITY_PROTOCOL,
      online: true,
      lastSeenAt: new Date(),
      executors: {
        antigravity: { version: "agy 1.4.12", models: [{ id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" }] },
      },
      ...over,
    }) as never;
  const option = (m: unknown) => brainOptions(m as never).find((o) => o.kind === "antigravity");
  expect(option(machine())).toMatchObject({
    available: true,
    defaultModel: null,
    models: [{ value: "gemini-4-argon-high", label: "Gemini 4 Argon (High)", modelId: "gemini-4-argon" }],
  });
  expect(option(machine({ protocol: ANTIGRAVITY_PROTOCOL - 1 }))).toMatchObject({ reason: "runner_old" });
  expect(option(machine({ executors: { detectedAt: "x" } }))).toMatchObject({ reason: "not_installed" });
  expect(option(machine({ executors: {} }))).toMatchObject({ reason: "not_reported" });
  expect(antigravityModels([]).map((m) => m.value)).toEqual(ANTIGRAVITY_MODELS.map((m) => m.id));
  // A model sold at thinking levels: the apps show one row ("Gemini 4 Argon") and offer its levels as the effort.
  expect(antigravityModels([])[0]).toMatchObject({
    value: "gemini-4-argon-medium",
    family: { id: "gemini-4-argon", label: "Gemini 4 Argon" },
    level: "medium",
  });
  expect(antigravityModels([{ id: "gemini-4-hydrogen-xhigh", label: "Gemini 4 Hydrogen (XHigh)" }])[0]).toMatchObject({
    family: { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
    level: "xhigh",
  });
  // A model that names no level (the Orchestrator) is a choice of its own.
  expect(
    antigravityModels([{ id: "gemini-pro-orchestrator-g1-pro", label: "Orchestrator (Argon)" }])[0],
  ).not.toHaveProperty("family");
  // A slug's level suffix comes off to find its catalog model, "-xhigh" too; one with no catalog row has none.
  expect(antigravityModels([{ id: "claude-opus-5-5-high" }])[0]).toMatchObject({
    value: "claude-opus-5-5-high",
    modelId: "claude-opus-5-5",
  });
  expect(antigravityModels([{ id: "gemini-4-hydrogen-xhigh" }])[0]).not.toHaveProperty("modelId");
  expect(defaultBrainModel("antigravity")).toBeNull();
  expect(isBrainKind("antigravity") && isComputerBrain("antigravity")).toBe(true);
  expect([BRAIN_NAMES.antigravity, BRAIN_PLAN_NAMES.antigravity, defaultAccountLabel("antigravity")]).toEqual([
    "Antigravity CLI",
    "Gemini",
    "Gemini",
  ]);
});

test("a Gemini sign-in is made for all agents where each is its own OS user from protocol 58 on; Enterprise signs in again as Enterprise", () => {
  const system = (protocol: number) => ({ protocol, executors: { mode: "system" as const } }) as never;
  expect(sharesSignIns(system(SHARED_GEMINI_PROTOCOL), "antigravity")).toBe(true);
  expect(sharesSignIns(system(SHARED_GEMINI_PROTOCOL - 1), "antigravity")).toBe(false);
  expect(sharesSignIns(system(SHARED_GEMINI_PROTOCOL), "grok")).toBe(false);
  // Where every agent is the runner's own user, any sign-in thinks for all of them, as before.
  expect(sharesSignIns({ protocol: ANTIGRAVITY_PROTOCOL, executors: {} } as never, "antigravity")).toBe(true);
  expect([sharedSignIn("antigravity"), sharedSignIn("antigravity", GEMINI_ENTERPRISE_PROVIDER)]).toEqual([true, true]);
  expect(signInProviderOf(GEMINI_ENTERPRISE_PROVIDER)).toBe("enterprise");
  expect(signInProviderOf("zai")).toBe("zai");
  expect(signInProviderOf(null)).toBeUndefined();
});

test("availability: Gemini's account decides, signed out says so", () => {
  const status = {
    name: "box",
    online: true,
    execAllowed: true,
    protocol: ANTIGRAVITY_PROTOCOL,
    pairedByUserId: "u1",
    executors: { antigravity: { version: "agy 1.4.12" }, detectedAt: new Date().toISOString() },
  } as unknown as MachineStatus;
  expect(computerBrainUnavailable("antigravity", "m1", status, Date.now(), ACCOUNT)).toBeNull();
  expect(
    computerBrainUnavailable("antigravity", "m1", status, Date.now(), { ...ACCOUNT, status: "signed_out" }),
  ).toMatchObject({ code: "not_logged_in" });
});

test("the right hand's reply never carries a Google token, refresh token, key or client secret", () => {
  // Made up, and built here so no scanner reads them as real ones.
  const access = ["ya29", ".", "a0FakeAccessTokenForTestsOnly_x"].join("");
  const refresh = ["1//", "0gFakeRefreshTokenForTestsOnly"].join("");
  const key = ["AIza", "FakeKeyForTestsOnly0123456789abcdef"].join("");
  const secret = ["GOCSPX", "-FakeClientSecretForTests"].join("");
  const out = scrubSignIns(`token ${access} refresh ${refresh} key ${key} secret ${secret}`, "[removed]");
  for (const v of [access, refresh, key, secret]) expect(out.text).not.toContain(v);
  expect(out.found).toBe(4);
});

test("a model group reached its quota: its own models wait, the other models of the plan keep working", () => {
  // What agy /usage reported (2026-11-15): the plan fine, the Claude and GPT weekly group full, Argon free.
  const usage = {
    at: "2026-11-15T20:53:55.287Z",
    source: "probe" as const,
    windows: [
      { kind: "seven_day" as const, usedPercent: 10 },
      { kind: "five_hour" as const, usedPercent: 0 },
      {
        kind: "other" as const,
        label: "Claude and GPT models · 7d",
        usedPercent: 100,
        resetsAt: "2026-11-17T22:42:00.000Z",
      },
      { kind: "other" as const, label: "Claude and GPT models · 5h", usedPercent: 0 },
      { kind: "other" as const, label: "Gemini 4 Argon Gemini 4 Argon · 7d", usedPercent: 0 },
    ],
  };
  const now = Date.parse("2026-11-15T21:00:00Z");
  // The model that was refused waits for its group; another group and other models are not the plan limit.
  expect(antigravityGroupLimit(usage, "gemini-4-argon-medium", now)).toMatchObject({ group: "argon", full: false });
  expect(antigravityGroupLimit(usage, "claude-opus-5-5-high", now)).toMatchObject({
    group: "claude",
    full: true,
    resetsAt: "2026-11-17T22:42:00.000Z",
  });
  expect(antigravityGroupLimit(usage, "gpt-oss-120b-medium", now)).toMatchObject({ group: "claude", full: true });
  // A window whose reset has passed is empty again.
  expect(antigravityGroupLimit(usage, "claude-opus-5-5-high", Date.parse("2026-11-18T00:00:00Z")).full).toBe(false);
  // No reading yet: nothing is known, so nothing is called full.
  expect(antigravityGroupLimit(null, "claude-opus-5-5-high", now)).toMatchObject({ group: "claude", full: false });
});
