import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { notification } from "./fakes/notifications";
import { renderApp, screen, settle } from "./render";

/* The bell's dock: a click on the bell opens the latest notifications beside it, compact; only "Ver tudo" goes to the
   inbox page. */

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};

describe("the bell's dock", () => {
  test("opens beside the bell without leaving the page, and Ver tudo opens the inbox", async () => {
    const state = seedState();
    state.notifications = [
      notification({
        id: "n-dm",
        kind: "dm",
        actors: [{ type: "agent", id: ADA_ID }],
        latest: { text: "Gerei o frame novo" },
      }),
    ];
    const { router } = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);
    const bell = screen().getAllByRole("button", { name: /Notificações|não lida/ })[0] as HTMLElement;
    await click(bell);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${ENG_ID}`);
    const dock = screen().getByRole("dialog", { name: "Notificações" });
    expect(within(dock).getByText("Gerei o frame novo")).toBeTruthy();
    const all = within(dock).getByRole("link", { name: "Ver tudo" });
    expect(all.getAttribute("href")).toBe(`/org/${ORG_ID}/notifications`);
    await click(all);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/notifications`);
    expect(screen().queryByRole("dialog", { name: "Notificações" })).toBeNull();
  });
});
