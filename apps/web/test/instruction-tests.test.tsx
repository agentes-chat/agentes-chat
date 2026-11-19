import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { InstructionTestRun } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(cleanup);

const example = { id: "case-1", situation: "Pedido sem o número do recibo", expectation: "Pedir o número do recibo" };
const run = (candidateInstructions: string): InstructionTestRun => ({
  id: "test-1",
  agentId: ADA_ID,
  status: "done",
  executor: "model",
  model: "claude-sonnet-5-5",
  createdAt: "2026-11-18T12:00:00Z",
  completedAt: "2026-11-18T12:00:01Z",
  error: null,
  baseInstructions: "",
  candidateInstructions,
  limitations: ["instructionTests.responsesOnly"],
  results: [
    {
      caseId: example.id,
      situation: example.situation,
      expectation: example.expectation,
      current: "Processarei o pedido.",
      candidate: "Qual é o número do recibo?",
      currentVerdict: "not_met",
      candidateVerdict: "met",
      reason: "A alteração pede o dado necessário antes de prosseguir.",
    },
  ],
  usage: { inputTokens: 120, outputTokens: 60, costNanoUsd: 1000 },
});

async function open(available = true, executor = "model") {
  const state = seedState();
  const api = createFakeApi(state);
  let starts = 0;
  api.instructionTests = {
    list: async () => ({
      support: {
        available,
        executor: available ? executor : null,
        model: available ? "claude-sonnet-5-5" : null,
        reason: available ? null : "instructionTests.planUnavailable",
        limitations: ["instructionTests.responsesOnly"],
      },
      cases: [example],
      runs: [],
    }),
    saveCases: async (_org, _agent, cases) => ({ cases }),
    start: async (_org, _agent, input) => {
      starts++;
      return { run: { ...run(input.candidateInstructions), executor } };
    },
    get: async () => ({ run: run("Nova instrução") }),
    cancel: async () => ({ run: { ...run("Nova instrução"), status: "canceled" } }),
    remove: async () => {},
    suggest: async () => ({ case: example }),
  };
  await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=instructions`, { api });
  await settle(8);
  const area = screen().getByRole("textbox", { name: "Instruções" });
  await act(async () => fireEvent.change(area, { target: { value: "Nova instrução" } }));
  await settle(3);
  return { state, api, starts: () => starts };
}

test("comparing instructions is explicit and keeps the live instructions unsaved", async () => {
  const { state, starts } = await open();
  expect(starts()).toBe(0);
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(6);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  expect(
    within(dialog).getByRole("textbox", { name: "Situação" }).getAttribute("value") ??
      (within(dialog).getByRole("textbox", { name: "Situação" }) as HTMLTextAreaElement).value,
  ).toBe(example.situation);
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Comparar respostas" })));
  await settle(6);
  expect(starts()).toBe(1);
  expect(within(dialog).getByText("Avaliação destes exemplos")).toBeTruthy();
  expect(within(dialog).getByText("Qual é o número do recibo?")).toBeTruthy();
  expect(state.calls.filter((c) => c.method === "agents.update")).toHaveLength(0);
});

test("an unsupported subscription never silently switches to an API model", async () => {
  const { starts } = await open(false);
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(6);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  expect(within(dialog).getByText(/assinatura.*indisponível/i)).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Comparar respostas" })?.hasAttribute("disabled")).toBe(true);
  expect(starts()).toBe(0);
});

test("subscription comparisons identify plan usage without presenting API dollar charges", async () => {
  const { starts } = await open(true, "codex");
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(5);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  expect(within(dialog).getByText(/Usa somente a assinatura conectada/)).toBeTruthy();
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Comparar respostas" })));
  await settle(5);
  expect(starts()).toBe(1);
  expect(within(dialog).getByText(/180 tokens utilizados/).textContent).not.toMatch(/US\$|USD/);
});

test("an inconclusive evaluator result is shown in the person's language", async () => {
  const { api } = await open();
  api.instructionTests.start = async (_org, _agent, input) => {
    const result = run(input.candidateInstructions);
    const first = result.results[0];
    if (!first) throw new Error("Expected a comparison result");
    first.reason = "instructionTests.reviewInconclusive";
    return { run: result };
  };
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(4);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Comparar respostas" })));
  await settle(4);
  expect(within(dialog).queryByText("instructionTests.reviewInconclusive")).toBeNull();
  expect(within(dialog).getByText("A avaliação da IA foi inconclusiva. Confira as respostas.")).toBeTruthy();
});

test("deleting a comparison holds new starts until the deletion finishes", async () => {
  const { api } = await open();
  let finish: () => void = () => {};
  api.instructionTests.remove = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(4);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Comparar respostas" })));
  await settle(4);
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Excluir comparação" })));
  await settle(3);
  const confirmation = screen().getByRole("dialog", { name: "Excluir esta comparação?" });
  await act(async () => fireEvent.click(within(confirmation).getByRole("button", { name: "Excluir comparação" })));
  await settle(2);
  await act(async () => fireEvent.click(within(confirmation).getByRole("button", { name: "Cancelar" })));
  await settle(2);
  const blocked = within(dialog).getByRole("button", { name: "Comparar respostas" }).hasAttribute("disabled");
  await act(async () => finish());
  await settle(3);
  expect(blocked).toBe(true);
});

test("removing every saved example remains an unsaved change", async () => {
  await open();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar alteração" })));
  await settle(4);
  const dialog = screen().getByRole("dialog", { name: "Testar alteração" });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Remover exemplo" })));
  await settle(2);
  await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
  await settle(2);
  expect(screen().queryByRole("dialog", { name: "Testar alteração" })).not.toBeNull();
});
