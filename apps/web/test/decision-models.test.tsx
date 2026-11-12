import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { Credential } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle, showIn } from "./render";

afterEach(() => cleanup());
const account: Credential = {
  id: "openrouter-1",
  provider: "openrouter",
  label: "My OpenRouter",
  keyHint: "9f2c",
  createdAt: "2026-11-12T00:00:00Z",
  revokedAt: null,
};
const selected = { credentialId: account.id, model: "jaredpalmer/kev-4b", visionModel: "typesafe/jev-1.14" };
async function open(patch: Partial<ReturnType<typeof seedState>> = {}) {
  const state = seedState({ credentials: [account], ...patch });
  const result = await renderApp(`/org/${ORG_ID}/settings/keys`, { api: createFakeApi(state) });
  await settle(5);
  await showIn(result.services, "en");
  return { state, ...result };
}
const card = () => within(screen().getByRole("region", { name: "Decision models" }));
const choose = async (name: "Jev" | "OpenRouter") => {
  await act(() => {
    fireEvent.click(card().getByRole("radio", { name }));
  });
  await settle(5);
};
const change = (name: string, value: string) =>
  act(() => {
    fireEvent.change(card().getByLabelText(name), { target: { value } });
  });
const click = async (name: string) => {
  await act(() => {
    fireEvent.click(card().getByRole("button", { name }));
  });
  await settle(5);
};

test("saves with the existing OpenRouter account and model IDs, shows the active setup and resets it", async () => {
  const { state } = await open();
  expect(card().getByRole("radio", { name: "Jev" }).getAttribute("aria-checked")).toBe("true");
  expect(card().queryByLabelText("OpenRouter account")).toBeNull();
  expect(card().queryByLabelText("Text decision model")).toBeNull();
  await choose("OpenRouter");
  expect(card().getByRole("combobox").textContent).toContain("My OpenRouter");
  expect(card().queryByLabelText(/key/i)).toBeNull();
  await change("Text decision model", selected.model);
  await click("Test and save");
  expect(state.calls.filter((c) => c.method === "system.saveDecisions").map((c) => c.args)).toEqual([
    [ORG_ID, selected],
  ]);
  expect(card().getByText("Using My OpenRouter · jaredpalmer/kev-4b")).toBeTruthy();
  await choose("Jev");
  expect(state.decisions?.settings).toBeNull();
  expect(card().queryByText(/Using My OpenRouter/)).toBeNull();
  expect(card().queryByLabelText("Text decision model")).toBeNull();
  expect(card().getByRole("radio", { name: "Jev" }).getAttribute("aria-checked")).toBe("true");
});

test("failed save preserves the draft and saved setup; screenshots can be disabled", async () => {
  const { state } = await open({ decisions: { settings: selected, available: true }, decisionError: true });
  await change("Text decision model", "typesafe/jev-1.14");
  await change("Vision decision model (optional)", "");
  await click("Test and save");
  expect(card().getByRole("alert").textContent).toContain("OpenRouter could not verify");
  expect((card().getByLabelText("Text decision model") as HTMLInputElement).value).toBe("typesafe/jev-1.14");
  expect(state.decisions?.settings).toEqual(selected);
  state.decisionError = false;
  await click("Test and save");
  expect(state.decisions?.settings).toEqual({ ...selected, model: "typesafe/jev-1.14", visionModel: null });
});

test("no account: connects through existing settings, with no key or Docker configuration requested", async () => {
  await open({ credentials: [] });
  await choose("OpenRouter");
  expect(card().getByRole("link").getAttribute("href")).toBe("#sec-keys");
  expect(card().queryByRole("button", { name: "Test and save" })).toBeNull();
});

test("an unavailable saved account must be replaced or reset; it never picks another account silently", async () => {
  await open({ decisions: { settings: { ...selected, credentialId: "removed-account" }, available: false } });
  expect(card().getByText(/selected OpenRouter account is unavailable/)).toBeTruthy();
  expect(card().getByRole("button", { name: "Test and save" }).hasAttribute("disabled")).toBe(true);
  expect(card().getByRole("radio", { name: "Jev" })).toBeTruthy();
});

test("provider choices retain an unsaved draft without changing the active setup", async () => {
  const { state } = await open();
  await choose("OpenRouter");
  await change("Text decision model", "jaredpalmer/kev-4b");
  await choose("Jev");
  expect(card().queryByLabelText("Text decision model")).toBeNull();
  await choose("OpenRouter");
  expect((card().getByLabelText("Text decision model") as HTMLInputElement).value).toBe("jaredpalmer/kev-4b");
  expect(state.calls.filter((c) => c.method === "system.saveDecisions")).toHaveLength(0);
});

test("a failed switch to Jev keeps OpenRouter selected and its saved configuration", async () => {
  const { state } = await open({ decisions: { settings: selected, available: true }, decisionError: true });
  await choose("Jev");
  expect(card().getByRole("radio", { name: "OpenRouter" }).getAttribute("aria-checked")).toBe("true");
  expect(card().getByRole("alert")).toBeTruthy();
  expect(state.decisions?.settings).toEqual(selected);
});

test("the Jev deep link focuses the selected provider without resetting OpenRouter", async () => {
  const state = seedState({ credentials: [account], decisions: { settings: selected, available: true } });
  const result = await renderApp("/?open=jev", { api: createFakeApi(state) });
  await settle(6);
  await showIn(result.services, "en");
  expect(document.activeElement).toBe(screen().getByRole("region", { name: "Decision models" }));
  expect(card().getByRole("radio", { name: "OpenRouter" }).getAttribute("aria-checked")).toBe("true");
  expect(state.calls.filter((c) => c.method === "system.saveDecisions")).toHaveLength(0);
});

test("the Jev setup is shown only for Jev and its server key is untouched by provider choices", async () => {
  const { state } = await open({
    jev: { source: "settings", hint: "9f2c", state: "ok", month: { decisions: 0, costUsd: 0 } },
  });
  expect(card().getByRole("region", { name: "Jev" })).toBeTruthy();
  await choose("OpenRouter");
  expect(card().queryByRole("region", { name: "Jev" })).toBeNull();
  expect(card().getByLabelText("OpenRouter account")).toBeTruthy();
  await choose("Jev");
  expect(card().getByRole("region", { name: "Jev" })).toBeTruthy();
  expect(
    state.calls.filter((c) => ["system.saveJev", "system.removeJev", "system.saveDecisions"].includes(c.method)),
  ).toHaveLength(0);
});
