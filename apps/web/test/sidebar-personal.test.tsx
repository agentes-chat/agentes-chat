import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { COMPACT_QUERY } from "@/components/NavDrawer";
import { toggleSidebar } from "@/components/Sidebar";
import { ADA_ID, createFakeApi, ENG_ID, meWithRole, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/* A personal workspace's sidebar (ADR 0159): the person on top, the agents with no header and New agent under them,
   group conversations, people only when there are some, and direct access to Home and Tools. */

/** A narrow screen: only the query for the behavior under test matches. */
let media: { mockRestore: () => void } | null = null;
let sidebarCollapsed = false;
const narrowScreen = (query = "(max-width: 959px)") => {
  media = spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        matches: q === query,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
};

afterEach(() => {
  media?.mockRestore();
  media = null;
  cleanup();
  if (sidebarCollapsed) toggleSidebar();
  sidebarCollapsed = false;
  localStorage.clear();
  sessionStorage.clear();
});

type State = ReturnType<typeof seedState>;
/** Acme as a personal workspace, nothing waiting for me; `alone`: João isn't a member. */
const personal = ({ alone = false }: { alone?: boolean } = {}) => {
  const state = seedState();
  const org = state.me?.organizations[0];
  if (org) org.mode = "personal";
  for (const a of state.approvals) a.status = "approved";
  for (const p of state.proposals) p.status = "accepted";
  if (alone) state.members = state.members.filter((m) => m.userId === state.me?.user.id);
  return state;
};
const go = async (state: State, path = `c/${ENG_ID}`) => {
  await renderApp(`/org/${ORG_ID}/${path}`, { api: createFakeApi(state) });
  await settle(8);
  return state;
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(3);
};
const nav = () => document.getElementById("app-nav") as HTMLElement;
const top = () => nav().querySelector(".sidebar__top") as HTMLElement;
const collapse = async () => {
  await click(within(nav()).getByRole("button", { name: "Minimizar barra lateral" }));
  sidebarCollapsed = true;
};
const openCreate = async () => {
  const button = within(nav()).getByRole("button", { name: "Criar" });
  button.focus();
  await act(async () => fireEvent.keyDown(button, { key: "Enter" }));
  await settle(3);
  return within(screen().getByRole("menu", { name: "Criar" }));
};
const blocks = () => [...nav().querySelectorAll<HTMLElement>(".sidebar__block")].map((b) => b.dataset.section);
const channelRows = () =>
  [...nav().querySelectorAll('.sidebar__item[data-kind="channel"] .sidebar__item-label')].map((l) => l.textContent);

describe("a personal workspace's sidebar", () => {
  test("me on top with the bell beside me, and no foot", async () => {
    await go(personal());
    const me = within(top()).getByRole("button", { name: /^Conta: / });
    expect(me.textContent).toContain("Walter");
    // My row, not the workspace's: my name wraps whole there, never cut.
    expect(me.classList.contains("sidebar__org-button--me")).toBe(true);
    expect(within(top()).getByRole("link", { name: "Notificações" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/notifications`,
    );
    expect(within(top()).queryByRole("button", { name: /Menu do workspace/ })).toBeNull();
    expect(nav().querySelector(".sidebar__foot")).toBeNull();
    expect(nav().querySelectorAll(".sidebar__bell")).toHaveLength(1);
  });

  test("my menu opens down with my account, About you and my workspaces in it", async () => {
    await go(personal());
    const me = within(top()).getByRole("button", { name: /^Conta: / });
    me.focus();
    await act(async () => {
      fireEvent.keyDown(me, { key: "Enter" });
      fireEvent.keyUp(me, { key: "Enter" });
    });
    await settle(3);
    const menu = screen().getAllByRole("menu")[0] as HTMLElement;
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.getAttribute("aria-label") ?? el.textContent),
    ).toEqual([
      // My face on top changes my photo.
      "Trocar foto",
      "Definir status",
      "Editar perfil",
      "Sua conta",
      "Sobre você",
      // A personal workspace of mine is me: my face (its initial here) and my name, never the workspace's.
      "WWalterVocê está aqui",
      "Novo workspace",
      // Another account beside this one (ADR 0183).
      "Adicionar contaEntrar com outra conta sem sair desta",
      "Sair",
    ]);
    expect(menu.textContent).toContain("Seus workspaces");
    await click(within(menu).getByRole("menuitem", { name: "Sobre você" }));
    expect(screen().getByRole("heading", { level: 2, name: "Sobre você" })).toBeTruthy();
  });

  test("Home is always in sight and Tools lists every tool in its group", async () => {
    await go(personal());
    const home = within(nav()).getByRole("link", { name: "Início" });
    expect(home.getAttribute("href")).toBe(`/org/${ORG_ID}/home`);
    expect(home.getAttribute("title")).toBe("O seu dia: o que espera você e o que os seus agentes estão fazendo");
    expect(home.closest(".sidebar__top")).toBe(top());
    expect(home.closest(".sidebar__scroll")).toBeNull();
    expect(within(top()).getByRole("button", { name: "Atividade" }).textContent).toContain("Atividade");
    expect(nav().querySelector(".sidebar__jump")).toBeNull();
    await click(within(nav()).getByRole("button", { name: "Ferramentas" }));
    const menu = screen().getByRole("dialog", { name: "Ferramentas" });
    const links = within(menu).getAllByRole("link");
    const names = links.map((link) => link.querySelector(".sidebar__catalog-title > span")?.textContent);
    expect(names).toEqual([
      "Esperando você",
      "Aprovações",
      "Propostas de melhoria",
      "Rotinas",
      "Drive",
      "Calendário",
      "Tarefas",
      "Threads",
      "Equipe",
      "Wiki",
      "Painéis",
      "Gerenciador de tarefas",
    ]);
    const descriptions = links.map((link) => link.querySelector(".ac-menu__desc")?.textContent);
    expect(descriptions.every(Boolean)).toBe(true);
    expect(descriptions).toContain("O que seus agentes pedem para você liberar");
    expect(descriptions).toContain("Arquivos, relatórios e tabelas");
    expect(within(menu).getByRole("button", { name: /Ir para…/ })).toBeTruthy();
    expect(within(menu).getByRole("region", { name: "Organização" }).textContent).toContain("Tarefas");
  });

  test("on a phone, closing Customize sidebar returns focus to Tools in the open navigation drawer", async () => {
    narrowScreen(COMPACT_QUERY);
    await go(personal(), "home");
    const openDrawer = screen().getByRole("button", { name: "Abrir menu" });
    await click(openDrawer);
    const tools = within(nav()).getByRole("button", { name: "Ferramentas" });

    tools.focus();
    await click(tools);
    const catalog = within(screen().getByRole("dialog", { name: "Ferramentas" }));
    const customize = catalog.getByRole("button", { name: "Personalizar a barra lateral" });
    customize.focus();
    await click(customize);
    const dialog = within(screen().getByRole("dialog", { name: "Personalizar a barra lateral" }));
    const choice = within(dialog.getByRole("radiogroup", { name: "Aprovações" })).getByRole("radio", {
      name: "Quando tiver algo",
    });
    choice.focus();
    await act(async () => fireEvent.keyDown(choice, { key: "Escape" }));
    await settle(3);

    expect(screen().queryByRole("dialog", { name: "Personalizar a barra lateral" })).toBeNull();
    expect(openDrawer.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement === tools).toBe(true);
  });

  test("on a phone, dismissing Go to returns focus to Tools in the open navigation drawer", async () => {
    narrowScreen(COMPACT_QUERY);
    await go(personal(), "home");
    const openDrawer = screen().getByRole("button", { name: "Abrir menu" });
    await click(openDrawer);
    const tools = within(nav()).getByRole("button", { name: "Ferramentas" });
    tools.focus();
    await click(tools);
    const catalog = within(screen().getByRole("dialog", { name: "Ferramentas" }));
    const jump = catalog.getByRole("button", { name: "Ir para…" });
    jump.focus();
    await click(jump);

    const name = "Ir para, ou pedir a um agente";
    const input = screen().getByRole("combobox", { name });
    expect(document.activeElement === input).toBe(true);
    await act(async () => fireEvent.keyDown(input, { key: "Escape" }));
    await settle(3);

    expect(screen().queryByRole("dialog", { name })).toBeNull();
    expect(openDrawer.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement === tools).toBe(true);
  });

  test("pinning and removing a tool stays in sync with Customize sidebar in both directions", async () => {
    const state = await go(personal());
    const openTools = async () => {
      await click(within(nav()).getByRole("button", { name: "Ferramentas" }));
      return within(screen().getByRole("dialog", { name: "Ferramentas" }));
    };
    const catalog = await openTools();
    const pin = catalog.getByRole("button", { name: "Fixar Drive no acesso rápido" });
    pin.focus();
    await click(pin);
    expect(catalog.getByRole("link", { name: /^Drive\b/ })).toBeTruthy();
    expect(within(nav()).getByRole("link", { name: "Drive" })).toBeTruthy();
    expect(catalog.getByRole("button", { name: "Remover Drive do acesso rápido" })).toBe(pin);
    expect(document.activeElement === pin).toBe(true);

    await click(catalog.getByRole("button", { name: "Personalizar a barra lateral" }));
    const customize = within(screen().getByRole("dialog", { name: "Personalizar a barra lateral" }));
    const drive = within(customize.getByRole("radiogroup", { name: "Drive" }));
    expect(drive.getByRole("radio", { name: "No acesso rápido" }).getAttribute("aria-checked")).toBe("true");
    await click(drive.getByRole("radio", { name: "Só em Ferramentas" }));
    await click(customize.getByRole("button", { name: "Fechar" }));
    const reopened = await openTools();
    expect(Boolean(within(nav()).queryByRole("link", { name: "Drive" }))).toBe(false);
    await click(reopened.getByRole("button", { name: "Fixar Drive no acesso rápido" }));
    await click(reopened.getByRole("button", { name: "Remover Drive do acesso rápido" }));
    expect(Boolean(within(nav()).queryByRole("link", { name: "Drive" }))).toBe(false);
    expect(reopened.getByRole("link", { name: /^Drive\b/ })).toBeTruthy();
    expect(
      state.calls.filter((call) => call.method === "orgs.setSidebarItem").map((call) => call.args.slice(1)),
    ).toEqual([
      ["drive", "always"],
      ["drive", null],
      ["drive", "always"],
      ["drive", null],
    ]);
  });

  test("opening Customize sidebar while a pin is saving keeps the optimistic choice", async () => {
    const api = createFakeApi(personal());
    const write = api.orgs.setSidebarItem;
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    api.orgs.setSidebarItem = async (...args) => {
      await pending;
      return write(...args);
    };
    await renderApp(`/org/${ORG_ID}/home`, { api });
    await settle(8);
    try {
      await click(within(nav()).getByRole("button", { name: "Ferramentas" }));
      const tools = within(screen().getByRole("dialog", { name: "Ferramentas" }));
      await click(tools.getByRole("button", { name: "Fixar Drive no acesso rápido" }));
      expect(within(nav()).getByRole("link", { name: "Drive" })).toBeTruthy();
      await click(tools.getByRole("button", { name: "Personalizar a barra lateral" }));
      const setup = within(screen().getByRole("dialog", { name: "Personalizar a barra lateral" }));
      const drive = within(setup.getByRole("radiogroup", { name: "Drive" }));
      expect(drive.getByRole("radio", { name: "No acesso rápido", checked: true })).toBeTruthy();
    } finally {
      await act(async () => finish());
      await settle(3);
    }
  });

  for (const platform of ["windows", "linux", "mac"] as const) {
    test(`Activity has one entry point in a personal workspace on ${platform}`, async () => {
      const desktop = window as { __agentesDesktop?: unknown; __TAURI_INTERNALS__?: unknown };
      desktop.__agentesDesktop = { platform };
      desktop.__TAURI_INTERNALS__ = { invoke: async () => ({ orgs: [] }) };
      try {
        await go(personal(), "home");
        const activity = screen().getByRole("button", { name: "Atividade" });
        expect(Boolean(activity.closest(".titlebar"))).toBe(platform === "mac");
        expect(Boolean(activity.closest("#app-nav"))).toBe(platform !== "mac");
      } finally {
        delete desktop.__agentesDesktop;
        delete desktop.__TAURI_INTERNALS__;
      }
    });
  }

  test("Aprovações comes into sight while something waits", async () => {
    const state = personal();
    const first = state.approvals[0];
    if (first) first.status = "pending";
    await go(state);
    const rows = [...nav().querySelectorAll(".sidebar__tools .sidebar__item-label")].map((l) => l.textContent);
    expect(rows).toEqual(["Aprovações"]);
  });

  for (const collapsed of [false, true]) {
    test(`the Settings shortcut opens Your account in the ${collapsed ? "collapsed" : "expanded"} sidebar`, async () => {
      await go(personal());
      if (collapsed) await collapse();
      const shortcut = within(nav()).getByRole("link", { name: "Configurações" });
      expect(shortcut.getAttribute("href")).toBe(`/org/${ORG_ID}/settings/account`);
      await click(shortcut);
      expect(screen().getByRole("heading", { name: "Sua conta" })).toBeTruthy();
      expect(within(nav()).getByRole("link", { name: "Configurações" }).getAttribute("aria-current")).toBe("page");
    });
  }

  test("the collapsed sidebar offers one Create menu even before the first group conversation", async () => {
    const state = withRightHand(personal({ alone: true }));
    state.channels = state.channels.filter((c) => c.name === "general");
    await go(state, `dm/agent/${ADA_ID}`);
    expect(Boolean(within(nav()).queryByRole("button", { name: "Criar" }))).toBe(false);
    await collapse();
    expect(nav().querySelectorAll(".sidebar__new-channel, .sidebar__create")).toHaveLength(0);
    const menu = await openCreate();
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Novo agente",
      "Nova conversa em grupo",
    ]);
    await click(menu.getByRole("menuitem", { name: "Nova conversa em grupo" }));
    const dialog = screen().getByRole("dialog", { name: "Nova conversa em grupo" });
    await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
    await settle(3);
    expect(screen().queryByRole("dialog", { name: "Nova conversa em grupo" })).toBeNull();
    expect(document.activeElement === within(nav()).getByRole("button", { name: "Criar" })).toBe(true);
  });

  test("Create opens the new agent flow and regains focus when it closes", async () => {
    await go(withRightHand(personal()));
    await collapse();
    const menu = await openCreate();
    const item = menu.getByRole("menuitem", { name: "Novo agente" });
    item.focus();
    await click(item);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
    await settle(3);
    expect(screen().queryByRole("dialog", { name: "Novo agente" })).toBeNull();
    expect(document.activeElement === within(nav()).getByRole("button", { name: "Criar" })).toBe(true);
  });

  for (const allowed of ["create_agents", "create_channels", null] as const) {
    test(`Create respects the resolved permissions (${allowed ?? "none"})`, async () => {
      const state = personal();
      meWithRole(state, allowed ? [allowed] : []);
      const everyone = state.roles?.find((role) => role.kind === "everyone");
      if (everyone)
        everyone.permissions = everyone.permissions.filter((permission) => permission !== "create_channels");
      await go(state);
      await collapse();
      if (!allowed) {
        expect(Boolean(within(nav()).queryByRole("button", { name: "Criar" }))).toBe(false);
        return;
      }
      const menu = await openCreate();
      expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        allowed === "create_agents" ? "Novo agente" : "Nova conversa em grupo",
      ]);
    });
  }

  test("the agents have no header; New agent sits right under them and opens the new agent's card (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    expect(agents.querySelector(".sidebar__section-toggle")).toBeNull();
    const rows = [...agents.querySelectorAll(".sidebar__item")];
    const last = rows.at(-1) as HTMLElement;
    expect(last.classList.contains("sidebar__new-agent")).toBe(true);
    expect(last.textContent).toBe("Novo agente");
    await click(last);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    // From scratch first, then the personal starters; Clara picked, introducing herself on her card.
    const options = within(dialog).getAllByRole("option");
    expect(options[0]?.textContent).toContain("Do zero");
    // Each row's face stands beside its two lines, the name's capitals at its top (never centred on both).
    for (const option of options) {
      expect(option.classList.contains("ac-faceline")).toBe(true);
      expect(option.querySelector(".tp-gallery__text > b.ac-captop")).toBeTruthy();
    }
    expect(within(dialog).getByRole("option", { name: /Clara/ }).getAttribute("aria-selected")).toBe("true");
    expect((within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement).value).toBe("Clara");
    expect(dialog.textContent).toContain("Oi, eu sou a");
    // "Vai usar" holds only what is connected here (GitHub), at write; her starter's apps wait for the chat.
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(within(uses).getByRole("button", { name: /GitHub/ }).textContent).toContain("Lê e escreve");
    expect(uses.textContent).not.toContain("Todoist");
    // How she works: her own instructions, editable in place; the first tasks stay in the chat.
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    expect(how.value).toContain("Confere a agenda toda manhã");
    expect(dialog.textContent).not.toContain("Para começar, peça");
    // The footer's start: the import, always in sight.
    expect(within(dialog).getByRole("button", { name: /Trazer agentes de outro app/ })).toBeTruthy();
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    const made = state.calls.find((c) => c.method === "agents.create");
    expect(made).toBeTruthy();
    const input = made?.args[1] as {
      name: string;
      instructions: string;
      setup: { starter?: string; hello?: string; apps?: object };
    };
    expect(input.name).toBe("Clara");
    expect(input.instructions).toContain("Confere a agenda toda manhã");
    expect(input.setup.starter).toBe("clara");
    expect(input.setup.hello).toContain("agenda");
    // The checklist suggests her starter's apps not connected yet, and keeps the card's (ADR 0164).
    expect(input.setup.apps).toMatchObject({ "google-calendar": "write", todoist: "write", github: "write" });
  });

  test("the agent being made never reads as taken: its @ stays the one shown, though the list has it before Criar is answered", async () => {
    const state = withRightHand(personal());
    const api = createFakeApi(state);
    const make = api.agents.create;
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    api.agents.create = async (...args) => {
      const made = await make(...args);
      await answered;
      return made;
    };
    const { sockets } = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(8);
    await act(async () => sockets.last().open());
    await settle(2);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    const handle = () => dialog.querySelector(".nac__handle")?.textContent;
    const shown = handle();
    expect(shown).toContain("No chat: @clara");
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    // Made on the server, which says so on the socket before it answers.
    await act(async () => sockets.last().push({ type: "event", scope: "org", event: { type: "agents.changed" } }));
    await settle(6);
    expect(agents.textContent).toContain("Clara");
    expect(handle()).toBe(shown);
    await act(async () => answer());
    await settle(6);
  });

  test("how it works is edited on the card; its helpers add a line and the cursor goes after it (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getByRole("region", { name: "Como a Clara trabalha" })).toBeTruthy();
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(how, { target: { value: "Só lembra, nunca marca." } }));
    await click(within(dialog).getByRole("button", { name: "O que evitar" }));
    expect(how.value).toBe("Só lembra, nunca marca.\nEvite: ");
    expect(how.selectionStart).toBe(how.value.length);
    // Enter in it is a new line, not Create.
    await act(async () => fireEvent.keyDown(how, { key: "Enter" }));
    expect(state.calls.some((c) => c.method === "agents.create")).toBe(false);
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as { instructions: string };
    expect(input.instructions).toBe("Só lembra, nunca marca.\nEvite:");
  });

  test("Outro app: the catalog in a dialog, the starter's apps on top; Usar puts a connected one on the card", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    await click(within(dialog).getByRole("option", { name: /Gabi/ }));
    // Taken off the card, GitHub is one click away again.
    await click(within(dialog).getByRole("button", { name: /GitHub/ }));
    await click(screen().getByRole("button", { name: "Tirar GitHub" }));
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(uses.textContent).toContain("Nada por enquanto.");
    await click(within(uses).getByRole("button", { name: "Escolher apps" }));
    const picker = screen().getByRole("dialog", { name: /Apps d[ao] Gabi/ });
    const suggested = within(picker).getByRole("region", { name: /Sugeridos para/ });
    expect(suggested.textContent).toContain("Notion");
    expect(within(suggested).getByRole("button", { name: "Conectar" })).toBeTruthy();
    const connected = within(picker).getByRole("region", { name: "Conectados" });
    await click(within(connected).getByRole("button", { name: "Usar" }));
    expect(within(connected).queryByRole("button", { name: "Usar" })).toBeNull();
    expect(connected.textContent).toContain("No cartão");
    // On the card under the picker (hidden from the accessibility tree while the picker is open).
    expect(uses.textContent).toContain("GitHub");
    // An app not connected yet runs the usual flow from here, and the card waits for the provider's way back.
    await click(within(suggested).getByRole("button", { name: "Conectar" }));
    expect(screen().getByRole("dialog", { name: /Notion/ })).toBeTruthy();
    const saved = JSON.parse(sessionStorage.getItem("agentes:new-agent") ?? "null") as { sel: string; pending: string };
    expect(saved).toMatchObject({ sel: "gabi", pending: "notion" });
  });

  test("on a narrow screen, two steps: a row opens its card, Back keeps every edit, Create is the card's (ADR 0164)", async () => {
    narrowScreen();
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    // Step 1, the list: no card and no Create; the import stays at the footer's start.
    let dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getAllByRole("option")[0]?.textContent).toContain("Do zero");
    expect(within(dialog).queryByRole("textbox", { name: "Nome" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Criar/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Trazer agentes de outro app/ })).toBeTruthy();
    // It opens the import over the dialog, which stays as it was: nothing goes to Settings.
    const here = window.location.pathname;
    await click(within(dialog).getByRole("button", { name: /Trazer agentes de outro app/ }));
    const bring = await screen().findByRole("dialog", { name: "Trazer agentes de outro app" });
    expect(within(bring).getByRole("group", { name: "De onde vêm os agentes" })).toBeTruthy();
    expect(window.location.pathname).toBe(here);
    await click(within(bring).getByRole("button", { name: "Fechar" }));
    dialog = screen().getByRole("dialog", { name: "Novo agente" });
    // A row leads to its card, titled with its name, a back arrow before it.
    await click(within(dialog).getByRole("option", { name: /Gabi/ }));
    dialog = screen().getByRole("dialog", { name: "Gabi" });
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    const nameField = within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement;
    expect(nameField.value).toBe("Gabi");
    await act(async () => fireEvent.change(nameField, { target: { value: "Gabriela" } }));
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(how, { target: { value: "Só perguntas." } }));
    // Back: the list, with the pick and the edits kept.
    await click(within(dialog).getByRole("button", { name: "Voltar" }));
    dialog = screen().getByRole("dialog", { name: "Novo agente" });
    const row = within(dialog).getByRole("option", { name: /Gabriela/ });
    expect(row.getAttribute("aria-selected")).toBe("true");
    await click(row);
    dialog = screen().getByRole("dialog", { name: "Gabriela" });
    expect((within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement).value).toBe(
      "Só perguntas.",
    );
    // Create: the card's one button, at the sheet's width.
    const create = within(dialog).getByRole("button", { name: /Criar Gabriela/ });
    expect(within(dialog).queryByRole("button", { name: "Cancelar" })).toBeNull();
    await click(create);
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as {
      name: string;
      instructions: string;
    };
    expect(input).toMatchObject({ name: "Gabriela", instructions: "Só perguntas." });
  });

  test("back from connecting an app on the provider's page, the card opens as it was, the app on it", async () => {
    const state = withRightHand(personal());
    const draft = {
      name: "Gabi",
      what: "Monto o seu plano de estudos.",
      look: { color: "sky", eyes: "round", accessory: "none" },
      apps: {},
      skills: null,
      instructions: "Só perguntas, nunca respostas.",
    };
    sessionStorage.setItem(
      "agentes:new-agent",
      JSON.stringify({
        org: ORG_ID,
        at: Date.now(),
        channelId: null,
        sel: "gabi",
        drafts: { gabi: draft },
        pending: "notion",
      }),
    );
    window.history.replaceState(
      null,
      "",
      `/org/${ORG_ID}/c/${ENG_ID}?newAgent=resume&connected=notion&outcome=connected`,
    );
    await go(state);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getByRole("option", { name: /Gabi/ }).getAttribute("aria-selected")).toBe("true");
    expect((within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement).value).toBe(
      "Só perguntas, nunca respostas.",
    );
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(within(uses).getByRole("button", { name: /Notion/ }).textContent).toContain("Lê e escreve");
    // Its parameters leave the address, and nothing waits any more.
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("agentes:new-agent")).toBeNull();
  });

  test("from scratch, the card asks what it will do and offers names that fit it (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    await click(within(dialog).getByRole("option", { name: /Do zero/ }));
    const create = within(dialog).getByRole("button", { name: /Criar agente/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const what = within(dialog).getByRole("textbox", { name: "O que faz" });
    await act(async () => fireEvent.change(what, { target: { value: "Cuidar da agenda do consultório" } }));
    await settle(2);
    // An agenda's names; one of them picked becomes its name.
    const idea = within(dialog).getByRole("button", { name: "Lia" });
    await click(idea);
    expect((within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement).value).toBe("Lia");
    await click(within(dialog).getByRole("button", { name: /Criar Lia/ }));
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as {
      instructions: string;
      setup: { role: null; hello?: string };
    };
    expect(input.instructions).toBe("Cuidar da agenda do consultório");
    expect(input.setup).toMatchObject({ role: null, hello: "Cuidar da agenda do consultório" });
  });

  test("the agents come first; channels are Conversas em grupo; with someone else in, people and #general show", async () => {
    await go(personal());
    expect(blocks()).toEqual(["agents", "channels", "people"]);
    const toggles = [...nav().querySelectorAll(".sidebar__section-toggle")].map((b) => b.textContent);
    expect(toggles).toContain("Conversas em grupo");
    expect(toggles).toContain("Mensagens diretas");
    expect(channelRows()).toContain("general");
  });

  test("alone: no people and no #general; the channels show while there is another one", async () => {
    await go(personal({ alone: true }));
    expect(blocks()).toEqual(["agents", "channels"]);
    expect(channelRows()).toEqual(["eng"]);
  });

  test("alone with only #general: Conversas em grupo holds one row, which creates the first", async () => {
    const state = personal({ alone: true });
    state.channels = state.channels.filter((c) => c.name === "general");
    await go(state, `dm/agent/${ADA_ID}`);
    expect(blocks()).toEqual(["agents", "channels"]);
    expect(channelRows()).toEqual([]);
    await click(within(nav()).getByRole("button", { name: "Nova conversa em grupo" }));
    expect(screen().getByRole("dialog", { name: "Nova conversa em grupo" })).toBeTruthy();
  });

  test("with a group conversation in the list the row is gone: the header's + creates the next", async () => {
    await go(personal({ alone: true }));
    expect(channelRows()).toEqual(["eng"]);
    expect(nav().querySelector(".sidebar__new-channel")).toBeNull();
  });

  test("a team's sidebar is as before: the workspace on top, ⌘K under it, me and the bell at the foot", async () => {
    await go(seedState());
    expect(nav().querySelector(".sidebar__end")).toBeNull();
    expect(nav().querySelector(".sidebar__jump")).not.toBeNull();
    expect(nav().querySelector(".sidebar__foot .sidebar__bell")).not.toBeNull();
    expect(blocks()).toEqual(["tools", "channels", "agents", "people"]);
  });
});
