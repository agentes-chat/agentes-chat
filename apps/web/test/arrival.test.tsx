import { afterEach, describe, expect, test } from "bun:test";
import type { FeedbackInput } from "@agenteschat/client";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { describeElement, openFeedback } from "@/lib/feedback";
import { createFakeApi, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The welcome wizard's first step, named after the workspace and the person (ADR 0160, addendum of 2026-11-26). */
const WELCOME = "Boas-vindas à Acme, Walter";
const READY = "Tudo pronto para começar";
const CONNECT = "Conecte uma IA para o seu time pensar";

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const open = async (state = seedState(), search = "") => {
  const r = await renderApp(`/org/${ORG_ID}${search}`, { api: createFakeApi(state) });
  await settle(6);
  return { ...r, state };
};
/** Every agent without an AI, as a workspace is right after its onboarding. */
const withoutAi = (state = seedState()) => {
  state.aiStatus = {
    any: false,
    agents: state.agents.map((a) => ({ agentId: a.id, state: "no_ai", reason: "no_key" })),
  };
  return state;
};
/** Its right hand with the first-run list it starts with, nothing done (ADR 0162). */
const withList = (state = seedState()) => withRightHand(state, { setup: { role: null, done: [] } });
const wizard = () => screen().getByRole("dialog") as HTMLElement;
const title = () => wizard().querySelector(".wiz__title")?.textContent;
const press = async (name: string | RegExp, rounds = 2) => {
  await click(within(wizard()).getByRole("button", { name }));
  await settle(rounds);
};

describe("the welcome wizard, right after the onboarding", () => {
  test("from the address once: its seven steps with Back and Next, then Connect an AI with its choices as cards", async () => {
    const { router } = await open(withoutAi(), "?arrival=1");
    expect(screen().getByRole("dialog", { name: WELCOME })).toBe(wizard());
    // The mark is dropped as it opens, and this browser keeps that it was shown here.
    expect(router.state.location.search).not.toHaveProperty("arrival");
    expect(localStorage.getItem(`agentes.welcome.seen.u-walter.${ORG_ID}`)).toBe("1");
    expect(within(wizard()).getByRole("img", { name: "Passo 1 de 7" })).toBeTruthy();
    // The first step has no Back.
    expect(within(wizard()).queryByRole("button", { name: "Voltar" })).toBeNull();
    const titles = [title()];
    for (let n = 2; n <= 7; n++) {
      await press(/^Próximo/);
      titles.push(title());
      expect(within(wizard()).getByRole("img", { name: `Passo ${n} de 7` })).toBeTruthy();
    }
    expect(titles).toEqual([
      WELCOME,
      "Cada agente tem o seu computador",
      "Cada assunto no seu canal",
      "A wiki é a documentação da Acme",
      "Eles lembram do que importa",
      "Trabalho que acontece sozinho",
      READY,
    ]);
    // The last: no Skip, the beta line, and nothing about feedback where the server takes none.
    expect(within(wizard()).queryByRole("button", { name: "Pular" })).toBeNull();
    expect(wizard().querySelector(".wiz-betaline")?.textContent).toBe(
      "Estamos em beta. Melhora toda semana, e se algo falhar, o problema é nosso.",
    );
    // Back, one step at a time.
    await press("Voltar");
    expect(title()).toBe("Trabalho que acontece sozinho");
    await press(/^Próximo/);
    await press(/^Começar/, 6);
    const connect = screen().getByRole("dialog", { name: CONNECT });
    expect(within(connect).getByText("O seu time está pronto")).toBeTruthy();
    for (const name of ["Claude", "ChatGPT", "Outro plano", "Começar grátis"])
      expect(within(connect).getByRole("button", { name: new RegExp(`^${name}`) })).toBeTruthy();
    // Not now: the dialog closes and nothing was connected.
    await click(within(connect).getByRole("button", { name: "Agora não" }));
    await settle(2);
    expect(screen().queryByRole("dialog", { name: CONNECT })).toBeNull();
  });

  test("shown once per person and workspace: the same address again, or a reload, opens nothing", async () => {
    await open(withoutAi(), "?arrival=1");
    await press("Pular");
    expect(title()).toBe(READY);
    await press(/^Começar/, 6);
    cleanup();
    await open(withoutAi(), "?arrival=1");
    expect(screen().queryByRole("dialog")).toBeNull();
  });

  test("Skip goes to the last step; with every agent already thinking, the wizard is all there is", async () => {
    await open(seedState(), "?arrival=1");
    await press("Pular");
    expect(title()).toBe(READY);
    await press(/^Começar/, 6);
    expect(screen().queryByRole("dialog")).toBeNull();
  });

  test("after the onboarding's own AI step (beta): the wizard alone, even with agents that don't think", async () => {
    const { router } = await open(withoutAi(), "?arrival=beta");
    expect(screen().getByRole("dialog", { name: WELCOME })).toBeTruthy();
    expect(router.state.location.search).not.toHaveProperty("arrival");
    await press("Pular");
    await press(/^Começar/, 6);
    expect(screen().queryByRole("dialog")).toBeNull();
  });

  test("no mark in the address, no wizard", async () => {
    await open(withoutAi());
    expect(screen().queryByRole("dialog", { name: WELCOME })).toBeNull();
    expect(screen().queryByRole("dialog", { name: CONNECT })).toBeNull();
  });

  test("the last step, an owner's: the right hand's first-run rows as the data has them, each with its way there", async () => {
    await open(withoutAi(withList(seedState({ authConfig: { feedback: true } }))), "?arrival=beta");
    await press("Pular");
    const rows = [...wizard().querySelectorAll(".wiz-board > li")].map((li) => ({
      text: li.querySelector(".wiz-board__text")?.textContent,
      done: li.hasAttribute("data-done"),
      action: li.querySelector("button")?.textContent ?? null,
    }));
    // The seed's workspace has its people and GitHub already: the AI is what's left.
    expect(rows).toEqual([
      { text: "Conecte uma IA", done: false, action: "Conectar" },
      { text: "2 pessoas no time", done: true, action: null },
      { text: "GitHub conectado", done: true, action: null },
    ]);
    // What's left, and where the list waits: the right hand's conversation.
    expect(wizard().querySelector(".wiz__text")?.textContent).toBe(
      "Falta só uma coisa. Se deixar para depois, esta lista continua na sua conversa com o Lodi, para você terminar quando quiser.",
    );
    // Feedback on: where to send it.
    expect(wizard().querySelector(".wiz-betaline")?.textContent).toBe(
      "Estamos em beta. Melhora toda semana, e se algo falhar, o problema é nosso. Conte o que faltar em Enviar feedback, no fim da barra lateral.",
    );
    // A row's way there closes the wizard and opens its own place, never Connect after it.
    await press("Conectar", 8);
    expect(screen().queryByRole("dialog", { name: READY })).toBeNull();
    expect(screen().getAllByRole("dialog")).toHaveLength(1);
  });

  test("someone who doesn't own the workspace: the same steps, no rows on the last", async () => {
    const state = withList();
    const org = state.me?.organizations[0];
    if (org) org.role = "member";
    await open(state, "?arrival=beta");
    await press("Pular");
    expect(title()).toBe(READY);
    expect(wizard().querySelector(".wiz-board")).toBeNull();
  });

  test("its pictures: work any business has, done by the person's own agent under its role, never one trade's", async () => {
    const state = withList();
    state.agents.push({
      id: "agent-caio",
      name: "Caio",
      handle: "caio",
      role: "Cobrança",
      instructions: "",
      model: "auto",
      ownerUserId: "u-walter",
      hasCredential: true,
      createdAt: new Date().toISOString(),
    });
    await open(state, "?arrival=beta");
    const art = () => wizard().querySelector(".wiz__art") as HTMLElement;
    const seen = [art().textContent ?? ""];
    await press(/^Próximo/);
    // The agent's screen: its tasks under its own role, the late one said in its voice.
    expect(art().querySelector(".wiz-win__bar span")?.textContent).toBe("Cobrança");
    expect([...art().querySelectorAll(".wiz-win__rows li")].map((li) => li.textContent)).toEqual([
      "Responder um clienteontematrasada",
      "Relatório da semanahojea fazer",
      "Atualizar os preços9hfeita",
    ]);
    expect(art().querySelector(".wiz-pc__say")?.textContent).toBe(
      "Uma resposta está atrasada. O rascunho está pronto para o seu ok.",
    );
    seen.push(art().textContent ?? "");
    for (let n = 3; n <= 7; n++) {
      await press(/^Próximo/);
      seen.push(art().textContent ?? "");
    }
    const words = seen.join(" ");
    expect(words).toContain("Caio");
    expect(words).toContain("Alguém respondeu o cliente de ontem?");
    expect(words).toContain("Enviar a resposta para o cliente?");
    // No trade's sample: the pictures fit any business.
    expect(words).not.toMatch(/cl[ií]nic|odonto|dental|pacient/i);
  });

  test("its pictures, with no agent of the person's own: the right hand's screen says Tarefas", async () => {
    await open(withList(), "?arrival=beta");
    await press(/^Próximo/);
    expect(wizard().querySelector(".wiz-win__bar span")?.textContent).toBe("Tarefas");
  });

  test("a personal workspace's own words: the person's hello, a conversation per subject", async () => {
    const state = withList();
    for (const o of state.me?.organizations ?? []) o.mode = "personal";
    await open(state, "?arrival=beta");
    expect(title()).toBe("Boas-vindas, Walter");
    await press(/^Próximo/);
    await press(/^Próximo/);
    expect(title()).toBe("Cada assunto na sua conversa");
    await press(/^Próximo/);
    expect(title()).toBe("A wiki guarda o que importa");
  });
});

describe("feedback", () => {
  test("no Beta mark where the server takes no feedback", async () => {
    await open();
    expect(screen().queryByRole("button", { name: "Enviar feedback" })).toBeNull();
  });

  test("the Beta mark opens the form, and what was typed is sent with the workspace and the screen", async () => {
    const { state } = await open(seedState({ authConfig: { feedback: true } }));
    await click(screen().getByRole("button", { name: "Enviar feedback" }));
    const form = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    const send = within(form).getByRole("button", { name: /^Enviar/ });
    expect(send.hasAttribute("disabled")).toBe(true);
    await type(within(form).getByRole("textbox"), "  O botão de anexar sumiu  ");
    await click(send);
    await settle(4);
    const sent = state.calls.find((c) => c.method === "system.sendFeedback")?.args[0];
    expect(sent).toMatchObject({ text: "O botão de anexar sumiu", orgId: ORG_ID, app: "web" });
    expect(screen().getByRole("dialog", { name: "Recado entregue. Obrigado." })).toBeTruthy();
    await click(screen().getByRole("button", { name: "Enviar outro" }));
    const again = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    expect(within(again).getByRole("textbox")).toHaveProperty("value", "");
  });
});

describe("feedback about what was clicked", () => {
  const page = () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-message-id="m1"><article class="ac-msg ac-msg--agent"><span class="ac-msg__author">Ada</span>' +
      '<div class="ac-msg__body"><p>Deploy   done.</p><p>All green.</p></div></article></div>' +
      "<section><h2>Plano</h2><button>Assinar</button></section>";
    document.body.append(host);
    return host;
  };

  test("a message says who wrote it and what it says; a selection, only itself; anything else, its role and words", () => {
    const host = page();
    const said = describeElement(host.querySelector("p"));
    expect(said).toMatchObject({
      message: true,
      about: { kind: "agent message", label: "Ada", text: "Deploy done.\nAll green." },
    });
    expect(said?.facts[0]).toEqual(["Message id", "m1"]);
    expect(describeElement(host.querySelector("p"), "All green")?.about.text).toBe("All green");
    expect(describeElement(host.querySelector("button"))).toMatchObject({
      message: false,
      about: { kind: "button", text: "Assinar" },
    });
    expect(describeElement(null)).toBeNull();
    host.remove();
  });

  test("the form shows the excerpt, sends it with where the person is, and leaves it out when asked", async () => {
    const { state } = await open(seedState({ authConfig: { feedback: true } }));
    const host = page();
    await act(async () => openFeedback(describeElement(host.querySelector("p"))));
    let form = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    expect(within(form).getByText("Sobre a mensagem de Ada")).toBeTruthy();
    expect(within(form).getByText(/Deploy done\./)).toBeTruthy();
    await type(within(form).getByRole("textbox"), "Resposta errada");
    await click(within(form).getByRole("button", { name: /^Enviar/ }));
    await settle(4);
    const sent = state.calls.findLast((c) => c.method === "system.sendFeedback")?.args[0] as FeedbackInput;
    expect(sent.about).toEqual({ kind: "agent message", label: "Ada", text: "Deploy done.\nAll green." });
    expect(sent.facts?.map(([k]) => k)).toEqual(expect.arrayContaining(["Route", "Message id", "Browser"]));

    await act(async () => openFeedback(describeElement(host.querySelector("p"))));
    form = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    await click(within(form).getByRole("button", { name: "Não enviar este trecho" }));
    expect(within(form).queryByText(/Deploy done\./)).toBeNull();
    await type(within(form).getByRole("textbox"), "Só o aviso");
    await click(within(form).getByRole("button", { name: /^Enviar/ }));
    await settle(4);
    const bare = state.calls.findLast((c) => c.method === "system.sendFeedback")?.args[0] as FeedbackInput;
    expect(bare.about).toMatchObject({ kind: "agent message", label: "Ada" });
    expect(bare.about?.text).toBeUndefined();
    host.remove();
  });

  test("a picture is added, listed and sent by its id; anything else is refused before it is uploaded", async () => {
    const { state } = await open(seedState({ authConfig: { feedback: true } }));
    await click(screen().getByRole("button", { name: "Enviar feedback" }));
    const form = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    const picker = form.querySelector('input[type="file"]') as HTMLInputElement;
    const choose = (files: File[]) => act(async () => fireEvent.change(picker, { target: { files } }));
    await choose([new File(["x"], "notas.pdf", { type: "application/pdf" })]);
    expect(state.calls.some((c) => c.method === "system.uploadFeedbackFile")).toBe(false);
    await choose([new File(["x"], "tela.png", { type: "image/png" })]);
    await settle(4);
    expect(within(form).getByText("tela.png")).toBeTruthy();
    await type(within(form).getByRole("textbox"), "Olha a tela");
    await click(within(form).getByRole("button", { name: /^Enviar/ }));
    await settle(4);
    const sent = state.calls.findLast((c) => c.method === "system.sendFeedback")?.args[0] as FeedbackInput;
    expect(sent.files).toHaveLength(1);
  });

  test("where it goes to the agentes.chat team, the form says so and takes photos only", async () => {
    const { state } = await open(seedState({ authConfig: { feedback: true, feedbackRelay: true } }));
    await click(screen().getByRole("button", { name: "Enviar feedback" }));
    const form = screen().getByRole("dialog", { name: "O que faltou, quebrou ou incomodou?" });
    expect(
      within(form).getByText(
        "O que você escrever vai por e-mail para o time do agentes.chat, que pode usar um assistente de IA para analisar.",
      ),
    ).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Anexar foto" })).toBeTruthy();
    expect(within(form).getByText("Até 3 fotos de 5 MB.")).toBeTruthy();
    const picker = form.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).not.toContain("video");
    await act(async () =>
      fireEvent.change(picker, { target: { files: [new File(["x"], "tela.mp4", { type: "video/mp4" })] } }),
    );
    expect(state.calls.some((c) => c.method === "system.uploadFeedbackFile")).toBe(false);
  });
});
