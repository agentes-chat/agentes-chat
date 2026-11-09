import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { island } from "@/lib/island";
import { builtCss, declarations, topLevel } from "./built-css";
import { ADA_ID, createFakeApi, ENG_ID, GENERAL_ID, ORG_ID, seedState } from "./fake-api";
import { notification } from "./fakes/notifications";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  island.putAway();
  cleanup();
});

const reply = notification({
  id: "n-reply",
  kind: "agent_reply",
  actors: [{ type: "agent", id: ADA_ID }],
  source: { channelId: GENERAL_ID, messageId: "m-1" },
  latest: { text: "Não tô contra, mas acho que vale testar antes." },
});

test("the closed island ends in 'Ver', which opens the message where it happened", async () => {
  const r = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(seedState()) });
  await act(async () => island.arrive(reply));
  await settle(3);
  const bar = document.querySelector(".ni__bar") as HTMLElement;
  // A button of its own after the pill, never one inside the other.
  const see = within(bar).getByRole("button", { name: "Ver" });
  expect(see.previousElementSibling?.classList.contains("ni__pill")).toBe(true);
  expect(bar.querySelector(".ni__pill button")).toBeNull();
  await act(async () => fireEvent.click(see));
  await settle(4);
  expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  expect(r.router.state.location.search).toMatchObject({ m: "m-1" });
  // It goes off the island once opened.
  expect(island.get().items.map((i) => i.n.id)).toEqual([]);
});

test("'Ver' reaches past a side panel: the island stays live over it, and the message opens in the panel's place", async () => {
  const r = await renderApp(`/org/${ORG_ID}/dm/agent/${ADA_ID}`, { api: createFakeApi(seedState()) });
  await settle(8);
  const header = document.querySelector(".channel__header") as HTMLElement;
  await act(async () => fireEvent.click(within(header).getByRole("button", { name: "Perfil de Ada" })));
  await settle(6);
  expect(screen().getByRole("complementary", { name: "Perfil da Ada" })).toBeTruthy();
  await act(async () => island.arrive(reply));
  await settle(3);
  const see = within(document.querySelector(".ni__bar") as HTMLElement).getByRole("button", { name: "Ver" });
  expect(see.closest("[inert]")).toBeNull();
  await act(async () => fireEvent.click(see));
  await settle(6);
  expect(r.router.state.location.pathname).toBe(`/org/${ORG_ID}/c/${GENERAL_ID}`);
  expect(screen().queryByRole("complementary", { name: "Perfil da Ada" })).toBeNull();
});

test("the island is centered on the window, not the work area beside the sidebar", async () => {
  const css = topLevel(await builtCss("src/styles.css", "src/components/notice-island.css"));
  const last = (selector: string, property: string) =>
    declarations(css, selector)
      .filter(([p]) => p === property)
      .at(-1)?.[1];
  expect(last(".ni-wrap", "position")).toBe("fixed");
  expect(last(".ni-wrap", "left")).toBe("0");
  expect(last(".ni-wrap", "right")).toBe("0");
  expect(last(".ni-wrap", "justify-content")).toBe("center");
});
