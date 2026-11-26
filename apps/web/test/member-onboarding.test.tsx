import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { FirstAgentOption, FirstAgents } from "@agenteschat/client";
import { keys } from "@agenteschat/client";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, type FakeState, GENERAL_ID, LODI_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle, showIn } from "./render";

/*
 * The onboarding of someone who joined a workspace (`/welcome/$orgId`, ADR 0253, addendum of 2026-11-26): the team as
 * it is and who brought an agent, then the two ways to make their own: asking their own AI (the owner's ask and pick,
 * in a member's words) or from scratch with the right hand. Every way out lands in the workspace on the welcome wizard
 * alone. Without the permission to create agents, the hello says so and opens the workspace.
 */

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const answer = (name: RegExp) => screen().getByRole("radio", { name });
/** An answer's title and its line, as the row beside its radio shows them. */
const answerText = (name: RegExp) => answer(name).closest(".onb-pick__item")?.textContent ?? "";
const click = async (el: Element, rounds = 10) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent;
const lead = () => document.querySelector(".onbx__lead")?.textContent;
const box = () => document.querySelector(".onbx") as HTMLElement;
/** The geometry capture, where CI runs one (`check:geometry`). */
const snapshot = () => (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();

const HELLO = "Boas-vindas à Acme, Walter";
/** The workspace's own welcome wizard, where every way out lands (ADR 0160). */
const WIZARD = HELLO;

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
const proposal = (options = [option("Caio", "Cobrança", "amber"), option("Nina", "Agenda", "teal")]): FirstAgents => ({
  id: "fa-member",
  about: "Cuido da cobrança da Acme.",
  source: "mcp",
  options,
  picked: null,
  agentId: null,
  createdAt: new Date().toISOString(),
});

/**
 * Walter just joined Acme as a member: its right hand, Ada and Atlas (João's), and the permission to create agents
 * unless `makes` is false.
 */
const joined = (opts: { makes?: boolean; personal?: boolean; proposal?: FirstAgents } = {}) => {
  const state = withRightHand(seedState());
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
  if (opts.proposal) state.firstAgents = opts.proposal;
  return state;
};
type Rendered = Awaited<ReturnType<typeof renderApp>>;
const welcome = async (state: FakeState) => {
  const r = await renderApp(`/welcome/${ORG_ID}`, { api: createFakeApi(state) });
  await settle(12);
  return r;
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
/** The person's AI sends its proposal now, and the page reads it on its next poll. */
const arrives = async (state: FakeState, r: Rendered, sent = proposal()) => {
  state.firstAgents = sent;
  await act(() => r.services.queryClient.invalidateQueries({ queryKey: keys.firstAgents(ORG_ID) }));
  await settle(12);
};

describe("a member's onboarding (ADR 0253)", () => {
  test("the hello: the team awake, who brought an agent, the question, and the two ways to make theirs", async () => {
    const state = joined();
    await welcome(state);
    expect(heading()).toBe(HELLO);
    expect(eyebrow()).toBe("Passo 1 de 2");
    expect(lead()).toBe(
      "Aqui, cada pessoa traz o agente que resolve um problema dela. João trouxe a Ada, para dev. Qual vai ser o seu?",
    );
    // The team awake on its daylight sky: the right hand first.
    expect(box().querySelector(".onb-pass[data-awake]")).not.toBeNull();
    expect(answer(/Pedir para a sua IA/).getAttribute("aria-checked")).toBe("true");
    expect(answerText(/Começar do zero/)).toContain("o Lodi, o RH dos agentes, monta o agente com você.");
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe("Agora não");
    expect(button(/^Pedir à sua IA/)).toBeTruthy();
  });

  test("asking their AI: the request in a member's words, the proposal, and the agent made in its channel", async () => {
    const state = joined();
    const r = await welcome(state);
    const landed = landings(r.router);
    await click(button(/^Pedir à sua IA/), 12);
    expect(heading()).toBe("Peça o seu agente");
    expect(eyebrow()).toBe("Passo 2 de 2");
    const request = box().querySelector(".onb-ask__text")?.textContent ?? "";
    expect(request).toContain("Acabei de entrar no workspace da Acme no agentes.chat");
    expect(request).toContain("Entenda qual é o meu papel na Acme");
    expect(request).toContain("um resumo de duas ou três frases do que eu faço na Acme");
    // Back to the hello, and on again.
    await click(button("Voltar"), 6);
    expect(heading()).toBe(HELLO);
    await click(button(/^Pedir à sua IA/), 12);
    await arrives(state, r);
    expect(heading()).toBe("Escolha o seu agente");
    expect(eyebrow()).toBe("Proposta do seu Claude · passo 2 de 2");
    // Who it joins: the team already there, the right hand last.
    expect(lead()).toBe(
      "O seu Claude achou as duas tarefas que mais tomam o seu tempo. Comece por uma: o agente entra no time da Acme, com a Ada, o Atlas e o Lodi.",
    );
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe(
      "É o seu primeiro: depois, crie outros quando quiser.",
    );
    await click(button(/^Criar o Caio/), 20);
    expect(calls(state, "firstAgents.pick").map((c) => c.args)).toEqual([[ORG_ID, "fa-member", 0]]);
    const made = state.agents.find((a) => a.name === "Caio");
    const channel = state.channels.find((c) => c.name === made?.handle);
    expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${channel?.id}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
    // The workspace's welcome wizard, once.
    expect(screen().getByRole("dialog", { name: WIZARD })).toBeTruthy();
  });

  test("from scratch: the right hand's DM, where it builds the agent with them; Not now: the workspace", async () => {
    const state = joined();
    const r = await welcome(state);
    const landed = landings(r.router);
    await click(answer(/Começar do zero/), 4);
    await click(button(/^Começar do zero/), 16);
    expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${LODI_ID}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
    expect(calls(state, "firstAgents.pick")).toEqual([]);
    cleanup();
    localStorage.clear();

    const later = await welcome(joined());
    const went = landings(later.router);
    await click(button("Agora não"), 16);
    expect(later.router.state.location.pathname.startsWith(`/org/${ORG_ID}`)).toBe(true);
    expect(went[0]?.arrival).toBe("beta");
  });

  test("without the permission to create agents: the hello says so, and its one button opens the workspace", async () => {
    const state = joined({ makes: false });
    const r = await welcome(state);
    expect(heading()).toBe(HELLO);
    // No count and no question: nothing to answer here.
    expect(eyebrow()).toBeUndefined();
    expect(lead()).toBe("Aqui, cada pessoa traz o agente que resolve um problema dela. João trouxe a Ada, para dev.");
    expect(screen().queryByRole("radio")).toBeNull();
    expect(box().querySelector(".ac-dialog__foot-note")?.textContent).toBe(
      "Para criar o seu agente, peça a um admin a permissão de criar agentes.",
    );
    // Its proposals are never read.
    expect(calls(state, "firstAgents.latest")).toEqual([]);
    await click(button(/^Entrar na Acme/), 16);
    expect(r.router.state.location.pathname.startsWith(`/org/${ORG_ID}`)).toBe(true);
  });

  test("a reload while picking opens on the pick", async () => {
    await welcome(joined({ proposal: proposal() }));
    expect(heading()).toBe("Escolha o seu agente");
    expect(eyebrow()).toBe("Proposta da sua IA · passo 2 de 2");
  });

  test("a personal workspace's: the person's hello, and a request about them, never its name", async () => {
    const state = joined({ personal: true });
    await welcome(state);
    expect(heading()).toBe("Boas-vindas, Walter");
    await click(button(/^Pedir à sua IA/), 12);
    const request = box().querySelector(".onb-ask__text")?.textContent ?? "";
    expect(request).toContain("Entenda o que eu faço, como é a minha semana");
    expect(request).not.toContain("Pessoal");
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
  test("a long workspace, person and agent names on the hello, the ask and the pick", async () => {
    const LONG = "Cerâmicas Pneumoultramicroscopicossilicovulcanoconióticas Artesanais Ltda";
    const state = joined();
    const org = state.me?.organizations[0];
    if (org) org.name = LONG;
    if (state.me) state.me.user = { ...state.me.user, name: "Maximiliana Bartolomeu Constantinopla de Albuquerque" };
    for (const a of state.agents) if (a.name === "Ada") a.role = "Desenvolvimento de integrações e automações";
    const r = await welcome(state);
    expect(heading()).toBe(`Boas-vindas à ${LONG}, Maximiliana`);
    const languages = async () => {
      for (const lang of ["de", "ru"] as const) {
        await showIn(r.services, lang);
        snapshot();
      }
      await showIn(r.services, "pt-BR");
    };
    await languages();
    await click(button(/^Pedir à sua IA/), 12);
    await languages();
    await arrives(
      state,
      r,
      proposal([
        option("Maximiliana Bartholomew-Fitz", "Cobrança e conciliação bancária", "amber"),
        option("Iara", "Atendimento", "violet"),
        option("Nina", "Agenda", "teal"),
      ]),
    );
    expect(heading()).toBe("Escolha o seu agente");
    expect(box().querySelectorAll(".onb-card")).toHaveLength(3);
    await languages();
  });
});
