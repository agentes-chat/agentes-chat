import { expect, test } from "bun:test";
import { COPILOT_PROTOCOL } from "@agenteschat/adapters";
import { COPILOT_CLI_MODELS, loginPerAgent, sharedSignIn } from "@agenteschat/providers/plans";
import { brainOptions, copilotModels, defaultBrainModel, isBrainKind } from "../src/brain-settings";
import { type BrainTurnRequest, type ComputerBrainLink, CopilotBrain } from "../src/brains/codex";
import { computerBrainUnavailable, NO_AI_CODES, UNAVAILABLE_CODES } from "../src/brains/select";
import {
  BRAIN_NAMES,
  BRAIN_PLAN_NAMES,
  type BrainEvent,
  type BrainTurn,
  isComputerBrain,
  isSandboxedBrain,
} from "../src/brains/types";
import { defaultAccountLabel, sharesSignIns } from "../src/machine-accounts";
import type { MachineStatus } from "../src/machine-hub";

const SESSION = "0193aaaa-0000-7000-8000-00000000f0de";
const ACCOUNT = { id: "0193eeee-0000-7000-8000-000000000001", label: "GitHub Copilot", status: "active" as const };

const turn = (over: Partial<BrainTurn> = {}): BrainTurn => ({
  runId: "0193aaaa-0000-7000-8000-000000000001",
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
  copilot?: boolean;
  tools?: { claude: boolean; codex: boolean; copilot?: boolean; commands: boolean };
  events?: BrainEvent[];
}): ComputerBrainLink & { sent: BrainTurnRequest[] } {
  const sent: BrainTurnRequest[] = [];
  return {
    sent,
    async status() {
      return {
        online: true,
        execAllowed: true,
        protocol: opts.protocol ?? COPILOT_PROTOCOL,
        executors: opts.copilot === false ? {} : { copilot: { version: "GitHub Copilot CLI 1.0.109" } },
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
  new CopilotBrain({
    link: l,
    mcp: async () => ({ token: "tok" }),
    ...(permissions ? { permissions: async () => permissions } : {}),
  });

test("a Copilot turn goes to the runner as kind copilot with its account; its usage passes through as the person's plan", async () => {
  const l = link({
    events: [
      { type: "text_delta", text: "All good." },
      { type: "usage", input: 1000, output: 40, source: "plan", model: "gpt-6-luna", cacheRead: 400 },
      { type: "done", text: "All good.", session: { id: "9a0c" } },
    ],
  });
  const events = await collect(brain(l).run(turn({ model: "gpt-6-luna" }), io()));
  expect(l.sent[0]).toMatchObject({
    kind: "copilot",
    account: ACCOUNT.id,
    model: "gpt-6-luna",
    session: { id: SESSION },
  });
  expect(events.at(-1)).toEqual({ type: "done", text: "All good.", session: { id: SESSION } });
  expect(events.find((e) => e.type === "usage")).toMatchObject({ source: "plan", cacheRead: 400 });
});

test("Copilot refuses before the runner: an older runner, its CLI missing, its switch off (following Codex's when unset)", async () => {
  const first = async (l: ComputerBrainLink, permissions?: BrainTurnRequest["permissions"]) =>
    (await collect(brain(l, permissions).run(turn(), io())))[0];
  expect(await first(link({ protocol: COPILOT_PROTOCOL - 1 }))).toMatchObject({ code: "runner_outdated" });
  expect(await first(link({ copilot: false }))).toMatchObject({ code: "copilot_missing" });
  expect(await first(link({ tools: { claude: true, codex: false, commands: true } }))).toMatchObject({
    code: "tool_off",
  });
  expect(await first(link({ tools: { claude: true, codex: true, copilot: false, commands: true } }))).toMatchObject({
    code: "tool_off",
  });
  expect(UNAVAILABLE_CODES.has("copilot_missing")).toBe(true);
  expect(NO_AI_CODES.has("copilot_missing")).toBe(true);
});

test("Quem pensa: Copilot where its runner and CLI are, its models as the CLI listed them (else the known ones), its CLI's default", () => {
  const machine = (over: Record<string, unknown> = {}) =>
    ({
      id: "m1",
      name: "mac",
      execAllowed: true,
      protocol: COPILOT_PROTOCOL,
      online: true,
      lastSeenAt: new Date(),
      executors: { copilot: { version: "GitHub Copilot CLI 1.0.109", models: [{ id: "gpt-6-luna" }] } },
      ...over,
    }) as never;
  const option = (m: unknown) => brainOptions(m as never).find((o) => o.kind === "copilot");
  expect(option(machine())).toMatchObject({ available: true, defaultModel: null, models: [{ value: "gpt-6-luna" }] });
  expect(option(machine({ protocol: COPILOT_PROTOCOL - 1 }))).toMatchObject({
    available: false,
    reason: "runner_old",
  });
  expect(option(machine({ executors: { detectedAt: "x" } }))).toMatchObject({
    available: false,
    reason: "not_installed",
  });
  expect(option(machine({ executors: {} }))).toMatchObject({ available: false, reason: "not_reported" });
  // A runner that reports no switch for it follows Codex's.
  expect(option(machine({ access: { tools: { claude: true, codex: true, commands: true } } }))).toMatchObject({
    available: true,
  });
  expect(option(machine({ access: { tools: { claude: true, codex: false, commands: true } } }))).toMatchObject({
    available: false,
    reason: "tool_off",
  });
  expect(copilotModels([]).map((m) => m.value)).toEqual(COPILOT_CLI_MODELS.map((m) => m.id));
  expect(copilotModels([{ id: "typed-by-hand" }]).map((m) => m.value)).toEqual(["typed-by-hand"]);
  expect(defaultBrainModel("copilot")).toBeNull();
  expect(isBrainKind("copilot") && isComputerBrain("copilot")).toBe(true);
  expect([BRAIN_NAMES.copilot, BRAIN_PLAN_NAMES.copilot, defaultAccountLabel("copilot")]).toEqual([
    "Copilot CLI",
    "GitHub Copilot",
    "GitHub Copilot",
  ]);
  // It has no sandbox of its own (its paths are held to the turn's folder), like OpenCode.
  expect(isSandboxedBrain("copilot")).toBe(false);
});

test("a Copilot sign-in is never made for all agents where each is its own OS user", () => {
  expect(loginPerAgent("copilot")).toBe(true);
  expect(sharedSignIn("copilot")).toBe(false);
  const system = { protocol: COPILOT_PROTOCOL, executors: { mode: "system" as const } };
  expect(sharesSignIns(system as never, "copilot")).toBe(false);
  // Where the agents are the runner's own user, one sign-in thinks for all of its owner's agents there, as Grok's.
  expect(sharesSignIns({ protocol: COPILOT_PROTOCOL, executors: {} } as never, "copilot")).toBe(true);
});

test("availability: Copilot's account decides, signed out or at its limit says so", () => {
  const status = {
    name: "mac",
    online: true,
    execAllowed: true,
    protocol: COPILOT_PROTOCOL,
    pairedByUserId: "u1",
    executors: { copilot: { version: "GitHub Copilot CLI 1.0.109" }, detectedAt: new Date().toISOString() },
  } as unknown as MachineStatus;
  expect(computerBrainUnavailable("copilot", "m1", status, Date.now(), ACCOUNT)).toBeNull();
  expect(
    computerBrainUnavailable("copilot", "m1", status, Date.now(), { ...ACCOUNT, status: "signed_out" }),
  ).toMatchObject({ code: "not_logged_in" });
  expect(
    computerBrainUnavailable("copilot", "m1", {
      ...status,
      executors: { detectedAt: new Date().toISOString() },
    } as never),
  ).toMatchObject({ code: "copilot_missing" });
  expect(
    computerBrainUnavailable(
      "copilot",
      "m1",
      { ...status, protocol: COPILOT_PROTOCOL - 1 } as never,
      Date.now(),
      ACCOUNT,
    ),
  ).toMatchObject({ code: "runner_outdated" });
});
