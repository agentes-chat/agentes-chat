import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

/** Settings › Chaves de IA › Adicionar chave on a server that offers `providers` alone (`MODEL_PROVIDERS`). */
async function openAddKey(providers?: string[]) {
  const state = seedState();
  state.aiStatus = { any: true, agents: [], ...(providers ? { providers } : {}) };
  await renderApp(`/org/${ORG_ID}/settings/keys`, { api: createFakeApi(state) });
  await settle(5);
  const keys = screen().getByRole("region", { name: "Chaves de provedor" });
  await act(async () => fireEvent.click(within(keys).getByRole("button", { name: "Adicionar chave" })));
  await settle(4);
  const dialog = screen().getByRole("dialog", { name: "Adicionar chave de API" });
  // Where to create the picked provider's key.
  const site = within(dialog).queryByRole("link", { name: /platform\./ })?.textContent;
  const combobox = within(dialog).getByRole("combobox", { name: "Provedor" });
  combobox.focus();
  await act(async () => fireEvent.keyDown(combobox, { key: "Enter" }));
  const options = screen().getAllByRole("option");
  return {
    options: options.map((o) => o.textContent ?? ""),
    site,
  };
}

describe("Chaves de IA on a server that limits the providers", () => {
  test("only the providers it offers, the first of them picked", async () => {
    const { options, site } = await openAddKey(["openai", "gemini", "api_keys"]);
    expect(options).toEqual(["OpenAI", "Gemini"]);
    expect(site).toContain("platform.openai.com");
  });

  test("a server that sends no list offers every provider and Outro provedor", async () => {
    const { options, site } = await openAddKey();
    expect(options[0]).toBe("Claude");
    expect(site).toContain("platform.claude.com");
    expect(options.some((o) => o.startsWith("Outro provedor"))).toBe(true);
  });
});
