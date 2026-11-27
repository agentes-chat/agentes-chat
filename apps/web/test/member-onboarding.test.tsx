import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { FirstAgentOption, FirstAgents } from "@agenteschat/client";
import { keys } from "@agenteschat/client";
import { FIRST_AREAS } from "@agenteschat/client/lib/first-areas";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, type FakeState, GENERAL_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle, showIn } from "./render";

/*
 * The onboarding of someone who joined a workspace (`/welcome/$orgId`, ADR 0256, addenda of 2026-11-26 and
 * 2026-11-27): the work their own first agent does (the owner's work step, without the workspace's name, which isn't
 * theirs), meeting that agent and connecting its apps, then the AI only when the workspace has none that answers for it.
 * There is no plan: the workspace's is in force. Every way out lands in the person's DM with their agent, on the welcome
 * wizard alone. Without the permission to create agents, the hello says so and opens the workspace.
 */

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const click = async (el: Element, rounds = 10) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent;
const lead = () => document.querySelector(".onbx__lead")?.textContent;
const box = () => document.querySelector(".onbx") as HTMLElement;
const area = (title: string) =>
  within(document.querySelector(".onb-areas__list") as HTMLElement).getByRole("button", { name: title });

const AREAS = "O que o seu primeiro agente vai fazer?";
const AI = "Agora, a IA que você já assina";
/** The workspace's own welcome wizard, where every way out lands (ADR 0160). */
const WIZARD = "Boas-vindas à Acme, Walter";

const option = (name: string, role: string, color: string): FirstAgentOption => ({
  name,
  handle: name.toLowerCase(),
  role,
  why: `${name} tira de você o que mais se repete.`,
  tasks: [`${role}: lista o que atrasou`, "Rascunha as mensagens para o seu ok"],
  apps: [{ key: "gmail", label: "Gmail" }],
  routine: null,
  today: ["Lista o que ficou para trás"],
  instructions: `Você é ${name}.`,
  appearance: { color, eyes: "happy", accessory: "none" },
});
const proposal = (): FirstAgents => ({
  id: "fa-member",
  about: "Cuido da cobrança da Acme.",
  source: "mcp",
  options: [option("Caio", "Cobrança", "amber"), option("Nina", "Agenda", "teal")],
  picked: null,
  agentId: null,
  createdAt: new Date().toISOString(),
});

/**
 * Walter just joined Acme as a member: its right hand, Ada and Atlas (João's), and the permission to create agents
 * unless `makes` is false.
 */
const joined = (opts: { makes?: boolean; personal?: boolean } = {}) => {
  const state = withRightHand(seedState({ connections: [] }));
  if (state.me)
    state.me.organizations = [
      {
        id: ORG_ID,
        name: opts.personal ? "Pessoal" : "Acme",
        role: "member",
        ...(opts.personal ? { mode: "personal" as const } : {}),
        permissions: opts.makes === false ? ["read", "post"] : ["read", "post", "create_agents"],
      },
    ];
  return state;
};
/** No agent of the workspace has an AI, whoever is made later. */
const noAiYet = (state: FakeState) => {
  Object.defineProperty(state, "aiStatus", {
    configurable: true,
    get: () => ({ any: false, agents: state.agents.map((a) => ({ agentId: a.id, state: "no_ai" as const })) }),
  });
  return state;
};
type Rendered = Awaited<ReturnType<typeof renderApp>>;
const welcome = async (state: FakeState) => {
  const r = await renderApp(`/welcome/${ORG_ID}`, { api: createFakeApi(state) });
  const landed = landings(r.router);
  await settle(12);
  return { ...r, landed };
};
/** Where the page sends the person, with the arrival it asks for. */
const landings = (router: Rendered["router"]) => {
  const seen: { path: string; arrival: unknown }[] = [];
  router.subscribe("onBeforeNavigate", (e) => {
    if (e.toLocation.pathname === (seen.at(-1)?.path ?? e.fromLocation?.pathname)) return;
    seen.push({ path: e.toLocation.pathname, arrival: (e.toLocation.search as Record<string, unknown>).arrival });
  });
  return seen;
};

describe("a member's onboarding (ADR 0256)", () => {
  test("the work step, step 1 of 2: the same works, no workspace name to change, no import", async () => {
    await welcome(joined());
    expect(heading()).toBe(AREAS);
    expect(eyebrow()).toBe("Passo 1 de 2");
    expect([...box().querySelectorAll(".onb-areas__list .ac-optrow__title")].map((t) => t.textContent)).toEqual([
      "Atendimento",
      "Vendas",
      "Financeiro",
      "Marketing",
      "O meu dia",
      "Tecnologia",
      "Outro",
    ]);
    // The workspace's name and zone are its owner's.
    expect(box().querySelector(".onb-place-line")).toBeNull();
    expect([...box().querySelectorAll(".onb-other__btn")].map((b) => b.textContent)).toEqual(["Pedir à sua IA"]);
  });

  test("one tap makes their agent, step 2 of 2; with an AI there, Continue arms the delivery and opens their DM", async () => {
    const state = joined();
    const r = await welcome(state);
    await click(area("Marketing"), 20);
    expect(calls(state, "firstAgents.start")[0]?.args).toEqual([
      ORG_ID,
      expect.objectContaining({ area: "marketing", name: "Gabi", replace: null }),
    ]);
    expect(heading()).toBe("Gabi, do marketing");
    expect(eyebrow()).toBe("Passo 2 de 2 · O seu primeiro agente");
    await click(button(/^Continuar/), 24);
    const gabi = state.agents.find((a) => a.name === "Gabi")?.id;
    expect(calls(state, "firstAgents.keepDelivery").map((c) => c.args)).toEqual([[ORG_ID, gabi]]);
    expect(state.firstDelivery?.armedAt).toBeTruthy();
    // The workspace's AI answers for her: no AI step, straight to the conversation, on the wizard alone.
    expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${gabi}`);
    expect(r.landed.at(-1)?.arrival).toBe("beta");
    expect(screen().getByRole("dialog", { name: WIZARD })).toBeTruthy();
  });

  test("the AI only when the workspace has none for the agent: Connect later asks, then their DM", async () => {
    const state = noAiYet(joined());
    const r = await welcome(state);
    await click(area("Marketing"), 20);
    await click(button(/^Continuar/), 24);
    expect(heading()).toBe(AI);
    // Past the count: no step number over it.
    expect(eyebrow()).toBeUndefined();
    expect(lead()).toBe(
      "A Gabi pensa com ela, sem custo a mais aqui. Assim que conectar, ela começa a primeira entrega.",
    );
    expect(box().querySelector(".arrival-opts.ac-optlinks--flat")).not.toBeNull();
    await click(button("Conectar depois"), 6);
    const ask = screen().getByRole("dialog", { name: "Continuar sem uma IA?" });
    await click(within(ask).getByRole("button", { name: "Continuar sem IA" }), 16);
    const gabi = state.agents.find((a) => a.name === "Gabi")?.id;
    expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${gabi}`);
    expect(r.landed.at(-1)?.arrival).toBe("beta");
  });

  test("Other: the agent made on Continue, which goes on at once", async () => {
    const state = joined();
    const r = await welcome(state);
    await click(area("Outro"), 10);
    expect(heading()).toBe("Crie o seu agente");
    expect(eyebrow()).toBe("Passo 2 de 2 · O seu primeiro agente");
    await act(async () => fireEvent.change(screen().getByLabelText("Nome"), { target: { value: "Léo" } }));
    await act(async () =>
      fireEvent.change(screen().getByLabelText("O que ele faz?"), { target: { value: "Fecha o caixa toda sexta" } }),
    );
    await click(button(/^Continuar/), 30);
    const leo = state.agents.find((a) => a.name === "Léo")?.id;
    expect(calls(state, "firstAgents.start").map((c) => c.args[1])).toEqual([
      expect.objectContaining({ area: "custom", name: "Léo", task: "Fecha o caixa toda sexta" }),
    ]);
    // One press: the agent made, its delivery armed, its conversation open.
    expect(calls(state, "firstAgents.keepDelivery").map((c) => c.args)).toEqual([[ORG_ID, leo]]);
    expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${leo}`);
  });

  test("asking their AI: a member's request; its proposal makes their agent", async () => {
    const state = joined();
    const r = await welcome(state);
    await click(button(/Pedir à sua IA/), 12);
    const dialog = screen().getByRole("dialog", { name: "Peça o seu primeiro agente à sua IA" });
    const request = dialog.querySelector(".onb-ask__text")?.textContent ?? "";
    expect(request).toContain("Acabei de entrar no workspace da Acme no agentes.chat");
    state.firstAgents = proposal();
    await act(() => r.services.queryClient.invalidateQueries({ queryKey: keys.firstAgents(ORG_ID) }));
    await settle(20);
    expect(calls(state, "firstAgents.pick").map((c) => c.args)).toEqual([[ORG_ID, "fa-member", 0]]);
    expect(heading()).toBe("Caio");
    expect(lead()).toBe("Cobrança: lista o que atrasou");
  });

  test("a reload after their agent was made comes back to it", async () => {
    const state = joined();
    const ada = state.agents.find((a) => a.name === "Ada");
    state.agents.push({
      ...(ada as FakeState["agents"][number]),
      id: "agent-iara",
      name: "Iara",
      handle: "iara",
      ownerUserId: "u-walter",
      appearance: FIRST_AREAS.support.look,
    });
    state.firstDelivery = {
      agentId: "agent-iara",
      area: "support",
      task: "",
      armedAt: null,
      firedAt: null,
      runId: null,
    };
    await welcome(state);
    expect(heading()).toBe("Iara, do atendimento");
    expect(eyebrow()).toBe("Passo 2 de 2 · O seu primeiro agente");
  });

  test("a personal workspace's own works", async () => {
    await welcome(joined({ personal: true }));
    expect(box().querySelector(".onb-areas__list .ac-optrow__title")?.textContent).toBe("Vida em ordem");
  });

  test("without the permission to create agents: the hello says so, and its one button opens the workspace", async () => {
    const state = joined({ makes: false });
    const r = await welcome(state);
    expect(heading()).toBe(WIZARD);
    // No count and no question: nothing to answer here.
    expect(eyebrow()).toBeUndefined();
    expect(lead()).toBe("Aqui, cada pessoa traz o agente que resolve um problema dela.");
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe(
      "Para criar o seu agente, peça a um admin a permissão de criar agentes.",
    );
    // Nothing of a first agent is read.
    expect(calls(state, "firstAgents.latest")).toEqual([]);
    expect(calls(state, "firstAgents.delivery")).toEqual([]);
    await click(button(/^Entrar na Acme/), 16);
    expect(r.router.state.location.pathname.startsWith(`/org/${ORG_ID}`)).toBe(true);
  });

  test("only for a member: someone who isn't one gets the workspace's answer; an owner setting it up, the onboarding", async () => {
    const outside = seedState();
    if (outside.me) outside.me.organizations = [];
    const away = await renderApp(`/welcome/${ORG_ID}`, { api: createFakeApi(outside) });
    await settle(8);
    expect(away.router.state.location.pathname.startsWith("/welcome")).toBe(false);
    cleanup();

    const owner = withRightHand(seedState({ agents: [] }));
    if (owner.me)
      owner.me.organizations = [
        { id: ORG_ID, name: "Acme", role: "owner", onboarding: { step: "workspace", generalChannelId: GENERAL_ID } },
      ];
    const setting = await renderApp(`/welcome/${ORG_ID}`, { api: createFakeApi(owner) });
    await settle(10);
    expect(setting.router.state.location.pathname).toBe("/onboarding");
  });
});

describe("the worst case, measured by CI's geometry in German and Russian too", () => {
  test("a long workspace and person name on the work step, the agent step and the AI step", async () => {
    const LONG = "Cerâmicas Pneumoultramicroscopicossilicovulcanoconióticas Artesanais Ltda";
    const state = noAiYet(joined());
    const org = state.me?.organizations[0];
    if (org) org.name = LONG;
    if (state.me) state.me.user = { ...state.me.user, name: "Maximiliana Bartolomeu Constantinopla de Albuquerque" };
    const r = await welcome(state);
    const languages = async () => {
      for (const lang of ["de", "ru"] as const) await showIn(r.services, lang);
      await showIn(r.services, "pt-BR");
    };
    await languages();
    await click(area("Marketing"), 20);
    expect(lead()).toBe(`Acha o que falam da ${LONG} na internet e traz o que pede resposta.`);
    await languages();
    await click(button(/^Continuar/), 24);
    expect(heading()).toBe(AI);
    await languages();
  });
});
