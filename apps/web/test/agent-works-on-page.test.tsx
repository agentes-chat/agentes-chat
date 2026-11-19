import { afterEach, describe, expect, test } from "bun:test";
import type { Agent } from "@agenteschat/client";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { brainDialog, brainRows, toScreen } from "./ai-picker";
import { ADA_ID, createFakeApi, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(cleanup);

/**
 * An agent that works on another's computer (ADR 0202) in the agent page's own dialogs: it never moves, so nothing
 * offers to move it, and a lock line never prints an empty name.
 */
const linked = (name: string | null) => {
  const state = seedState();
  Object.assign(state.agents[0] as Agent, {
    worksOnAgentId: "lead",
    worksOn: name ? { id: "lead", name, handle: "lead", archived: false } : null,
  });
  state.edition = "selfhost";
  const api = createFakeApi(state);
  fakeMachinesOf.get(api)?.pair({
    id: "machine_1",
    name: "MacBook",
    os: "darwin",
    access: { folders: [], tools: { claude: true, codex: true, commands: true, browser: false } },
  });
  return { state, api };
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(3);
};

describe("a linked agent in the agent page", () => {
  test("its brain dialog offers no plan that moves it to another computer", async () => {
    const { api } = linked("Atlas");
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}`, { api });
    await settle(8);
    const d = await brainDialog();
    await toScreen(d, "Trocar de conta");
    expect(brainRows(d).flatMap((r) => r.lines)).not.toContain("Vai para o MacBook");
  });

  test("the computer dialog is locked on a lead whose name is unknown, with no empty name", async () => {
    const { api } = linked(null);
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}`, { api });
    await settle(8);
    const sentence = screen().getByRole("region", { name: "Como trabalha" });
    await click(within(sentence).getByRole("button", { name: "Mudar onde trabalha" }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Acompanha o computador de outro agente");
    expect(text).not.toContain("Acompanha  ");
  });

  test("settings: the 'change where it works' button is disabled", async () => {
    const { api } = linked("Atlas");
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings&sec=computer`, { api });
    await settle(10);
    const button = screen().queryByRole("button", { name: /^Mudar onde/ });
    // Absent on a Cloud edition; where it exists it must be locked.
    if (button) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button).not.toBeNull();
  });
});
