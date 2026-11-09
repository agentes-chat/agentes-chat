import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import type { AgentBrain, AiAccounts, BrainOption, Credential, MachineAccount, PlanUsage } from "../src/api/types";
import { type AiRowsInput, aiNote, aiRows, currentValue, newAgentRows } from "../src/lib/ai-select";

const enI18n = i18next.createInstance();
void enI18n.init({ lng: "en", resources, initAsync: false });
const t: TFunction = enI18n.t.bind(enI18n);

const NOW = Date.parse("2026-11-09T12:00:00.000Z");

const account = (over: Partial<MachineAccount> = {}): MachineAccount => ({
  id: "acct_work",
  kind: "claude_code",
  label: "Work",
  email: "ana@example.com",
  plan: "Team",
  status: "active",
  ownerId: "u-ana",
  ownerName: "Ana Lima",
  mine: true,
  usedBy: [],
  usage: null,
  provider: null,
  keyHint: null,
  ...over,
});

const OPTIONS: BrainOption[] = [
  { kind: "model", available: true, models: [], defaultModel: null },
  { kind: "claude_code", available: true, models: [], defaultModel: "sonnet" },
  { kind: "codex", available: true, models: [], defaultModel: null },
];

const view = (over: Partial<AgentBrain> = {}): AgentBrain => ({
  agentId: "agent_ada",
  brain: "claude_code",
  model: null,
  effectiveModel: "sonnet",
  computer: { machineId: "m1", name: "MacBook", online: true },
  options: OPTIONS,
  machines: [],
  canEdit: true,
  account: "acct_work",
  effort: null,
  speed: "standard",
  accounts: [account()],
  canManageAccounts: true,
  accountsSupported: true,
  onlyOwner: true,
  canUsePlans: true,
  ownSignIn: true,
  ownUsage: {},
  ...over,
});

const key = (over: Partial<Credential> = {}): Credential => ({
  id: "key_claude",
  provider: "anthropic",
  label: "Claude key",
  keyHint: "1234",
  createdAt: "2026-10-01T00:00:00.000Z",
  revokedAt: null,
  ...over,
});

const input = (over: Partial<AiRowsInput> = {}): AiRowsInput => ({
  view: view(),
  computerName: "MacBook",
  agentName: "Ada",
  agentOwnerId: "u-ana",
  keys: [],
  defaultKey: null,
  serverKey: false,
  apiKey: true,
  keysAllowed: true,
  agentKey: null,
  now: NOW,
  ...over,
});

const usage = (usedPercent: number, resetsAt?: string): PlanUsage => ({
  windows: [{ kind: "five_hour", usedPercent, ...(resetsAt ? { resetsAt } : {}) }],
  ...(usedPercent >= 100 ? { limited: true } : {}),
  source: "probe",
  at: new Date(NOW).toISOString(),
});

const noteOf = (o: AiRowsInput, value: string) => {
  const rows = aiRows(t, "en", o);
  const row = rows.find((r) => r.value === value);
  if (!row) throw new Error(`no row ${value}`);
  return aiNote(t, "en", row, { rows, agentName: "Ada", computerName: "MacBook", cloud: false, now: NOW });
};

describe("the AI select's rows", () => {
  test("each AI once, in its group: your plans, other people's, then the keys, the workspace's default first", () => {
    const bia = account({
      id: "acct_bia",
      label: "Max",
      email: null,
      plan: null,
      ownerId: "u-bia",
      ownerName: "Bia Souza",
      mine: false,
    });
    const rows = aiRows(
      t,
      "en",
      input({
        view: view({
          accounts: [
            account(),
            account({ id: "acct_home", label: "Home", email: "ana@home.example.com", plan: "Max" }),
            bia,
          ],
          canUseOthersPlans: true,
        }),
        keys: [key({ id: "key_openai", provider: "openai", label: "OpenAI key", keyHint: "9876" }), key()],
        defaultKey: "key_claude",
      }),
    );
    expect(rows.map((r) => [r.group, r.label])).toEqual([
      ["mine", "Home · Max"],
      ["mine", "Work · Team"],
      ["others", "Max"],
      ["keys", "Claude key"],
      ["keys", "OpenAI key"],
    ]);
    // Your own say your email; someone else's whose it is, with no email.
    expect(rows[1]?.who).toBe("ana@example.com");
    expect(rows[2]?.who).toBe("Bia's");
    expect(rows[2]?.owner).toBe("Bia");
    expect(rows[3]).toMatchObject({ value: "key:default", key: null, who: "Workspace default · ends in 1234" });
    expect(rows[4]).toMatchObject({ value: "key:key_openai", key: "key_openai" });
    expect(currentValue(view(), null)).toBe("acct_work");
    expect(currentValue(view({ brain: "model" }), null)).toBe("key:default");
    expect(currentValue(view({ brain: "model" }), "key_openai")).toBe("key:key_openai");
    expect(currentValue(view({ account: null }), null)).toBe("own:claude_code");
  });

  test("a login of yours another agent thinks with signs in once more for this one; someone else's is never taken", () => {
    const theo = account({ id: "acct_theo", label: "Home", email: "ana@home.example.com", usedBy: ["Theo"] });
    const hers = account({ id: "acct_caio", label: "Pro", mine: false, ownerId: "u-caio", usedBy: ["Theo"] });
    const o = input({ view: view({ accounts: [account(), theo, hers], canUseOthersPlans: true }) });
    const rows = aiRows(t, "en", o);
    expect(rows.find((r) => r.value === "acct_theo")).toMatchObject({
      act: "signIn",
      state: "Also used by Theo",
      disabled: false,
    });
    expect(noteOf(o, "acct_theo")).toEqual({
      icon: "info",
      text: "Each agent keeps its own sign-in. They all share your plan's limits.",
      action: { kind: "signInFor", label: "Sign in for Ada" },
    });
    expect(rows.find((r) => r.value === "acct_caio")).toMatchObject({ act: "move", disabled: true });
  });

  test("someone else's plan is lent only by who may use other people's plans, after asking; its owner's own is theirs", () => {
    const bia = account({ id: "acct_bia", label: "Max", mine: false, ownerId: "u-bia", ownerName: "Bia Souza" });
    const off = aiRows(t, "en", input({ view: view({ accounts: [account(), bia] }) }));
    expect(off.find((r) => r.value === "acct_bia")?.disabled).toBe(true);
    const o = input({ view: view({ accounts: [account(), bia], canUseOthersPlans: true }) });
    expect(aiRows(t, "en", o).find((r) => r.value === "acct_bia")).toMatchObject({ act: "lend", disabled: false });
    expect(noteOf(o, "acct_bia")).toEqual({
      icon: "info",
      text: "Bia gets an email and can take it back.",
      action: { kind: "confirm", label: "Use Bia's plan" },
    });
    // An admin on someone else's agent: the agent's owner's plans think for it as any of theirs.
    const admin = input({ view: view({ accounts: [account(), bia], canUsePlans: false }), agentOwnerId: "u-bia" });
    expect(aiRows(t, "en", admin).find((r) => r.value === "acct_bia")).toMatchObject({ act: "use", disabled: false });
  });

  test("signed out: its note asks for the sign-in; a coding plan's refused key, for a new one; another agent's can't be picked", () => {
    const out = input({ view: view({ accounts: [account({ status: "signed_out" })] }) });
    expect(aiRows(t, "en", out)[0]).toMatchObject({
      state: "Signed out",
      tone: "danger",
      act: "signIn",
      disabled: false,
    });
    expect(noteOf(out, "acct_work")).toEqual({
      icon: "alert",
      text: "Work is signed out. Sign in again so Ada can use it.",
      action: { kind: "signIn", label: "Sign in again" },
    });
    const taken = account({
      id: "acct_theo",
      label: "Home",
      email: "x@example.com",
      status: "signed_out",
      usedBy: ["Theo"],
    });
    const rows = aiRows(t, "en", input({ view: view({ accounts: [account(), taken] }) }));
    expect(rows.find((r) => r.value === "acct_theo")?.disabled).toBe(true);
    const glm = input({
      view: view({ accounts: [account({ label: "GLM Coding", provider: "zai", plan: null, status: "signed_out" })] }),
    });
    expect(aiRows(t, "en", glm)[0]?.state).toBe("Key refused");
    expect(noteOf(glm, "acct_work")?.action).toEqual({ kind: "newKey", label: "Replace the key" });
  });

  test("at the limit: when it answers again, and the account with the most room as the one way out", () => {
    const resets = new Date(NOW + 2 * 3_600_000).toISOString();
    const roomy = account({ id: "acct_roomy", label: "Team 2", email: "ana@two.example.com", usage: usage(12) });
    const o = input({ view: view({ accounts: [account({ usage: usage(100, resets), usedBy: ["Ada"] }), roomy] }) });
    expect(aiRows(t, "en", o).find((r) => r.value === "acct_work")?.tone).toBe("danger");
    const note = noteOf(o, "acct_work");
    expect(note?.icon).toBe("clock");
    expect(note?.text.startsWith("On this account, Ada answers again ")).toBe(true);
    expect(note?.action).toEqual({ kind: "use", value: "acct_roomy", label: "Use Team 2 (12%)" });
    const unknown = input({ view: view({ accounts: [account({ usage: usage(100) })] }) });
    expect(noteOf(unknown, "acct_work")?.text).toBe("On this account, Ada answers again when the plan renews.");
  });

  test("the computer offline: every plan says so and the note says when it answers again; keys don't", () => {
    const o = input({ view: view({ computer: { machineId: "m1", name: "MacBook", online: false } }), keys: [key()] });
    const rows = aiRows(t, "en", o);
    expect(rows.find((r) => r.value === "acct_work")?.state).toBe("MacBook · offline");
    expect(rows.find((r) => r.group === "keys")?.state).toBeNull();
    expect(noteOf(o, "acct_work")?.icon).toBe("computer");
    expect(noteOf(o, "acct_work")?.action).toBeUndefined();
  });

  test("keys only for who may switch it onto the API; the server's own key with none of the workspace's", () => {
    expect(aiRows(t, "en", input({ keys: [key()], keysAllowed: false })).some((r) => r.group === "keys")).toBe(false);
    expect(aiRows(t, "en", input({ keys: [key()], apiKey: false })).some((r) => r.group === "keys")).toBe(false);
    const server = aiRows(t, "en", input({ serverKey: true })).filter((r) => r.group === "keys");
    expect(server.map((r) => [r.value, r.label, r.who])).toEqual([
      ["key:default", "This server's Claude key", "Set on the server"],
    ]);
    // Someone who may not list the workspace's keys sees the one the agent would think with.
    const unlisted = aiRows(t, "en", input({ keys: null })).filter((r) => r.group === "keys");
    expect(unlisted.map((r) => [r.value, r.label, r.who])).toEqual([["key:default", "API key", "Through the API"]]);
    // A revoked key is gone.
    const revoked = aiRows(t, "en", input({ keys: [key({ revokedAt: "2026-11-01T00:00:00.000Z" })] }));
    expect(revoked.some((r) => r.group === "keys")).toBe(false);
  });

  test("an AI that just thinks has no note", () => {
    expect(noteOf(input(), "acct_work")).toBeNull();
  });
});

describe("a new agent's rows (Criar agente)", () => {
  const machines = [
    {
      machineId: "m1",
      name: "MacBook",
      online: true,
      options: OPTIONS,
    },
  ];
  const accounts: AiAccounts = {
    accounts: [
      { ...account(), machineId: "m1", computer: "MacBook" },
      { ...account({ id: "acct_theo", label: "Home", usedBy: ["Theo"] }), machineId: "m1", computer: "MacBook" },
      { ...account({ id: "acct_out", label: "Old", status: "signed_out" }), machineId: "m1", computer: "MacBook" },
      {
        ...account({ id: "acct_all", label: "Shared", usedBy: ["Theo"], shared: true }),
        machineId: "m1",
        computer: "MacBook",
      },
    ],
    computers: [
      {
        machineId: "m1",
        name: "MacBook",
        online: true,
        mine: true,
        canAdd: true,
        keys: true,
        brains: { claude_code: true, codex: true },
        own: { codex: { plan: "plus" } },
      },
    ],
  };
  const base = {
    machines,
    accounts,
    ownerIsMe: true,
    keys: [key()],
    defaultKey: "key_claude",
    serverKey: false,
    apiKey: true,
    keysAllowed: true,
    now: NOW,
  };

  test("the person's free accounts and the computer's own sign-ins, then the keys; a login another agent has waits for its page", () => {
    const rows = newAgentRows(t, "en", base);
    expect(rows.map((r) => r.value)).toEqual(["acct_all", "acct_work", "own:codex:m1", "key:default"]);
    expect(rows.find((r) => r.value === "own:codex:m1")).toMatchObject({
      who: "Signed in on MacBook",
      machineId: "m1",
    });
    expect(rows.find((r) => r.value === "acct_all")?.hint).toBe("Theo thinks with it");
  });

  test("someone else's agent: only the keys", () => {
    expect(newAgentRows(t, "en", { ...base, ownerIsMe: false }).map((r) => r.group)).toEqual(["keys"]);
  });
});
