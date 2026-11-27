import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { keys, type Machine } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { connectRequest } from "@/pages/onboarding/AiStep";
import {
  ADA_ID,
  createFakeApi,
  type FakeState,
  fakeMachinesOf,
  GENERAL_ID,
  LODI_ID,
  ORG_ID,
  seedState,
  withRightHand,
} from "./fake-api";
import { shownText } from "./hint";
import { renderApp, screen, settle } from "./render";

/*
 * The onboarding's Connect an AI step (ADR 0162, amended by ADR 0256's addendum of 2026-11-27): after the first agent's
 * step (and the plan, on agentes.chat Cloud), answered by the data (every agent thinking), left with Connect later
 * after asking, and never after a plan left for later. Then the team's photo, whose button opens the workspace on the
 * welcome wizard alone (`?arrival=beta`, ADR 0160).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  // The welcome wizard shows once per person and workspace in a browser: each test is a new one.
  localStorage.clear();
  globalThis.fetch = realFetch;
});

const CONNECT = "Agora, a IA que você já assina";
/** The arrival's Connect an AI, which the wizard never leads to after this step. */
const ARRIVAL_CONNECT = "Conecte uma IA para o seu time pensar";
/** The onboarding's last step, after this one: the team's photo. */
const PHOTO = "Boas-vindas ao time da Acme";
/** The welcome wizard's first step (ADR 0160, addendum of 2026-11-26). */
const WELCOME = "Boas-vindas à Acme, Walter";

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const click = async (el: Element, rounds = 10) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent;
const body = () => document.querySelector(".onbx__body") as HTMLElement;
/** The welcome wizard skipped to its last step and closed with its button. */
const throughWelcome = async () => {
  const wizard = screen().getByRole("dialog", { name: WELCOME });
  await click(within(wizard).getByRole("button", { name: "Pular" }), 2);
  await click(within(screen().getByRole("dialog")).getByRole("button", { name: /^Começar/ }), 8);
};

type Router = Awaited<ReturnType<typeof renderApp>>["router"];
/** The `arrival` asked for by each navigation from now on (the arrival drops it from the address as it opens). */
const arrivals = (router: Router) => {
  const seen: unknown[] = [];
  router.subscribe("onBeforeNavigate", (e) => {
    seen.push((e.toLocation.search as { arrival?: unknown }).arrival);
  });
  return seen;
};

/**
 * Acme being set up, its first agent (Ada) made and its step left with Continue ("agents"), none of its agents with an
 * AI yet; `held`: agentes.chat Cloud, waiting for its first plan.
 */
const madeTeam = (opts: { held?: boolean } = {}) => {
  const state = withRightHand(seedState());
  if (state.me)
    state.me.organizations = [
      {
        id: ORG_ID,
        name: "Acme",
        role: "owner",
        onboarding: { step: "agents", generalChannelId: GENERAL_ID },
        ...(opts.held ? { standing: { state: "hold" as const, reason: "payment" } } : {}),
      },
    ];
  state.aiStatus = {
    any: false,
    agents: state.agents.map((a) => ({ agentId: a.id, state: "no_ai", reason: "no_key" })),
  };
  if (opts.held) state.authConfig = { billingUrl: "https://billing.example.com" };
  return state;
};
/** `madeTeam`, its team the person's own (a plan signs in only for its owner's agents, ADR 0059 §3). */
const ownTeam = () => {
  const state = madeTeam();
  for (const a of state.agents) a.ownerUserId = "u-walter";
  return state;
};
/** Every agent thinks now (a key or a plan connected, here or in another tab), and the page reads it again. */
const allThink = async (state: FakeState, services: Awaited<ReturnType<typeof renderApp>>["services"]) => {
  state.aiStatus = { any: true, agents: state.agents.map((a) => ({ agentId: a.id, state: "ready" })) };
  await act(async () => services.queryClient.invalidateQueries({ queryKey: keys.aiStatus(ORG_ID) }));
  await settle(10);
};
/** The photo's list: each row's words. */
const photoRows = () => [...document.querySelectorAll(".onbx .onb-next__row")].map((li) => li.textContent);

describe("Connect an AI, after the first agent", () => {
  test("the team made with no AI: the step, its choices as flat rows, and what leaving it means", async () => {
    const state = madeTeam();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    // Past the count: no step number over it, and no plan (self-hosted) to name.
    expect(eyebrow()).toBeUndefined();
    expect(heading()).toBe(CONNECT);
    expect(document.querySelector(".onbx__lead")?.textContent).toBe(
      "A Ada pensa com ela, sem custo a mais aqui. Assim que conectar, ela começa a primeira entrega.",
    );
    // The first agent awake on the box's own header.
    expect(document.querySelector(".onbx .onb-pass[data-awake]")).not.toBeNull();
    expect(document.querySelector(".onbx .arrival-opts.ac-optlinks--flat")).not.toBeNull();
    for (const name of ["Claude", "ChatGPT", "Outro plano", "Chave de API", "Começar grátis"])
      expect(within(body()).getByRole("button", { name: new RegExp(`^${name}`) })).toBeTruthy();
    expect(document.querySelector(".onbx .ac-dialog__foot-note")?.textContent).toBe(
      "Sem uma IA, os agentes não respondem.",
    );
    // Nothing is finished while the step waits.
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
  });

  test("a pick opens the Connect dialog over the step, the step still under it", async () => {
    const state = madeTeam();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Chave de API/ }), 12);
    // For the right hand alone, on the card's own steps.
    expect(screen().getByRole("dialog", { name: "Adicionar uma chave de API" })).toBeTruthy();
    expect(heading()).toBe(CONNECT);
  });

  test("Connect later asks first, then the photo, whose button opens the first agent's DM on the wizard alone", async () => {
    const state = madeTeam();
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    const asked = arrivals(router);
    await click(button("Conectar depois"), 6);
    await click(within(screen().getByRole("dialog")).getByRole("button", { name: "Continuar sem IA" }), 16);
    expect(heading()).toBe(PHOTO);
    await click(button(/^Conhecer o workspace/), 16);
    await settle(8);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [ORG_ID, { step: "ai" }],
      [ORG_ID, { finished: true }],
    ]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${ADA_ID}`);
    expect(asked).toContain("beta");
    await throughWelcome();
    expect(screen().queryByRole("dialog")).toBeNull();
  });

  test("once every agent thinks: the photo, never the workspace by itself; its button opens it", async () => {
    const state = madeTeam();
    const { router, services } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe(CONNECT);
    await allThink(state, services);
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(heading()).toBe(PHOTO);
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
    const asked = arrivals(router);
    await click(button(/^Conhecer o workspace/), 16);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { finished: true }]]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${ADA_ID}`);
    expect(asked).toContain("beta");
  });

  test("a card picked names nothing by itself: the dialog closed, and the AI connected some other way", async () => {
    for (const keyCame of [false, true]) {
      const state = madeTeam();
      const { services } = await renderApp("/onboarding", { api: createFakeApi(state) });
      await settle(16);
      await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
      // Its dialog closed with nothing connected, then a plan or a key connected in another tab.
      await act(async () => fireEvent.keyDown(screen().getByRole("dialog"), { key: "Escape" }));
      await settle(4);
      state.aiStatus = {
        any: true,
        ...(keyCame ? { apiKey: true } : {}),
        agents: state.agents.map((a) => ({ agentId: a.id, state: "ready" })),
      };
      await act(async () => services.queryClient.invalidateQueries({ queryKey: keys.aiStatus(ORG_ID) }));
      await settle(10);
      // The photo says an AI is connected, in general words: nothing was connected through the card.
      expect(heading()).toBe(PHOTO);
      expect(photoRows()[0]).toBe("IA conectada (concluído)");
      cleanup();
    }
  });

  test("a key connected through the dialog, never the card it opened on: Back leads to every other choice", async () => {
    const state = ownTeam();
    const { services } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const dialog = screen().getByRole("dialog", { name: "Seu plano do Claude" });
    await click(within(dialog).getByRole("button", { name: "Voltar" }), 6);
    await click(within(dialog).getByRole("button", { name: /^Chave de API/ }), 6);
    const panel = within(dialog).getByRole("region", { name: "Chave de API" });
    await act(async () =>
      fireEvent.change(within(panel).getByLabelText("Cole aqui"), {
        target: { value: "sk-ant-api03-abcdefghijklmnop" },
      }),
    );
    await click(within(panel).getByRole("button", { name: "Salvar chave" }), 10);
    expect(calls(state, "agents.addCredential")).toHaveLength(1);
    state.aiStatus = { any: true, apiKey: true, agents: state.agents.map((a) => ({ agentId: a.id, state: "ready" })) };
    await act(async () => services.queryClient.invalidateQueries({ queryKey: keys.aiStatus(ORG_ID) }));
    await settle(10);
    // The photo never names the card the dialog opened on (Claude): a key is an AI, in general words.
    expect(heading()).toBe(PHOTO);
    expect(photoRows()[0]).toBe("IA conectada (concluído)");
    expect(document.querySelector(".onbx")?.textContent).not.toContain("Claude");
  });

  test("on agentes.chat Cloud, a plan left for later skips the step: Lodi's DM, the wizard alone", async () => {
    const state = madeTeam({ held: true });
    // The billing service's plan list can't be read: the plan step names a plan generically.
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const { router } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe("O time da Acme começa com a Ada");
    expect(eyebrow()).toBe("Passo 4 de 4");
    const asked = arrivals(router);
    await click(button("Agora não"), 16);
    await settle(8);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${LODI_ID}`);
    expect(asked).toContain("beta");
    await throughWelcome();
    expect(screen().queryByRole("dialog", { name: ARRIVAL_CONNECT })).toBeNull();
  });
});

describe("a personal workspace (ADR 0159)", () => {
  test("its own words, never a team's: the step for its first agent, then its own photo", async () => {
    const state = ownTeam();
    for (const o of state.me?.organizations ?? []) {
      o.mode = "personal";
      o.name = "Walter";
    }
    const { services } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    expect(heading()).toBe(CONNECT);
    const box = () => document.querySelector(".onbx")?.textContent ?? "";
    expect(box()).toContain("A Ada pensa com ela, sem custo a mais aqui.");
    expect(box()).not.toContain("time");
    await allThink(state, services);
    expect(heading()).toBe("Boas-vindas ao seu time");
  });
});

describe("a personal workspace's Connect (ADR 0159)", () => {
  test("its agents in its own words: the dialog's title, never the team's", async () => {
    const state = ownTeam();
    for (const o of state.me?.organizations ?? []) o.mode = "personal";
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const dialog = screen().getByRole("dialog", { name: "Seu plano do Claude" });
    await click(within(dialog).getByRole("button", { name: "Voltar" }), 6);
    expect(screen().getByRole("dialog", { name: "Conectar uma IA para os seus agentes" })).toBe(dialog);
    expect(shownText(dialog)).not.toContain("time");
  });
});

describe("what a pick opens", () => {
  test("for the team, Connect for the whole team on the card picked; for the right hand alone, its own dialog", () => {
    const team = [LODI_ID, "ada", "atlas"];
    for (const start of ["claude", "chatgpt", "key", "cursor"] as const)
      expect(connectRequest(start, team)).toEqual({ agentIds: team, start });
    for (const start of ["claude", "key", "zen"] as const)
      expect(connectRequest(start, [LODI_ID])).toEqual({ agentId: LODI_ID, start });
  });
});

/** The narrow dialog under the sky: Connect for the whole team (ADR 0160, addendum). */
const inBand = (dialog: HTMLElement) => dialog.querySelector(".arrival-hero") !== null;

describe("each card opens Connect for the whole team on its own steps (ADR 0162)", () => {
  for (const [card, title] of [
    ["Claude", "Seu plano do Claude"],
    ["ChatGPT", "Seu plano do ChatGPT"],
    ["Cursor", "Seu plano do Cursor"],
    ["Chave de API", "Adicionar uma chave de API"],
  ] as const) {
    test(`${card}: straight to its steps in the team's dialog, never the plain one nor the team's first screen`, async () => {
      const state = ownTeam();
      await renderApp("/onboarding", { api: createFakeApi(state) });
      await settle(16);
      const cardOf = () => within(body()).queryByRole("button", { name: new RegExp(`^${card}`) });
      if (!cardOf()) await click(within(body()).getByRole("button", { name: /^Outro plano/ }), 4);
      await click(cardOf() as HTMLElement, 12);
      const dialog = screen().getByRole("dialog", { name: title });
      expect(inBand(dialog)).toBe(true);
      // On the steps: the way back to the choices, and no list of whom it is for.
      expect(within(dialog).getByRole("button", { name: "Voltar" })).toBeTruthy();
      expect(dialog.querySelector(".arrival-forline")).toBeNull();
      expect(dialog.querySelector(".ai-picker")).toBeNull();
      if (card !== "Chave de API") expect(within(dialog).getByRole("region", { name: title })).toBeTruthy();
    });
  }

  test("the right hand alone: the narrow dialog for it, on the card's steps", async () => {
    // Every other agent someone else's: only the right hand is the person's to wake.
    const state = madeTeam();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const dialog = screen().getByRole("dialog", { name: "Seu plano do Claude" });
    expect(inBand(dialog)).toBe(true);
    expect(dialog.querySelector(".ai-picker")).toBeNull();
    expect(within(dialog).getByRole("region", { name: "Seu plano do Claude" })).toBeTruthy();
    // Back leads to the choices, under its own name.
    await click(within(dialog).getByRole("button", { name: "Voltar" }), 4);
    expect(screen().getByRole("dialog", { name: "Conectar uma IA para o Lodi" })).toBeTruthy();
  });

  test("the team already thinking and the right hand not: a card opens the right hand's own dialog", async () => {
    const state = ownTeam();
    state.aiStatus = {
      any: true,
      agents: state.agents.map((a) =>
        a.id === LODI_ID
          ? { agentId: a.id, state: "no_ai" as const, reason: "no_key" as const }
          : { agentId: a.id, state: "ready" as const },
      ),
    };
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const dialog = screen().getByRole("dialog", { name: "Seu plano do Claude" });
    expect(inBand(dialog)).toBe(true);
    // For the right hand alone: no For offering the agents that already think.
    expect(within(dialog).queryByRole("combobox", { name: "Agentes que usam este plano" })).toBeNull();
  });

  test("with no computer, a plan's panel never leaves for Computers, which the onboarding would send back here", async () => {
    const state = ownTeam();
    const api = createFakeApi(state);
    // A self-hosted workspace with no computer connected yet.
    const viewOf = api.agents.brain;
    api.agents.brain = async (orgId, agentId) => ({ ...(await viewOf(orgId, agentId)), computer: null });
    const { router } = await renderApp("/onboarding", { api });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const panel = within(screen().getByRole("dialog")).getByRole("region", { name: "Seu plano do Claude" });
    expect(panel.textContent).toContain(
      "As contas precisam de um computador, e este workspace ainda não tem. Dá para adicionar um assim que o workspace abrir.",
    );
    expect(within(panel).queryByRole("button", { name: "Conectar um computador" })).toBeNull();
    await click(within(panel).getByRole("button", { name: "Usar uma chave de API agora" }), 6);
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(within(screen().getByRole("dialog")).getByRole("region", { name: "Chave de API" })).toBeTruthy();
  });

  test("connected while the dialog is open: the step moves on by the data", async () => {
    const state = ownTeam();
    const { services } = await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    expect(screen().getByRole("dialog", { name: "Seu plano do Claude" })).toBeTruthy();
    await allThink(state, services);
    expect(heading()).toBe(PHOTO);
  });
});

describe("the server's own computer, added with the workspace (ADR 0060 §3)", () => {
  test("not connected yet: the plan's panel says it connects, never offline, nameless or a key", async () => {
    const state = ownTeam();
    const api = createFakeApi(state);
    // Made with the workspace before the runner here got its token (ADR 0060 §3): no name yet, never seen.
    const host = fakeMachinesOf.get(api)?.pair({
      name: "",
      kind: "host",
      online: false,
      lastSeenAt: null,
      pairedBy: null,
      createdAt: new Date().toISOString(),
    }) as Machine;
    const viewOf = api.agents.brain;
    api.agents.brain = async (orgId, agentId) => ({
      ...(await viewOf(orgId, agentId)),
      computer: { machineId: host.id, name: "", online: false },
    });
    await renderApp("/onboarding", { api });
    await settle(16);
    await click(within(body()).getByRole("button", { name: /^Claude/ }), 12);
    const panel = within(screen().getByRole("dialog")).getByRole("region", { name: "Seu plano do Claude" });
    expect(panel.textContent).toContain("O computador deste servidor conecta em até um minuto.");
    expect(panel.textContent).not.toContain("está offline");
    expect(within(panel).queryByRole("button", { name: "Usar uma chave de API agora" })).toBeNull();
  });

  test("in the desktop app, the workspace being set up reaches the app, so this computer joins it at once", async () => {
    const asked: Record<string, unknown>[] = [];
    const w = window as { __agentesDesktop?: unknown; __TAURI_INTERNALS__?: unknown };
    w.__agentesDesktop = { version: "0.6.0" };
    w.__TAURI_INTERNALS__ = {
      invoke: async (_cmd: string, args?: { request?: Record<string, unknown> }) => {
        asked.push(args?.request ?? {});
        return {};
      },
    };
    try {
      await renderApp("/onboarding", { api: createFakeApi(madeTeam()) });
      await settle(16);
      // Outside the workspace's pages, which tell the app on their own: the app syncs its computer on this.
      expect(asked.filter((r) => r.kind === "orgs").at(-1)).toEqual({
        kind: "orgs",
        orgs: [{ id: ORG_ID, name: "Acme" }],
      });
    } finally {
      delete w.__agentesDesktop;
      delete w.__TAURI_INTERNALS__;
    }
  });
});
