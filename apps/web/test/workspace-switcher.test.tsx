import { afterEach, describe, expect, test } from "bun:test";
import { domWindow, setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const open = async (trigger: HTMLElement) => {
  await act(async () => fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false }));
  await settle(4);
};

const go = async (extra: boolean) => {
  const state = seedState();
  if (extra && state.me) {
    state.me.organizations = [
      ...state.me.organizations,
      { id: "org-2", name: "Beta", role: "member", showActivity: true } as (typeof state.me.organizations)[number],
    ];
  }
  const r = await renderApp(`/org/${ORG_ID}/issues`, { api: createFakeApi(state) });
  await settle(6);
  return r;
};

describe("the workspace switcher", () => {
  test("with several workspaces the header opens a quick list; settings open the full menu", async () => {
    await go(true);
    await open(screen().getByRole("button", { name: "Menu do workspace Acme" }));
    const menu = screen().getByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent ?? "");
    expect(names.some((n) => n.includes("Acme") && n.includes("Você está aqui"))).toBe(true);
    expect(names.some((n) => n.includes("Beta"))).toBe(true);
    // The quick menu is the list only: New workspace and Add account stay in the full menu.
    expect(within(menu).queryByText("Novo workspace")).toBeNull();
    expect(within(menu).queryByText("Adicionar conta")).toBeNull();
    expect(screen().queryByRole("dialog", { name: "Acme" })).toBeNull();
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: /Configurações do workspace/ })));
    await settle(6);
    const full = screen().getByRole("dialog", { name: "Acme" });
    expect(within(full).getByText("Novo workspace")).toBeTruthy();
    expect(within(full).getByText("Adicionar conta")).toBeTruthy();
    expect(domWindow()).toBeTruthy();
  });

  test("with one workspace the header opens the full menu directly", async () => {
    await go(false);
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Menu do workspace Acme" })));
    await settle(6);
    expect(screen().getByRole("dialog", { name: "Acme" })).toBeTruthy();
  });
});
