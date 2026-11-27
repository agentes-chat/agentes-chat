import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, createEvent, fireEvent, within } from "@testing-library/react";
import { ATLAS_ID, createFakeApi, ENG_ID, GENERAL_ID, ORG_ID, seedDm, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/** Channels in sectors (ADR 0240): a sector shows its agents, a hairline, then its channels; Canais keeps the rest. */

afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const sheet of document.querySelectorAll("style[data-layout]")) sheet.remove();
});

type State = ReturnType<typeof seedState>;
const SUPPORT = "00000000-0000-4000-8000-0000000000f1";
const SALES = "00000000-0000-4000-8000-0000000000f2";
const DESIGN_ID = "00000000-0000-4000-8000-0000000000c3";
const ALERTS_ID = "00000000-0000-4000-8000-0000000000c4";

/**
 * Acme with the sectors Suporte (Atlas; #eng, #design and #alerts, 2 unread) and Vendas (no agent, no channel); #general
 * in none. Atlas wrote to me: 3 unread in our DM.
 */
function acme(): State {
  const state = seedState();
  state.agentGroups = [
    { id: SUPPORT, name: "Suporte", agentIds: [ATLAS_ID], color: "teal", icon: "chat" },
    { id: SALES, name: "Vendas", agentIds: [], color: "amber", icon: "person" },
  ];
  const eng = state.channels.find((c) => c.id === ENG_ID);
  if (!eng) throw new Error("no #eng");
  eng.groupId = SUPPORT;
  state.channels.push(
    { ...eng, id: DESIGN_ID, name: "design" },
    { ...eng, id: ALERTS_ID, name: "alerts", unreadCount: 2 },
  );
  seedDm(state, { type: "agent", id: ATLAS_ID }, { unread: 3 });
  return state;
}
const asMember = (state: State, createdOwn: string) => {
  const me = state.me;
  if (me?.organizations[0]) me.organizations[0].role = "member";
  for (const c of state.channels) c.createdByUserId = c.id === createdOwn ? me?.user.id : "u-joao";
  return state;
};
const go = async (state: State = acme(), { api = createFakeApi(state), channel = GENERAL_ID } = {}) => {
  const r = await renderApp(`/org/${ORG_ID}/c/${channel}`, { api });
  await settle(8);
  return { ...r, state };
};
const withLayout = async () => {
  const sheet = document.createElement("style");
  sheet.dataset.layout = "";
  sheet.textContent = await Bun.file(join(import.meta.dir, "../src/layout.css")).text();
  document.head.append(sheet);
};
const nav = () => screen().getByRole("navigation", { name: "Navegação do workspace" });
const section = (name: string) => {
  const toggle = within(nav()).getByRole("button", { name });
  const root = toggle.closest(".sidebar__section") as HTMLElement;
  return {
    toggle,
    root,
    head: root.querySelector(".sidebar__section-head") as HTMLElement,
    body: root.querySelector(".sidebar__section-body") as HTMLElement,
  };
};
/** A channel's row, in sight or not (a hidden one has no accessible name to find it by). */
const channel = (name: string) => {
  const row = nav().querySelector(`a.sidebar__item[title="#${name}"]`);
  if (!row) throw new Error(`no #${name} in the sidebar`);
  return row;
};
const shown = (el: Element) => {
  for (let e: Element | null = el; e; e = e.parentElement)
    if (window.getComputedStyle(e).display === "none") return false;
  return true;
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(3);
};
const places = (state: State) => state.calls.filter((c) => c.method === "chat.place").map((c) => c.args.slice(1));
const dataTransfer = { setData: () => {}, getData: () => "" };
/** Drags `from` over the top or bottom half of `to` (a 0-tall box here) and drops it there; the mark `to` got. */
const dragOnto = async (
  from: Element,
  to: Element,
  half: "top" | "bottom" = "top",
  marked: () => Element = () => to,
) => {
  await act(async () => fireEvent.dragStart(from, { dataTransfer }));
  // happy-dom's DragEvent is a plain Event: no clientY from the init.
  const over = createEvent.dragOver(to, { dataTransfer });
  Object.defineProperty(over, "clientY", { value: half === "top" ? 0 : 1 });
  await act(async () => fireEvent(to, over));
  const mark = marked().getAttribute("data-drop");
  await act(async () => fireEvent.drop(to, { dataTransfer }));
  await settle(3);
  return mark;
};
const rightClick = async (el: Element) => {
  await act(async () => fireEvent.contextMenu(el));
  await settle(2);
  return screen().getByRole("menu");
};

describe("a sector in the sidebar", () => {
  test("shows its agents, a hairline, then its channels; a channel in no sector stays in Canais", async () => {
    await go();
    const { body } = section("Suporte");
    const kids = [...body.children].map((el) =>
      el.matches("hr")
        ? el.className
        : (el.querySelector(".sidebar__item-label") ?? el).textContent?.replace(/Atlas.*/, "Atlas"),
    );
    expect(kids).toEqual(["Atlas", "sidebar__sector-line", "eng", "design", "alerts"]);
    expect(section("Canais").body.contains(channel("general"))).toBe(true);
    expect(section("Canais").body.contains(channel("eng"))).toBe(false);
    // Its mark is the sector's own color, not one gray for all.
    expect(section("Suporte").toggle.querySelector(".ac-rolemark")).not.toBeNull();
  });

  test("with the workspace's Canais antes dos agentes: its channels, the hairline, then its agents", async () => {
    const state = acme();
    state.sectorChannelsFirst = true;
    await go(state);
    const { body } = section("Suporte");
    const kids = [...body.children].map((el) =>
      el.matches("hr")
        ? el.className
        : (el.querySelector(".sidebar__item-label") ?? el).textContent?.replace(/Atlas.*/, "Atlas"),
    );
    expect(kids).toEqual(["eng", "design", "alerts", "sidebar__sector-line", "Atlas"]);
  });

  test("closed, it keeps the unread channels and who wrote to me, and one count adds up its DMs and channels", async () => {
    await withLayout();
    await go();
    const { toggle, head } = section("Suporte");
    expect(head.querySelector(".sidebar__section-count")?.textContent).toBe("1");
    await click(toggle);
    expect(shown(channel("alerts"))).toBe(true);
    expect(shown(channel("eng"))).toBe(false);
    expect(shown(channel("design"))).toBe(false);
    expect(shown(within(nav()).getByRole("link", { name: /^Atlas/ }))).toBe(true);
    // Atlas's 3 and #alerts' 2, in place of how many agents it has.
    expect(within(head).getByRole("img", { name: "5 mensagens não lidas" })).toBeTruthy();
    expect(head.querySelector(".sidebar__section-count")).toBeNull();
  });

  test("an empty sector shows to who arranges, to drop agents or channels in; never to a member", async () => {
    await go();
    expect(section("Vendas").body.textContent).toContain("Arraste agentes ou canais para cá");
    cleanup();
    await go(asMember(acme(), GENERAL_ID));
    expect(within(nav()).queryByRole("button", { name: "Vendas" })).toBeNull();
  });
});

describe("moving a channel between sectors", () => {
  test("its right click: Mudar de setor, its own sector dimmed, then Novo setor com #canal", async () => {
    const { state } = await go();
    const menu = await rightClick(channel("eng"));
    expect(within(menu).getByText("Mudar de setor")).toBeTruthy();
    const item = (name: string) => within(menu).getByRole("menuitem", { name });
    expect(item("Suporte").hasAttribute("data-disabled")).toBe(true);
    expect(item("Sem setor").hasAttribute("data-disabled")).toBe(false);
    expect(item("Novo setor com #eng")).toBeTruthy();
    await click(item("Vendas"));
    expect(places(state)).toEqual([[ENG_ID, { groupId: SALES }]]);
    expect(section("Vendas").body.contains(channel("eng"))).toBe(true);
    expect(document.body.textContent).toContain("#eng foi para o setor Vendas");
  });

  test("Novo setor com #canal makes the sector with the channel in it", async () => {
    const { state } = await go();
    await click(
      within(await rightClick(channel("general"))).getByRole("menuitem", { name: "Novo setor com #general" }),
    );
    const dialog = screen().getByRole("dialog", { name: "Novo setor" });
    await act(async () => fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Geral" } }));
    await click(within(dialog).getByRole("button", { name: "Criar setor" }));
    await settle(4);
    const made = state.calls.filter((c) => c.method === "agentGroups.create").map((c) => c.args[1]);
    expect(made).toEqual([expect.objectContaining({ name: "Geral", channelIds: [GENERAL_ID] })]);
    expect(section("Geral").body.contains(channel("general"))).toBe(true);
  });

  test("a member moves only the channels they created, and makes no sector", async () => {
    await go(asMember(acme(), DESIGN_ID));
    let menu = await rightClick(channel("design"));
    expect(within(menu).getByRole("menuitem", { name: "Sem setor" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Novo setor com #design" })).toBeNull();
    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));
    await settle(2);
    menu = await rightClick(channel("eng"));
    expect(within(menu).queryByText("Mudar de setor")).toBeNull();
    expect(channel("eng").getAttribute("draggable")).toBe("false");
    expect(channel("design").getAttribute("draggable")).toBe("true");
  });

  test("dragged onto a sector's header it goes in; out to Canais it leaves; within a sector it takes its place", async () => {
    const { state } = await go();
    expect(await dragOnto(channel("general"), section("Vendas").head)).toBe("into");
    expect(places(state)).toEqual([[GENERAL_ID, { groupId: SALES }]]);
    expect(section("Vendas").body.contains(channel("general"))).toBe(true);

    expect(await dragOnto(channel("eng"), section("Canais").body, "top", () => section("Canais").root)).toBe("into");
    expect(places(state).at(-1)).toEqual([ENG_ID, { groupId: null }]);
    expect(section("Canais").body.contains(channel("eng"))).toBe(true);

    expect(await dragOnto(channel("alerts"), channel("design"), "top")).toBe("before");
    expect(places(state).at(-1)).toEqual([ALERTS_ID, { groupId: SUPPORT, beforeChannelId: DESIGN_ID }]);
  });

  test("onto its own sector it stays put; nothing drags until the sectors load", async () => {
    const { state } = await go();
    expect(await dragOnto(channel("eng"), section("Suporte").head)).toBeNull();
    expect(places(state)).toEqual([]);
    cleanup();
    const waiting = acme();
    const api = createFakeApi(waiting);
    api.agentGroups.list = () => new Promise(() => {});
    await go(waiting, { api });
    expect(channel("general").getAttribute("draggable")).toBe("false");
  });

  test("a move made elsewhere shows live (channels.layout)", async () => {
    const state = acme();
    const api = createFakeApi(state);
    // A new list on each read, as the server sends: the fake's own array would read as unchanged.
    const read = api.chat.channels;
    api.chat.channels = async (...args) => structuredClone(await read(...args));
    const { sockets } = await go(state, { api });
    await act(async () => sockets.last().open());
    await settle(2);
    const eng = state.channels.find((c) => c.id === ENG_ID);
    if (eng) eng.groupId = SALES;
    await act(async () => sockets.last().push({ type: "event", scope: "org", event: { type: "channels.layout" } }));
    await settle(6);
    expect(section("Vendas").body.contains(channel("eng"))).toBe(true);
  });
});

describe("Criar canal", () => {
  test("picks the sector the channel starts in", async () => {
    const { state } = await go();
    const plus = within(nav()).getByRole("button", { name: "Novo canal" });
    await act(async () => {
      fireEvent.keyDown(plus, { key: "Enter" });
      fireEvent.keyUp(plus, { key: "Enter" });
    });
    await settle(2);
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Novo canal" }));
    const dialog = screen().getByRole("dialog", { name: "Criar canal" });
    await act(async () => fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "vendas" } }));
    const picker = within(dialog).getByRole("combobox", { name: "Setor" });
    picker.focus();
    await act(async () => fireEvent.keyDown(picker, { key: "Enter" }));
    await click(screen().getByRole("option", { name: "Vendas" }));
    await click(within(dialog).getByRole("button", { name: "Criar #vendas" }));
    await settle(6);
    const made = state.calls.filter((c) => c.method === "chat.createChannel").map((c) => c.args[1]);
    expect(made).toEqual([expect.objectContaining({ name: "vendas", groupId: SALES })]);
  });
});
