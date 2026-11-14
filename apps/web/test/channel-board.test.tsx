import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { Channel } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { CHANNEL_BOARD_NARROW_QUERY, CHANNEL_BOARD_WIDE_QUERY } from "@/hooks/useMembersColumn";
import { STORAGE_KEYS } from "@/lib/storage";
import { ATLAS_ID, createFakeApi, ENG_ID, type FakeState, fakeDashboardsOf, ORG_ID, seedState } from "./fake-api";
import type { FakeDashboards } from "./fakes/dashboards";
import { renderApp, screen, settle } from "./render";

let media: { mockRestore: () => void } | null = null;
/** Only `query` matches. */
const widthIs = (query: string) => {
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
  cleanup();
  media?.mockRestore();
  media = null;
  localStorage.clear();
});

const KEY = `${STORAGE_KEYS.channelBoard}.u-walter.${ORG_ID}`;
const click = (el: Element) => act(async () => fireEvent.click(el));
const toggle = () => screen().queryByRole("button", { name: "Painel do canal" });
const column = () => screen().queryByRole("complementary", { name: "Painel de #eng" });
const eng = (state: FakeState) => state.channels.find((c) => c.id === ENG_ID) as Channel;

/** #eng with the board "Vendas" (one widget) linked, unless `prepare` changes it. */
async function open(prepare?: (state: FakeState, fake: FakeDashboards) => void) {
  const state = seedState();
  const api = createFakeApi(state);
  const fake = fakeDashboardsOf.get(api) as FakeDashboards;
  fake.addBoard({ id: "dash-v", title: "Vendas", audience: "workspace" });
  fake.addWidget("dash-v", { agentId: ATLAS_ID, title: "Receita hoje", layout: { position: 0, w: 1, h: 1 } });
  eng(state).dashboardId = "dash-v";
  prepare?.(state, fake);
  const view = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(8);
  await act(async () => view.sockets.last().open());
  return { state, fake, ...view };
}

describe("a channel's dashboard (ADR 0135 §21)", () => {
  test("docked on a wide window, before the members, with the board's grid; closing it is remembered", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    await open();
    const side = column() as HTMLElement;
    expect(side).toBeTruthy();
    expect(side.classList.contains("members-side")).toBe(true);
    expect(side.closest(".channel__body")).toBeTruthy();
    expect(within(side).getByRole("link", { name: "Vendas" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/dashboards/dash-v`,
    );
    expect(side.textContent).toContain("Receita hoje");
    // The board's own controls, for whoever edits it.
    expect(within(side).getByRole("group", { name: "Vendas" })).toBeTruthy();
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()?.getAttribute("title")).toBe("Esconder painel");
    await click(toggle() as HTMLElement);
    expect(column()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("0");
    cleanup();
    await open();
    expect(column()).toBeNull();
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
  });

  test("on a narrower window it floats over the chat, opened from the header", async () => {
    widthIs(CHANNEL_BOARD_NARROW_QUERY);
    await open();
    expect(column()).toBeNull();
    await click(toggle() as HTMLElement);
    await settle(3);
    const panel = column() as HTMLElement;
    expect(panel.classList.contains("channel-board--float")).toBe(true);
    expect(panel.closest(".channel__body")).toBeNull();
    await click(within(panel).getByRole("button", { name: "Fechar" }));
    await settle(3);
    expect(column()).toBeNull();
  });

  test("a board not shown to the reader says only that: no title, no widgets", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    await open((state, fake) => {
      fake.boards = fake.boards.filter((b) => b.id !== "dash-v");
      eng(state).can = { post: true, callAgents: true, manage: false };
    });
    const side = column() as HTMLElement;
    expect(side.textContent).toContain("Não compartilhado com você");
    expect(side.textContent).not.toContain("Vendas");
    expect(within(side).queryByRole("button", { name: "Trocar painel" })).toBeNull();
  });

  test("no board: the button only for whoever manages the channel, which opens the picker; picking links it", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { state } = await open((s) => {
      eng(s).dashboardId = null;
    });
    expect(column()).toBeNull();
    await click(toggle() as HTMLElement);
    await settle(4);
    const panel = column() as HTMLElement;
    expect(panel.textContent).toContain("Nenhum painel aqui ainda");
    const picker = within(panel).getByRole("combobox", { name: "Painel" });
    picker.focus();
    await act(async () => fireEvent.keyDown(picker, { key: "Enter" }));
    await click(screen().getByRole("option", { name: "Vendas" }));
    await settle(6);
    expect(state.calls.some((c) => c.method === "chat.update" && (c.args[2] as Channel).dashboardId === "dash-v")).toBe(
      true,
    );
    const docked = column() as HTMLElement;
    expect(docked.classList.contains("channel-board--float")).toBe(false);
    expect(within(docked).getByRole("link", { name: "Vendas" })).toBeTruthy();
  });

  test("a member who doesn't manage a channel with no board gets no button", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    await open((state) => {
      eng(state).dashboardId = null;
      eng(state).can = { post: true, callAgents: true, manage: false };
    });
    expect(toggle()).toBeNull();
    expect(column()).toBeNull();
  });

  test("a manager takes it off the channel from its menu", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { state } = await open();
    const trigger = within(column() as HTMLElement).getByRole("button", { name: "Opções do painel" });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.keyUp(trigger, { key: "Enter" });
    });
    await settle(1);
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Tirar do canal" }));
    await settle(6);
    expect(state.calls.some((c) => c.method === "chat.update" && (c.args[2] as Channel).dashboardId === null)).toBe(
      true,
    );
    expect(column()).toBeNull();
  });

  test("a link made elsewhere shows without a reload (`channels.changed`)", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { state, sockets } = await open((s) => {
      eng(s).dashboardId = null;
    });
    expect(column()).toBeNull();
    eng(state).dashboardId = "dash-v";
    await act(async () => sockets.last().push({ type: "event", scope: "org", event: { type: "channels.changed" } }));
    await settle(8);
    expect(within(column() as HTMLElement).getByRole("link", { name: "Vendas" })).toBeTruthy();
  });

  test("a widget opens in its panel, kept in the address (`?widget=`)", async () => {
    widthIs(CHANNEL_BOARD_WIDE_QUERY);
    const { router } = await open();
    const card = within(column() as HTMLElement).getByText("Receita hoje");
    await click(card);
    await settle(6);
    expect((router.state.location.search as { widget?: string }).widget).toBeTruthy();
  });
});
