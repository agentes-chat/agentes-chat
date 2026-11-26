import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { ApiClient, DirectMessage, FirstAgentOption, FirstAgents } from "@agenteschat/client";
import { ApiError, keys } from "@agenteschat/client";
import type { OnboardingStepId } from "@agenteschat/client/lib/onboarding";
import { browserTimezone } from "@agenteschat/client/lib/routines";
import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { fileSaver } from "@/components/artifacts/fileSaver";
import { teamPhoto } from "@/pages/onboarding/team-photo";
import {
  ATLAS_ID,
  createFakeApi,
  type FakeState,
  GENERAL_ID,
  LODI_ID,
  ORG_ID,
  seedState,
  withRightHand,
} from "./fake-api";
import { pick } from "./new-agent-flow";
import { renderApp, screen, settle, showIn } from "./render";

/*
 * The onboarding (ADR 0162, amended for the first agent asked of the person's own AI, ADR 0253): what the workspace is
 * for first (ADR 0159), then one box at a time on the page's sky, each step read from the workspace's own data: a
 * team's name, how to start (the person's own AI proposes first agents, one is picked; or from scratch), the picked
 * agent's first week, the plan where the workspace waits for its first one, the team's photo back from Checkout, an AI
 * for the team to think with and, a team's last, the people who work there.
 */

const realFetch = globalThis.fetch;
const realDraw = teamPhoto.draw;
const realSave = fileSaver.save;
const realObjectUrl = URL.createObjectURL;
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  globalThis.fetch = realFetch;
  teamPhoto.draw = realDraw;
  fileSaver.save = realSave;
  URL.createObjectURL = realObjectUrl;
  focusManager.setFocused(undefined);
});

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const answer = (name: RegExp) => screen().getByRole("radio", { name });
/** An answer's title and its line, as the row beside its radio shows them. */
const answerText = (name: RegExp) => answer(name).closest(".onb-pick__item")?.textContent ?? "";
const click = async (el: Element, rounds = 10) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
/** The first question answered for a company or team: its name comes next. */
const forATeam = async () => {
  await click(answer(/Para meu time/), 4);
  await click(button("Continuar"), 4);
};
const type = async (label: string, value: string) => {
  await act(async () => fireEvent.change(screen().getByLabelText(label), { target: { value } }));
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent;
const lead = () => document.querySelector(".onbx__lead")?.textContent;
/** What the right hand says over the box. */
const says = () => document.querySelector(".onbw__say")?.textContent;
const box = () => document.querySelector(".onbx") as HTMLElement;
/** The geometry capture, where CI runs one (`check:geometry`). */
const snapshot = () => (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();

const PURPOSE = "Para que você vai usar o agentes.chat?";
const NAME = "Como se chama o seu workspace?";
const START = "Como você quer começar?";
const ASK = "Peça o seu primeiro agente";
const PICK = "Escolha o seu primeiro agente";
const WEEK = "A primeira semana do Caio";
const HIRE = "Contrate o time";
const AI = "Agora, a IA que vocês já assinam";
const PEOPLE = "Quem trabalha com você?";
const PEOPLE_WHILE = "Enquanto isso, chame quem trabalha com você";
const GREETING = "Oi, eu sou o Lodi. Monto o time com você.";

/** A new workspace's zone and the person's own in it: this browser's, sent with the workspace. */
const zones = () => {
  const zone = browserTimezone();
  return { timezone: zone ?? "UTC", ...(zone ? { memberTimezone: zone } : {}) };
};

/** One agent the person's AI proposed, as the server keeps it (ADR 0253). */
const option = (
  name: string,
  role: string,
  color: string,
  extra: Partial<FirstAgentOption> = {},
): FirstAgentOption => ({
  name,
  handle: name.toLowerCase(),
  role,
  why: `${name} tira de você o que mais se repete.`,
  tasks: [
    `${role}: toda segunda, 8:00, lista o que atrasou`,
    "Rascunha as mensagens para o seu ok",
    "Avisa quando algo muda",
  ],
  apps: [
    { key: "gmail", label: "Gmail" },
    { key: null, label: "Planilha de clientes" },
  ],
  routine: {
    title: "Revisar a semana",
    schedule: "toda segunda às 8:00",
    prompt: "Revise a semana.",
    cron: "0 8 * * 1",
    timezone: "America/Sao_Paulo",
  },
  today: ["Lista quem está atrasado", "Rascunha os primeiros lembretes"],
  instructions: `Você é ${name}.`,
  appearance: { color, eyes: "happy", accessory: "none" },
  ...extra,
});
const PROPOSED = [
  option("Caio", "Cobrança", "amber"),
  option("Iara", "Atendimento", "violet"),
  option("Nina", "Agenda", "teal"),
];
/** What the person's AI sent: up to three agents, the task that repeats the most first. */
const proposal = (options = PROPOSED, extra: Partial<FirstAgents> = {}): FirstAgents => ({
  id: "fa-1",
  about: "A Acme vende assinaturas para clínicas e cobra todo mês.",
  source: "mcp",
  options,
  picked: null,
  agentId: null,
  createdAt: new Date().toISOString(),
  ...extra,
});
/** The same proposal as the JSON answer pasted when there is no connector. */
const pasted = JSON.stringify({
  about: "A Acme vende assinaturas para clínicas.",
  options: [
    { name: "Caio", role: "Cobrança", why: "É o que mais se repete.", tasks: ["Cobra quem atrasou"], apps: ["Gmail"] },
    { name: "Iara", role: "Atendimento", why: "Responde os clientes.", tasks: ["Responde dúvidas"] },
  ],
});

/** Someone signed up with no workspace yet; `cloud`: the server bills, and a new workspace waits for its plan. */
const newcomer = (cloud: boolean) => {
  const state = seedState({ agents: [] });
  if (state.me) state.me.organizations = [];
  if (cloud) {
    state.authConfig = { billingUrl: "https://billing.example.com" };
    state.newWorkspaceStanding = { state: "hold", reason: "payment" };
  }
  return state;
};
/**
 * Acme being set up already, at whatever its data says; `step`: the furthest one the server keeps; `held`: on
 * agentes.chat Cloud, waiting for its first plan; `picked`: its first agent picked from its AI's proposal.
 */
const settingUp = (
  opts: { held?: boolean; step?: OnboardingStepId; personal?: boolean; picked?: boolean; proposal?: FirstAgents } = {},
) => {
  const state = withRightHand(seedState({ agents: [] }));
  if (state.me)
    state.me.organizations = [
      {
        id: ORG_ID,
        name: opts.personal ? "Pessoal" : "Acme",
        role: "owner",
        ...(opts.personal ? { mode: "personal" as const } : {}),
        onboarding: { step: opts.step ?? "workspace", generalChannelId: GENERAL_ID },
        ...(opts.held ? { standing: { state: "hold" as const, reason: "payment" } } : {}),
      },
    ];
  if (opts.held) state.authConfig = { billingUrl: "https://billing.example.com" };
  if (opts.proposal) state.firstAgents = opts.proposal;
  if (opts.picked) {
    const caio = PROPOSED[0] as FirstAgentOption;
    state.agents.push({
      id: "agent-caio",
      name: caio.name,
      handle: caio.handle,
      role: caio.role,
      instructions: caio.instructions,
      model: "auto",
      ownerUserId: "u-walter",
      hasCredential: false,
      monthlyBudgetUsd: null,
      createdAt: new Date().toISOString(),
      appearance: caio.appearance,
    });
    state.firstAgents = proposal(PROPOSED, { picked: 0, agentId: "agent-caio" });
  }
  return state;
};
/** The billing service's public plan list; `null`: it can't be read. */
const plans = (list: unknown | null) => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return list === null
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return asked;
};
const PLANS = {
  recommended: "team",
  recommendedAlone: "personal",
  plans: [
    { key: "personal", name: "Pessoal", price: "$29", period: "month" },
    { key: "team", name: "Equipe", price: "$49", period: "month", people: 10 },
  ],
};

/**
 * No agent has an AI yet, whoever is made later (the fake's own answer is every agent ready): the AI step asks for
 * one.
 */
const noAiYet = (state: FakeState) => {
  Object.defineProperty(state, "aiStatus", {
    configurable: true,
    get: () => ({ any: false, agents: state.agents.map((a) => ({ agentId: a.id, state: "no_ai" as const })) }),
  });
  return state;
};
/** An AI connected meanwhile (in the step's dialog, another tab, the phone): every agent ready again. */
const aiConnected = (state: FakeState) =>
  Object.defineProperty(state, "aiStatus", { configurable: true, writable: true, value: undefined });
/** Where the onboarding sends the person, with the arrival it asks for (the workspace drops it from the address). */
const landings = (router: Awaited<ReturnType<typeof renderApp>>["router"]) => {
  const seen: { path: string; arrival: string | undefined }[] = [];
  router.subscribe("onBeforeNavigate", (e) => {
    // Against the last path seen, not `pathChanged`: the router's resolved location can lag behind a navigation that
    // only drops the arrival from the address.
    if (e.toLocation.pathname === (seen.at(-1)?.path ?? e.fromLocation?.pathname)) return;
    const arrival = (e.toLocation.search as Record<string, unknown>).arrival;
    seen.push({ path: e.toLocation.pathname, arrival: arrival === undefined ? undefined : String(arrival) });
  });
  return seen;
};
type Rendered = Awaited<ReturnType<typeof renderApp>>;
/** The person's AI sends its proposal now (`propose_first_agents`), and the page reads it on its next poll. */
const arrives = async (state: FakeState, r: Rendered, sent = proposal()) => {
  state.firstAgents = sent;
  const orgId = state.me?.organizations.at(-1)?.id ?? ORG_ID;
  await act(() => r.services.queryClient.invalidateQueries({ queryKey: keys.firstAgents(orgId) }));
  await settle(12);
};
/** The stacked cards: each one's name, whether it is the one picked, and where it stands. */
const cards = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".onb-card")].map((c) => ({
    name: c.querySelector(".onb-card__name b")?.textContent,
    on: c.getAttribute("aria-pressed") === "true",
    pos: c.getAttribute("data-pos"),
  }));

/** A team's way to its AI's proposal: what it is for, its name, then "Ask your AI". */
async function toTheAsk(state: FakeState) {
  const r = await renderApp("/onboarding", { api: createFakeApi(state) });
  const landed = landings(r.router);
  await settle(10);
  await forATeam();
  await type("Nome", "Acme");
  await click(button("Continuar"), 14);
  expect(heading()).toBe(START);
  await click(button(/^Pedir à sua IA/), 12);
  expect(heading()).toBe(ASK);
  return { ...r, landed };
}
/** Then the proposal arrives, Caio (the first card) is created, and its week shows. */
async function toTheWeek(state: FakeState) {
  const r = await toTheAsk(state);
  await arrives(state, r);
  expect(heading()).toBe(PICK);
  await click(button(/^Criar o Caio/), 20);
  expect(heading()).toBe(WEEK);
  return r;
}

describe("a team's start, asking its own AI (ADR 0253)", () => {
  test("the name makes the workspace; how to start is the next step, nothing finished", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    expect(heading()).toBe(PURPOSE);
    await forATeam();
    expect(heading()).toBe(NAME);
    // The name, how to start, the agent's week and the plan.
    expect(eyebrow()).toBe("Passo 1 de 4");
    // A name is no misspelling, and an empty one goes nowhere.
    expect(screen().getByLabelText("Nome").getAttribute("spellcheck")).toBe("false");
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    await type("Nome", "Acme");
    await click(button("Continuar"), 14);
    expect(calls(state, "orgs.create").map((c) => c.args[0])).toEqual([{ name: "Acme", ...zones() }]);
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 2 de 4");
    // The apps the agents work in over the question, its two answers, asking the person's AI picked.
    expect(box().querySelector(".onb-wall")).not.toBeNull();
    expect(lead()).toMatch(
      /^Os agentes trabalham nos apps que vocês já usam(, mais de \d+)?\. Dá para mudar tudo depois\.$/,
    );
    expect(answer(/Pedir para a sua IA/).getAttribute("aria-checked")).toBe("true");
    expect(answerText(/Pedir para a sua IA/)).toContain("propõe um agente para cada uma");
    expect(answerText(/Começar do zero/)).toContain("O Lodi, o RH dos agentes, monta cada um com você.");
    // Nothing kept past the workspace: how it starts is the person's to answer.
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
    expect(calls(state, "agents.applyTeamTemplate")).toEqual([]);
  });

  test("the ask: the assistants most used first, connecting agentes.chat, the request to copy, then the wait", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await toTheAsk(state);
    expect(eyebrow()).toBe("Passo 2 de 4");
    expect(says()).toBe("Estou ouvindo. A proposta aparece aqui.");
    // The row scrolls sideways, the most used first; another agent app last, through the import.
    const row = within(box().querySelector(".onb-ask__ais") as HTMLElement);
    const names = row.getAllByRole("button").map((b) => b.textContent);
    expect(names.slice(0, 6)).toEqual(["ChatGPT", "Claude", "Gemini", "Grok", "Perplexity", "Le Chat"]);
    expect(names.at(-1)).toBe("Outro app de agentes");
    expect(names).not.toContain("Outro app");
    // Claude, picked when no app is connected yet.
    expect(row.getByRole("button", { name: "Claude" }).getAttribute("aria-pressed")).toBe("true");
    const steps = [...box().querySelectorAll(".onb-ask__steps > li")];
    expect(steps.map((li) => li.querySelector(".onb-ask__title")?.textContent)).toEqual([
      "Conecte o agentes.chat",
      "Cole este pedido numa conversa nova",
    ]);
    // The request names the workspace and the tool, and asks to create nothing.
    const request = box().querySelector(".onb-ask__text")?.textContent ?? "";
    expect(request).toContain("Entenda o que a Acme faz");
    expect(request).toContain("propose_first_agents");
    expect(request).toContain("Não crie nada: eu escolho por onde começar.");
    expect(button(/Copiar o pedido/)).toBeTruthy();
    expect(box().querySelector(".onb-ask__line")?.textContent).toBe("Esperando a proposta do Claude…");
    // Another assistant: its own words, its own wait.
    await click(row.getByRole("button", { name: "ChatGPT" }), 4);
    expect(box().querySelector(".onb-ask__line")?.textContent).toBe("Esperando a proposta do ChatGPT…");
    // Nothing is made while it waits.
    expect(calls(state, "firstAgents.pick")).toEqual([]);
  });

  test("the proposal arrives: three cards, the one picked in front; Create makes that one, and its week follows", async () => {
    const state = newcomer(true);
    plans(PLANS);
    const r = await toTheAsk(state);
    // One there from before the ask isn't its answer: only a new one moves the step on.
    await arrives(state, r);
    expect(heading()).toBe(PICK);
    expect(eyebrow()).toBe("Proposta do seu Claude · passo 2 de 4");
    expect(says()).toBe("O Claude achou três jeitos de começar.");
    expect(lead()).toBe(
      "O seu Claude achou as três tarefas que mais tomam o seu tempo. Comece por uma: as outras ficam para depois.",
    );
    expect(cards()).toEqual([
      { name: "Caio", on: true, pos: "center" },
      { name: "Iara", on: false, pos: "left" },
      { name: "Nina", on: false, pos: "right" },
    ]);
    const front = document.querySelector(".onb-card[data-on]") as HTMLElement;
    expect(front.querySelector(".onb-card__rank")?.textContent).toBe("A que mais se repete");
    expect([...front.querySelectorAll(".onb-card__label")].map((l) => l.textContent)).toEqual([
      "Responsabilidades",
      "Requisitos",
    ]);
    // Each app by its name beside its mark (an app outside the catalog: its initials).
    const words = (el: Element) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("");
    expect([...front.querySelectorAll(".onb-card__reqs > span")].map(words)).toEqual(["Gmail", "Planilha de clientes"]);
    expect(document.querySelector(".onb-hand__why")?.textContent).toBe(
      "Por que o Caio: Caio tira de você o que mais se repete.",
    );
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe("Nada é criado até você escolher.");
    // A card behind comes to the middle, and the button and the reason follow it.
    await click(document.querySelectorAll(".onb-card")[2] as HTMLElement, 4);
    expect(cards()).toEqual([
      { name: "Caio", on: false, pos: "left" },
      { name: "Iara", on: false, pos: "right" },
      { name: "Nina", on: true, pos: "center" },
    ]);
    expect(document.querySelector(".onb-hand__why")?.textContent).toBe(
      "Por que a Nina: Nina tira de você o que mais se repete.",
    );
    expect(button(/^Criar a Nina/)).toBeTruthy();
    await click(document.querySelectorAll(".onb-card")[0] as HTMLElement, 4);
    await click(button(/^Criar o Caio/), 20);
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(calls(state, "firstAgents.pick").map((c) => c.args)).toEqual([[orgId, "fa-1", 0]]);
    expect(heading()).toBe(WEEK);
    expect(eyebrow()).toBe("Passo 3 de 4");
  });

  test("the week: seven days from today, today's deliveries, the routine's day, and what the AI said", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await toTheWeek(state);
    expect(lead()).toBe(
      "Ele começa hoje mesmo, e “Revisar a semana” se repete toda segunda. Tudo chega no canal dele, e você só aprova.",
    );
    expect(says()).toBe("Assim que o time ligar, a gente começa.");
    const strip = [...document.querySelectorAll(".onb-week__strip > li")];
    expect(strip).toHaveLength(7);
    expect(strip.filter((d) => d.hasAttribute("data-today"))).toHaveLength(1);
    expect(strip[0]?.hasAttribute("data-today")).toBe(true);
    // Every Monday in the strip is a working day, today too (its deliveries).
    expect(strip[0]?.hasAttribute("data-work")).toBe(true);
    const days = [...document.querySelectorAll(".onb-week__day")];
    expect(days[0]?.querySelector(".onb-week__title b")?.textContent).toMatch(/^Hoje · /);
    const now = [...(days[0]?.querySelectorAll(".onb-week__evs > li") ?? [])]
      .filter((li) => li.querySelector(".onb-week__at")?.textContent === "Agora")
      .map((li) => li.querySelector(".onb-week__ev")?.textContent);
    expect(now).toEqual(["Lista quem está atrasado", "Rascunha os primeiros lembretes"]);
    // The routine's day says how it repeats, at its time.
    const repeats = days.flatMap((d) => [...d.querySelectorAll(".onb-week__title span")].map((s) => s.textContent));
    expect(repeats).toEqual(["toda segunda"]);
    expect(document.querySelector(".onb-week__from")?.textContent).toBe("O que o seu Claude contou");
    expect(document.querySelector(".onb-week__text")?.textContent).toBe(
      "A Acme vende assinaturas para clínicas e cobra todo mês.",
    );
    // Seen: kept as "agents", and the plan is next.
    await click(button(/^Continuar/), 16);
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [orgId, { step: "agents" }],
      [orgId, { step: "computer" }],
    ]);
    expect(heading()).toBe(HIRE);
    expect(eyebrow()).toBe("Passo 4 de 4");
  });

  test("no connector: the request asks for a JSON answer, pasted here; one that isn't JSON says so", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await toTheAsk(state);
    await click(button("Sem conector? Cole a resposta"), 4);
    // The request first, then the field for the answer; nothing to connect.
    const steps = [...box().querySelectorAll(".onb-ask__steps > li")];
    expect(steps.map((li) => li.querySelector(".onb-ask__title")?.textContent)).toEqual([
      "Cole este pedido numa conversa nova com o Claude",
      "Cole aqui a resposta inteira do Claude",
    ]);
    expect(box().querySelector(".onb-ask__text")?.textContent).toContain("Responda só com um JSON neste formato");
    expect((button(/^Ler a resposta/) as HTMLButtonElement).disabled).toBe(true);
    await type("Cole aqui a resposta inteira do Claude", "Aqui estão as opções, sem nada estruturado.");
    await click(button(/^Ler a resposta/), 6);
    expect(screen().getByRole("alert").textContent).toBe(
      "Não achei um JSON nessa resposta. Copie a resposta inteira e cole de novo.",
    );
    expect(calls(state, "firstAgents.paste")).toEqual([]);
    // The answer wrapped in words and a code block: its JSON is read.
    await type("Cole aqui a resposta inteira do Claude", `Claro! Segue:\n\`\`\`json\n${pasted}\n\`\`\``);
    await click(button(/^Ler a resposta/), 14);
    expect(calls(state, "firstAgents.paste")).toHaveLength(1);
    expect(heading()).toBe(PICK);
    // Two: side by side, the lead in their count.
    expect(cards().map((c) => c.pos)).toEqual(["side", "side"]);
    expect(lead()).toBe(
      "O seu Claude achou as duas tarefas que mais tomam o seu tempo. Comece por uma: as outras ficam para depois.",
    );
  });

  test("the plan: who is hired, the offer in two lines, its Checkout; Not now opens Lodi's DM", async () => {
    const state = newcomer(true);
    const asked = plans(PLANS);
    const r = await toTheWeek(state);
    await click(button(/^Continuar/), 16);
    expect(heading()).toBe(HIRE);
    expect(lead()).toBe(
      "Você está contratando o Caio para cobrança. Ele começa hoje, com o Lodi, e trabalha de dia e de noite.",
    );
    // The team asleep at night on the box's own header.
    expect(box().querySelector(".onb-pass:not([data-awake])")).not.toBeNull();
    const roster = [...box().querySelectorAll(".onb-roster > li")].map((li) => li.textContent);
    expect(roster).toEqual([
      "CaioCobrançaCobrança: toda segunda, 8:00, lista o que atrasou",
      "LodiRH dos agentesCria e ajusta os seus agentes, quando você pedir.",
    ]);
    expect(box().querySelector(".onb-offer__head")?.textContent).toContain("Plano Equipe");
    expect(box().querySelector(".onb-offer__price")?.textContent).toBe("$49por mês");
    expect(box().querySelector(".onb-offer__fine")?.textContent).toBe(
      "Até 10 pessoas. Crie outros agentes depois, sem pagar a mais. Cancele em um clique.",
    );
    expect(asked[0]).toBe("https://billing.example.com/plans.json?locale=pt-BR");
    const orgId = state.me?.organizations.at(-1)?.id;
    await click(button(/^Contratar o time/), 6);
    expect(calls(state, "orgs.billingLink").map((c) => c.args)).toEqual([[orgId, "onboarding", "team"]]);
    await click(button("Ver todos os planos"), 6);
    expect(calls(state, "orgs.billingLink").at(-1)?.args).toEqual([orgId, "onboarding"]);
    // Not now: the workspace opens on its right hand's DM, whose card leads with the plan.
    await click(button("Agora não"), 16);
    expect(calls(state, "orgs.saveOnboarding").at(-1)?.args).toEqual([orgId, { finished: true }]);
    expect(r.router.state.location.pathname).toBe(`/org/${orgId}/dm/agent/${LODI_ID}`);
    expect(r.landed.at(-1)?.arrival).toBe("beta");
  });

  test("with no plan data, the plan is named generically, its Checkout the same", async () => {
    const state = settingUp({ held: true, step: "agents", picked: true });
    plans(null);
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(HIRE);
    expect(box().querySelector(".onb-offer__head")?.textContent).toContain("Um plano do agentes.chat");
    expect(box().querySelector(".onb-offer__price")).toBeNull();
    expect(screen().queryByRole("button", { name: "Ver todos os planos" })).toBeNull();
    await click(button(/^Contratar o time/), 6);
    expect(calls(state, "orgs.billingLink").map((c) => c.args.length)).toEqual([2]);
  });

  test("Another agent app opens the import over the ask step, which stays under it and after it", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await toTheAsk(state);
    await click(button("Outro app de agentes"), 16);
    expect(screen().getByRole("dialog")).toBeTruthy();
    expect(heading()).toBe(ASK);
    await act(async () => fireEvent.keyDown(screen().getByRole("dialog"), { key: "Escape" }));
    await settle(8);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(heading()).toBe(ASK);
  });

  test("Not now on the ask starts from scratch: kept as such, and the plan for the right hand alone", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await toTheAsk(state);
    await click(button(/^Agora não/), 16);
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [orgId, { step: "agents" }],
      [orgId, { step: "computer" }],
    ]);
    expect(heading()).toBe(HIRE);
    expect(eyebrow()).toBe("Passo 3 de 3");
  });
});

describe("starting from scratch (ADR 0162, amended for the first agent)", () => {
  test("picked on how to start: three steps, the right hand alone on the plan, and a reload resumes there", async () => {
    const state = newcomer(true);
    plans(PLANS);
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    await forATeam();
    await type("Nome", "Acme");
    await click(button("Continuar"), 14);
    expect(eyebrow()).toBe("Passo 2 de 4");
    // Picked: no week comes, and the count says so before the button.
    await click(answer(/Começar do zero/), 4);
    expect(eyebrow()).toBe("Passo 2 de 3");
    await click(button(/^Começar do zero/), 16);
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [orgId, { step: "agents" }],
      [orgId, { step: "computer" }],
    ]);
    expect(calls(state, "firstAgents.pick")).toEqual([]);
    expect(heading()).toBe(HIRE);
    expect(eyebrow()).toBe("Passo 3 de 3");
    expect(lead()).toBe(
      "Você começa com o Lodi, o RH dos agentes. Ele cria cada agente com você e trabalha de dia e de noite.",
    );
    // Nobody hired but the right hand: no roster, the offer alone.
    expect(box().querySelector(".onb-roster")).toBeNull();
    cleanup();

    plans(PLANS);
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(HIRE);
    expect(eyebrow()).toBe("Passo 3 de 3");
  });

  test("self-hosted with an AI already there: from scratch goes on to the people, then #general", async () => {
    const state = settingUp();
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    const landed = landings(router);
    await settle(14);
    expect(heading()).toBe(START);
    // No plan here: the name and how to start.
    await click(answer(/Começar do zero/), 4);
    expect(eyebrow()).toBe("Passo 2 de 2");
    await click(button(/^Começar do zero/), 16);
    expect(heading()).toBe(PEOPLE);
    await click(button("Convidar depois"), 16);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
    // The team thought before the AI step could show: the arrival as ever.
    expect(landed.at(-1)?.arrival).toBe("1");
  });

  test("its Back goes to the name, filled; the name saved again goes on to how to start", async () => {
    const state = settingUp();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(START);
    await click(button("Voltar"), 8);
    expect(heading()).toBe(NAME);
    expect((screen().getByLabelText("Nome") as HTMLInputElement).value).toBe("Acme");
    await type("Nome", "Acme Clínicas");
    await click(button("Continuar"), 14);
    expect(calls(state, "orgs.updateSettings").at(-1)?.args).toEqual([ORG_ID, { name: "Acme Clínicas" }]);
    expect(heading()).toBe(START);
  });
});

describe("back from Checkout: the team's photo (ADR 0079)", () => {
  /** Acme with Caio, its plan step shown before Checkout ("computer"), back with `?paid=1`. */
  const paidReturn = async (opts: { lifted: boolean }) => {
    const state = noAiYet(settingUp({ held: !opts.lifted, step: opts.lifted ? "computer" : "agents", picked: true }));
    state.authConfig = { billingUrl: "https://billing.example.com" };
    plans(PLANS);
    const r = await renderApp(`/org/${ORG_ID}/onboarding?paid=1&plan=team&period=year`, { api: createFakeApi(state) });
    await settle(16);
    return { ...r, state };
  };

  test("the payment received until the hold lifts, then the photo: who's in the team, what's left, Connect the AI", async () => {
    const { state, router } = await paidReturn({ lifted: false });
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(heading()).toBe(HIRE);
    // The billing service lifts the hold on its next pass: until then, the payment as received, no button.
    expect(box().querySelector(".ac-dialog__foot-note [role='status']")?.textContent).toContain("Pagamento recebido");
    expect(screen().queryByRole("button", { name: /^Contratar o time/ })).toBeNull();
    const org = state.me?.organizations[0];
    if (org) delete org.standing;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(16);
    expect(heading()).toBe("Boas-vindas ao time da Acme");
    expect(eyebrow()).toMatch(/^Time da Acme · desde /);
    expect(lead()).toBe("Você, o Lodi e o Caio. A partir de hoje, trabalhando juntos, de dia e de noite.");
    expect(box().querySelector(".onb-photo__say")?.textContent).toBe("Oi, Walter. A gente começa hoje.");
    const rows = [...box().querySelectorAll(".onb-next__row")].map((li) => ({
      text: li.textContent,
      done: li.hasAttribute("data-done"),
    }));
    expect(rows).toEqual([
      { text: "Plano Equipe ativo (concluído)", done: true },
      { text: "2Conectar a IA que vocês já assinam", done: false },
      { text: "3Chamar quem trabalha com você", done: false },
      { text: "E o time começa as 2 entregas", done: false },
    ]);
    await click(button(/^Conectar a IA/), 16);
    expect(heading()).toBe(AI);
    // The plan bought, by its name, over the question.
    expect(eyebrow()).toBe("Plano Equipe ativo");
  });

  test("the photo downloads through the app's saver, named after the workspace", async () => {
    const saved: [string, string][] = [];
    teamPhoto.draw = async () => new Blob(["png"], { type: "image/png" });
    URL.createObjectURL = () => "blob:team-photo";
    fileSaver.save = (url, name) => saved.push([url, name]);
    await paidReturn({ lifted: true });
    expect(heading()).toBe("Boas-vindas ao time da Acme");
    await click(button("Baixar a foto do time"), 6);
    expect(saved).toEqual([["blob:team-photo", "time-acme.png"]]);
  });

  test("with the plan already on: the photo once, and a reload goes straight to the AI step", async () => {
    await paidReturn({ lifted: true });
    expect(heading()).toBe("Boas-vindas ao time da Acme");
    cleanup();
    await paidReturn({ lifted: true });
    expect(heading()).toBe(AI);
  });
});

describe("Connect an AI, then the people", () => {
  test("Connect later goes on to the people, whose Convidar depois opens #general with the wizard alone", async () => {
    const state = noAiYet(settingUp({ step: "agents", picked: true }));
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    const landed = landings(router);
    await settle(16);
    expect(heading()).toBe(AI);
    // Past the count: no step number.
    expect(eyebrow()).toBeUndefined();
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe("Sem uma IA, os agentes não respondem.");
    await click(button("Conectar depois"), 16);
    expect(heading()).toBe(PEOPLE);
    await click(button("Convidar depois"), 16);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [ORG_ID, { step: "ai" }],
      [ORG_ID, { finished: true }],
    ]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
  });

  test("the addresses as chips, each with its role, sent by the step's button; the workspace opens in #general", async () => {
    const state = settingUp({ step: "agents", picked: true });
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe(PEOPLE);
    expect(lead()).toBe("Cada pessoa que você chamar cria, ao entrar, o agente para o trabalho dela.");
    expect(says()).toBe("Agora as pessoas. Me passa os e-mails que eu mando os convites.");
    expect((button("Enviar convites") as HTMLButtonElement).disabled).toBe(true);
    const field = screen().getByLabelText("E-mails");
    await act(async () => fireEvent.change(field, { target: { value: "bruno@example.com, caio@example.com" } }));
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await settle(4);
    await pick(screen().getByRole("combobox", { name: "Cargo de caio@example.com" }), "Admin");
    await click(button("Convidar 2 pessoas"), 20);
    expect(calls(state, "orgs.inviteMany").map((c) => c.args[1])).toEqual([
      {
        invites: [
          { email: "bruno@example.com", roleIds: [] },
          { email: "caio@example.com", roleIds: ["role-admin"] },
        ],
      },
    ]);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [ORG_ID, { step: "team" }],
      [ORG_ID, { finished: true }],
    ]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  });

  test("right after the plan, the people while the team gets ready", async () => {
    const state = settingUp({ step: "ai", picked: true });
    state.authConfig = { billingUrl: "https://billing.example.com" };
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe(PEOPLE_WHILE);
    expect(eyebrow()).toBe("Preparando o time");
    expect(lead()).toBe(
      "Leva alguns minutos. Cada pessoa que você chamar cria, ao entrar, o agente para o trabalho dela.",
    );
  });

  test("a server that sends no email: the workspace's link, and Entrar no workspace", async () => {
    const state = settingUp({ step: "agents", picked: true });
    state.authConfig = { passwordReset: false };
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe(PEOPLE);
    expect(lead()).toBe("Quem abrir pede para entrar. Eu te mostro cada pedido, e você aprova.");
    expect(screen().queryByLabelText("E-mails")).toBeNull();
    await click(button("Criar link"), 8);
    const link = box().querySelector(".invite-link") as HTMLElement;
    expect(within(link).getByRole("button", { name: "Copiar link" })).toBeTruthy();
    await click(button(/^Entrar no workspace/), 16);
    expect(calls(state, "orgs.inviteMany")).toEqual([]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  });
});

describe("a workspace being set up resumes from its data", () => {
  test("at how to start, at an unpicked proposal, at the week, at the plan; never a second workspace", async () => {
    for (const [opts, title, saved] of [
      [{}, START, []],
      [{ proposal: proposal() }, PICK, []],
      [{ picked: true }, WEEK, []],
      [{ held: true, step: "agents", picked: true }, HIRE, [[ORG_ID, { step: "computer" }]]],
    ] as const) {
      const state = settingUp(opts);
      plans(PLANS);
      await renderApp("/onboarding", { api: createFakeApi(state) });
      await settle(14);
      expect({ opts, title: heading() }).toEqual({ opts, title });
      expect(calls(state, "orgs.create")).toEqual([]);
      expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual<typeof saved>(saved);
      cleanup();
    }
  });

  test("a resumed proposal's pick goes back to how to start, never to it again by itself", async () => {
    const state = settingUp({ proposal: proposal() });
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(PICK);
    // The pick has no Back of its own: the way back is the ask's, which the resumed pick skipped.
    expect(eyebrow()).toBe("Proposta da sua IA · passo 2 de 3");
  });

  test("picked in another tab meanwhile: this one moves on to the week when it comes back", async () => {
    const state = settingUp();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(START);
    const other = settingUp({ picked: true });
    state.agents = other.agents;
    state.firstAgents = other.firstAgents;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(14);
    expect(heading()).toBe(WEEK);
    expect(calls(state, "firstAgents.pick")).toEqual([]);
  });

  test("a read that fails, or a workspace that won't open, says so with a way on, never a sky that waits", async () => {
    const broke = () => new ApiError(500, "internal", "Something broke");
    const state = settingUp();
    const api = createFakeApi(state);
    const read = api.orgs.settings;
    let fails = 1;
    api.orgs.settings = async (orgId) => {
      if (fails-- > 0) throw broke();
      return read(orgId);
    };
    await renderApp("/onboarding", { api });
    await settle(14);
    await click(button("Tentar de novo"), 14);
    expect(heading()).toBe(START);
    cleanup();

    // Its people invited already ("team"): nothing left to answer, it opens by itself.
    const ready = settingUp({ step: "team", picked: true });
    const opening = createFakeApi(ready);
    const finish = opening.orgs.saveOnboarding;
    let refusals = 1;
    opening.orgs.saveOnboarding = async (orgId, input) => {
      if (refusals-- > 0) throw broke();
      return finish(orgId, input);
    };
    const { router } = await renderApp("/onboarding", { api: opening });
    await settle(16);
    expect(router.state.location.pathname).toBe("/onboarding");
    await click(button("Tentar de novo"), 16);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  });

  test("its AI left for later, it resumes on the people; invited already, it opens in #general", async () => {
    const later = noAiYet(settingUp({ step: "ai", picked: true }));
    await renderApp("/onboarding", { api: createFakeApi(later) });
    await settle(16);
    expect(heading()).toBe(PEOPLE);
    cleanup();
    const invited = settingUp({ step: "team", picked: true });
    const { router } = await renderApp("/onboarding", { api: createFakeApi(invited) });
    await settle(16);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  });

  test("asked to delete the workspace being set up: its dialog, and nothing is finished", async () => {
    const state = settingUp();
    await renderApp("/onboarding?delete=1", { api: createFakeApi(state) });
    await settle(10);
    expect(screen().getByRole("dialog")).toBeTruthy();
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
  });
});

describe("for me (ADR 0159)", () => {
  test("no name to ask: how to start in its own words, its AI asked as a step, its one agent hired by name", async () => {
    const state = newcomer(true);
    plans(PLANS);
    const api = createFakeApi(state);
    const r = await renderApp("/onboarding", { api });
    const landed = landings(r.router);
    await settle(10);
    // "For me", not "For my team", whose words start the same in Portuguese.
    await click(answer(/^Para mim(?!ha)/), 4);
    expect(screen().queryByLabelText("Nome")).toBeNull();
    await click(button("Continuar"), 16);
    expect(calls(state, "orgs.create")[0]?.args[0]).toEqual({ name: "Pessoal", mode: "personal", ...zones() });
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(heading()).toBe(START);
    // How to start, asking its AI, the agent's week and its plan.
    expect(eyebrow()).toBe("Passo 1 de 4");
    expect(answerText(/Pedir para a sua IA/)).toContain("no trabalho ou fora dele");
    await click(button(/^Pedir à sua IA/), 12);
    expect(heading()).toBe(ASK);
    expect(eyebrow()).toBe("Passo 2 de 4");
    expect(lead()).toContain("A sua IA já conhece a sua rotina.");
    // Its request speaks of the person, never of a workspace named "Pessoal".
    const request = box().querySelector(".onb-ask__text")?.textContent ?? "";
    expect(request).toContain("Entenda o que eu faço, como é a minha semana");
    expect(request).not.toContain("Pessoal");
    await arrives(state, r);
    expect(heading()).toBe(PICK);
    expect(eyebrow()).toBe("Proposta do seu Claude · passo 2 de 4");
    await click(button(/^Criar o Caio/), 20);
    expect(heading()).toBe(WEEK);
    expect(eyebrow()).toBe("Passo 3 de 4");
    expect(lead()).toBe(
      "Ele começa hoje mesmo, e “Revisar a semana” se repete toda segunda. Tudo chega na conversa com ele, e você só aprova.",
    );
    expect(says()).toBe("Assim que ligar, a gente começa.");
    await click(button(/^Continuar/), 16);
    expect(heading()).toBe("Contrate o Caio");
    expect(eyebrow()).toBe("Passo 4 de 4");
    // The plan for one person, never the team's, with no people in its line.
    expect(box().querySelector(".onb-offer__head")?.textContent).toContain("Plano Pessoal");
    expect(box().querySelector(".onb-offer__fine")?.textContent).toBe(
      "Crie outros agentes depois, sem pagar a mais. Cancele em um clique.",
    );
    await click(button(/^Contratar o Caio/), 6);
    expect(calls(state, "orgs.billingLink").map((c) => c.args)).toEqual([[orgId, "onboarding", "personal"]]);
    await click(button("Agora não"), 16);
    expect(r.router.state.location.pathname).toBe(`/org/${orgId}/dm/agent/${LODI_ID}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
  });

  test("from scratch, self-hosted with no AI yet: how to start, then the AI for its right hand, then Lodi's DM", async () => {
    const state = noAiYet(newcomer(false));
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    const landed = landings(router);
    await settle(10);
    await click(answer(/^Para mim(?!ha)/), 4);
    await click(button("Continuar"), 16);
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 1 de 3");
    await click(answer(/Começar do zero/), 4);
    await click(button(/^Começar do zero/), 16);
    expect(heading()).toBe("Agora, a IA que você já assina");
    await click(button("Conectar depois"), 16);
    const orgId = state.me?.organizations.at(-1)?.id;
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [orgId, { step: "agents" }],
      [orgId, { finished: true }],
    ]);
    expect(router.state.location.pathname).toBe(`/org/${orgId}/dm/agent/${LODI_ID}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
  });

  test("back from the name, the question again; the answer can change", async () => {
    const state = newcomer(false);
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    await forATeam();
    expect(screen().getByLabelText("Nome")).toBeTruthy();
    await click(button("Voltar"), 4);
    expect(answer(/Para meu time/).getAttribute("aria-checked")).toBe("true");
    expect(calls(state, "orgs.create")).toEqual([]);
  });
});

describe("the first question and the way out (ADR 0162)", () => {
  test("two answers that say what each view is, a note that it can change, the right hand saying hello", async () => {
    await renderApp("/onboarding", { api: createFakeApi(newcomer(false)) });
    await settle(10);
    expect(heading()).toBe(PURPOSE);
    expect(answerText(/^Para mim(?!ha)/)).toContain("Uma visão mais simples, com todos os recursos.");
    expect(answerText(/Para meu time/)).toContain("A visão completa, com canais e pessoas.");
    // Beside Continue, where the person hesitates.
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe("Dá para trocar depois, sem perder nada.");
    expect(says()).toBe("Oi, Walter. Eu sou o Lodi. Vou montar o time com você em uns dois minutos.");
    // Nobody to go back to: no way out in the top bar.
    expect(document.querySelector(".onbw__top a")).toBeNull();
  });

  test("someone with another workspace leaves at any step, back to it; the one being made stays", async () => {
    const state = seedState({ agents: [] });
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    const leave = () => document.querySelector<HTMLAnchorElement>(".onbw__top a");
    expect(leave()?.getAttribute("aria-label")).toBe("Voltar para Acme e terminar depois");
    expect(leave()?.getAttribute("href")).toBe(`/org/${ORG_ID}`);
    // Past the first question the workspace exists, and the way out is still there.
    await forATeam();
    await type("Nome", "Acme Clínicas");
    await click(button("Continuar"), 14);
    expect(calls(state, "orgs.create")).toHaveLength(1);
    expect(heading()).toBe(START);
    expect(leave()).not.toBeNull();
    await click(leave() as HTMLAnchorElement, 10);
    expect(router.state.location.pathname.startsWith(`/org/${ORG_ID}`)).toBe(true);
    expect(calls(state, "orgs.deleteWorkspace")).toEqual([]);
  });
});

describe("the name step's other cases", () => {
  test("waiting for its plan elsewhere: said in place, with the way to that plan", async () => {
    const state = newcomer(true);
    const api = createFakeApi(state);
    api.orgs.create = async () => {
      throw new ApiError(403, "org.create_unpaid", "Waiting", { orgId: ORG_ID });
    };
    await renderApp("/onboarding", { api });
    await settle(10);
    await forATeam();
    await type("Nome", "Outra loja");
    await click(button("Continuar"), 10);
    expect(document.querySelector(".onb__status")?.textContent).toBeTruthy();
    expect(document.querySelector(".onb__answer .row button")).not.toBeNull();
  });

  test("back on the name after another visit: the workspace's own zone and name, the zone kept unless changed", async () => {
    const state = settingUp();
    const api = createFakeApi(state);
    const read = api.orgs.settings;
    api.orgs.settings = async (orgId) => ({ ...(await read(orgId)), timezone: "Asia/Tokyo" });
    await renderApp("/onboarding", { api });
    await settle(14);
    await click(button("Voltar"), 8);
    expect(document.querySelector(".onb__zone")?.textContent).toContain("Tóquio");
    expect((screen().getByLabelText("Nome") as HTMLInputElement).value).toBe("Acme");
    await type("Nome", "");
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    await type("Nome", "Acme e Filhas");
    await click(button("Continuar"), 14);
    expect(calls(state, "orgs.updateSettings").at(-1)?.args).toEqual([ORG_ID, { name: "Acme e Filhas" }]);
  });

  test("invite-only: the step says so and Continuar stays off", async () => {
    const state = newcomer(false);
    if (state.me) state.me.user = { ...state.me.user, canCreateWorkspace: false };
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    await click(answer(/Para meu time/), 4);
    expect((button("Continuar") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".onb__note")?.textContent).toBeTruthy();
  });
});

/** Every call the app makes, reads too, in order, as "orgs.create". */
function recorded(api: ApiClient) {
  const log: string[] = [];
  const wrap = <T extends object>(target: T, path: string): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        const value = Reflect.get(obj, key, receiver);
        const name = path ? `${path}.${String(key)}` : String(key);
        if (typeof value === "function")
          return (...args: unknown[]) => {
            log.push(name);
            return value.apply(obj, args);
          };
        return value && typeof value === "object" ? wrap(value, name) : value;
      },
    });
  return { api: wrap(api, ""), log };
}

/**
 * How long "Abrindo seu workspace" waits is its calls one after another: each is a round trip to the server (#1).
 */
describe("opening a new workspace, in round trips", () => {
  test("For me: one call makes it with both zones, one finishes it and opens Lodi's DM, nobody asked again", async () => {
    const state = noAiYet(newcomer(false));
    const { api, log } = recorded(createFakeApi(state));
    const { router } = await renderApp("/onboarding", { api });
    await settle(10);
    await click(answer(/^Para mim(?!ha)/), 4);
    log.length = 0;
    await click(button("Continuar"), 16);
    expect(heading()).toBe(START);
    expect(log[0]).toBe("orgs.create");
    // Its zones went with it and the answers said who the person is: none of them is asked on its own.
    expect(log.filter((c) => ["account.me", "orgs.updateSettings", "orgs.updateMe"].includes(c))).toEqual([]);
    await click(answer(/Começar do zero/), 4);
    await click(button(/^Começar do zero/), 16);
    expect(heading()).toBe("Agora, a IA que você já assina");
    log.length = 0;
    const off = router.subscribe("onBeforeNavigate", (e) => {
      if (e.pathChanged) log.push(`→ ${e.toLocation.pathname}`);
    });
    await click(button("Conectar depois"), 16);
    off();
    const orgId = state.me?.organizations.at(-1)?.id;
    const before = log.slice(0, log.findIndex((c) => c.startsWith("→")) + 1);
    // One call finishes it, and its answer says where it opens.
    expect(before.slice(-2)).toEqual(["orgs.saveOnboarding", `→ /org/${orgId}/dm/agent/${LODI_ID}`]);
    expect(before.filter((c) => c === "account.me")).toEqual([]);
    expect(state.me?.organizations.at(-1)?.onboarding).toBeUndefined();
  });

  test("a logo picked first: the workspace, its logo, then who the person is asked again, for the logo", async () => {
    const state = newcomer(false);
    const { api, log } = recorded(createFakeApi(state));
    await renderApp("/onboarding", { api });
    await settle(10);
    await forATeam();
    await click(button("Escolher o logo"), 4);
    const dialog = screen().getByRole("dialog", { name: "Logo do workspace" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () =>
      fireEvent.change(input, { target: { files: [new File(["png-bytes"], "logo.png", { type: "image/png" })] } }),
    );
    await settle(3);
    await click(screen().getByRole("button", { name: "Salvar" }), 6);
    await type("Nome", "Acme");
    log.length = 0;
    await click(button("Continuar"), 14);
    expect(log.slice(0, 5)).toEqual(["orgs.create", "orgs.setLogo", "orgs.settings", "agents.list", "account.me"]);
    expect(heading()).toBe(START);
  });

  test("a conversation opened for the first time shows from its own answer, no list read again for it", async () => {
    const state = seedState();
    const { api, log } = recorded(createFakeApi(state));
    const { services } = await renderApp(`/org/${ORG_ID}/dm/agent/${ATLAS_ID}`, { api });
    await settle(10);
    expect(screen().getByRole("heading", { level: 1, name: /Atlas/ })).toBeTruthy();
    expect(log.filter((c) => c === "dms.open")).toHaveLength(1);
    expect(log.filter((c) => c === "dms.list")).toHaveLength(1);
    expect(log.filter((c) => c === "chat.channels")).toHaveLength(1);
    // In the DM list all the same, where the header's search finds it.
    const dms = services.queryClient.getQueryData<DirectMessage[]>(keys.dms(ORG_ID)) ?? [];
    expect(dms.some((d) => d.with.id === ATLAS_ID)).toBe(true);
  });
});

describe("the worst case, measured by CI's geometry in German and Russian too", () => {
  const LONG = "Cerâmicas Pneumoultramicroscopicossilicovulcanoconióticas Artesanais Ltda";
  const PERSON = "Maximiliana Bartolomeu Constantinopla de Albuquerque";
  /** The longest of everything a proposal may hold (ADR 0253: 30-character names, 40-character roles…). */
  const LONGEST = [
    option("Maximiliana Bartholomew-Fitz", "Cobrança e conciliação bancária", "amber", {
      why: "Cobrar quem atrasou toma três tardes por semana, com planilha, e-mail e WhatsApp abertos ao mesmo tempo. ".repeat(
        2,
      ),
      tasks: [
        "Toda segunda, às 8:00, confere a planilha de recebimentos e lista quem atrasou mais de cinco dias úteis",
        "Rascunha a mensagem de cobrança de cada cliente atrasado, no tom de sempre, para o seu ok antes de enviar",
        "Concilia os pagamentos que chegaram com as faturas abertas e marca as que foram pagas parcialmente",
        "Avisa no canal quando um cliente atrasa pela segunda vez no mesmo trimestre, com o histórico dele",
      ],
      apps: [
        { key: "gmail", label: "Gmail" },
        { key: null, label: "Planilha de recebimentos compartilhada do financeiro" },
        { key: null, label: "Sistema de faturamento" },
      ],
      today: [
        "Lista quem está atrasado agora, com o valor e os dias de atraso de cada um",
        "Rascunha os três primeiros lembretes para o seu ok",
        "Marca as faturas pagas parcialmente",
      ],
    }),
    option("Iara", "Atendimento", "violet"),
    option("Nina", "Agenda", "teal"),
  ];
  const long = (state: FakeState) => {
    const org = state.me?.organizations[0];
    if (org) org.name = LONG;
    if (state.me) state.me.user = { ...state.me.user, name: PERSON };
    return state;
  };
  const languages = async (services: Rendered["services"]) => {
    for (const lang of ["de", "ru"] as const) {
      await showIn(services, lang);
      snapshot();
    }
  };

  test("how to start, the ask, the pick and the week, with the longest names and lines", async () => {
    const state = long(settingUp({ held: true }));
    plans(PLANS);
    const r = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(START);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    await click(button(/^Pedir à sua IA/), 12);
    expect(heading()).toBe(ASK);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    await click(button("Sem conector? Cole a resposta"), 4);
    snapshot();
    await click(button("Usar o conector"), 4);
    await arrives(state, r, proposal(LONGEST, { about: "Vendemos cerâmica feita à mão. ".repeat(12).trim() }));
    expect(heading()).toBe(PICK);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    await click(button(/^Criar o Maximiliana/), 20);
    expect(heading()).toBe("A primeira semana do Maximiliana Bartholomew-Fitz");
    await languages(r.services);
  });

  test("the plan, the photo, the AI step and its done screen, the people, with the same long names", async () => {
    const state = noAiYet(long(settingUp({ held: true, step: "agents", picked: true })));
    plans({
      recommended: "team",
      plans: [{ key: "team", name: "Equipe Profissional Ilimitada Plus", price: "US$ 49,00 + impostos", people: 1284 }],
    });
    const r = await renderApp(`/org/${ORG_ID}/onboarding?paid=1&plan=team`, { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe(HIRE);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    const org = state.me?.organizations[0];
    if (org) delete org.standing;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(16);
    expect(heading()).toBe(`Boas-vindas ao time da ${LONG}`);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    await click(button(/^Conectar a IA/), 16);
    expect(heading()).toBe(AI);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    aiConnected(state);
    await act(() => r.services.queryClient.invalidateQueries({ queryKey: keys.aiStatus(ORG_ID) }));
    await settle(10);
    expect(heading()).toBe(`Pronto. O time da ${LONG} já pensa.`);
    await languages(r.services);
    await showIn(r.services, "pt-BR");
    await click(button(/^Continuar/), 12);
    expect(heading()).toBe(PEOPLE_WHILE);
    await languages(r.services);
  });

  test("a personal workspace's plan for its one agent, and from scratch for its right hand alone", async () => {
    const state = long(settingUp({ held: true, step: "agents", personal: true, picked: true }));
    plans(PLANS);
    const r = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(14);
    expect(heading()).toBe("Contrate o Caio");
    await languages(r.services);
    cleanup();
    const alone = long(settingUp({ held: true, step: "agents", personal: true }));
    plans(PLANS);
    const a = await renderApp("/onboarding", { api: createFakeApi(alone) });
    await settle(14);
    expect(heading()).toBe("Contrate o Lodi");
    await languages(a.services);
  });
});

describe("the top of Lodi's DM without its checklist", () => {
  test("with a team and an AI: the greeting and the way to build the team again, no card", async () => {
    const state = withRightHand(seedState());
    await renderApp(`/org/${ORG_ID}/dm/agent/${LODI_ID}`, { api: createFakeApi(state) });
    await settle(10);
    expect(document.body.textContent).toContain(GREETING);
    expect(document.querySelector(".setup-cl")).toBeNull();
    expect(button("Montar o time")).toBeTruthy();
  });
});
