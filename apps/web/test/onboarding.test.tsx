import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type {
  ApiClient,
  Connection,
  DirectMessage,
  FirstAgentOption,
  FirstAgents,
  MailAccount,
} from "@agenteschat/client";
import { ApiError, keys } from "@agenteschat/client";
import { CUSTOM_LOOK, FIRST_AREAS, type FirstArea } from "@agenteschat/client/lib/first-areas";
import { IMPORT_CARDS } from "@agenteschat/client/lib/import/flow";
import type { OnboardingStepId } from "@agenteschat/client/lib/onboarding";
import { browserTimezone } from "@agenteschat/client/lib/routines";
import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { fileSaver } from "@/components/artifacts/fileSaver";
import { CARD_MARK } from "@/lib/import-marks";
import { setNavigateAway } from "@/lib/navigate";
import { teamPhoto } from "@/pages/onboarding/team-photo";
import {
  ATLAS_ID,
  createFakeApi,
  type FakeState,
  fakeMailOf,
  GENERAL_ID,
  LODI_ID,
  ORG_ID,
  seedState,
  withRightHand,
} from "./fake-api";
import { MAIL_PROVIDERS } from "./fakes/mail";
import { renderApp, screen, settle, showIn } from "./render";

/*
 * The onboarding (ADR 0162, amended by ADR 0256's addendum of 2026-11-27): what the workspace is for first (ADR 0159);
 * "For me" makes it at once, "For my team" names it first (the work e-mail's name to start with, a logo, the zone) and
 * Continue there makes it. Then one box at a time on the page's sky, each step read from the workspace's own data: the
 * work its first agent does (flat rows, one tap), meeting that agent and connecting the apps it works in (each bringing
 * its routine, ADR 0242), the plan where the workspace waits for its first one (ADR 0079), the AI the person already
 * pays for (shown once, even where the agents already think), and the team's photo with the first delivery on its way,
 * whose button opens the person's DM with the agent on the welcome wizard alone (ADR 0160). "Not now" on the plan asks
 * first, then skips the AI step: the photo with the plan still to sign, into the right hand's DM.
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
const type = async (label: string, value: string) => {
  await act(async () => fireEvent.change(screen().getByLabelText(label), { target: { value } }));
};
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent;
const lead = () => document.querySelector(".onbx__lead")?.textContent;
const box = () => document.querySelector(".onbx") as HTMLElement;
/** The box's footer: its quiet note (or the way back), and its buttons. */
const footNote = () => box().querySelector(".ac-dialog__foot-note")?.textContent;
const footActs = () =>
  [...(box().querySelector(".ac-dialog__foot-acts")?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
/** The geometry capture, where CI runs one (`check:geometry`). */
const snapshot = () => (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();

const PURPOSE = "Para que você vai usar o agentes.chat?";
const NAME = "Como se chama o seu workspace?";
const AREAS = "O que o seu primeiro agente vai fazer?";
const AI = "Agora, a IA que você já assina";
const OTHER = "Crie o seu agente";
const TEAM_PHOTO = "Boas-vindas ao time da Acme";
const GREETING = "Oi, eu sou o Lodi. Monto o time com você.";

/** The work step's rows: each one's title, its line, and how many app marks end it. */
const areaRows = () =>
  [...document.querySelectorAll(".onb-areas__list > .ac-optrow")].map((row) => ({
    title: row.querySelector(".ac-optrow__title")?.textContent,
    line: row.querySelector(".ac-optrow__desc")?.textContent,
    marks: row.querySelectorAll(".onb-area__apps > *").length,
  }));
const area = (title: string) =>
  within(document.querySelector(".onb-areas__list") as HTMLElement).getByRole("button", { name: title });
/** The agent step's app rows: the app, and what ends its row (Connect, or Connected with its account and time). */
const appRows = () =>
  [...box().querySelectorAll(".onb-rows > .onb-row")].map((row) => ({
    name: row.querySelector(".onb-row__name")?.textContent,
    end: row.querySelector(".onb-ok")?.textContent ?? row.querySelector("button")?.textContent,
    sub: row.querySelector(".onb-row__sub")?.textContent ?? null,
  }));
const continueOff = () => (button(/^Continuar/) as HTMLButtonElement).disabled;
/** The photo's list: each row's words, done or not, and whether it shows the working sign. */
const photoRows = () =>
  [...box().querySelectorAll(".onb-next__row")].map((li) => ({
    text: li.textContent,
    done: li.hasAttribute("data-done"),
    working: li.querySelector(".ac-pixspin") !== null,
  }));

/** A new workspace's zone and the person's own in it: this browser's, sent with the workspace. */
const zones = () => {
  const zone = browserTimezone();
  return { timezone: zone ?? "UTC", ...(zone ? { memberTimezone: zone } : {}) };
};

/** One agent the person's AI proposed, as the server keeps it (ADR 0256). */
const option = (name: string, role: string, color: string): FirstAgentOption => ({
  name,
  handle: name.toLowerCase(),
  role,
  why: `${name} tira de você o que mais se repete.`,
  tasks: [`${role}: toda segunda, 8:00, lista o que atrasou`, "Rascunha as mensagens para o seu ok"],
  apps: [{ key: "gmail", label: "Gmail" }],
  routine: null,
  today: ["Lista quem está atrasado"],
  instructions: `Você é ${name}.`,
  appearance: { color, eyes: "happy", accessory: "none" },
});
/** What the person's AI sent: up to three agents, the task that repeats the most first. */
const proposal = (): FirstAgents => ({
  id: "fa-1",
  about: "A Acme vende assinaturas para clínicas e cobra todo mês.",
  source: "mcp",
  options: [option("Caio", "Cobrança", "amber"), option("Nina", "Agenda", "teal")],
  picked: null,
  agentId: null,
  createdAt: new Date().toISOString(),
});

/** The roles the works' agents are made with, in Portuguese (`onboarding.areas.list.<area>.role`). */
const ROLE: Partial<Record<FirstArea, string>> = {
  support: "Atendimento",
  finance: "Financeiro",
  marketing: "Marketing",
  tech: "Tecnologia",
  life: "Vida em ordem",
  freelance: "Trabalho",
};
const agentIdOf = (a: FirstArea) => `agent-${a}`;

/** The agent the work step made for `a` (as `firstAgents.start` does), its first delivery kept, not armed yet. */
const madeFor = (state: FakeState, a: FirstArea) => {
  const def = FIRST_AREAS[a];
  state.agents.push({
    id: agentIdOf(a),
    name: def.name,
    handle: def.name.toLowerCase(),
    role: ROLE[a] ?? "",
    instructions: "",
    model: "auto",
    ownerUserId: "u-walter",
    hasCredential: false,
    monthlyBudgetUsd: null,
    createdAt: new Date().toISOString(),
    appearance: def.look,
  });
  state.firstDelivery = { agentId: agentIdOf(a), area: a, task: "", armedAt: null, firedAt: null, runId: null };
  return state;
};

/** Someone signed up with no workspace yet; `cloud`: the server bills, and a new workspace waits for its plan. */
const newcomer = (cloud: boolean, user: { email?: string; name?: string } = {}) => {
  const state = seedState({ agents: [] });
  if (state.me) {
    state.me.organizations = [];
    state.me.user = { ...state.me.user, ...user };
  }
  if (cloud) {
    state.authConfig = { billingUrl: "https://billing.example.com" };
    state.newWorkspaceStanding = { state: "hold", reason: "payment" };
  }
  return state;
};
/**
 * Acme being set up already, at whatever its data says; `step`: the furthest one the server keeps; `held`: on
 * agentes.chat Cloud, waiting for its first plan; `billing`: on agentes.chat Cloud, its plan paid; `area`: its first
 * agent made for that work.
 */
const settingUp = (
  opts: { held?: boolean; billing?: boolean; step?: OnboardingStepId; personal?: boolean; area?: FirstArea } = {},
) => {
  // A new workspace: its right hand alone, no app connected yet.
  const state = withRightHand(seedState({ agents: [], connections: [] }));
  if (state.me)
    state.me.organizations = [
      {
        id: ORG_ID,
        name: opts.personal ? "Walter" : "Acme",
        role: "owner",
        ...(opts.personal ? { mode: "personal" as const } : {}),
        onboarding: { step: opts.step ?? "context", generalChannelId: GENERAL_ID },
        ...(opts.held ? { standing: { state: "hold" as const, reason: "payment" } } : {}),
      },
    ];
  if (opts.held || opts.billing) state.authConfig = { billingUrl: "https://billing.example.com" };
  if (opts.area) madeFor(state, opts.area);
  return state;
};
/** The billing service's public plan list; `null`: it can't be read. */
const plans = (list: unknown | null) => {
  globalThis.fetch = (async () =>
    list === null
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify(list), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
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
/** One app connected in the workspace, as Settings lists it. */
const connection = (connector: string, account: string): Connection =>
  ({
    id: `conn-${connector}`,
    connector,
    label: connector,
    serverUrl: `https://mcp.${connector}.example/`,
    authType: "oauth",
    accountLabel: account,
    tokenExpiresAt: null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  }) as Connection;

type Rendered = Awaited<ReturnType<typeof renderApp>>;
/** Where the onboarding sends the person, with the arrival it asks for (the workspace drops it from the address). */
const landings = (router: Rendered["router"]) => {
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
const open = async (state: FakeState, path = "/onboarding", rounds = 14) => {
  const r = await renderApp(path, { api: createFakeApi(state) });
  const landed = landings(r.router);
  await settle(rounds);
  return { ...r, landed };
};
/** The tab comes back: `/me` and the step's reads are asked again. */
const refocus = async () => {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle(16);
};

describe("what the workspace is for, first (ADR 0159)", () => {
  test("two answers that say what each view is, a note that it can change, step 1 of 5 on agentes.chat Cloud (of 4 for me)", async () => {
    await open(newcomer(true), "/onboarding", 10);
    expect(heading()).toBe(PURPOSE);
    // A team is the answer to start with: its name step counts.
    expect(eyebrow()).toBe("Passo 1 de 5");
    expect(answerText(/^Para mim(?!ha)/)).toContain("Uma visão mais simples, com todos os recursos.");
    expect(answerText(/Para meu time/)).toContain("A visão completa, com canais e pessoas.");
    // Beside Continue, where the person hesitates.
    expect(footNote()).toBe("Dá para trocar depois, sem perder nada.");
    // The right hand stands on the box, quiet: it speaks in its own conversation, later.
    expect(document.querySelector(".onbw__say")).toBeNull();
    // Nobody to go back to: no way out in the top bar.
    expect(document.querySelector(".onbw__top a")).toBeNull();
    // "For me" has no name step.
    await click(answer(/^Para mim(?!ha)/), 4);
    expect(eyebrow()).toBe("Passo 1 de 4");
  });

  test("self-hosted, with no plan: four steps for a team, three for me", async () => {
    await open(newcomer(false), "/onboarding", 10);
    expect(eyebrow()).toBe("Passo 1 de 4");
    await click(button(/^Continuar/), 8);
    expect(heading()).toBe(NAME);
    expect(eyebrow()).toBe("Passo 2 de 4");
    await click(button(/^Continuar/), 16);
    expect(heading()).toBe(AREAS);
    expect(eyebrow()).toBe("Passo 3 de 4");
    cleanup();

    await open(newcomer(false), "/onboarding", 10);
    await click(answer(/^Para mim(?!ha)/), 4);
    expect(eyebrow()).toBe("Passo 1 de 3");
    await click(button(/^Continuar/), 16);
    expect(heading()).toBe(AREAS);
    expect(eyebrow()).toBe("Passo 2 de 3");
  });

  test("Enter on an answer presses the step's button, and the focus goes to the new step's title", async () => {
    const state = newcomer(false);
    await open(state, "/onboarding", 10);
    const team = answer(/Para meu time/);
    team.focus();
    await act(async () => fireEvent.keyDown(team, { key: "Enter" }));
    await settle(8);
    expect(heading()).toBe(NAME);
    expect(document.activeElement?.classList.contains("onbx__title")).toBe(true);
    expect(document.activeElement?.textContent).toBe(NAME);
    // Enter in the name presses Continue, which makes the workspace.
    const name = screen().getByLabelText("Nome");
    name.focus();
    await act(async () => fireEvent.keyDown(name, { key: "Enter" }));
    await settle(16);
    expect(calls(state, "orgs.create")).toHaveLength(1);
    expect(heading()).toBe(AREAS);
    expect(document.activeElement?.classList.contains("onbx__title")).toBe(true);
    expect(document.activeElement?.textContent).toBe(AREAS);
  });
});

describe("a team's workspace named before it exists (ADR 0162)", () => {
  const nameField = () => screen().getByLabelText("Nome") as HTMLInputElement;

  test("For my team: its name from the work e-mail, the zone, step 2 of 5; Back to the question, nothing made", async () => {
    const state = newcomer(true);
    await open(state, "/onboarding", 10);
    await click(answer(/Para meu time/), 4);
    await click(button(/^Continuar/), 8);
    expect(heading()).toBe(NAME);
    expect(eyebrow()).toBe("Passo 2 de 5");
    expect(lead()).toBe("É onde o time e os agentes conversam.");
    expect(nameField().value).toBe("Acme");
    expect(nameField().getAttribute("spellcheck")).toBe("false");
    // No logo yet: the name's letter, and the way to pick one.
    expect(button("Escolher o logo").textContent).toBe("A");
    expect(document.querySelector(".onb__zone")?.textContent).toMatch(/^Fuso horário: .+ · trocar$/);
    expect(calls(state, "orgs.create")).toEqual([]);
    // An empty name makes nothing.
    await type("Nome", "  ");
    expect(continueOff()).toBe(true);
    await type("Nome", "Acme Clínicas");
    expect(continueOff()).toBe(false);

    // Back: the question again, the name typed kept for the way forward.
    await click(button("Voltar"), 4);
    expect(heading()).toBe(PURPOSE);
    expect(eyebrow()).toBe("Passo 1 de 5");
    await click(button(/^Continuar/), 8);
    expect(nameField().value).toBe("Acme Clínicas");
    expect(calls(state, "orgs.create")).toEqual([]);
  });

  test("Continue makes it with the name typed, the zone picked and both zones; the logo picked goes up once it exists", async () => {
    const state = newcomer(true);
    await open(state, "/onboarding", 10);
    await click(answer(/Para meu time/), 4);
    await click(button(/^Continuar/), 8);
    await type("Nome", "Acme Clínicas");

    // Another zone: "change" opens the selector in place.
    await click(button("trocar"), 4);
    const zoneBox = screen().getByRole("combobox", { name: "Fuso horário" });
    await click(zoneBox, 2);
    const search = screen().getByRole("combobox", { name: "Buscar fuso" });
    await act(async () => fireEvent.change(search, { target: { value: "lisboa" } }));
    await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
    await settle(2);
    expect(screen().getByRole("combobox", { name: "Fuso horário" }).textContent).toContain("Lisboa");

    // The logo: cropped in its dialog, kept here until the workspace exists.
    await click(button("Escolher o logo"), 4);
    const dialog = screen().getByRole("dialog", { name: "Logo do workspace" });
    await act(async () =>
      fireEvent.change(within(dialog).getByLabelText("Escolher imagem"), {
        target: { files: [new File(["png-bytes"], "logo.png", { type: "image/png" })] },
      }),
    );
    await settle(3);
    await click(within(dialog).getByRole("button", { name: "Salvar" }), 8);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(button("Trocar o logo").querySelector("img")?.getAttribute("src")).toStartWith("data:image/png;base64,");
    expect(calls(state, "orgs.setLogo")).toEqual([]);

    await click(button(/^Continuar/), 20);
    const zone = browserTimezone();
    expect(calls(state, "orgs.create").map((c) => c.args[0])).toEqual([
      { name: "Acme Clínicas", timezone: "Europe/Lisbon", ...(zone ? { memberTimezone: zone } : {}) },
    ]);
    const made = state.me?.organizations.find((o) => o.name === "Acme Clínicas")?.id;
    expect(calls(state, "orgs.setLogo").map((c) => c.args)).toEqual([[made, { contentType: "image/png" }]]);
    expect(state.calls.map((c) => c.method).filter((m) => m === "orgs.create" || m === "orgs.setLogo")).toEqual([
      "orgs.create",
      "orgs.setLogo",
    ]);
    expect(heading()).toBe(AREAS);
    expect(eyebrow()).toBe("Passo 3 de 5");
    expect(document.querySelector(".onb-place-line")?.textContent).toMatch(/^Acme Clínicas · /);
    // Nothing is finished.
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
  });

  test("the e-mail's own name, untouched: the workspace made with it and both zones, no logo sent", async () => {
    const state = newcomer(true);
    await open(state, "/onboarding", 10);
    await click(answer(/Para meu time/), 4);
    await click(button(/^Continuar/), 8);
    await click(button(/^Continuar/), 16);
    expect(calls(state, "orgs.create").map((c) => c.args[0])).toEqual([{ name: "Acme", ...zones() }]);
    expect(calls(state, "orgs.setLogo")).toEqual([]);
    expect(heading()).toBe(AREAS);
  });

  test("a webmail address names a team's workspace after the person; For me always does, with no name step", async () => {
    const webmail = newcomer(false, { email: "ana.souza@gmail.com", name: "Ana Souza" });
    await open(webmail, "/onboarding", 10);
    await click(answer(/Para meu time/), 4);
    await click(button(/^Continuar/), 8);
    expect(nameField().value).toBe("Ana");
    await click(button(/^Continuar/), 16);
    expect(calls(webmail, "orgs.create")[0]?.args[0]).toMatchObject({ name: "Ana" });
    expect(document.querySelector(".onb-place-line")?.textContent).toMatch(/^Ana · /);
    cleanup();

    const mine = newcomer(false);
    await open(mine, "/onboarding", 10);
    // "For me", not "For my team", whose words start the same in Portuguese.
    await click(answer(/^Para mim(?!ha)/), 4);
    await click(button(/^Continuar/), 16);
    expect(calls(mine, "orgs.create")[0]?.args[0]).toEqual({ name: "Walter", mode: "personal", ...zones() });
    expect(heading()).toBe(AREAS);
  });
});

describe("the work its first agent does (ADR 0256)", () => {
  test("a team's six works as flat rows, each with its line and its apps' marks; Other last; the other ways under them", async () => {
    await open(settingUp());
    expect(heading()).toBe(AREAS);
    expect(lead()).toBe("Escolha um trabalho. Depois, você cria outros agentes.");
    expect(document.querySelector(".onb-areas__list.ac-optlinks--flat")).not.toBeNull();
    // The marks are the apps this catalog lists (here: the mailbox, Stripe, GitHub, Sentry, Linear, Notion, Drive).
    expect(areaRows()).toEqual([
      { title: "Atendimento", line: "Responde e-mails e chamados de clientes", marks: 1 },
      { title: "Vendas", line: "Segue contatos novos e negócios parados", marks: 1 },
      { title: "Financeiro", line: "Avisa de pagamentos com problema", marks: 1 },
      { title: "Marketing", line: "Acha o que falam da empresa e ideias de conteúdo", marks: 0 },
      { title: "O meu dia", line: "E-mails, reuniões e tarefas de hoje", marks: 2 },
      { title: "Tecnologia", line: "Acha PRs esperando revisão e erros novos", marks: 3 },
      { title: "Outro", line: "Crie o seu agente e escolha os apps", marks: 0 },
    ]);
    // Each row's bare icon in its own column, no tile around it.
    expect(document.querySelectorAll(".onb-areas__list .ac-optrow__lead")).toHaveLength(7);
    expect(box().querySelector(".onb-other__label")?.textContent).toBe("Prefere outro jeito?");
    expect([...box().querySelectorAll(".onb-other__btn")].map((b) => b.textContent)).toEqual([
      "Pedir à sua IA",
      "Trazer de outro app",
    ]);
    // Each led by what it means: three assistants' marks, and the import's first three apps.
    const [ask, bring] = box().querySelectorAll(".onb-other__btn");
    expect(ask?.querySelectorAll(".ac-brand-stack > .ac-brand").length).toBe(3);
    expect([...(bring?.querySelectorAll(".onb-marks__plate img") ?? [])].map((i) => i.getAttribute("src"))).toEqual(
      IMPORT_CARDS.filter((c) => c !== "other")
        .slice(0, 3)
        .map((c) => CARD_MARK[c].icon),
    );
    // The faces on the cover are the works' agents, never the right hand.
    expect(box().querySelector(".onb-wall [data-accessory='headset']")).toBeNull();
    // One tap goes on: no button of the step's own.
    expect(footActs()).toEqual([]);
  });

  test("a personal workspace's own works, its footer with the person's name", async () => {
    await open(settingUp({ personal: true }));
    expect(areaRows().map((r) => r.title)).toEqual([
      "Vida em ordem",
      "Trabalho por conta própria",
      "Estudos e ideias",
      "Viagens",
      "Casa",
      "Saúde",
      "Outro",
    ]);
    expect(document.querySelector(".onb-place-line")?.textContent).toBe("Walter · horário de Brasília · Trocar");
  });

  test("one tap makes the work's agent and goes on to it; back, another work takes its place; the same one makes none", async () => {
    const state = settingUp();
    await open(state);
    await click(area("Atendimento"), 20);
    expect(calls(state, "firstAgents.start").map((c) => c.args)).toEqual([
      [
        ORG_ID,
        {
          area: "support",
          name: "Iara",
          role: "Atendimento",
          instructions: expect.stringContaining("Você cuida do atendimento"),
          appearance: FIRST_AREAS.support.look,
          task: expect.stringContaining("Leia os e-mails dos últimos 7 dias"),
          apps: ["zendesk", "intercom"],
          replace: null,
        },
      ],
    ]);
    expect(heading()).toBe("Iara, do atendimento");
    const iara = state.agents.find((a) => a.name === "Iara")?.id;

    // Back: the work again, and another one takes Iara's place, her first delivery not gone yet.
    await click(button("Voltar"), 8);
    expect(heading()).toBe(AREAS);
    await click(area("Financeiro"), 20);
    expect(calls(state, "firstAgents.start")[1]?.args[1]).toMatchObject({
      area: "finance",
      name: "Caio",
      replace: iara,
    });
    expect(state.agents.some((a) => a.name === "Iara")).toBe(false);
    expect(heading()).toBe("Caio, do financeiro");

    // The same work again: the agent made for it stays.
    await click(button("Voltar"), 8);
    await click(area("Financeiro"), 12);
    expect(calls(state, "firstAgents.start")).toHaveLength(2);
    expect(heading()).toBe("Caio, do financeiro");
  });

  test("the footer says the workspace's name and zone; Trocar saves both, and an empty name can't", async () => {
    const state = settingUp();
    await open(state);
    const place = () => document.querySelector(".onb-place-line")?.textContent;
    expect(place()).toBe("Acme · horário de Brasília · Trocar");
    await click(button("Trocar"), 4);
    const dialog = screen().getByRole("dialog", { name: "Nome e fuso horário" });
    const name = within(dialog).getByLabelText("Nome") as HTMLInputElement;
    expect(name.value).toBe("Acme");
    expect(name.getAttribute("spellcheck")).toBe("false");
    // The zone's reason behind its ⓘ.
    const about = within(dialog).getByRole("button", { name: "Sobre Fuso horário" });
    expect(document.getElementById(about.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Para rotinas e lembretes. Detectado pelo seu navegador.",
    );
    const save = () => within(dialog).getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    await act(async () => fireEvent.change(name, { target: { value: "  " } }));
    expect(save().disabled).toBe(true);
    await act(async () => fireEvent.change(name, { target: { value: "Acme Clínicas" } }));
    await click(save(), 12);
    expect(calls(state, "orgs.updateSettings").map((c) => c.args)).toEqual([
      [ORG_ID, { name: "Acme Clínicas", timezone: "America/Sao_Paulo" }],
    ]);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(place()).toBe("Acme Clínicas · horário de Brasília · Trocar");
    expect(heading()).toBe(AREAS);
  });

  test("Ask your AI: its dialog over the step; the proposal makes its first option and goes on to that agent", async () => {
    const state = settingUp();
    const r = await open(state);
    await click(button(/Pedir à sua IA/), 12);
    const dialog = screen().getByRole("dialog", { name: "Peça o seu primeiro agente à sua IA" });
    expect(dialog.querySelector(".onb-ask")).not.toBeNull();
    expect(heading()).toBe(AREAS);
    // The person's AI sends its proposal: the page reads it on its next poll.
    state.firstAgents = proposal();
    await act(() => r.services.queryClient.invalidateQueries({ queryKey: keys.firstAgents(ORG_ID) }));
    await settle(20);
    // The top option, the task it found repeated most.
    expect(calls(state, "firstAgents.pick").map((c) => c.args)).toEqual([[ORG_ID, "fa-1", 0]]);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(heading()).toBe("Caio");
    expect(eyebrow()).toBe("Passo 4 de 4 · O seu primeiro agente");
    expect(lead()).toBe("Cobrança: toda segunda, 8:00, lista o que atrasou");
    // Asked of the AI: nothing has to be connected first.
    expect(continueOff()).toBe(false);
    // The apps its AI named come first, the catalog a search away.
    expect(appRows()).toEqual([{ name: "Gmail", end: "Conectar", sub: null }]);
    expect(button(/Outro app/)).toBeTruthy();
  });

  test("Bring from another app opens the import over the step", async () => {
    await open(settingUp());
    await click(button(/Trazer de outro app/), 16);
    expect(screen().getByRole("dialog", { name: "Trazer agentes de outro app" })).toBeTruthy();
    expect(heading()).toBe(AREAS);
  });
});

describe("meeting the first agent and connecting its apps (ADR 0256, ADR 0242)", () => {
  test("its title and line by its work, where it works, each app with Connect; Continue goes on with none connected", async () => {
    plans(PLANS);
    const state = settingUp({ held: true, area: "support" });
    await open(state);
    expect(heading()).toBe("Iara, do atendimento");
    expect(eyebrow()).toBe("Passo 4 de 5 · O seu primeiro agente");
    expect(lead()).toBe(
      "Responde e-mails e chamados de clientes, com um rascunho pronto em cada um. Nada sai sem o seu ok.",
    );
    expect(box().querySelector(".onb-apps__label")?.textContent).toBe("Conecte onde os clientes escrevem");
    // The apps this catalog can connect: the mailbox (Zendesk and Intercom aren't in it).
    expect(appRows()).toEqual([{ name: "Gmail", end: "Conectar", sub: null }]);
    expect(button(/Outro app/)).toBeTruthy();
    // The apps can come later: Continue never waits for one.
    expect(continueOff()).toBe(false);
    // The portrait: the agent among faint faces, none of them the right hand's.
    expect(box().querySelector(".onb-meet .onb-meet__agent")).not.toBeNull();
    expect(box().querySelector(".onb-meet [data-accessory='headset']")).toBeNull();
    // Continue with nothing connected: on to the plan.
    await click(button(/^Continuar/), 20);
    expect(calls(state, "orgs.saveOnboarding")[0]?.args).toEqual([ORG_ID, { step: "agents" }]);
    expect(heading()).toBe("O time da Acme começa com a Iara");
  });

  test("work that starts with no app: Continue at once, in her own words", async () => {
    await open(settingUp({ area: "marketing" }));
    expect(heading()).toBe("Gabi, do marketing");
    expect(lead()).toBe("Acha o que falam da Acme na internet e traz o que pede resposta.");
    expect(box().querySelector(".onb-apps__label")?.textContent).toBe(
      "Ela já começa pela internet. Conecte para ir além",
    );
    expect(continueOff()).toBe(false);
  });

  test("back from an app's sign-in: its confirmation makes the routine for this agent, its first run left for later", async () => {
    const state = settingUp({ area: "finance" });
    state.connections = [connection("stripe", "acme")];
    const api = createFakeApi(state);
    const ran: string[] = [];
    const runNow = api.routines.runNow;
    api.routines.runNow = async (orgId, id) => {
      ran.push(id);
      return runNow(orgId, id);
    };
    await renderApp("/onboarding?connected=stripe&outcome=connected", { api });
    await settle(20);
    expect(heading()).toBe("Caio, do financeiro");
    // The connect flow reopens on its confirmation, with the routine the app brings, for this agent.
    const flow = screen().getAllByRole("dialog").at(-1) as HTMLElement;
    expect(within(flow).getByText("Pagamentos com problema")).toBeTruthy();
    expect(within(flow).getByRole("combobox", { name: "Quem faz" }).textContent).toContain("Caio");
    await click(within(flow).getByRole("button", { name: "Pronto" }), 16);
    const made = (await api.routines.list(ORG_ID)).filter((x) => x.name === "Pagamentos com problema");
    expect(made.map((x) => x.agentId)).toEqual([agentIdOf("finance")]);
    // Its first run is the first delivery: nothing runs now, and no toast says it started.
    expect(ran).toEqual([]);
    expect(document.body.textContent).not.toContain("Rotina criada");
    // The row: the account and when its routine runs, and Connected as plain words.
    const [stripe] = appRows();
    expect(stripe?.name).toBe("Stripe");
    expect(stripe?.end).toBe("Conectado");
    expect(stripe?.sub).toMatch(/^acme · \S/);
    expect(stripe?.sub).toContain("10:00");
    expect(continueOff()).toBe(false);
  });

  test("an app signed in through its own MCP server (a server row, `custom:<id>`): Connected, and back from it its confirmation", async () => {
    const state = settingUp({ area: "finance" });
    const api = createFakeApi(state);
    // Stripe's own server by its address: a server row, the catalog's app by that address.
    const made = await api.customConnectors.connect(ORG_ID, {
      serverUrl: "https://mcp.stripe.com",
      apiKey: "rk_test_onboarding",
      label: "Stripe",
      returnTo: "/onboarding",
    });
    if (made.status !== "connected") throw new Error("the fake server didn't connect");
    await renderApp(`/onboarding?connected=custom:${made.server.id}&outcome=connected`, { api });
    await settle(20);
    expect(heading()).toBe("Caio, do financeiro");
    // The connect flow reopens on that server's confirmation.
    expect(screen().getByRole("dialog", { name: "Stripe conectado" })).toBeTruthy();
    // Its row says Connected, as for a catalog connection.
    expect(appRows()[0]).toMatchObject({ name: "Stripe", end: "Conectado" });
    expect(continueOff()).toBe(false);
  });

  test("Gmail's one-click sign-in comes back to the onboarding, where this agent may write in it from the start", async () => {
    const left: string[] = [];
    setNavigateAway((url) => left.push(url));
    const state = settingUp({ area: "support" });
    const api = createFakeApi(state);
    const mail = fakeMailOf.get(api);
    if (!mail) throw new Error("no mail fake");
    mail.providers = structuredClone(MAIL_PROVIDERS);
    await renderApp("/onboarding", { api });
    await settle(14);
    await click(within(box()).getByRole("button", { name: "Conectar" }), 8);
    const flow = () => screen().getAllByRole("dialog").at(-1) as HTMLElement;
    await click(within(flow()).getByRole("button", { name: "Conectar com Google" }), 6);
    expect(calls(state, "mail.connectComposio").map((c) => c.args[1])).toEqual([
      { provider: "gmail", desktop: false, back: "onboarding" },
    ]);
    expect(left).toEqual(["https://composio.example/connect/gmail"]);
    cleanup();

    // Back from Google: the flow reopens on what the mailbox does, then who may use it, Iara writing.
    mail.accounts = [
      {
        id: "mail-1",
        provider: "gmail",
        via: "composio",
        address: "atende@acme.com.br",
        offActions: [],
        askActions: [],
        aliases: [],
        defaultFrom: null,
        label: "atende@acme.com.br",
        status: "active",
        lastError: null,
        preset: null,
        createdAt: new Date().toISOString(),
        ownerUserId: state.me?.user.id ?? null,
        agents: [],
      } as MailAccount,
    ];
    await renderApp("/onboarding?mail=connected&account=mail-1", { api });
    await settle(20);
    expect(screen().getByRole("dialog", { name: "O que atende@acme.com.br faz" })).toBeTruthy();
    await click(within(flow()).getByRole("button", { name: "Continuar" }), 8);
    const iara = within(flow()).getByRole("radiogroup", { name: "Nível de Iara" });
    expect(within(iara).getByRole("radio", { checked: true }).textContent).toBe("Ler e escrever");
    const lodi = within(flow()).getByRole("radiogroup", { name: "Nível de Lodi" });
    expect(within(lodi).getByRole("radio", { checked: true }).textContent).toBe("Sem acesso");
  });

  test("Continue arms the first delivery, then keeps the step; on to the plan, its step marked as shown", async () => {
    plans(PLANS);
    const state = settingUp({ held: true });
    const api = createFakeApi(state);
    await renderApp("/onboarding", { api });
    await settle(14);
    await click(area("Marketing"), 20);
    const gabi = state.agents.find((a) => a.name === "Gabi")?.id ?? "";
    // Work that needs no app starts with its routine, in the person's DM with her.
    const routines = (await api.routines.list(ORG_ID)).filter((x) => x.name === "Menções à empresa");
    expect(routines.map((x) => ({ agent: x.agentId, target: x.target, trigger: x.trigger.type }))).toEqual([
      { agent: gabi, target: { type: "dm" }, trigger: "schedule" },
    ]);
    expect(state.firstDelivery?.armedAt).toBeNull();
    await click(button(/^Continuar/), 20);
    const order = state.calls
      .map((c) => c.method)
      .filter((m) => m === "firstAgents.keepDelivery" || m === "orgs.saveOnboarding");
    expect(order.slice(0, 2)).toEqual(["firstAgents.keepDelivery", "orgs.saveOnboarding"]);
    expect(calls(state, "firstAgents.keepDelivery").map((c) => c.args)).toEqual([[ORG_ID, gabi]]);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [ORG_ID, { step: "agents" }],
      [ORG_ID, { step: "computer" }],
    ]);
    expect(state.firstDelivery?.armedAt).toBeTruthy();
    expect(heading()).toBe("O time da Acme começa com a Gabi");
  });

  test("Other: its name, what it does and its apps searched; Continue makes the agent with them, then goes on", async () => {
    const state = settingUp();
    await open(state);
    await click(area("Outro"), 10);
    expect(heading()).toBe(OTHER);
    expect(eyebrow()).toBe("Passo 4 de 4 · O seu primeiro agente");
    expect(continueOff()).toBe(true);
    // Nothing searched: the most used apps, the mailbox first; Connect waits for the agent's name and work.
    expect(appRows().map((a) => a.name)).toEqual(["Gmail", "Notion", "Stripe", "GitHub", "Linear", "Google Drive"]);
    expect(appRows().every((a) => a.end === "Conectar")).toBe(true);
    const connect = box().querySelector<HTMLButtonElement>(".onb-rows .onb-row button");
    expect(connect?.disabled).toBe(true);
    await type("Buscar apps", "lin");
    expect(appRows().map((a) => a.name)).toEqual(["Linear"]);
    await type("Buscar apps", "zzz");
    expect(box().querySelector(".onb-rows__none")?.textContent).toBe("Nenhum app com esse nome.");
    await type("Nome", "Léo");
    await type("O que ele faz?", "Responde às dúvidas dos alunos no fim do dia");
    expect(continueOff()).toBe(false);
    await click(button(/^Continuar/), 24);
    expect(calls(state, "firstAgents.start").map((c) => c.args[1])).toEqual([
      {
        area: "custom",
        name: "Léo",
        instructions: "Responde às dúvidas dos alunos no fim do dia",
        appearance: CUSTOM_LOOK,
        task: "Responde às dúvidas dos alunos no fim do dia",
        replace: null,
      },
    ]);
    const leo = state.agents.find((a) => a.name === "Léo")?.id;
    expect(calls(state, "firstAgents.keepDelivery").map((c) => c.args)).toEqual([[ORG_ID, leo]]);
    expect(calls(state, "orgs.saveOnboarding")[0]?.args).toEqual([ORG_ID, { step: "agents" }]);
    // Self-hosted, its AI already there: the AI step all the same, answered with Continue.
    expect(heading()).toBe(AI);
    expect(footActs()).toEqual([expect.stringMatching(/^Continuar/)]);
  });
});

describe("the plan (agentes.chat Cloud, ADR 0079)", () => {
  test("the agent asleep among the next places, what it delivers today, the plan from the billing list, its Checkout", async () => {
    plans(PLANS);
    const state = settingUp({ held: true, step: "agents", area: "support" });
    await open(state);
    expect(heading()).toBe("O time da Acme começa com a Iara");
    expect(eyebrow()).toBe("Passo 5 de 5");
    expect(lead()).toStartWith(
      "Ela entrega hoje os e-mails que pedem resposta. Depois, crie quantos agentes quiser, e eles passam trabalho um para o outro.",
    );
    // What the next agents could be, each icon before its name.
    const next = box().querySelector(".onb-next-areas") as HTMLElement;
    expect(next.firstElementChild?.textContent).toBe("Depois:");
    expect([...next.querySelectorAll(".onb-next-areas__item")].map((i) => i.textContent?.replace("·", ""))).toEqual([
      "Vendas",
      "Financeiro",
      "Marketing",
      "Tecnologia",
    ]);
    // On the band: four empty places around the agent; no words on the sky.
    expect(box().querySelectorAll(".onb-pass .onb-place")).toHaveLength(4);
    expect(box().querySelector(".onb-pass")?.textContent).toBe("");
    // The plan from the billing service's list: its name and price on one line, what it includes, every plan.
    expect(box().querySelector(".onb-offer__name")?.textContent).toContain("Plano Equipe");
    expect(box().querySelector(".onb-offer__price")?.textContent).toBe("$49por mês");
    expect(box().querySelector(".onb-offer__fine")?.textContent).toBe(
      "Agentes sem limite e até 10 pessoas. Cancele em um clique.",
    );
    expect(button("Ver todos os planos")).toBeTruthy();
    expect(footNote()).toBe("Agora não");
    expect(footActs()).toEqual([expect.stringMatching(/^Assinar o plano Equipe/)]);
    // Shown once: kept as such, so it stays on the rail, answered, after paying.
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { step: "computer" }]]);
    // The plan is subscribed to, never "hired".
    expect(box().textContent).not.toMatch(/[Cc]ontrat/);
    await click(button(/^Assinar o plano Equipe/), 6);
    expect(calls(state, "orgs.billingLink").map((c) => c.args)).toEqual([[ORG_ID, "onboarding", "team"]]);
  });

  test("a personal workspace's: its agents begin with the one made, the plan for one person", async () => {
    plans(PLANS);
    await open(settingUp({ held: true, step: "agents", personal: true, area: "life" }));
    expect(heading()).toBe("Os seus agentes começam com a Nina");
    expect(box().querySelector(".onb-offer__name")?.textContent).toContain("Plano Pessoal");
    expect(box().querySelector(".onb-offer__fine")?.textContent).toBe(
      "Agentes sem limite, só para você. Cancele em um clique.",
    );
    expect(footActs()).toEqual([expect.stringMatching(/^Assinar o plano Pessoal/)]);
  });

  test("with no plan data, the plan named generically; an agent of no work delivers in general words", async () => {
    plans(null);
    const state = settingUp({ held: true, step: "agents", area: "support" });
    // An agent brought from another app: its first delivery has no work of the list.
    if (state.firstDelivery) state.firstDelivery.area = null;
    await open(state);
    expect(heading()).toBe("O time da Acme começa com a Iara");
    expect(lead()).toStartWith("Ela começa hoje a primeira entrega.");
    expect(box().querySelector(".onb-offer__name")?.textContent).toContain("Um plano do agentes.chat");
    expect(box().querySelector(".onb-offer__fine")?.textContent).toBe("Agentes sem limite. Cancele em um clique.");
    expect(footActs()).toEqual([expect.stringMatching(/^Assinar o plano/)]);
    expect(screen().queryByRole("button", { name: "Ver todos os planos" })).toBeNull();
  });

  test("Not now asks first; its Subscribe opens the same Checkout as the step's, and closing it keeps the plan step", async () => {
    plans(PLANS);
    const state = settingUp({ held: true, step: "agents", area: "support" });
    await open(state);
    await click(button("Agora não"), 6);
    const ask = screen().getByRole("dialog", { name: "Continuar sem um plano?" });
    expect(ask.textContent).toContain(
      "Sem um plano, a Iara não começa a trabalhar e a primeira entrega fica esperando. Dá para assinar depois, no workspace.",
    );
    expect(within(ask).getByRole("button", { name: "Continuar sem plano" })).toBeTruthy();
    // Closed: the plan step as it was, nothing left for later.
    await act(async () => fireEvent.keyDown(ask, { key: "Escape" }));
    await settle(4);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(heading()).toBe("O time da Acme começa com a Iara");
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { step: "computer" }]]);
    // Asked again, its primary is the step's own Subscribe: the plan's Checkout.
    await click(button("Agora não"), 6);
    await click(
      within(screen().getByRole("dialog", { name: "Continuar sem um plano?" })).getByRole("button", {
        name: /^Assinar o plano Equipe/,
      }),
      6,
    );
    expect(calls(state, "orgs.billingLink").map((c) => c.args)).toEqual([[ORG_ID, "onboarding", "team"]]);
    expect(heading()).toBe("O time da Acme começa com a Iara");
  });

  test("Continue without a plan: the photo, its plan still to sign and the first delivery waiting; its button opens the right hand's DM on the welcome wizard alone", async () => {
    plans(PLANS);
    const state = settingUp({ held: true, step: "agents", area: "support" });
    const { router, landed } = await open(state);
    await click(button("Agora não"), 6);
    await click(
      within(screen().getByRole("dialog", { name: "Continuar sem um plano?" })).getByRole("button", {
        name: "Continuar sem plano",
      }),
      20,
    );
    expect(router.state.location.pathname).toBe("/onboarding");
    // No AI step without a plan: the photo, the plan still waiting.
    expect(heading()).toBe(TEAM_PHOTO);
    expect(lead()).toBe("Você e a Iara, a primeira do time. A partir de hoje, trabalhando juntos.");
    expect(photoRows()).toEqual([
      { text: "1Assinar o plano Equipe", done: false, working: false },
      { text: "IA conectada (concluído)", done: true, working: false },
      { text: "3A primeira entrega da Iara", done: false, working: false },
    ]);
    // Waiting for the plan even though the agents think.
    expect(box().querySelector(".onb-next__delivery")?.hasAttribute("data-waiting")).toBe(true);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { step: "computer" }]]);
    await click(button(/^Conhecer o workspace/), 20);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([
      [ORG_ID, { step: "computer" }],
      [ORG_ID, { finished: true }],
    ]);
    // Into the right hand's DM, whose card leads with the plan.
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${LODI_ID}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
  });
});

describe("back from Checkout: the AI the person already pays for", () => {
  /** Acme with Iara, its plan step shown before Checkout ("computer"), back with `?paid=1`. */
  const paidReturn = async (opts: { lifted: boolean }) => {
    const state = noAiYet(
      settingUp({ held: !opts.lifted, billing: true, step: opts.lifted ? "computer" : "agents", area: "support" }),
    );
    plans(PLANS);
    const r = await open(state, `/org/${ORG_ID}/onboarding?paid=1&plan=team&period=year`, 16);
    return { ...r, state };
  };

  test("the payment received until the hold lifts, then the AI step with the plan named over it", async () => {
    const { state, router } = await paidReturn({ lifted: false });
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(heading()).toBe("O time da Acme começa com a Iara");
    // The billing service lifts the hold on its next pass: until then, the payment as received, no button.
    expect(box().querySelector(".ac-dialog__foot-note [role='status']")?.textContent).toContain("Pagamento recebido");
    expect(screen().queryByRole("button", { name: /^Assinar o plano/ })).toBeNull();
    const org = state.me?.organizations[0];
    if (org) delete org.standing;
    await refocus();
    expect(heading()).toBe(AI);
    expect(eyebrow()).toBe("Plano Equipe ativo");
    expect(lead()).toBe(
      "A Iara pensa com ela, sem custo a mais aqui. Assim que conectar, ela começa a primeira entrega.",
    );
    // The choices as flat rows.
    const choices = box().querySelector(".arrival-opts.ac-optlinks--flat") as HTMLElement;
    expect([...choices.querySelectorAll(".ac-optrow__title")].map((t) => t.textContent)).toEqual([
      "Claude",
      "ChatGPT",
      "Outro plano",
      "Chave de API",
      "Começar grátis",
    ]);
    expect(footNote()).toBe("Sem uma IA, os agentes não respondem.");
    expect(footActs()).toEqual(["Conectar depois"]);
  });

  test("Connect later asks first; Connect now stays; Continue without an AI goes on to the photo", async () => {
    const { state } = await paidReturn({ lifted: true });
    expect(heading()).toBe(AI);
    await click(button("Conectar depois"), 6);
    const ask = screen().getByRole("dialog", { name: "Continuar sem uma IA?" });
    expect(ask.textContent).toContain(
      "Sem uma IA, a Iara não faz a primeira entrega e não responde. Ela fica esperando até você conectar uma.",
    );
    await click(within(ask).getByRole("button", { name: "Conectar agora" }), 6);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(heading()).toBe(AI);
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
    await click(button("Conectar depois"), 6);
    await click(within(screen().getByRole("dialog")).getByRole("button", { name: "Continuar sem IA" }), 16);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { step: "ai" }]]);
    expect(heading()).toBe(TEAM_PHOTO);
  });
});

describe("the AI step, shown once even where the agents already think", () => {
  test("a server's own AI: Continue in place of Connect later, no note; kept as answered, then the photo", async () => {
    const state = settingUp({ step: "agents", area: "support" });
    await open(state, "/onboarding", 18);
    expect(heading()).toBe(AI);
    expect(footActs()).toEqual([expect.stringMatching(/^Continuar/)]);
    expect(box().textContent).not.toContain("Sem uma IA, os agentes não respondem.");
    expect(screen().queryByRole("button", { name: "Conectar depois" })).toBeNull();
    // Nothing is kept while it shows.
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
    await click(button(/^Continuar/), 16);
    expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual([[ORG_ID, { step: "ai" }]]);
    expect(heading()).toBe(TEAM_PHOTO);
    expect(photoRows()[0]?.text).toBe("IA conectada (concluído)");
  });
});

describe("the team's photo, the onboarding's end", () => {
  test("the plan, the AI and the first delivery on its way; Conhecer o workspace opens the DM with the agent", async () => {
    plans(PLANS);
    const state = settingUp({ billing: true, step: "ai", area: "support" });
    const { router, landed } = await open(state, "/onboarding", 18);
    expect(heading()).toBe(TEAM_PHOTO);
    expect(eyebrow()).toMatch(/^Time da Acme · desde /);
    expect(lead()).toBe("Você e a Iara, a primeira do time. A partir de hoje, trabalhando juntos, de dia e de noite.");
    expect(box().querySelector(".onb-photo__say")?.textContent).toBe("Oi, Walter. A gente começa hoje.");
    // Only the person and the agent on the photo: never the right hand.
    expect(box().querySelectorAll(".onb-photo .team-scene__agent")).toHaveLength(2);
    expect(box().querySelector(".onb-photo [data-accessory='headset']")).toBeNull();
    expect(photoRows()).toEqual([
      { text: "Plano Equipe ativo (concluído)", done: true, working: false },
      { text: "IA conectada (concluído)", done: true, working: false },
      {
        text: "A Iara está lendo os seus e-mailsA primeira entrega chega em alguns minutos.",
        done: false,
        working: true,
      },
    ]);
    expect(footNote()).toBe("Baixar a foto do time");
    await click(button(/^Conhecer o workspace/), 20);
    expect(calls(state, "orgs.saveOnboarding").at(-1)?.args).toEqual([ORG_ID, { finished: true }]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${agentIdOf("support")}`);
    expect(landed.at(-1)?.arrival).toBe("beta");
  });

  test("the AI left for later: Connect the AI to do, the first delivery waiting, muted, with no working sign", async () => {
    plans(PLANS);
    await open(noAiYet(settingUp({ billing: true, step: "ai", area: "support" })), "/onboarding", 18);
    expect(heading()).toBe(TEAM_PHOTO);
    expect(photoRows()).toEqual([
      { text: "Plano Equipe ativo (concluído)", done: true, working: false },
      { text: "2Conectar a IA", done: false, working: false },
      { text: "3A primeira entrega da Iara", done: false, working: false },
    ]);
    expect(box().querySelector(".onb-next__delivery")?.hasAttribute("data-waiting")).toBe(true);
  });

  test("self-hosted: no plan to list; a personal workspace's own words", async () => {
    await open(settingUp({ step: "ai", area: "support" }), "/onboarding", 18);
    expect(photoRows().map((r) => r.text)).toEqual([
      "IA conectada (concluído)",
      "A Iara está lendo os seus e-mailsA primeira entrega chega em alguns minutos.",
    ]);
    cleanup();
    await open(settingUp({ step: "ai", personal: true, area: "life" }), "/onboarding", 18);
    expect(heading()).toBe("Boas-vindas ao seu time");
    expect(eyebrow()).toMatch(/^Seus agentes · desde /);
    expect(lead()).toBe("Você e a Nina, a primeira dos seus agentes. A partir de hoje, cuidando dos seus dias juntas.");
    expect(photoRows().at(-1)?.text).toBe("A Nina está montando o seu diaA primeira entrega chega em alguns minutos.");
    expect(footNote()).toBe("Baixar a foto do seu time");
  });

  test("the photo downloads through the app's saver, named after the workspace", async () => {
    const saved: [string, string][] = [];
    teamPhoto.draw = async () => new Blob(["png"], { type: "image/png" });
    URL.createObjectURL = () => "blob:team-photo";
    fileSaver.save = (url, name) => saved.push([url, name]);
    await open(settingUp({ step: "ai", area: "support" }), "/onboarding", 18);
    await click(button("Baixar a foto do time"), 6);
    expect(saved).toEqual([["blob:team-photo", "time-acme.png"]]);
  });

  test("Change your photo, under the list: the avatar builder, the photo upload a step from it; /me read again on closing", async () => {
    const state = settingUp({ step: "ai", area: "support" });
    const { api, log } = recorded(createFakeApi(state));
    await renderApp("/onboarding", { api });
    await settle(18);
    expect(heading()).toBe(TEAM_PHOTO);
    // Under the checklist, quiet.
    const change = button("Trocar a sua foto");
    expect(change.closest(".onb-face")?.previousElementSibling?.matches("ol")).toBe(true);
    await click(change, 6);
    const builder = screen().getByRole("dialog", { name: "Seu avatar" });
    log.length = 0;
    await click(within(builder).getByRole("button", { name: "Enviar foto" }), 6);
    const upload = screen().getByRole("dialog", { name: "Foto do perfil" });
    expect(screen().queryByRole("dialog", { name: "Seu avatar" })).toBeNull();
    await act(async () => fireEvent.keyDown(upload, { key: "Escape" }));
    await settle(8);
    expect(screen().queryByRole("dialog")).toBeNull();
    // The face on the photo is the account's: read again once the dialog closes.
    expect(log).toContain("account.me");
    expect(heading()).toBe(TEAM_PHOTO);
  });
});

describe("a workspace being set up resumes from its data", () => {
  test("at the work, at its agent, at the plan, at the AI until it's answered, then the photo; never a second workspace", async () => {
    for (const [opts, title, saved] of [
      [{}, AREAS, []],
      [{ area: "support" }, "Iara, do atendimento", []],
      [
        { held: true, step: "agents", area: "support" },
        "O time da Acme começa com a Iara",
        [[ORG_ID, { step: "computer" }]],
      ],
      // Its agents already think: the AI step all the same, until it's kept as answered ("ai").
      [{ step: "agents", area: "support" }, AI, []],
      [{ step: "ai", area: "support" }, TEAM_PHOTO, []],
    ] as const) {
      const state = settingUp(opts);
      plans(PLANS);
      await open(state);
      expect({ opts, title: heading() }).toEqual({ opts, title });
      expect(calls(state, "orgs.create")).toEqual([]);
      expect(calls(state, "orgs.saveOnboarding").map((c) => c.args)).toEqual<typeof saved>(saved);
      cleanup();
    }
  });

  test("its agent made in another tab meanwhile: this one moves on to it when it comes back, making none", async () => {
    const state = settingUp();
    await open(state);
    expect(heading()).toBe(AREAS);
    madeFor(state, "tech");
    await refocus();
    expect(heading()).toBe("Ada, da tecnologia");
    expect(calls(state, "firstAgents.start")).toEqual([]);
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
    expect(heading()).toBe(AREAS);
    cleanup();

    const ready = settingUp({ step: "ai", area: "support" });
    const opening = createFakeApi(ready);
    const finish = opening.orgs.saveOnboarding;
    let refusals = 1;
    opening.orgs.saveOnboarding = async (orgId, input) => {
      if ("finished" in input && refusals-- > 0) throw broke();
      return finish(orgId, input);
    };
    const { router } = await renderApp("/onboarding", { api: opening });
    await settle(18);
    await click(button(/^Conhecer o workspace/), 16);
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(heading()).toBe(TEAM_PHOTO);
    await click(button(/^Conhecer o workspace/), 20);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${agentIdOf("support")}`);
  });

  test("asked to delete the workspace being set up: its dialog, and nothing is finished", async () => {
    const state = settingUp();
    await open(state, "/onboarding?delete=1", 10);
    expect(screen().getByRole("dialog")).toBeTruthy();
    expect(calls(state, "orgs.saveOnboarding")).toEqual([]);
  });
});

describe("the first question's other cases (ADR 0162)", () => {
  test("someone with another workspace leaves at any step, back to it; the one being made stays", async () => {
    const state = seedState({ agents: [] });
    const { router } = await open(state, "/onboarding", 10);
    const leave = () => document.querySelector<HTMLAnchorElement>(".onbw__top a");
    expect(leave()?.getAttribute("aria-label")).toBe("Voltar para Acme e terminar depois");
    expect(leave()?.getAttribute("href")).toBe(`/org/${ORG_ID}`);
    // On the name step nothing exists yet, and the way out is there; past it the workspace exists, the way out still.
    await click(answer(/Para meu time/), 4);
    await click(button(/^Continuar/), 8);
    expect(heading()).toBe(NAME);
    expect(leave()).not.toBeNull();
    await click(button(/^Continuar/), 16);
    expect(calls(state, "orgs.create")).toHaveLength(1);
    expect(heading()).toBe(AREAS);
    expect(leave()).not.toBeNull();
    await click(leave() as HTMLAnchorElement, 10);
    expect(router.state.location.pathname.startsWith(`/org/${ORG_ID}`)).toBe(true);
    expect(calls(state, "orgs.deleteWorkspace")).toEqual([]);
  });

  test("waiting for its plan elsewhere: said in place, with the way to that plan", async () => {
    const state = newcomer(true);
    const api = createFakeApi(state);
    api.orgs.create = async () => {
      throw new ApiError(403, "org.create_unpaid", "Waiting", { orgId: ORG_ID });
    };
    await renderApp("/onboarding", { api });
    await settle(10);
    // A team's: its name step, whose Continue is refused there.
    await click(button(/^Continuar/), 8);
    await click(button(/^Continuar/), 10);
    expect(heading()).toBe(NAME);
    expect(document.querySelector(".onb__status")?.textContent).toBeTruthy();
    expect(document.querySelector(".onb__answer .row button")).not.toBeNull();
  });

  test("invite-only: the step says so and Continuar stays off", async () => {
    const state = newcomer(false);
    if (state.me) state.me.user = { ...state.me.user, canCreateWorkspace: false };
    await open(state, "/onboarding", 10);
    await click(answer(/Para meu time/), 4);
    expect(continueOff()).toBe(true);
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
  test("one call makes it with both zones and its name; nobody is asked again for it", async () => {
    const state = newcomer(false);
    const { api, log } = recorded(createFakeApi(state));
    await renderApp("/onboarding", { api });
    await settle(10);
    await click(answer(/^Para mim(?!ha)/), 4);
    log.length = 0;
    await click(button(/^Continuar/), 16);
    expect(heading()).toBe(AREAS);
    expect(log[0]).toBe("orgs.create");
    // Its zones went with it and the answers said who the person is: none of them is asked on its own.
    expect(log.filter((c) => ["account.me", "orgs.updateSettings", "orgs.updateMe"].includes(c))).toEqual([]);
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
  const long = (state: FakeState) => {
    const org = state.me?.organizations[0];
    if (org) org.name = LONG;
    if (state.me) state.me.user = { ...state.me.user, name: PERSON };
    return state;
  };
  const languages = async (services: Rendered["services"]) => {
    for (const lang of ["de", "ru"] as const) await showIn(services, lang);
    await showIn(services, "pt-BR");
  };
  const closeDialog = async () => {
    await act(async () => fireEvent.keyDown(screen().getAllByRole("dialog").at(-1) as HTMLElement, { key: "Escape" }));
    await settle(4);
  };

  test("the first question, a team's name, the work, its agent and Other, with the longest names", async () => {
    const first = await open(newcomer(true, { name: PERSON }), "/onboarding", 10);
    expect(heading()).toBe(PURPOSE);
    await languages(first.services);
    // The name step with the longest name, its zone's selector open.
    await click(button(/^Continuar/), 8);
    expect(heading()).toBe(NAME);
    await type("Nome", LONG);
    await click(button("trocar"), 4);
    await languages(first.services);
    cleanup();

    const state = long(settingUp({ held: true }));
    state.connections = [connection("github", "maximiliana-bartolomeu-constantinopla-de-albuquerque")];
    plans(PLANS);
    const r = await open(state);
    expect(heading()).toBe(AREAS);
    await languages(r.services);
    await click(button("Trocar"), 4);
    snapshot();
    await closeDialog();
    await click(button(/Pedir à sua IA/), 12);
    await languages(r.services);
    await closeDialog();
    await click(area("Tecnologia"), 20);
    expect(heading()).toBe("Ada, da tecnologia");
    await languages(r.services);
    await click(button("Voltar"), 8);
    await click(area("Outro"), 10);
    expect(heading()).toBe(OTHER);
    await type("Nome", "Maximiliana Bartholomew-Fitz");
    await languages(r.services);
  });

  test("the plan, the AI step and the photo, with the same long names and a long plan", async () => {
    const state = noAiYet(long(settingUp({ held: true, billing: true, step: "agents", area: "support" })));
    plans({
      recommended: "team",
      plans: [{ key: "team", name: "Equipe Profissional Ilimitada Plus", price: "US$ 49,00 + impostos", people: 1284 }],
    });
    const r = await open(state, `/org/${ORG_ID}/onboarding?paid=1&plan=team`, 16);
    expect(heading()).toBe(`O time da ${LONG} começa com a Iara`);
    await languages(r.services);
    const org = state.me?.organizations[0];
    if (org) delete org.standing;
    await refocus();
    expect(heading()).toBe(AI);
    await languages(r.services);
    await click(button("Conectar depois"), 6);
    await click(within(screen().getByRole("dialog")).getByRole("button", { name: "Continuar sem IA" }), 16);
    expect(heading()).toBe(`Boas-vindas ao time da ${LONG}`);
    await languages(r.services);
  });

  test("a personal workspace's plan for its one agent", async () => {
    const state = long(settingUp({ held: true, step: "agents", personal: true, area: "freelance" }));
    plans(PLANS);
    const r = await open(state);
    expect(heading()).toBe("Os seus agentes começam com o Rui");
    await languages(r.services);
  });

  test("Not now's question and the photo with the plan still to sign, with the long names and a long plan", async () => {
    const state = long(settingUp({ held: true, step: "agents", area: "support" }));
    plans({
      recommended: "team",
      plans: [{ key: "team", name: "Equipe Profissional Ilimitada Plus", price: "US$ 49,00 + impostos", people: 1284 }],
    });
    const r = await open(state);
    // The plan step reads its plans again in each language: the question is asked in each one.
    for (const lang of ["de", "ru", "pt-BR"] as const) {
      await showIn(r.services, lang);
      await settle(8);
      await click(box().querySelector(".onbx__back--text") as HTMLElement, 6);
      snapshot();
      if (lang !== "pt-BR") await closeDialog();
    }
    expect(screen().getByRole("dialog", { name: "Continuar sem um plano?" })).toBeTruthy();
    await click(within(screen().getByRole("dialog")).getByRole("button", { name: "Continuar sem plano" }), 20);
    expect(heading()).toBe(`Boas-vindas ao time da ${LONG}`);
    await languages(r.services);
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
