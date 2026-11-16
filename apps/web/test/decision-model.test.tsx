import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { DecisionModel } from "@agenteschat/client";
import { act, cleanup, screen as domScreen, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle } from "./render";

afterEach(() => cleanup());

const OFF: DecisionModel = {
  source: null,
  enabled: false,
  provider: null,
  model: null,
  baseURL: null,
  runtime: null,
  hint: null,
  state: "off",
  capabilities: { inputs: ["text"] },
  timeoutMs: 3000,
  install: null,
};
const ON: DecisionModel = {
  ...OFF,
  source: "settings",
  enabled: true,
  provider: "local",
  model: "laya",
  runtime: "llamacpp",
  state: "ok",
};

const open = async (patch: Partial<ReturnType<typeof seedState>>, decisionModel?: DecisionModel) => {
  const state = seedState({ ...patch, ...(decisionModel ? { decisionModel } : {}) });
  const r = await renderApp(`/org/${ORG_ID}/settings/keys`, { api: createFakeApi(state) });
  await settle(5);
  return { ...r, state };
};
const click = async (el: Element, rounds = 4) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const card = () => domScreen.getByText("Modelo de decisão").closest(".decision-model") as HTMLElement;
const calls = (state: ReturnType<typeof seedState>, method: string) =>
  state.calls.filter((c) => c.method === method).map((c) => c.args);

describe("the decision model card", () => {
  test("is off by default, then turns on with Laya", async () => {
    const { state } = await open({}, OFF);
    expect(card().textContent).toContain("Desligado");
    const toggle = within(card()).getByRole("switch", { name: "Modelo de decisão" });
    await click(toggle);
    expect(card().textContent).toContain("Neste servidor");
    await click(within(card()).getByText("Neste servidor"));
    await click(within(card()).getByText("Ativar e baixar o Laya"));
    expect(calls(state, "system.saveDecisionModel")[0]?.[0]).toMatchObject({
      enabled: true,
      provider: "local",
      model: "laya",
    });
  });

  test("an enabled model shows its state and can be removed", async () => {
    const { state } = await open({}, ON);
    expect(card().textContent).toContain("Ligado");
    await click(within(card()).getByText("Remover"));
    const dialog = domScreen.getByRole("dialog");
    expect(dialog.textContent).toContain("Remover o modelo de decisão?");
    await click(within(dialog).getByRole("button", { name: "Remover" }));
    expect(calls(state, "system.removeDecisionModel")).toHaveLength(1);
  });
});
