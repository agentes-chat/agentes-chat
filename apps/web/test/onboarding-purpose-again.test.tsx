import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, type FakeState, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/*
 * What the workspace is for, asked again once it exists (ADR 0162, amended 2026-11-26; ADR 0159 §4): Back from a
 * personal workspace's start step shows the question with "For me" picked, a view that saves nothing; "For my team"
 * there switches the workspace to a team's and asks its name. A team's name step goes back to the same question, where
 * "For me" switches it to personal under the personal name.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  globalThis.fetch = realFetch;
});

const PURPOSE = "Para que você vai usar o agentes.chat?";
const START = "Como você quer começar?";
const NAME = "Como se chama o seu workspace?";

const button = (name: string | RegExp) => screen().getByRole("button", { name });
const answer = (name: RegExp) => screen().getByRole("radio", { name });
const click = async (el: Element, rounds = 12) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const heading = () => document.querySelector(".onbx__title")?.textContent;
const eyebrow = () => document.querySelector(".onbx__eyebrow")?.textContent ?? null;
const lead = () => document.querySelector(".onbx__lead")?.textContent ?? "";
const calls = (state: FakeState, method: string) => state.calls.filter((c) => c.method === method);
const workspace = (state: FakeState) => state.me?.organizations[0];

/** Someone with no workspace yet, on agentes.chat Cloud: a new workspace waits for its first plan. */
const newcomer = () => {
  const state = seedState({ agents: [] });
  if (state.me) state.me.organizations = [];
  state.authConfig = { billingUrl: "https://billing.example.com" };
  state.newWorkspaceStanding = { state: "hold", reason: "payment" };
  // The billing service's plan list can't be read here: the plan is named generically, nothing waits on it.
  globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  return state;
};

describe("what the workspace is for, asked again (ADR 0159 §4)", () => {
  test("a personal workspace's start goes back to the question; For my team switches it and asks its name", async () => {
    const state = newcomer();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    await click(answer(/Para mim/), 4);
    await click(button("Continuar"), 16);
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 1 de 4");
    expect(lead()).toContain("Os seus agentes");

    // Back: the question, "For me" picked, and nothing saved.
    await click(button("Voltar"));
    expect(heading()).toBe(PURPOSE);
    expect(answer(/Para mim/).getAttribute("aria-checked")).toBe("true");
    expect(calls(state, "orgs.updateSettings")).toHaveLength(0);
    // The same answer goes back to how to start, still nothing saved.
    await click(button("Continuar"));
    expect(heading()).toBe(START);
    expect(calls(state, "orgs.updateSettings")).toHaveLength(0);
    expect(workspace(state)?.mode).toBe("personal");

    // For my team: the workspace becomes a team's, its name asked in an empty field, as a team's first step.
    await click(button("Voltar"));
    await click(answer(/Para meu time/), 4);
    await click(button("Continuar"), 16);
    expect(calls(state, "orgs.updateSettings").map((c) => c.args[1])).toEqual([{ mode: "team" }]);
    expect(workspace(state)?.mode).toBe("team");
    expect(heading()).toBe(NAME);
    expect(eyebrow()).toBe("Passo 1 de 4");
    expect((screen().getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect(button("Continuar").hasAttribute("disabled")).toBe(true);

    // Its Back asks the question again, "For my team" picked; the same answer comes back to the name.
    await click(button("Voltar"));
    expect(heading()).toBe(PURPOSE);
    expect(answer(/Para meu time/).getAttribute("aria-checked")).toBe("true");
    await click(button("Continuar"));
    expect(heading()).toBe(NAME);

    // Named, it goes on as a team: how to start is its second step, in a team's words.
    await act(async () => fireEvent.change(screen().getByLabelText("Nome"), { target: { value: "Acme" } }));
    await click(button("Continuar"), 16);
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 2 de 4");
    expect(lead()).not.toContain("Os seus agentes");
    expect(calls(state, "orgs.updateSettings").at(-1)?.args[1]).toMatchObject({ name: "Acme" });
  });

  test("a team's name step, once the workspace exists, goes back to the question; For me switches it", async () => {
    const state = newcomer();
    await renderApp("/onboarding", { api: createFakeApi(state) });
    await settle(10);
    await click(answer(/Para meu time/), 4);
    await click(button("Continuar"), 6);
    await act(async () => fireEvent.change(screen().getByLabelText("Nome"), { target: { value: "Acme" } }));
    await click(button("Continuar"), 16);
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 2 de 4");

    // Back to the name, then back to the question, "For my team" picked.
    await click(button("Voltar"));
    expect(heading()).toBe(NAME);
    await click(button("Voltar"));
    expect(heading()).toBe(PURPOSE);
    expect(answer(/Para meu time/).getAttribute("aria-checked")).toBe("true");

    // For me: personal, under the personal name, on to how to start in its own words.
    await click(answer(/Para mim/), 4);
    await click(button("Continuar"), 16);
    expect(calls(state, "orgs.updateSettings").at(-1)?.args[1]).toEqual({ mode: "personal", name: "Pessoal" });
    expect(workspace(state)).toMatchObject({ mode: "personal", name: "Pessoal" });
    expect(heading()).toBe(START);
    expect(eyebrow()).toBe("Passo 1 de 4");
    expect(lead()).toContain("Os seus agentes");
    // A personal workspace's start goes back to the question again, never to a name.
    await click(button("Voltar"));
    expect(heading()).toBe(PURPOSE);
    expect(answer(/Para mim/).getAttribute("aria-checked")).toBe("true");
  });
});
