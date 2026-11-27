import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { fakeMicrophone } from "@agenteschat/ui/testing";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/** The microphone where nothing turns voice into text yet (`speechState`): it shows, and the first press asks. */

let restore = () => {};
afterEach(() => {
  cleanup();
  restore();
  restore = () => {};
  localStorage.clear();
});

const open = async (state: ReturnType<typeof seedState>) => {
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(5);
  return state;
};
const press = () =>
  act(async () => {
    fireEvent.pointerDown(screen().getByRole("button", { name: "Gravar áudio" }), { button: 0 });
    fireEvent.pointerUp(window);
  });
const recording = () => screen().queryByRole("button", { name: "Pausar" });

describe("the microphone with no engine on the server", () => {
  test("a member asks the owner by name, and the next press records at once", async () => {
    restore = fakeMicrophone();
    const state = await open(
      seedState({ media: { speechState: "none", speechOwner: { userId: "u-joao", name: "João" } } }),
    );
    await press();
    await settle();
    const dialog = screen().getByRole("dialog", { name: "A voz ainda não está ligada aqui" });
    expect(dialog.textContent).toContain("Os agentes só vão ouvir quando João escolher");
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Pedir para João" })));
    await settle();
    expect(state.calls.some((c) => c.method === "notifications.askAdmins")).toBe(true);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(recording()).toBeNull();
    await press();
    await act(() => Bun.sleep(150));
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(recording()).not.toBeNull();
  });

  test("Record anyway starts the take the person pressed for", async () => {
    restore = fakeMicrophone();
    await open(seedState({ media: { speechState: "none", speechOwner: null } }));
    await press();
    await settle();
    expect(screen().getByRole("dialog").textContent).toContain("quem cuida deste servidor");
    // Nobody to ask by name: no Ask button.
    expect(screen().queryByRole("button", { name: /Pedir para/ })).toBeNull();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Gravar mesmo assim" })));
    await act(() => Bun.sleep(150));
    expect(recording()).not.toBeNull();
  });

  test("the server's owner chooses what turns voice into text right there", async () => {
    restore = fakeMicrophone();
    await open(
      seedState({
        media: { speechState: "none", speechOwner: { userId: "u-walter", name: "Walter" } },
        speechKey: { provider: null, hint: null, state: "off", envProviders: [] },
      }),
    );
    await press();
    await settle();
    expect(screen().getByRole("dialog", { name: "Escolha o que transforma a voz em texto" })).toBeTruthy();
    expect(screen().getByRole("radio", { name: "AssemblyAI" })).toBeTruthy();
    fireEvent.change(screen().getByLabelText("Chave da AssemblyAI"), { target: { value: "aai-key-12345678" } });
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Testar" })));
    await settle();
    expect(screen().getByRole("dialog", { name: "As mensagens de voz estão ligadas" })).toBeTruthy();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Gravar uma mensagem" })));
    await act(() => Bun.sleep(150));
    expect(recording()).not.toBeNull();
  });

  test("an older server without the state keeps the microphone hidden with no engine", async () => {
    await open(seedState());
    expect(screen().queryByRole("button", { name: "Gravar áudio" })).toBeNull();
  });
});
