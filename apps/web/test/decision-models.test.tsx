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
  expect(card().getByRole("combobox").textContent).toContain("My OpenRouter");
  expect(card().queryByLabelText(/key/i)).toBeNull();
  await change("Text decision model", selected.model);
  await click("Test and save");
  expect(state.calls.filter((c) => c.method === "system.saveDecisions").map((c) => c.args)).toEqual([
    [ORG_ID, selected],
  ]);
  expect(card().getByText("Using My OpenRouter · jaredpalmer/kev-4b")).toBeTruthy();
  await click("Use the default setup");
  expect(state.decisions?.settings).toBeNull();
  expect(card().queryByText(/Using My OpenRouter/)).toBeNull();
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
  expect(card().getByRole("link").getAttribute("href")).toBe("#sec-keys");
  expect(card().queryByRole("button", { name: "Test and save" })).toBeNull();
});

test("an unavailable saved account must be replaced or reset; it never picks another account silently", async () => {
  await open({ decisions: { settings: { ...selected, credentialId: "removed-account" }, available: false } });
  expect(card().getByText(/selected OpenRouter account is unavailable/)).toBeTruthy();
  expect(card().getByRole("button", { name: "Test and save" }).hasAttribute("disabled")).toBe(true);
  expect(card().getByRole("button", { name: "Use the default setup" })).toBeTruthy();
});
