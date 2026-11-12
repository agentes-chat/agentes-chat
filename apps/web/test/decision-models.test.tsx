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
const pickModel = async (name: string, label: string) => {
  await act(() => fireEvent.click(card().getByRole("combobox", { name })));
  await settle(2);
  await act(() => fireEvent.click(within(screen().getByRole("listbox")).getByText(label, { exact: true })));
  await settle(2);
};
const change = (name: string, value: string) =>
  act(() => {
    fireEvent.change(card().getByRole("textbox", { name }), { target: { value } });
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
  expect(card().getByRole("combobox", { name: "OpenRouter account" }).textContent).toContain("My OpenRouter");
  expect(card().queryByLabelText(/key/i)).toBeNull();
  await pickModel("Text decision model", "Kev 4B");
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
  await pickModel("Text decision model", "Jev 1.14");
  await pickModel("Vision decision model (optional)", "Off");
  await click("Test and save");
  expect(card().getByRole("alert").textContent).toContain("OpenRouter could not verify");
  expect(card().getByRole("combobox", { name: "Text decision model" }).textContent).toContain("Jev 1.14");
  expect(state.decisions?.settings).toEqual(selected);
  state.decisionError = false;
  await click("Test and save");
  expect(state.decisions?.settings).toEqual({ ...selected, model: "typesafe/jev-1.14", visionModel: null });
});

test("without OpenRouter the original routing and Jev UI is shown", async () => {
  await open({ credentials: [] });
  expect(screen().getByRole("region", { name: "Who picks the agents" })).toBeTruthy();
  expect(screen().queryByRole("radio", { name: "OpenRouter" })).toBeNull();
  expect(screen().queryByRole("region", { name: "Decision models" })).toBeNull();
});

test("a removed OpenRouter account can be reset without showing the OpenRouter choice", async () => {
  const { state } = await open({ credentials: [], decisions: { settings: selected, available: false } });
  expect(screen().queryByRole("radio", { name: "OpenRouter" })).toBeNull();
  await act(() => fireEvent.click(screen().getByRole("button", { name: "Use the default setup" })));
  await settle(5);
  expect(state.decisions?.settings).toBeNull();
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
  await pickModel("Text decision model", "Other model…");
  await change("Text decision model", "maker/decision-v2");
  await choose("Jev");
  expect(card().queryByLabelText("Text decision model")).toBeNull();
  await choose("OpenRouter");
  expect((card().getByRole("textbox", { name: "Text decision model" }) as HTMLInputElement).value).toBe(
    "maker/decision-v2",
  );
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
  expect(document.activeElement).toBe(screen().getByRole("region", { name: "Decision provider" }));
  expect(card().getByRole("radio", { name: "OpenRouter" }).getAttribute("aria-checked")).toBe("true");
  expect(state.calls.filter((c) => c.method === "system.saveDecisions")).toHaveLength(0);
});

test("the Jev setup is shown only for Jev and its server key is untouched by provider choices", async () => {
  const { state } = await open({
    jev: { source: "settings", hint: "9f2c", state: "ok", month: { decisions: 0, costUsd: 0 } },
  });
  expect(card().getByRole("region", { name: "Jev" })).toBeTruthy();
  expect(card().getByText(/A fast model by TypeSafe/)).toBeTruthy();
  await choose("OpenRouter");
  expect(card().queryByRole("region", { name: "Jev" })).toBeNull();
  expect(card().getByLabelText("OpenRouter account")).toBeTruthy();
  await choose("Jev");
  expect(card().getByRole("region", { name: "Jev" })).toBeTruthy();
  expect(
    state.calls.filter((c) => ["system.saveJev", "system.removeJev", "system.saveDecisions"].includes(c.method)),
  ).toHaveLength(0);
});

test("other model IDs are sent unchanged for text and vision, while a failed test keeps the draft", async () => {
  const { state } = await open({ decisionError: true });
  await choose("OpenRouter");
  await pickModel("Text decision model", "Other model…");
  await change("Text decision model", "maker/decision-v2");
  await pickModel("Vision decision model (optional)", "Other model…");
  await change("Vision decision model (optional)", "maker/vision-v2");
  await click("Test and save");
  expect(card().getByRole("alert")).toBeTruthy();
  expect((card().getByRole("textbox", { name: "Text decision model" }) as HTMLInputElement).value).toBe(
    "maker/decision-v2",
  );
  state.decisionError = false;
  await click("Test and save");
  expect(state.decisions?.settings).toEqual({
    credentialId: account.id,
    model: "maker/decision-v2",
    visionModel: "maker/vision-v2",
  });
});

test("saved unlisted models stay editable and are never replaced with a preset", async () => {
  const settings = { credentialId: account.id, model: "maker/decision-v2", visionModel: "maker/vision-v2" };
  const { state } = await open({ decisions: { settings, available: true } });
  expect((card().getByRole("textbox", { name: "Text decision model" }) as HTMLInputElement).value).toBe(settings.model);
  expect((card().getByRole("textbox", { name: "Vision decision model (optional)" }) as HTMLInputElement).value).toBe(
    settings.visionModel,
  );
  await click("Test and save");
  expect(state.decisions?.settings).toEqual(settings);
});

test("one shared explanation covers both providers", async () => {
  await open();
  const about = "These models help choose who replies, organize memory, and understand screenshots.";
  expect(card().getAllByText(about)).toHaveLength(1);
  await choose("OpenRouter");
  expect(card().getAllByText(about)).toHaveLength(1);
  expect(card().queryByText("Helps your agents work as a team.")).toBeNull();
});

test("a revoked OpenRouter account stays hidden and a failed reset preserves the override", async () => {
  const { state } = await open({
    credentials: [{ ...account, revokedAt: "2026-11-12T00:00:00Z" }],
    decisions: { settings: selected, available: false },
    decisionError: true,
  });
  expect(screen().queryByRole("radio", { name: "OpenRouter" })).toBeNull();
  await act(() => fireEvent.click(screen().getByRole("button", { name: "Use the default setup" })));
  await settle(5);
  expect(screen().getByRole("alert")).toBeTruthy();
  expect(state.decisions?.settings).toEqual(selected);
});
