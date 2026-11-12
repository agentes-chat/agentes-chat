import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AgentBrain, AgentBrainInput } from "@agenteschat/client";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { DM_SIDE_WIDE_QUERY } from "@/hooks/useMembersColumn";
import { ADA_ID, createFakeApi, type FakeState, fakeAgentBrain, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/*
 * The model and the effort in a DM's side panel (ADR 0032 §5, addendum 2026-11-12): two clicks for the model, one for
 * the effort, each saved at once; read-only for whoever may not change the agent.
 */

let media: { mockRestore: () => void } | null = null;
afterEach(() => {
  cleanup();
  media?.mockRestore();
  media = null;
  localStorage.clear();
});

const wide = () => {
  media = spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        matches: q === DM_SIDE_WIDE_QUERY,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
};

const thinks = () =>
  within(screen().getByRole("complementary", { name: "Detalhes" })).getByRole("region", { name: "Como pensa" });
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(6);
};

/** Ada's brain as the server gives it, following each save, and what was sent. */
async function openDm(first: AgentBrain, state: FakeState = seedState()) {
  wide();
  const api = createFakeApi(state);
  let view = first;
  const sent: AgentBrainInput[] = [];
  api.agents.brain = async () => structuredClone(view);
  api.agents.setBrain = async (_org, _id, input) => {
    sent.push(input);
    const option = view.options.find((o) => o.kind === view.brain);
    view = {
      ...view,
      ...(input.model !== undefined
        ? { model: input.model, effectiveModel: input.model ?? option?.defaultModel ?? null }
        : {}),
      ...(input.effort !== undefined ? { effort: input.effort } : {}),
    };
    return structuredClone(view);
  };
  await renderApp(`/org/${ORG_ID}/dm/agent/${ADA_ID}`, { api });
  await settle(12);
  return { state, sent };
}

const onClaude = (patch: Partial<AgentBrain> = {}) =>
  fakeAgentBrain(ADA_ID, { brain: "claude_code", effectiveModel: "sonnet", effort: "medium", canEdit: true, ...patch });

describe("Como pensa, in the DM's side panel", () => {
  test("a plan: the model in two clicks, saved at once; the effort in one", async () => {
    const { sent } = await openDm(onClaude());
    const model = within(thinks()).getByRole("combobox", { name: "Modelo" });
    expect(model.textContent).toContain("Sonnet");
    await click(model);
    await click(screen().getByRole("option", { name: /^Opus/ }));
    expect(sent).toEqual([{ model: "opus" }]);
    expect(within(thinks()).getByRole("combobox", { name: "Modelo" }).textContent).toContain("Opus");
    const effort = within(thinks()).getByRole("radiogroup", { name: "Esforço" });
    expect(within(effort).getByRole("radio", { name: "Médio" }).getAttribute("aria-checked")).toBe("true");
    await click(within(effort).getByRole("radio", { name: "Alto" }));
    expect(sent.at(-1)).toEqual({ effort: "high" });
    expect(
      within(within(thinks()).getByRole("radiogroup", { name: "Esforço" }))
        .getByRole("radio", { name: "Alto" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("Automático picks the effort too: no effort to set, and picking it saves both", async () => {
    const { sent } = await openDm(onClaude());
    await click(within(thinks()).getByRole("combobox", { name: "Modelo" }));
    await click(screen().getByRole("option", { name: /^Automático/ }));
    expect(sent).toEqual([{ model: "auto", effort: "auto" }]);
    expect(within(thinks()).queryByRole("radiogroup", { name: "Esforço" })).toBeNull();
  });

  test("the API through a key: the workspace's models, saved as the agent's model; no effort", async () => {
    const state = seedState();
    const { sent } = await openDm(fakeAgentBrain(ADA_ID, { canEdit: true }), state);
    expect(within(thinks()).queryByRole("radiogroup", { name: "Esforço" })).toBeNull();
    await click(within(thinks()).getByRole("combobox", { name: "Modelo" }));
    await click(screen().getByRole("option", { name: /^Automático/ }));
    expect(sent).toEqual([]);
    expect(state.calls.filter((c) => c.method === "agents.update").map((c) => c.args[2])).toEqual([{ model: "auto" }]);
  });

  test("whoever may not change the agent reads the line, with no control", async () => {
    await openDm(onClaude({ canEdit: false }));
    expect(within(thinks()).queryByRole("combobox", { name: "Modelo" })).toBeNull();
    expect(within(thinks()).queryByRole("radiogroup", { name: "Esforço" })).toBeNull();
    expect(thinks().textContent).toContain("Pensa com");
  });
});
