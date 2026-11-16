import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { DecisionModel } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
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

const open = async (decisionModel?: DecisionModel) => {
  const state = seedState({ ...(decisionModel ? { decisionModel } : {}) });
  const r = await renderApp(`/org/${ORG_ID}/settings/keys`, { api: createFakeApi(state) });
  await settle(5);
  return { ...r, state };
};
const click = async (el: Element, rounds = 5) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const card = () => document.querySelector(".decision-model") as HTMLElement;
const calls = (state: ReturnType<typeof seedState>, method: string) =>
  state.calls.filter((c) => c.method === method).map((c) => c.args);

describe("who decides: one list of providers", () => {
  test("Jev is in use while the switch is off, and the four providers share one list", async () => {
    await open(OFF);
    const radios = within(card()).getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.split("\n")[0])).toEqual([
      expect.stringContaining("Jev"),
      expect.stringContaining("Neste servidor"),
      expect.stringContaining("OpenAI"),
      expect.stringContaining("Gemini"),
    ]);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    expect(within(card()).getByRole("switch", { name: "Modelo de decisão" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  test("choosing Laya opens its settings, and its action turns it on", async () => {
    const { state } = await open(OFF);
    await click(within(card()).getAllByRole("radio")[1] as Element);
    expect(card().textContent).toContain("O runtime local baixa e carrega o Laya");
    await click(within(card()).getByText("Ativar e baixar o Laya"));
    expect(calls(state, "system.saveDecisionModel")[0]?.[0]).toMatchObject({
      enabled: true,
      provider: "local",
      model: "laya",
    });
  });

  test("an OpenAI key is asked for before it can be turned on", async () => {
    const { state } = await open(OFF);
    await click(within(card()).getAllByRole("radio")[2] as Element);
    const on = within(card()).getByText("Ativar") as HTMLButtonElement;
    expect(on.disabled).toBe(true);
    const key = within(card()).getByLabelText("Chave da API");
    await act(async () => fireEvent.change(key, { target: { value: "sk-test-123" } }));
    await settle(3);
    await click(on);
    expect(calls(state, "system.saveDecisionModel")[0]?.[0]).toMatchObject({
      enabled: true,
      provider: "openai",
      model: "gpt-6-luna",
      apiKey: "sk-test-123",
    });
  });

  test("the switch turns the model off again, back to Jev", async () => {
    const { state } = await open(ON);
    await click(within(card()).getByRole("switch", { name: "Modelo de decisão" }));
    expect(calls(state, "system.saveDecisionModel")[0]?.[0]).toEqual({ enabled: false });
  });

  test("an enabled model can be removed, after asking", async () => {
    const { state } = await open(ON);
    await click(within(card()).getByText("Remover"));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Remover o modelo de decisão?");
    await click(within(dialog).getByRole("button", { name: "Remover" }));
    expect(calls(state, "system.removeDecisionModel")).toHaveLength(1);
  });
});
