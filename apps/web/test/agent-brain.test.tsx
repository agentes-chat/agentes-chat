import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type {
  Agent,
  AgentBrain,
  AiComputer,
  BrowserUnavailableReason,
  Machine,
  MachineAccount,
  PlanUsage,
} from "@agenteschat/client";
import { ApiError } from "@agenteschat/client";
import { CODING_PLANS, learnPlanModels } from "@agenteschat/client/lib/plans";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { type BrainChoice, changedKeys, type Saved, sameBrain } from "@/lib/agent-edit";
import { aiSelect, brainTitle, chooseBrain, closeAiSelect, openAiSelect } from "./ai-picker";
import {
  ADA_ID,
  createFakeApi,
  type FakeState,
  fakeAgentBrain,
  fakeBrowserOf,
  fakeMachinesOf,
  OPENROUTER_KEY,
  OPENROUTER_MODELS,
  ORG_ID,
  seedState,
} from "./fake-api";
import { hintOf, shownText } from "./hint";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  setSystemTime();
});

const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(2);
};
const brainCalls = (state: ReturnType<typeof seedState>) =>
  state.calls.filter((c) => c.method === "agents.setBrain").map((c) => c.args[2]);

async function open(state = seedState(), api = createFakeApi(state)) {
  const { services } = await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}`, { api });
  await settle(8);
  return { state, api, services };
}
/** "Como trabalha" under the name: where, who thinks, the browser. */
const sentence = () => screen().getByRole("region", { name: "Como trabalha" });
/** The "Pensa com" cell: what thinks (and its effort), and what pays (on the value's line in the fact sheet). */
const brainCell = () => {
  const cell = within(sentence()).getByRole("button", { name: "Mudar quem pensa" });
  const value = cell.querySelector(".agp-cell__value")?.cloneNode(true) as HTMLElement | undefined;
  value?.querySelector(".agp-cell__sub")?.remove();
  return {
    label: cell.querySelector("small")?.textContent,
    value: value?.textContent,
    sub: cell.querySelector(".agp-cell__sub")?.textContent,
  };
};
const dialog = async (word: string, title: string) => {
  await click(screen().getByRole("button", { name: word }));
  return screen().getByRole("dialog", { name: title });
};
const brainDialog = () => dialog("Mudar quem pensa", "Quem pensa");
/** "Quem pensa"'s select, read while open and closed again. */
const brainRows = async (d: HTMLElement) => {
  const rows = (await openAiSelect(d, "Quem pensa")).map((o) => ({
    title: brainTitle(o),
    desc: o.querySelector(".ac-menu__desc")?.textContent,
    mark: o.querySelector(".ac-brand")?.getAttribute("data-mark"),
    off: o.querySelector(".ac-brand--off") !== null,
    disabled: o.getAttribute("aria-disabled") === "true",
  }));
  await closeAiSelect();
  return rows;
};
const card = async (d: HTMLElement, name: RegExp) => (await brainRows(d)).find((r) => name.test(r.title));
const choose = chooseBrain;
const chosen = (d: HTMLElement) => aiSelect(d, "Quem pensa").textContent;
/** The opened brain's model, from its dropdown: saved at once. */
const model = (d: HTMLElement, name: RegExp) => pick(d, "Modelo", name);
/** What the opened brain's model dropdown offers (it stays open). */
const modelNames = async (d: HTMLElement) => {
  const trigger = within(d).getByRole("combobox", { name: "Modelo" });
  trigger.focus();
  await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
  return screen()
    .getAllByRole("option")
    .map((o) => o.textContent);
};
/** "Configuração avançada", opened in place under the select (ADR 0086). */
const advanced = async (d: HTMLElement) => {
  const toggle = within(d).getByRole("button", { name: /^Configuração avançada/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await click(toggle);
  return d;
};
/** The toast's Desfazer. */
const undo = () => click(screen().getByRole("button", { name: "Desfazer" }));
/** "Conectar outra IA", the select's last row: its steps open in the dialog. */
const connectOther = async (d: HTMLElement) => {
  const rows = await openAiSelect(d, "Quem pensa");
  await click(rows.find((o) => brainTitle(o) === "Conectar outra IA") as Element);
  await settle(6);
};
/** Opens one of the opened brain's dropdowns and picks an option. */
const pick = async (d: HTMLElement, select: string, option: RegExp) => {
  const trigger = within(d).getByRole("combobox", { name: select });
  trigger.focus();
  await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
  await click(screen().getByRole("option", { name: option }));
};
/** Ada's brain view as the server keeps it: each save changes what the next read says. */
function liveBrain(api: ReturnType<typeof createFakeApi>, patch: Partial<AgentBrain>) {
  const live: Partial<AgentBrain> = { ...patch };
  const view = () => fakeAgentBrain(ADA_ID, live);
  const defaultOf = (kind: AgentBrain["brain"]) => view().options.find((o) => o.kind === kind)?.defaultModel ?? null;
  api.agents.brain = async () => view();
  const save = api.agents.setBrain;
  api.agents.setBrain = async (orgId, agentId, input) => {
    await save(orgId, agentId, input);
    if (input.brain !== undefined && input.brain !== view().brain) {
      live.brain = input.brain;
      live.model = null;
      live.effectiveModel = input.brain === "model" ? null : defaultOf(input.brain);
    }
    if (input.account !== undefined) live.account = input.account;
    if (input.model !== undefined) {
      live.model = input.model;
      live.effectiveModel = input.model ?? defaultOf(view().brain);
    }
    if (input.effort !== undefined) live.effort = input.effort;
    if (input.speed !== undefined) live.speed = input.speed;
    if (input.contextTokens !== undefined) live.contextTokens = input.contextTokens;
    if (input.onlyOwner !== undefined) live.onlyOwner = input.onlyOwner;
    return view();
  };
}
/** The MacBook's row in the AI accounts: the own sign-ins its runner reported there. */
const reportOwn = (api: ReturnType<typeof createFakeApi>, own: AiComputer["own"]) =>
  fakeMachinesOf.get(api)?.setAiAccounts({
    accounts: [],
    computers: [
      {
        machineId: "machine_1",
        name: "MacBook",
        online: true,
        mine: true,
        canAdd: true,
        keys: true,
        brains: { claude_code: true, codex: true },
        own,
      },
    ],
  });
/** A connected MacBook with Claude Code and Codex; its browser as given. */
const pairMac = (api: ReturnType<typeof createFakeApi>, browser: boolean) =>
  fakeMachinesOf.get(api)?.pair({
    id: "machine_1",
    name: "MacBook",
    os: "darwin",
    access: { folders: [], tools: { claude: true, codex: true, commands: true, browser } },
    browser: { available: browser, version: browser ? "1" : null, chrome: null, reason: null },
  });
describe("Como trabalha under the name", () => {
  test("where, who thinks and the browser, in three cells (where first); each opens its dialog", async () => {
    await open();
    expect(sentence().textContent).toContain("ComputadorNenhum computador");
    expect(sentence().textContent).toContain("Pensa com");
    // On the API: its model, then that it pays per use.
    expect(brainCell()).toEqual({ label: "Pensa com", value: "Claude Sonnet 5.5 · Pela API", sub: undefined });
    expect(sentence().textContent).toContain("Navegadornão navega em sites");
    expect(sentence().textContent?.indexOf("Computador")).toBeLessThan(
      sentence().textContent?.indexOf("Pensa com") ?? 0,
    );
    for (const word of ["Mudar quem pensa", "Mudar onde trabalha", "Mudar o navegador"])
      expect(screen().getByRole("button", { name: word }).getAttribute("aria-haspopup")).toBe("dialog");
    // Configurações no longer has "Quem pensa": it lives in the sentence.
    cleanup();
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(document.getElementById("agp-sec-brain")).toBeNull();
    expect(screen().getByRole("navigation", { name: "Seções das configurações" }).textContent).not.toContain(
      "Quem pensa",
    );
  });

  test("a member reads it, without buttons; the owner may open it", async () => {
    const member = seedState();
    if (member.me?.organizations[0]) member.me.organizations[0].role = "member";
    await open(member);
    expect(sentence().textContent).toContain("Claude Sonnet 5.5 · Pela API");
    expect(screen().queryByRole("button", { name: "Mudar quem pensa" })).toBeNull();
    cleanup();
    const owner = seedState();
    if (owner.me?.organizations[0]) owner.me.organizations[0].role = "member";
    const ada = owner.agents.find((a) => a.id === ADA_ID);
    if (ada) ada.ownerUserId = "u-walter";
    await open(owner);
    expect(screen().getByRole("button", { name: "Mudar quem pensa" })).toBeTruthy();
  });
});
/** A Claude account of the viewer's on the MacBook. */
const WORK: MachineAccount = {
  id: "acct_work",
  kind: "claude_code",
  label: "Trabalho",
  email: "walt@acme.com",
  plan: "Team",
  status: "active",
  ownerId: "u-walter",
  ownerName: "Walter Nogueira",
  mine: true,
  usedBy: [],
  usage: null,
  provider: null,
  keyHint: null,
};

/**
 * Ada thinks with Claude Code on the MacBook, which has the given accounts; `own`: the MacBook's own sign-ins its
 * runner reported, as its row of the AI accounts says them.
 */
async function onMac(patch: Partial<AgentBrain> = {}, own?: AiComputer["own"]) {
  const state = seedState();
  const api = createFakeApi(state);
  pairMac(api, true);
  await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
  if (own) reportOwn(api, own);
  liveBrain(api, { brain: "claude_code", effectiveModel: "sonnet", accounts: [WORK], ...patch });
  return open(state, api);
}

/** The note under the select (what the picked AI waits on, or what picking it does) and its one button. */
const note = (d: HTMLElement) => {
  const el = d.querySelector(".ai-form > .agp-acct + .ac-setnote") as HTMLElement | null;
  return { text: el ? shownText(el) : null, button: el?.querySelector("button") ?? null };
};

describe("Quem pensa: one select (its dialog)", () => {
  test("your plans with your email, other people's with whose they are, the keys, then Conectar outra IA", async () => {
    const bia: MachineAccount = {
      ...WORK,
      id: "acct_bia",
      label: "Max da Bia",
      email: null,
      plan: null,
      ownerId: "u-bia",
      ownerName: "Bia Lima",
      mine: false,
    };
    await onMac(
      { account: "acct_work", accounts: [WORK, bia], canUseOthersPlans: true },
      { claude_code: { plan: "max" } },
    );
    const d = await brainDialog();
    // Only for this agent, said by its name.
    expect(d.textContent).toContain("Vale só para a Ada, em todas as conversas.");
    await openAiSelect(d, "Quem pensa");
    expect([...document.querySelectorAll(".ac-menu__heading")].map((h) => h.textContent)).toEqual([
      "Seus planos",
      "Planos de outras pessoas",
      "Chaves de API",
    ]);
    await closeAiSelect();
    const rows = await brainRows(d);
    expect(rows.map((r) => r.title)).toEqual([
      "Claude · Max",
      "Trabalho · Team",
      "Max da Bia",
      "Claude da Acme",
      "Conectar outra IA",
    ]);
    expect(rows[0]?.desc).toBe("Login no MacBook");
    expect(rows[1]?.desc).toBe("walt@acme.com");
    // Someone else's says whose, never their email.
    expect(rows[2]?.desc).toContain("De Bia");
    expect(rows[3]?.desc).toBe("Padrão do workspace · termina em 7f2a");
    expect(rows[4]?.desc).toBe("Outra conta, plano ou chave de API");
    // Each by its maker's mark.
    expect(rows.slice(0, 4).map((r) => r.mark)).toEqual(["claude", "claude", "claude", "claude"]);
    // The trigger names it with your email, and nothing waits for a button.
    expect(chosen(d)).toBe("Trabalho · Team\u00a0· walt@acme.com");
    expect(within(d).queryByRole("button", { name: "Usar" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(d.textContent).not.toMatch(/responder pela API|uso extra pago|Usar em outros agentes/);
  });

  test("a pick saves at once; the toast says it, and Desfazer puts back what it thought with", async () => {
    const pessoal: MachineAccount = {
      ...WORK,
      id: "acct_pessoal",
      label: "Pessoal",
      email: "walt@pessoal.com",
      plan: "Max",
    };
    const { state } = await onMac({ account: "acct_work", accounts: [WORK, pessoal] });
    const d = await brainDialog();
    await choose(d, /^Pessoal · Max/);
    await settle(6);
    expect(brainCalls(state)).toEqual([{ brain: "claude_code", account: "acct_pessoal" }]);
    expect(document.body.textContent).toContain("A Ada agora pensa com Pessoal · Max.");
    await undo();
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({
      brain: "claude_code",
      account: "acct_work",
      model: null,
      onlyOwner: false,
    });
    // The dialog stays open on what it thinks with.
    expect(screen().getByRole("dialog", { name: "Quem pensa" })).toBeTruthy();
  });

  test("from the API onto a plan: it answers only its owner from now on, said in the toast", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    pairMac(api, true);
    await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
    reportOwn(api, { claude_code: { plan: "max" } });
    await open(state, api);
    const d = await brainDialog();
    expect(chosen(d)).toContain("Claude da Acme");
    // On a key, what it costs under the select.
    expect(d.textContent).toContain("Pago por uso. Conta no orçamento da Ada.");
    await choose(d, /^Claude · Max/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ brain: "claude_code", account: null });
    expect(document.body.textContent).toContain("A Ada agora pensa com Claude · Max e só atende você.");
  });

  test("someone else's plan asks first, in the note under the select, with one button; its owner hears of it", async () => {
    const bia: MachineAccount = {
      ...WORK,
      id: "acct_bia",
      label: "Max da Bia",
      email: null,
      plan: null,
      ownerId: "u-bia",
      ownerName: "Bia Lima",
      mine: false,
    };
    const busy: MachineAccount = { ...bia, id: "acct_caio", label: "Pro do Caio", ownerName: "Caio", usedBy: ["Theo"] };
    const { state } = await onMac({
      account: "acct_work",
      accounts: [WORK, bia, busy],
      canUseOthersPlans: true,
    });
    const d = await brainDialog();
    // One another agent has can't be lent.
    expect((await card(d, /^Pro do Caio/))?.disabled).toBe(true);
    await choose(d, /^Max da Bia/);
    expect(brainCalls(state)).toEqual([]);
    expect(note(d).text).toContain("Bia recebe um e-mail e pode tirar de volta.");
    expect(note(d).button?.textContent).toBe("Usar o plano de Bia");
    await click(note(d).button as Element);
    await settle(6);
    expect(brainCalls(state).at(-1)).toMatchObject({ brain: "claude_code", account: "acct_bia" });
  });

  test("a signed-out account says so; Entrar de novo opens its sign-in, its own email going to Claude unasked", async () => {
    const { state } = await onMac({ account: "acct_work", accounts: [{ ...WORK, status: "signed_out" }] });
    const d = await brainDialog();
    expect((await card(d, /^Trabalho/))?.desc).toContain("Saiu da conta");
    expect(note(d).text).toContain("Trabalho saiu da conta. Entre de novo para a Ada usar.");
    await click(note(d).button as Element);
    await settle(6);
    expect(d.textContent).toContain("Entrar de novo em Trabalho");
    const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
    expect(block.querySelector("input")).toBeNull();
    const realOpen = window.open;
    window.open = (() => ({ closed: false, opener: {}, location: { href: "" }, close: () => {} })) as never;
    try {
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(6);
    } finally {
      window.open = realOpen;
    }
    expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
      ORG_ID,
      "machine_1",
      "claude_code",
      { accountId: "acct_work", email: "walt@acme.com" },
    ]);
    expect(shownText(block)).not.toContain("walt@acme.com");
  });

  test("an account another agent thinks with signs in once more for this one, never taken from it", async () => {
    const theo: MachineAccount = {
      ...WORK,
      id: "acct_theo",
      label: "Pessoal",
      email: "walt@pessoal.com",
      plan: "Max",
      usedBy: ["Theo"],
    };
    const { state, api } = await onMac({ account: "acct_work", accounts: [WORK, theo] });
    fakeMachinesOf.get(api)?.endLogin("login_1", { state: "done", account: { ...theo, id: "acct_ada", usedBy: [] } });
    const d = await brainDialog();
    expect((await card(d, /^Pessoal · Max/))?.desc).toContain("Também usada por Theo");
    await choose(d, /^Pessoal · Max/);
    expect(brainCalls(state)).toEqual([]);
    expect(note(d).button?.textContent).toBe("Fazer login para a Ada");
    await click(note(d).button as Element);
    await settle(6);
    const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
    const realOpen = window.open;
    window.open = (() => ({ closed: false, opener: {}, location: { href: "" }, close: () => {} })) as never;
    try {
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(8);
    } finally {
      window.open = realOpen;
    }
    // A sign-in of Ada's own, Theo's account named to Claude's page unseen; nothing taken from Theo.
    expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
      ORG_ID,
      "machine_1",
      "claude_code",
      { email: "walt@pessoal.com" },
    ]);
    // The new login thinks for Ada once it's in: no button to confirm it.
    expect(brainCalls(state).at(-1)).toMatchObject({ account: "acct_ada" });
    expect(brainCalls(state).at(-1)).not.toHaveProperty("moveAccount");
  });

  test("at the plan's limit: when it answers again, and one button to the account with the most room", async () => {
    const now = new Date().toISOString();
    const full: PlanUsage = {
      windows: [{ kind: "five_hour", usedPercent: 100, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }],
      limited: true,
      source: "turn",
      at: now,
    };
    const some = (usedPercent: number): PlanUsage => ({
      windows: [{ kind: "five_hour", usedPercent }],
      source: "probe",
      at: now,
    });
    const roomy: MachineAccount = {
      ...WORK,
      id: "acct_roomy",
      label: "Claude Team 2",
      email: "walt@two.com",
      usage: some(12),
    };
    const busy: MachineAccount = {
      ...WORK,
      id: "acct_busy",
      label: "Claude Team 3",
      email: "walt@three.com",
      usedBy: ["Theo"],
      usage: some(3),
    };
    const { state } = await onMac({
      account: "acct_work",
      accounts: [{ ...WORK, usedBy: ["Ada"], usage: full }, roomy, busy],
    });
    const d = await brainDialog();
    // Opening it looks the plans up again.
    expect(state.calls.some((c) => c.method === "machines.refreshAccountUsage")).toBe(true);
    // Its meters under the select, in the same outline.
    const meter = d.querySelector(".agp-acct--use .ac-planmeter") as HTMLElement;
    expect(within(meter).getByRole("meter", { name: "5 horas" }).getAttribute("aria-valuenow")).toBe("100");
    expect(note(d).text).toContain("Com esta conta, a Ada só volta a responder");
    expect(note(d).button?.textContent).toBe("Usar Claude Team 2 (12%)");
    await click(note(d).button as Element);
    await settle(6);
    expect(brainCalls(state).at(-1)).toMatchObject({ brain: "claude_code", account: "acct_roomy" });
  });

  test("to someone who may not use other people's plans: its owner's accounts only, said whose", async () => {
    await onMac({
      canUsePlans: false,
      canManageAccounts: false,
      canUseOthersPlans: false,
      accounts: [{ ...WORK, mine: false, ownerId: "u-joao", ownerName: "João Silva" }],
      account: "acct_work",
    });
    const d = await brainDialog();
    expect(d.textContent).toContain(
      "Só contas de João, responsável pela Ada: um plano só pensa pelos agentes do seu dono.",
    );
  });

  test("what the computer can't run says why behind its ⓘ, and can't be picked", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const base = fakeAgentBrain(ADA_ID, {
      brain: "claude_code",
      effectiveModel: "sonnet",
      account: "acct_work",
      accounts: [
        WORK,
        { ...WORK, id: "acct_plus", kind: "codex", label: "Pessoal", email: "walt@pessoal.com", plan: "Plus" },
      ],
    });
    const options = base.options.map((o) =>
      o.kind === "codex" ? { ...o, available: false, reason: "not_installed" as const } : o,
    );
    api.agents.brain = async () => ({
      ...base,
      options,
      machines: [{ machineId: "machine_1", name: "MacBook", online: true, options }],
    });
    await open(state, api);
    const d = await brainDialog();
    const rows = await openAiSelect(d, "Quem pensa");
    const plus = rows.find((o) => brainTitle(o).startsWith("Pessoal")) as HTMLElement;
    expect(plus.getAttribute("aria-disabled")).toBe("true");
    expect(plus.querySelector(".ac-menu__desc")?.textContent).toContain("Indisponível");
    expect(document.getElementById(plus.getAttribute("aria-describedby") ?? "")?.textContent).toContain(
      "O Codex não está instalado no MacBook.",
    );
    await closeAiSelect();
  });

  test("the model under the select saves at once, and Desfazer puts the last one back", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    api.agents.brain = async () => fakeAgentBrain(ADA_ID, { brain: "codex", model: null, effectiveModel: "gpt-6-sol" });
    await open(state, api);
    const d = await brainDialog();
    await model(d, /Luna/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ model: "gpt-6-luna" });
    expect(document.body.textContent).toContain("A Ada agora pensa com GPT-6 Luna.");
    await undo();
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ model: null, effort: null });
  });

  test("Atende outras pessoas: its label with an ⓘ that says whom it answers and the plan's terms, saved at once", async () => {
    const { state } = await onMac({ account: "acct_work", onlyOwner: true });
    const d = await brainDialog();
    const replies = within(d).getByRole("switch", { name: "Atende outras pessoas" });
    expect(replies.getAttribute("aria-checked")).toBe("false");
    // A Team account is a seat: its own words.
    const hint = hintOf("Atende outras pessoas", d);
    expect(hint.text).toContain("A Ada só atende você, pelo seu assento do Claude.");
    expect(hint.text).toContain("Cada assento do Claude é de uma pessoa só.");
    // No line under it.
    expect(shownText(d)).not.toContain("A Ada só atende você");
    await click(replies);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ onlyOwner: false });
    expect(document.body.textContent).toContain("Agora a Ada atende outras pessoas.");
  });

  test("Conectar outra IA opens its steps in the dialog: the plans and the keys in one select, Voltar back to the list", async () => {
    await onMac({ account: "acct_work" });
    const d = await brainDialog();
    await connectOther(d);
    expect(d.textContent).toContain("Conectar outra IA");
    const providers = within(d).getByRole("combobox", { name: "Conectar outra IA" });
    expect(providers.textContent).toContain("Claude");
    expect(within(d).getByRole("region", { name: "Adicionar conta do Claude" })).toBeTruthy();
    await click(d.querySelector(".ai-flow__head button") as Element);
    expect(aiSelect(d, "Quem pensa")).toBeTruthy();
  });

  test("on the Cloud, a plan the workspace's computer is still installing says so behind its ⓘ", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const machines = fakeMachinesOf.get(api);
    machines?.pair({ id: "machine_1", name: "MacBook", os: "linux", mode: "system" });
    machines?.setSetup({ state: "ready", machineId: "machine_1", since: new Date().toISOString() });
    const base = fakeAgentBrain(ADA_ID, {
      brain: "claude_code",
      effectiveModel: "sonnet",
      account: "acct_work",
      accounts: [
        WORK,
        { ...WORK, id: "acct_plus", kind: "codex", label: "Pessoal", email: "walt@pessoal.com", plan: "Plus" },
      ],
    });
    const options = base.options.map((o) =>
      o.kind === "codex" ? { ...o, available: false, reason: "not_installed" as const } : o,
    );
    api.agents.brain = async () => ({
      ...base,
      options,
      machines: [{ machineId: "machine_1", name: "MacBook", online: true, options }],
    });
    await open(state, api);
    const d = await brainDialog();
    const rows = await openAiSelect(d, "Quem pensa");
    const plus = rows.find((o) => brainTitle(o).startsWith("Pessoal")) as HTMLElement;
    expect(document.getElementById(plus.getAttribute("aria-describedby") ?? "")?.textContent).toContain(
      "O Codex está sendo instalado no MacBook. Isto muda sozinho quando terminar.",
    );
    await closeAiSelect();
  });
});

describe("Quem pensa: worst case", () => {
  test("a long account name and an unbreakable email stay whole in the rows and the trigger, with someone else's plan beside them", async () => {
    const long: MachineAccount = {
      ...WORK,
      id: "acct_long",
      label: "Conta compartilhada da equipe de engenharia de plataforma",
      email: "joana.maria.de.souza.e.silva.engenharia@departamento-de-plataforma.example.com",
      plan: "Team",
    };
    const theirs: MachineAccount = {
      ...WORK,
      id: "acct_theirs",
      label: "Max",
      email: null,
      plan: null,
      ownerId: "u-bia",
      ownerName: "Bartholomeu Constantino Albuquerque",
      mine: false,
    };
    await onMac({ account: "acct_long", accounts: [long, theirs], canUseOthersPlans: true });
    const d = await brainDialog();
    expect(chosen(d)).toBe(
      "Conta compartilhada da equipe de engenharia de plataforma · Team\u00a0· joana.maria.de.souza.e.silva.engenharia@departamento-de-plataforma.example.com",
    );
    const rows = await openAiSelect(d, "Quem pensa");
    const row = rows.find((o) => brainTitle(o).startsWith("Conta compartilhada")) as HTMLElement;
    expect(row.querySelector(".ac-menu__desc")?.textContent).toBe(
      "joana.maria.de.souza.e.silva.engenharia@departamento-de-plataforma.example.com",
    );
    expect(rows.find((o) => brainTitle(o) === "Max")?.querySelector(".ac-menu__desc")?.textContent).toContain(
      "De Bartholomeu",
    );
    // The state that shows saved there: the geometry check lays it out at 1280 and 320.
    (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();
    await closeAiSelect();
  });
});

describe("Quem pensa: Configuração avançada, in place", () => {
  test("its row says what differs from the defaults and opens under itself; the effort's levels are the model's", async () => {
    const { state } = await onMac({ account: "acct_work", effectiveModel: "opus", model: "opus" });
    const d = await brainDialog();
    const toggle = within(d).getByRole("button", { name: /^Configuração avançada/ });
    expect(toggle.textContent).toContain("Tudo no padrão");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await advanced(d);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Claude's current models take five levels: more than the ramp's four, so a select, with Muito alto.
    expect(within(d).queryByRole("slider", { name: "Esforço" })).toBeNull();
    const effort = within(d).getByRole("combobox", { name: "Esforço" });
    effort.focus();
    await act(async () => fireEvent.keyDown(effort, { key: "Enter" }));
    expect(
      screen()
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Baixo", "Médio", "Alto", "Muito alto", "Máximo"]);
    await click(screen().getByRole("option", { name: "Muito alto" }));
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ effort: "xhigh" });
    expect(document.body.textContent).toContain("Esforço muito alto");
    // No switch for the API or for paid extra usage.
    expect(
      within(d)
        .queryAllByRole("switch")
        .map((s) => s.getAttribute("aria-label") ?? s.id),
    ).toHaveLength(1);
    expect(d.textContent).not.toMatch(/responder pela API|uso extra pago/);
  });

  test("four levels or fewer: the ramp of bars, saved at once", async () => {
    const { state } = await onMac({ brain: "codex", effectiveModel: "gpt-6-sol", accounts: [] });
    const d = await brainDialog();
    await advanced(d);
    const ramp = within(d).getByRole("slider", { name: "Esforço" });
    expect(ramp.getAttribute("aria-valuetext")).toBe("Médio");
    expect(ramp.getAttribute("aria-valuemax")).toBe("3");
    await act(async () => fireEvent.keyDown(ramp, { key: "ArrowRight" }));
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ effort: "high" });
  });

  test("Automático picks the effort too: said where the effort would be", async () => {
    await onMac({ account: "acct_work", model: "auto", effectiveModel: "auto", effort: "auto" });
    const d = await brainDialog();
    await advanced(d);
    expect(within(d).queryByRole("slider", { name: "Esforço" })).toBeNull();
    expect(within(d).queryByRole("combobox", { name: "Esforço" })).toBeNull();
    expect(d.textContent).toContain(
      "EsforçoO modelo Automático escolhe o esforço de cada tarefa. Escolha um modelo para fixar o esforço.",
    );
  });

  test("the context window saves at once; Voltar ao padrão puts every choice back", async () => {
    const { state } = await onMac({ account: "acct_work", effectiveModel: "opus", model: "opus", effort: "high" });
    const d = await brainDialog();
    await advanced(d);
    expect(within(d).getByRole("button", { name: /^Configuração avançada/ }).textContent).toContain("Esforço alto");
    const defaults = within(d).getByRole("button", { name: "Voltar ao padrão" }) as HTMLButtonElement;
    expect(defaults.disabled).toBe(false);
    await click(defaults);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ effort: "medium", speed: "standard", contextTokens: null });
  });

  test("on a key only the context window", async () => {
    await open();
    const d = await brainDialog();
    await advanced(d);
    expect(within(d).queryByRole("slider", { name: "Esforço" })).toBeNull();
    expect(within(d).getByRole("combobox", { name: "Janela de contexto" })).toBeTruthy();
  });
});

describe("Quem pensa: adding an account (Conectar outra IA)", () => {
  test("Adicionar conta: no address asked, Claude's page opens beside, Colar sends only this sign-in's code; Voltar stops it", async () => {
    const { state, api } = await onMac();
    const opened: string[] = [];
    const popup = {
      closed: false,
      opener: {},
      location: {
        href: "",
        replace(url: string) {
          this.href = url;
        },
      },
      close: () => {},
    };
    const realOpen = window.open;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return popup;
    }) as unknown as typeof window.open;
    let clip = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => clip, writeText: async () => {} },
    });
    try {
      const d = await brainDialog();
      await connectOther(d);
      await settle(6);
      const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
      // Nothing runs on the computer before the person goes on.
      expect(fakeMachinesOf.get(api)?.lastLogin()).toBeUndefined();
      // Where the account stays is the sign-in step's ⓘ.
      expect(hintOf("A conta com o seu plano", block).text).toBe(
        "Conta errada? Saia de lá e tente de novo. A conta fica só no MacBook. Você digita a senha na\u00a0página\u00a0do\u00a0Claude.",
      );
      expect(shownText(block)).not.toContain("digita a senha");
      // The person already has an account here: still no address to type, Claude's own page picks the account.
      expect(block.querySelector("input")).toBeNull();
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(6);
      expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
        ORG_ID,
        "machine_1",
        "claude_code",
      ]);
      // The window opened on the click itself went to Claude's page, cut off from the app.
      expect(opened).toEqual(["/conectando?kind=claude_code"]);
      expect(popup.opener).toBeNull();
      expect(popup.location.href).toBe("https://claude.ai/oauth/authorize?code=true&state=st4te");
      expect(within(block).getByRole("link", { name: "Abrir de novo" }).getAttribute("href")).toBe(
        "https://claude.ai/oauth/authorize?code=true&state=st4te",
      );
      const login = fakeMachinesOf.get(api)?.lastLogin();
      expect(login?.kind).toBe("claude_code");
      // Something else on the clipboard (a password) waits for Send, with a line; Colar goes while the field holds it.
      clip = "hunter2-password";
      await click(within(block).getByRole("button", { name: "Colar" }));
      await settle(4);
      expect(fakeMachinesOf.get(api)?.lastLogin()?.box).toBeNull();
      const field = within(block).getByRole("textbox", { name: "Código do Claude" }) as HTMLInputElement;
      expect(field.value).toBe("hunter2-password");
      expect(shownText(block)).toContain("Isso não parece o código do Claude.");
      expect(within(block).queryByRole("button", { name: "Colar" })).toBeNull();
      // Emptied, Colar is back; this sign-in's code (`…#<state>`) goes at once, sealed: the raw code is in no call.
      await act(async () => fireEvent.change(field, { target: { value: "" } }));
      clip = "c0de-from-claude#st4te";
      await click(within(block).getByRole("button", { name: "Colar" }));
      await settle(6);
      expect(fakeMachinesOf.get(api)?.lastLogin()?.box).not.toBeNull();
      expect(JSON.stringify(state.calls)).not.toContain("c0de-from-claude");
      // Back to the select: the sign-in under way stops on the computer.
      await click(d.querySelector(".ai-flow__head button") as Element);
      await settle(4);
      expect(state.calls.find((c) => c.method === "machines.cancelAccountLogin")?.args).toEqual([
        ORG_ID,
        "machine_1",
        login?.loginId,
      ]);
    } finally {
      window.open = realOpen;
    }
  });

  test("a sign-in's popup the browser refused: the sign-in goes on and its link is there to open by hand", async () => {
    await onMac();
    const realOpen = window.open;
    window.open = (() => null) as unknown as typeof window.open;
    try {
      const d = await brainDialog();
      await connectOther(d);
      await settle(6);
      const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(6);
      expect(within(block).getByRole("link", { name: "Abrir de novo" }).getAttribute("href")).toBe(
        "https://claude.ai/oauth/authorize?code=true&state=st4te",
      );
    } finally {
      window.open = realOpen;
    }
  });

  test("a sign-in that can't get its link: the popup closes and the dialog says why", async () => {
    const { api } = await onMac();
    api.machines.beginAccountLogin = async () => {
      throw new Error("the computer didn't answer");
    };
    let closed = 0;
    const popup = { closed: false, opener: {}, location: { replace: () => {} }, close: () => closed++ };
    const realOpen = window.open;
    window.open = (() => popup) as unknown as typeof window.open;
    try {
      const d = await brainDialog();
      await connectOther(d);
      await settle(6);
      const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(6);
      expect(closed).toBe(1);
      expect(shownText(block)).toContain("O MacBook não respondeu. Tente de novo em instantes.");
    } finally {
      window.open = realOpen;
    }
  });

  test("Add account: Copy link begins the sign-in with no window, copies its link and shows the code step", async () => {
    const { state, api } = await onMac();
    const opened: string[] = [];
    const realOpen = window.open;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as unknown as typeof window.open;
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "",
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    try {
      const d = await brainDialog();
      await connectOther(d);
      await settle(6);
      const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
      expect(within(block).queryByRole("textbox", { name: "Código do Claude" })).toBeNull();
      await click(within(block).getByRole("button", { name: "Copiar link" }));
      await settle(6);
      expect(state.calls.filter((c) => c.method === "machines.beginAccountLogin")).toHaveLength(1);
      expect(fakeMachinesOf.get(api)?.lastLogin()?.kind).toBe("claude_code");
      expect(opened).toEqual([]);
      expect(written).toEqual(["https://claude.ai/oauth/authorize?code=true&state=st4te"]);
      expect(within(block).getByRole("button", { name: "Copiado" })).toBeTruthy();
      expect(within(block).getByRole("textbox", { name: "Código do Claude" })).toBeTruthy();
      // Copied again, the same sign-in's link: no second one begins.
      await click(within(block).getByRole("button", { name: "Copiado" }));
      await settle(4);
      expect(state.calls.filter((c) => c.method === "machines.beginAccountLogin")).toHaveLength(1);
      expect(written).toHaveLength(2);
    } finally {
      window.open = realOpen;
    }
  });

  /** Claude's sign-in started from Add account, its code field showing; the sign-in window is a stand-in. */
  async function codeField() {
    const { state, api } = await onMac();
    const d = await brainDialog();
    await connectOther(d);
    await settle(6);
    const block = within(d).getByRole("region", { name: "Adicionar conta do Claude" });
    const realOpen = window.open;
    window.open = (() => ({ closed: false, opener: {}, location: { href: "" }, close: () => {} })) as never;
    try {
      await click(within(block).getByRole("button", { name: "Entrar com Claude" }));
      await settle(6);
    } finally {
      window.open = realOpen;
    }
    const field = within(block).getByRole("textbox", { name: "Código do Claude" });
    // ⌘V: the paste lands in the field as its new value.
    const paste = async (text: string) => {
      await act(async () => {
        fireEvent.paste(field, { clipboardData: { getData: () => text } });
        fireEvent.change(field, { target: { value: text } });
      });
      await settle(6);
    };
    return { state, api, block, paste, sealed: () => fakeMachinesOf.get(api)?.lastLogin()?.box ?? null };
  }

  test("while the code goes and the computer signs in, a line stands in for the field and its buttons; a failed send brings them back", async () => {
    const { api, block, paste } = await codeField();
    const real = api.machines.sendAccountCode;
    let answer = (_ok: boolean) => {};
    api.machines.sendAccountCode = (...args) =>
      new Promise<void>((resolve, reject) => {
        answer = (ok) => (ok ? resolve(real(...args)) : reject(new Error("offline")));
      });
    const code = () => within(block).getByRole("textbox", { name: "Código do Claude" }) as HTMLInputElement;
    /** The line, alone in the step with the product's spinner: no field, Colar, Enviar or Esperando beside it. */
    const busy = () => {
      const line = within(block).getByRole("status");
      expect(line.querySelector("canvas.ac-pixspin")).not.toBeNull();
      expect(block.querySelector("input")).toBeNull();
      expect(within(block).queryByRole("button", { name: /^(Colar|Enviar ao MacBook)$/ })).toBeNull();
      expect(shownText(block)).not.toContain("Esperando");
      return line;
    };
    code().focus();
    await paste("c0de-from-claude#st4te");
    const going = busy();
    expect(going.textContent).toBe("Enviando o código ao MacBook…");
    // The focus the field had goes to the line, not to the page.
    expect(document.activeElement === going).toBe(true);
    // The send fails: the field is back with the code in it, the error under it, and the focus.
    await act(async () => answer(false));
    await settle(4);
    expect(code().value).toBe("c0de-from-claude#st4te");
    expect(document.activeElement === code()).toBe(true);
    expect(shownText(block)).toContain("Não deu para enviar o código. Confira e tente de novo.");
    expect(shownText(block)).not.toContain("Enviando o código");
    // Sent again: the line says the computer is signing in, until the sign-in ends.
    await click(within(block).getByRole("button", { name: "Enviar ao MacBook" }));
    expect(busy().textContent).toBe("Enviando o código ao MacBook…");
    await act(async () => answer(true));
    await settle(6);
    expect(busy().textContent).toBe("Código enviado. O MacBook está terminando de entrar.");
    expect(shownText(block)).not.toContain("Não deu para enviar o código.");
  });

  test("the computer giving up on the code ends the sign-in with its reason, the focus still in the block", async () => {
    const { api, block, paste } = await codeField();
    const machines = fakeMachinesOf.get(api);
    machines?.endLogin(machines.lastLogin()?.loginId ?? "", { state: "failed" });
    (within(block).getByRole("textbox", { name: "Código do Claude" }) as HTMLInputElement).focus();
    await paste("c0de-from-claude#st4te");
    expect(shownText(block)).toContain("Não deu para entrar nessa conta. Tente de novo.");
    expect(within(block).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(within(block).queryByRole("status")).toBeNull();
    expect(document.activeElement === block).toBe(true);
  });

  test("Claude's code pasted into its field with ⌘V goes to the computer by itself, no click", async () => {
    const { state, block, paste, sealed } = await codeField();
    await paste("c0de-from-claude#st4te");
    expect(sealed()).not.toBeNull();
    expect(JSON.stringify(state.calls)).not.toContain("c0de-from-claude");
    expect(shownText(block)).toContain("Código enviado. O MacBook está terminando de entrar.");
    expect(shownText(block)).not.toContain("Isso não parece o código do Claude.");
  });

  test("Colar refused by the browser, then ⌘V: the code goes, and the refusal's line with it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          throw new Error("denied");
        },
        writeText: async () => {},
      },
    });
    const { block, paste, sealed } = await codeField();
    await click(within(block).getByRole("button", { name: "Colar" }));
    await settle(4);
    expect(shownText(block)).toContain("O navegador não deixou colar.");
    await paste("c0de-from-claude#st4te");
    expect(sealed()).not.toBeNull();
    expect(shownText(block)).toContain("Código enviado. O MacBook está terminando de entrar.");
    expect(shownText(block)).not.toContain("O navegador não deixou colar.");
  });

  test("a code that isn't this sign-in's waits for Enviar, the one action, with a line under it", async () => {
    const { block, paste, sealed } = await codeField();
    await paste("c0de-from-claude#another-state");
    expect(sealed()).toBeNull();
    expect(shownText(block)).toContain("Isso não parece o código do Claude.");
    expect(within(block).queryByRole("button", { name: "Colar" })).toBeNull();
    const send = within(block).getByRole("button", { name: "Enviar ao MacBook" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await click(send);
    await settle(6);
    expect(sealed()).not.toBeNull();
    expect(shownText(block)).toContain("Código enviado. O MacBook está terminando de entrar.");
  });

  test("Claude's code sent while the server restarts: the computer didn't answer, not a wrong code; Enviar sends it again", async () => {
    const { api, block, paste, sealed } = await codeField();
    const sendCode = api.machines.sendAccountCode;
    api.machines.sendAccountCode = async () => {
      throw new ApiError(502, "http_502", "Bad Gateway");
    };
    await paste("c0de-from-claude#st4te");
    expect(shownText(block)).toContain("O MacBook não respondeu. Tente de novo em instantes.");
    expect(shownText(block)).not.toContain("Confira");
    // The computer refusing it is still about the code.
    api.machines.sendAccountCode = async () => {
      throw new ApiError(400, "account.invalid_code", "The sealed code is malformed");
    };
    // A line stands in for the field and its buttons while the code goes: Enviar is a new button after each send.
    const send = () => within(block).getByRole("button", { name: "Enviar ao MacBook" });
    await click(send());
    await settle(6);
    expect(shownText(block)).toContain("Não deu para enviar o código. Confira e tente de novo.");
    expect(shownText(block)).not.toContain("não respondeu");
    api.machines.sendAccountCode = sendCode;
    await click(send());
    await settle(6);
    expect(sealed()).not.toBeNull();
    expect(shownText(block)).toContain("Código enviado. O MacBook está terminando de entrar.");
  });

  test("Adicionar conta (ChatGPT): its settings first, then the sign-in on its button; the account is chosen", async () => {
    const codex: MachineAccount = { ...WORK, id: "acct_codex", kind: "codex", label: "Pessoal", plan: "Plus" };
    const { state, api } = await onMac({ brain: "codex", effectiveModel: "gpt-6-sol", accounts: [] });
    // The computer finishes the first sign-in as soon as the page asks.
    fakeMachinesOf.get(api)?.endLogin("login_1", { state: "done", account: codex });
    const d = await brainDialog();
    await connectOther(d);
    await settle(8);
    // Showing the steps starts nothing: device code sign-in has to be allowed in ChatGPT first.
    expect(state.calls.some((c) => c.method === "machines.beginAccountLogin")).toBe(false);
    const block = within(d).getByRole("region", { name: "Adicionar conta do ChatGPT" });
    expect(within(block).getByRole("link", { name: "Abrir as configurações do ChatGPT" })).toBeTruthy();
    const realOpen = window.open;
    window.open = (() => ({ closed: false, opener: {}, location: { href: "" }, close: () => {} })) as never;
    try {
      await click(within(block).getByRole("button", { name: "Entrar com ChatGPT" }));
      await settle(8);
    } finally {
      window.open = realOpen;
    }
    expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
      ORG_ID,
      "machine_1",
      "codex",
    ]);
    expect(within(d).queryByRole("region", { name: "Adicionar conta do ChatGPT" })).toBeNull();
    expect(state.calls.some((c) => c.method === "machines.cancelAccountLogin")).toBe(false);
    // The account it signed in as thinks for Ada at once: nothing to confirm.
    expect(brainCalls(state).at(-1)).toMatchObject({ brain: "codex", account: "acct_codex" });
  });

  test("Adicionar conta (ChatGPT) while the server restarts: Reconectando, never a failure or an offline computer, then the account, one sign-in", async () => {
    const codex: MachineAccount = { ...WORK, id: "acct_codex", kind: "codex", label: "Pessoal", plan: "Plus" };
    const start = Date.now();
    setSystemTime(new Date(start));
    const { state, api, services } = await onMac({ brain: "codex", effectiveModel: "gpt-6-sol", accounts: [] });
    let online = true;
    const viewOf = api.agents.brain;
    api.agents.brain = async (orgId, agentId) => {
      const view = await viewOf(orgId, agentId);
      const on = <T extends { online: boolean }>(m: T) => ({ ...m, online });
      return { ...view, computer: view.computer && on(view.computer), machines: view.machines.map(on) };
    };
    const d = await brainDialog();
    await connectOther(d);
    await settle(8);
    const block = within(d).getByRole("region", { name: "Adicionar conta do ChatGPT" });
    const realOpen = window.open;
    window.open = (() => ({ closed: false, opener: {}, location: { href: "" }, close: () => {} })) as never;
    try {
      await click(within(block).getByRole("button", { name: "Entrar com ChatGPT" }));
      await settle(8);
    } finally {
      window.open = realOpen;
    }
    const read = api.machines.accountLogin;
    const ask = async (after: number, error?: Error) => {
      setSystemTime(new Date(start + after));
      api.machines.accountLogin = error
        ? async () => {
            throw error;
          }
        : read;
      await act(() => services.queryClient.invalidateQueries());
      await settle(6);
    };
    // The MacBook drops out with its runner: no answer, then only the proxy's, then the computer still
    // reconnecting, for 20 s. The sign-in's block says so; no brain there reads as offline meanwhile.
    online = false;
    for (const [after, error] of [
      [3_000, new TypeError("Failed to fetch")],
      [10_000, new ApiError(502, "http_502", "Bad Gateway")],
      [20_000, new ApiError(409, "machine.offline", "The computer MacBook is offline.")],
    ] as const) {
      await ask(after, error);
      expect(shownText(block)).toContain("Reconectando…");
      expect(d.textContent).not.toMatch(/Não deu para entrar|não respondeu|está offline/);
      expect(d.querySelector(".ac-brand--off")).toBeNull();
    }
    // The sign-in went on there meanwhile.
    online = true;
    fakeMachinesOf.get(api)?.endLogin("login_1", { state: "done", account: codex });
    await ask(22_000);
    expect(brainCalls(state).at(-1)).toMatchObject({ account: "acct_codex" });
    expect(d.textContent).not.toMatch(/Não deu para entrar|não respondeu/);
    expect(state.calls.filter((c) => c.method === "machines.beginAccountLogin")).toHaveLength(1);
    expect(state.calls.some((c) => c.method === "machines.cancelAccountLogin")).toBe(false);
  });
});

describe("Quem pensa: a plan with a login per agent", () => {
  const glm = (id: string, usedBy: string[]): MachineAccount => ({
    id,
    kind: "claude_code",
    label: "GLM Coding",
    email: null,
    plan: null,
    status: "active",
    ownerId: "u-walter",
    ownerName: "Walter Nogueira",
    mine: true,
    usedBy,
    usage: null,
    provider: "zai",
    keyHint: "4f2a",
  });

  test("a coding plan whose logins think for other agents: one row for the account, one more login for this one", async () => {
    // The MacBook's runner takes a plan's key.
    const { state, api } = await onMac({ accounts: [glm("acct_theo", ["Theo"]), glm("acct_lia", ["Lia"])] }, {});
    fakeMachinesOf.get(api)?.endLogin("login_1", { state: "done", account: glm("acct_ada", []) });
    const d = await brainDialog();
    const rows = await brainRows(d);
    // One row for the account, not one per login.
    expect(rows.filter((r) => r.title === "GLM Coding").map((r) => r.desc)).toEqual([
      "chave …4f2a · Também usada por Theo e Lia",
    ]);
    await choose(d, /^GLM Coding/);
    await click(note(d).button as Element);
    await settle(6);
    const block = within(d).getByRole("region", { name: "Conectar GLM Coding" });
    fireEvent.change(within(block).getByLabelText("Chave do GLM Coding"), {
      target: { value: "0123456789abcdef0123456789abcdef.AbCdEfGhIjKlMnOp" },
    });
    await click(within(block).getByRole("button", { name: "Enviar ao MacBook" }));
    await settle(8);
    expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
      ORG_ID,
      "machine_1",
      "claude_code",
      { provider: "zai" },
    ]);
    expect(brainCalls(state).at(-1)).toMatchObject({ account: "acct_ada" });
  });
});

describe("Quem pensa: a coding plan's models", () => {
  /** One of Walter's key accounts of `provider` on the MacBook. */
  const planKey = (provider: string | null, over: Partial<MachineAccount> = {}): MachineAccount => ({
    id: "acct_plan",
    kind: "claude_code",
    label: "Plano",
    email: null,
    plan: null,
    status: "active",
    ownerId: "u-walter",
    ownerName: "Walter Nogueira",
    mine: true,
    usedBy: ["Ada"],
    usage: null,
    provider,
    keyHint: "4f2a",
    ...over,
  });
  /** Ada thinks with Claude Code on the MacBook, with Walter's key account of `provider`. */
  async function onPlan(
    provider: string,
    patch: Partial<AgentBrain> = {},
    over: Partial<MachineAccount> = {},
    planModels?: FakeState["planModels"],
  ) {
    const state = seedState();
    if (planModels) state.planModels = planModels;
    const api = createFakeApi(state);
    pairMac(api, true);
    await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
    // Its runner takes a plan's key.
    reportOwn(api, {});
    liveBrain(api, {
      brain: "claude_code",
      effectiveModel: "sonnet",
      account: "acct_plan",
      accounts: [planKey(provider, over)],
      ...patch,
    });
    await open(state, api);
    return { state, api };
  }
  /** What one of the opened card's dropdowns offers (it closes again). */
  const offered = async (d: HTMLElement, select: string) => {
    const trigger = within(d).getByRole("combobox", { name: select });
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    const shown = screen()
      .getAllByRole("option")
      .map((o) => o.textContent);
    await act(async () => fireEvent.keyDown(screen().getAllByRole("option")[0] as HTMLElement, { key: "Escape" }));
    await settle(2);
    return shown;
  };

  test("the agent's model at a limit of its own: said under the plan's meters, which show the account's room", async () => {
    const at = new Date().toISOString();
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await onPlan(
      "opencode",
      { effectiveModel: "deepseek-v4.1-flash" },
      {
        usage: {
          windows: [{ kind: "five_hour", usedPercent: 0 }],
          source: "probe",
          at,
          models: { "deepseek-v4.1-flash": { at, until } },
        },
      },
    );
    const d = await brainDialog();
    expect(d.textContent).toContain("O DeepSeek V4.1 Flash chegou ao limite dele neste plano e renova ");
    expect(d.textContent).toContain("Os outros modelos do plano seguem funcionando.");
  });

  test("every model of the plan in a select, by maker, each with what it's sold as and needs; saved by its id at once", async () => {
    const { state } = await onPlan("opencode");
    const d = await brainDialog();
    expect(within(d).queryByRole("radiogroup", { name: "Modelo" })).toBeNull();
    const trigger = within(d).getByRole("combobox", { name: "Modelo" });
    expect(trigger.textContent).toBe("MiniMax M3");
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    const options = screen()
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toHaveLength(31);
    expect(options.slice(0, 4)).toEqual([
      "AutomáticoEscolhe o modelo e o esforço para cada tarefa",
      "MiniMax M3",
      "MiniMax M3.1 Flash",
      "Claude Haiku 5.5",
    ]);
    expect(options).toContain("Kimi K3.1 ProTopo de linha");
    // Grouped by maker, as the workspace's models are, each beside its logo.
    const list = screen().getByRole("listbox");
    expect([...list.querySelectorAll(".ac-menu__heading")].map((h) => h.textContent)).toEqual([
      "MiniMax",
      "Claude",
      "Z.ai",
      "Kimi",
      "Alibaba",
      "DeepSeek",
      "Xiaomi",
      "OpenAI",
      "Gemini",
      "xAI",
      "Meituan",
      "Tencent",
      "StepFun",
      "Meta",
      "Reflection",
      "OpenCode",
    ]);
    expect(list.querySelectorAll(".ac-menu__leading")).toHaveLength(31);
    // Every maker's own mark, never its initial.
    expect(list.querySelectorAll(".ac-brand__initial")).toHaveLength(0);
    // DeepSeek's answer only once the OpenCode workspace allows the Global region: said behind the ⓘ at the row's
    // end, never a line of the row.
    const deepseek = within(within(list).getByRole("group", { name: "DeepSeek" })).getAllByRole("option");
    expect(deepseek.map((o) => o.querySelector(".ac-menu__desc")?.textContent ?? null)).toEqual([null, "Econômico"]);
    const described = (o: HTMLElement) =>
      document.getElementById(o.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(deepseek.map(described)).toEqual([
      "Precisa da região Global no OpenCode.",
      "Precisa da região Global no OpenCode.",
    ]);
    await click(screen().getByRole("option", { name: /^DeepSeek V4\.1 Flash/ }));
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ model: "deepseek-v4.1-flash" });
    expect(document.body.textContent).toContain("A Ada agora pensa com DeepSeek V4.1 Flash.");
    // Chosen, what it needs is said once: under it, how to give it, with the plan's page.
    expect(within(d).getByRole("combobox", { name: "Modelo" }).textContent).toBe("DeepSeek V4.1 Flash");
    expect(d.textContent).toContain(
      "Ligue a região Global no OpenCode, em Settings › Privacy. Sem ela, este modelo não responde.",
    );
    expect(within(d).getByRole("link", { name: "Abrir opencode.ai" }).getAttribute("href")).toBe(
      "https://opencode.ai/console",
    );
  });

  test("an OpenCode key on OpenCode's CLI: after the computer's free models, OpenCode Go's, DeepSeek V4.1 Flash too", async () => {
    const free = { kind: "opencode" as const, available: true, defaultModel: null };
    const { state } = await onPlan(
      "zen",
      {
        brain: "opencode",
        effectiveModel: "opencode/big-pickle",
        options: [{ ...free, models: [{ value: "opencode/big-pickle", label: "Big Pickle", free: true }] }],
      },
      { kind: "opencode", label: "OpenCode", keyHint: "Q7f2" },
    );
    const d = await brainDialog();
    const trigger = within(d).getByRole("combobox", { name: "Modelo" });
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    const list = screen().getByRole("listbox");
    // The computer listed its CLI's models with no key: the free tier. The key's Go models follow, by maker.
    expect(within(list).getAllByRole("option")[1]?.textContent).toContain("Big Pickle");
    const deepseek = within(within(list).getByRole("group", { name: "DeepSeek" })).getAllByRole("option");
    expect(deepseek.map((o) => o.querySelector(".ac-menu__desc")?.textContent ?? null)).toEqual([null, "Econômico"]);
    expect(deepseek[1]?.textContent).toContain("DeepSeek V4.1 Flash");
    await click(screen().getByRole("option", { name: /^DeepSeek V4\.1 Flash/ }));
    await settle(6);
    expect(brainCalls(state).at(-1)).toMatchObject({ model: "opencode-go/deepseek-v4.1-flash" });
  });

  test("a coding plan's keys are rows of their own, by the key's end; someone else's waits for its owner", async () => {
    const { state } = await onPlan("opencode", {
      accounts: [
        planKey("opencode"),
        planKey("opencode", { id: "acct_oc2", label: "Plano 2", usedBy: [], keyHint: "9f3c" }),
        planKey("zai", { id: "acct_theirs", label: "GLM", mine: false, ownerId: "u-bia", usedBy: [], keyHint: "1b2c" }),
      ],
    });
    const d = await brainDialog();
    const rows = await brainRows(d);
    expect(rows.find((r) => r.title === "Plano")?.desc).toBe("chave …4f2a");
    expect(rows.find((r) => r.title === "Plano 2")?.desc).toBe("chave …9f3c");
    expect(rows.find((r) => r.title === "GLM")?.disabled).toBe(true);
    expect(rows.find((r) => r.title === "Plano")?.mark).toBe("opencode");
    await choose(d, /^Plano 2/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ brain: "claude_code", account: "acct_oc2" });
  });

  test("a key made for all of its owner's agents there is picked as it is, though another agent thinks with it", async () => {
    const { state } = await onPlan("opencode", {
      account: null,
      accounts: [planKey("opencode", { id: "acct_oc", usedBy: ["Theo"], shared: true })],
    });
    const d = await brainDialog();
    await choose(d, /^Plano/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ brain: "claude_code", account: "acct_oc" });
  });

  test("a key its plan refused: said so, and the note's one button asks the same account for a new key", async () => {
    const { state } = await onPlan("opencode", {}, { status: "signed_out" });
    const d = await brainDialog();
    expect((await card(d, /^Plano/))?.desc).toContain("Chave recusada");
    expect(note(d).text).toContain("A chave foi recusada: troque por uma nova.");
    expect(note(d).button?.textContent).toBe("Trocar a chave");
    await click(note(d).button as Element);
    await settle(6);
    const block = within(d).getByRole("region", { name: "Conectar OpenCode Go" });
    fireEvent.change(within(block).getByLabelText("Chave do OpenCode Go"), {
      target: { value: "oc_sk_fake-key-for-tests" },
    });
    await click(within(block).getByRole("button", { name: "Enviar ao MacBook" }));
    await settle(8);
    expect(state.calls.find((c) => c.method === "machines.beginAccountLogin")?.args).toEqual([
      ORG_ID,
      "machine_1",
      "claude_code",
      { accountId: "acct_plan", provider: "opencode" },
    ]);
  });

  test("a model OpenCode's list added after this build: offered by its maker, and shown by its name once chosen", async () => {
    const table = CODING_PLANS.opencode.claudeCode.models;
    try {
      await onPlan(
        "opencode",
        { model: "nova-2", effectiveModel: "nova-2" },
        {},
        { opencode: [...table, { id: "nova-2", label: "Nova 2", maker: "Acme" }] },
      );
      expect(brainCell().value).toContain("Nova 2");
      expect(await offered(await brainDialog(), "Modelo")).toContain("ANova 2");
    } finally {
      learnPlanModels({ opencode: table });
    }
  });

  test("the cell: the account that pays, then its model and effort", async () => {
    await onPlan("opencode", { model: "deepseek-v4.1-flash", effectiveModel: "deepseek-v4.1-flash", effort: "max" });
    expect(brainCell()).toEqual({
      label: "Pensa com",
      value: "Plano · DeepSeek V4.1 Flash · esforço máximo",
      sub: undefined,
    });
    expect(sentence().querySelector(".ac-brand[data-mark='opencode']")).not.toBeNull();
  });

  test("the cell names the plan's model it runs; models sold with words show them, a plan's only model too", async () => {
    await onPlan("kimi", { model: "k3-256k", effectiveModel: "k3-256k" });
    expect(sentence().textContent).toContain("K3 256K");
    cleanup();
    await onPlan("zai", { model: "opus", effectiveModel: "opus" });
    let d = await brainDialog();
    expect(within(d).queryByRole("radiogroup", { name: "Modelo" })).toBeNull();
    // An alias the plan leaves out runs its main model: shown as that one (what it's sold as stays in the list).
    const trigger = within(d).getByRole("combobox", { name: "Modelo" });
    expect(trigger.textContent).toBe("GLM-5.3");
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    expect(
      screen()
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "AutomáticoEscolhe o modelo e o esforço para cada tarefa",
      "GLM-5.3Topo de linha",
      "GLM-5.3 FlashEconômico",
    ]);
    cleanup();
    await onPlan("minimax");
    d = await brainDialog();
    // The model is a select on every brain, a plan of one model too.
    const one = within(d).getByRole("combobox", { name: "Modelo" });
    expect(one.textContent).toBe("MiniMax M3.1 Flash");
    one.focus();
    await act(async () => fireEvent.keyDown(one, { key: "Enter" }));
    expect(
      screen()
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["AutomáticoEscolhe o modelo e o esforço para cada tarefa", "MiniMax M3.1 Flash"]);
  });
});

describe("Onde trabalha and the browser (their dialogs)", () => {
  test("each computer says what it has; choosing one saves at once", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    pairMac(api, true);
    await open(state, api);
    const d = await dialog("Mudar onde trabalha", "Onde a Ada trabalha?");
    const mac = within(d).getByRole("radio", { name: /^MacBook/ });
    expect(mac.textContent).toContain("Ligado · Claude Code · Codex · Navegador");
    // Portraits are as wide as their drawings: each sits in the same column, so the names line up, and the drawing
    // starts at the row's edge like any other lead. "Nenhum computador" leads with a dash in that column.
    const options = within(d).getAllByRole("radio");
    expect(options.length).toBeGreaterThan(1);
    const none = within(d).getByRole("radio", { name: /^Nenhum computador/ });
    expect(none.querySelector(".ac-optrow__lead > .machine-row__pic > svg.ac-icon")).toBeTruthy();
    for (const option of options.filter((o) => !o.textContent?.startsWith("Nenhum computador")))
      expect(option.querySelector(".ac-optrow__lead > .machine-row__pic > canvas.ac-computer")).toBeTruthy();
    const css = await Bun.file(new URL("../src/layout.css", import.meta.url).pathname).text();
    const column = css.split("\n.machine-row__pic {")[1]?.split("}")[0] ?? "";
    expect(column).toContain("width: 48px");
    expect(column).not.toContain("center");
    await click(mac);
    await click(within(d).getByRole("button", { name: "Usar o MacBook" }));
    await settle(6);
    expect(state.calls.find((c) => c.method === "sandbox.setTarget")?.args.slice(1)).toEqual([ADA_ID, "machine_1"]);
    expect(document.body.textContent).toContain("A Ada agora trabalha no MacBook.");
  });

  test("the browser with no computer: the agent moves to the MacBook, and the steps there show before it's allowed", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    pairMac(api, false);
    await open(state, api);
    const d = await dialog("Mudar o navegador", "A Ada pode navegar em sites?");
    await click(within(d).getByRole("radio", { name: /^Qualquer site/ }));
    expect(d.textContent).toContain("A Ada passa para o MacBook, que tem navegador.");
    const steps = within(d).getByRole("region", { name: "Falta 1 passo, no próprio MacBook" });
    // The app's icon sits by the clock: at the top on a Mac, at the bottom on a PC.
    expect(steps.textContent).toContain("Clique no ícone do agentes.chat perto do relógio");
    expect(steps.querySelector(".machine-command__code")).toBeNull();
    await click(within(d).getByRole("button", { name: "Usar" }));
    await settle(6);
    expect(state.calls.find((c) => c.method === "sandbox.setTarget")?.args.slice(1)).toEqual([ADA_ID, "machine_1"]);
    expect(state.calls.some((c) => c.method === "access.set")).toBe(true);
    expect(document.body.textContent).toContain("Falta 1 passo no MacBook.");
  });

  test("on a Linux computer, maybe a server without the app, the step there is the command too", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.pair({
      id: "machine_1",
      name: "Servidor",
      os: "linux",
      mode: "system",
      access: { folders: [], tools: { claude: true, codex: true, commands: true, browser: false } },
      browser: { available: false, version: null, chrome: null, reason: null },
    });
    await open(state, api);
    const d = await dialog("Mudar o navegador", "A Ada pode navegar em sites?");
    await click(within(d).getByRole("radio", { name: /^Qualquer site/ }));
    const steps = within(d).getByRole("region", { name: "Falta 1 passo, no próprio Servidor" });
    expect(steps.textContent).toContain(
      "Só quem está no computador liga, no app do agentes.chat: Preferências → Ferramentas.Sem o app? No terminal do computador:",
    );
    expect(steps.querySelector(".machine-command__code")?.textContent).toBe("sudo agentes-runner tools enable browser");
    expect(steps.querySelector(".brw-steps__grid")).toBeNull();
  });

  /**
   * Ada's browser on Servidor, a Linux computer (`machine` over it), and the page open. `reason`: what the server says
   * of her browser there; null: she still has no computer, so turning it on moves her there.
   */
  const onServidor = async (
    machine: Partial<Machine>,
    reason: BrowserUnavailableReason | null,
    { cloud = false, granted = false } = {},
  ) => {
    cleanup();
    const state = seedState();
    if (granted) state.scopes[ADA_ID] = [...(state.scopes[ADA_ID] ?? []), { connectionId: null, scope: "browser:use" }];
    const api = createFakeApi(state);
    const machines = fakeMachinesOf.get(api);
    machines?.pair({ id: "machine_1", name: "Servidor", os: "linux", mode: "system", ...machine });
    if (cloud) machines?.setSetup({ state: "ready", machineId: "machine_1" });
    if (reason) {
      await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
      fakeBrowserOf.get(api)?.settings.set(ADA_ID, {
        allowedDomains: null,
        available: false,
        reason,
        detail: null,
        machine: { id: "machine_1", name: "Servidor" },
      });
    }
    await open(state, api);
  };
  const tools = (browser?: boolean) => ({
    folders: [],
    tools: { claude: true, codex: true, commands: true, ...(browser === undefined ? {} : { browser }) },
  });
  const command = (steps: Element | null) => steps?.querySelector(".machine-command__code")?.textContent;

  test("the step is only for a switch that is off, on a computer someone here reaches", async () => {
    const stepsIn = async (...args: Parameters<typeof onServidor>) => {
      await onServidor(...args);
      const d = await dialog("Mudar o navegador", "A Ada pode navegar em sites?");
      await click(within(d).getByRole("radio", { name: /^Qualquer site/ }));
      return d.querySelector(".brw-steps");
    };
    const missing = {
      available: false,
      version: "1",
      chrome: null,
      reason: "Chrome's libraries are missing: run `agentes-runner browser install --with-deps`",
    };
    expect(command(await stepsIn({ access: tools(false) }, "switched_off"))).toBe(
      "sudo agentes-runner tools enable browser",
    );
    // Switched on, and Chrome's libraries missing there: nothing to turn on, where she is or where she'd move.
    expect(await stepsIn({ access: tools(true), browser: missing }, "not_installed")).toBeNull();
    expect(await stepsIn({ access: tools(true), browser: missing }, null)).toBeNull();
    // A runner from before the browser has no switch for it.
    expect(await stepsIn({ access: tools() }, "outdated")).toBeNull();
    // The workspace's own computer: nobody here reaches it.
    expect(
      await stepsIn({ kind: "managed", os: "other", access: tools(false) }, "switched_off", { cloud: true }),
    ).toBeNull();
  });

  test("under the sentence, the step waits for a switch that is off, not for one that is on", async () => {
    await onServidor({ access: tools(false) }, "switched_off", { granted: true });
    expect(command(screen().getByRole("region", { name: "Falta 1 passo, no próprio Servidor" }))).toBe(
      "sudo agentes-runner tools enable browser",
    );
    // On, and the computer hasn't said yet whether it runs.
    await onServidor({ access: tools(true) }, "not_reported", { granted: true });
    expect(document.querySelector(".brw-steps")).toBeNull();
  });
});

describe("Quem pensa: the draft", () => {
  const saved: Saved = {
    name: "Ada",
    handle: "ada",
    role: "",
    look: { color: "sky", eyes: "round", accessory: "none" },
    instructions: "",
    model: "claude-sonnet-5-5",
    owner: "u-joao",
    audience: { mode: "everyone", userIds: [] },
    brain: { brain: "model", model: null },
  };
  const api: BrainChoice = { brain: "model", model: null };

  test("only real differences count", () => {
    expect(changedKeys(saved, { brain: { ...api } })).toEqual([]);
    expect(sameBrain(api, { ...api, model: "opus" })).toBe(true);
    expect(changedKeys(saved, { brain: { brain: "claude_code", model: null } }).map((c) => c.key)).toEqual(["brain"]);
  });
});
describe("Quem pensa: Automático", () => {
  /** Ada thinks with Claude Code on the MacBook (as given). */
  async function onClaude(patch: Partial<AgentBrain> = {}) {
    const state = seedState();
    const api = createFakeApi(state);
    pairMac(api, true);
    await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
    liveBrain(api, { brain: "claude_code", effectiveModel: "sonnet", ...patch });
    await open(state, api);
    return state;
  }

  test("Claude Code: Automático comes first for the model and picks the effort too, saved with it", async () => {
    const state = await onClaude();
    const d = await brainDialog();
    // Each with what it is for.
    expect(await modelNames(d)).toEqual([
      "AutomáticoEscolhe o modelo e o esforço para cada tarefa",
      "OpusO mais capaz. Gasta o plano mais rápido.",
      "SonnetEquilibrado. Bom para quase tudo.",
      "HaikuRápido e leve. Para tarefas simples.",
    ]);
    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));
    await settle(2);
    await model(d, /^Automático/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ model: "auto", effort: "auto" });
    expect(within(d).getByRole("combobox", { name: "Modelo" }).textContent).toBe("Automático");
    await advanced(d);
    expect(within(d).queryByRole("slider", { name: "Esforço" })).toBeNull();
    expect(d.textContent).toContain(
      "EsforçoO modelo Automático escolhe o esforço de cada tarefa. Escolha um modelo para fixar o esforço.",
    );
  });

  test("back to a fixed model: the effort starts again at Médio", async () => {
    const state = await onClaude({ model: "auto", effectiveModel: "auto", effort: "auto" });
    const d = await brainDialog();
    await model(d, /^Opus/);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ model: "opus", effort: "medium" });
    await advanced(d);
    const effort = within(d).getByRole("combobox", { name: "Esforço" });
    expect(effort.textContent).toBe("Médio");
  });

  test("a saved Automático reads as such in the cell, with no effort after it", async () => {
    await onClaude({ model: "auto", effectiveModel: "auto", effort: "auto" });
    expect(brainCell()).toEqual({ label: "Pensa com", value: "Claude · Automático", sub: undefined });
  });

  test("the organization's model: Automático is the first choice, saved as the agent's model at once", async () => {
    const { state } = await open();
    const d = await brainDialog();
    const trigger = within(d).getByRole("combobox", { name: "Modelo" });
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    const first = screen().getAllByRole("option")[0] as HTMLElement;
    expect(first.textContent).toBe("AutomáticoEscolhe o modelo e o esforço para cada tarefa");
    await click(first);
    await settle(6);
    expect(state.calls.filter((c) => c.method === "agents.update").map((c) => c.args[2])).toEqual([{ model: "auto" }]);
    expect(document.body.textContent).toContain("A Ada agora pensa com Automático.");
  });

  test("OpenRouter's models: a search over them, its good picks before the rest, each with its price", async () => {
    const seeded = seedState({ extraModels: OPENROUTER_MODELS });
    seeded.credentials.push(OPENROUTER_KEY);
    const { state } = await open(seeded);
    const d = await brainDialog();
    await click(within(d).getByRole("combobox", { name: "Modelo" }));
    const list = screen().getByRole("listbox", { name: "Modelos" });
    const groups = within(list)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Claude", "OpenAI", "OpenRouter · Boas escolhas", "OpenRouter"]);
    const search = screen().getByRole("combobox", { name: "Buscar modelos" });
    await act(async () => fireEvent.change(search, { target: { value: "glm" } }));
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Z.ai: GLM LatestUS$ 0,1 / US$ 2,77 por milhão de tokens",
      "Z.ai: GLM 5.3US$ 0,1 / US$ 2,77 por milhão de tokens",
    ]);
    // The maker's name and the id find them too; a free one says so.
    await act(async () => fireEvent.change(search, { target: { value: "nvidia free" } }));
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["NVIDIA: Nemotron 3 Ultra (free)Grátis, com limite diário"]);
    await act(async () => fireEvent.change(search, { target: { value: "glm" } }));
    await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
    await settle(6);
    expect(state.calls.filter((c) => c.method === "agents.update").map((c) => c.args[2])).toEqual([
      { model: "~z-ai/glm-latest" },
    ]);
  });

  test("without an OpenRouter key its good picks show, each saying a key opens it, and not the rest of its list", async () => {
    await open(seedState({ extraModels: OPENROUTER_MODELS }));
    const d = await brainDialog();
    await click(within(d).getByRole("combobox", { name: "Modelo" }));
    const list = screen().getByRole("listbox", { name: "Modelos" });
    const picks = within(within(list).getByRole("group", { name: "OpenRouter · Boas escolhas" })).getAllByRole(
      "option",
    );
    expect(picks.map((o) => [o.textContent, o.getAttribute("aria-disabled")])).toEqual([
      ["Z.ai: GLM LatestPrecisa de uma chave de API OpenRouter", "true"],
      ["DeepSeek: DeepSeek Flash LatestPrecisa de uma chave de API OpenRouter", "true"],
      ["Claude Sonnet LatestPrecisa de uma chave de API OpenRouter", "true"],
    ]);
    expect(within(list).queryByRole("group", { name: "OpenRouter" })).toBeNull();
  });
});

describe("Velocidade (ADR 0149)", () => {
  async function onChatGpt(patch: Partial<AgentBrain> = {}, line?: Partial<NonNullable<Agent["brain"]>>) {
    const state = seedState();
    const api = createFakeApi(state);
    pairMac(api, true);
    await api.sandbox.setTarget(ORG_ID, ADA_ID, "machine_1");
    const ada = state.agents.find((a) => a.id === ADA_ID);
    if (ada && line) ada.brain = { kind: "codex", model: "GPT-6 Sol", ...line };
    liveBrain(api, { brain: "codex", effectiveModel: "gpt-6-sol", onlyOwner: true, ...patch });
    return open(state, api);
  }
  const speed = (d: HTMLElement) => within(d).queryByRole("radiogroup", { name: "Velocidade" });

  test("on a ChatGPT plan with a model that has it: Padrão first, Rápida saved at once, the help says what it costs", async () => {
    const { state } = await onChatGpt();
    const d = await brainDialog();
    await advanced(d);
    const group = speed(d) as HTMLElement;
    const [standard, fast] = within(group).getAllByRole("radio");
    expect(standard?.textContent).toBe("Padrão");
    expect(standard?.getAttribute("aria-checked")).toBe("true");
    expect(fast?.textContent).toBe("Rápida");
    expect(hintOf("Velocidade", d).text).toBe(
      "Responde mais rápido nas conversas e gasta o plano 2,5× mais depressa. Rotinas e tarefas longas seguem no padrão.",
    );
    await click(fast as HTMLElement);
    await settle(6);
    expect(brainCalls(state).at(-1)).toEqual({ speed: "fast" });
    expect(
      within(speed(d) as HTMLElement)
        .getByRole("radio", { name: "Rápida" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("no control on a model without it or on Claude", async () => {
    await onChatGpt({ effectiveModel: "gpt-5.5", model: "gpt-5.5", speed: "fast" });
    expect(brainCell().value).not.toContain("Rápida");
    let d = await brainDialog();
    await advanced(d);
    expect(speed(d)).toBeNull();
    cleanup();
    await onChatGpt({ brain: "claude_code", effectiveModel: "sonnet" });
    d = await brainDialog();
    await advanced(d);
    expect(speed(d)).toBeNull();
  });

  test("the cell says Rápida beside the model and the effort, where it applies", async () => {
    await onChatGpt({ speed: "fast" }, { speed: "fast" });
    expect(brainCell().value).toBe("ChatGPT · GPT-6 Sol · esforço médio · Rápida");
    cleanup();
    await onChatGpt();
    expect(brainCell().value).toBe("ChatGPT · GPT-6 Sol · esforço médio");
  });

  test("a save that fails says so and leaves the dialog open on what it had", async () => {
    const { api } = await onChatGpt();
    api.agents.setBrain = async () => {
      throw new Error("offline");
    };
    const d = await brainDialog();
    await advanced(d);
    await click(within(speed(d) as HTMLElement).getByRole("radio", { name: "Rápida" }));
    await settle(6);
    expect(screen().getByText("Não deu para salvar. Tente de novo.")).toBeTruthy();
    expect(screen().getByRole("dialog", { name: "Quem pensa" })).toBeTruthy();
    expect(
      within(speed(d) as HTMLElement)
        .getByRole("radio", { name: "Padrão" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
