import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = async (el: Element, rounds = 2) => {
  await act(async () => fireEvent.click(el));
  await settle(rounds);
};
const type = async (el: Element, value: string, rounds = 2) => {
  await act(async () => fireEvent.change(el, { target: { value } }));
  await settle(rounds);
};
const flow = () => screen().getAllByRole("dialog").at(-1) as HTMLElement;
/** A state for CI's geometry check (laid out at 1280, 390 and 320). */
const snapshot = () => (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();
/** The dialog header's back: a stage back. */
const back = () => within(flow()).getByRole("button", { name: "Voltar" });
const connectCalls = (state: ReturnType<typeof seedState>) =>
  state.calls.filter((c) => c.method === "customConnectors.connect").map((c) => c.args[1] as Record<string, unknown>);

/** Settings › Connectors, "Connect by address": its one question answered, then "Continue". */
async function byAddress(address: string, state = seedState()) {
  await renderApp(`/org/${ORG_ID}/settings/connectors`, { api: createFakeApi(state) });
  await settle(8);
  await click(screen().getByRole("button", { name: "Conectar pelo endereço" }));
  expect(screen().getByRole("dialog", { name: "Conectar um servidor" })).toBe(flow());
  await type(within(flow()).getByLabelText("Qual é o endereço do servidor?"), address);
  snapshot();
  await click(within(flow()).getByRole("button", { name: "Continuar" }), 4);
  return state;
}

/** Connecting in stages, one thing each (ADR 0016 addendum 2026-11-23). */
describe("connecting a server by address, in stages", () => {
  test("a server that refuses our address: open its page, then paste where its sign-in ended; it connects at once", async () => {
    const state = await byAddress("https://mcp.acme.com/loopback");
    // The dialog that can take the return pasted says so; named after the address from here on.
    expect(connectCalls(state)).toEqual([
      expect.objectContaining({ serverUrl: "https://mcp.acme.com/loopback", label: "acme.com", paste: true }),
    ]);
    expect(screen().getByRole("dialog", { name: "Conectar acme.com" })).toBe(flow());
    expect(flow().textContent).toContain("Entre no acme.com e autorize");
    const open = () => within(flow()).getByRole("link", { name: "Abrir o acme.com" });
    expect(open().getAttribute("href")).toBe("https://auth.example.com/authorize?client_id=c1&state=paste-1");
    expect([open().getAttribute("target"), open().getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    snapshot();

    // Back a stage: the address as it was typed, and Continue asks again.
    await click(back());
    expect((within(flow()).getByLabelText("Qual é o endereço do servidor?") as HTMLInputElement).value).toBe(
      "https://mcp.acme.com/loopback",
    );
    await click(within(flow()).getByRole("button", { name: "Continuar" }), 4);
    await click(open());
    const field = () => within(flow()).getByLabelText("Cole o endereço dessa página");
    // The page that doesn't load, drawn with the address to bring.
    expect(flow().querySelector(".cflow-paste__addr")?.textContent).toContain("localhost:8976/callback");

    // Anything but that page's address says what it starts with; the provider's no says so. Neither is sent.
    await type(field(), "https://acme.com/entrar");
    expect(flow().textContent).toContain("Esse não é o endereço dessa página. Ele começa com http://localhost.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    snapshot();
    await type(field(), "http://localhost:8976/callback?error=access_denied&state=paste-2");
    expect(flow().textContent).toContain("O acme.com não foi autorizado. Abra de novo para tentar outra vez.");
    // Another authorization's address (the first one, opened before going back) is not this one.
    await type(field(), "http://localhost:8976/callback?code=fake-code&state=paste-1");
    expect(flow().textContent).toContain("Esse não é o endereço dessa página.");

    // Back to opening it, and again: what was pasted stays.
    await click(back());
    expect(flow().textContent).toContain("Entre no acme.com e autorize");
    await click(open());
    expect((field() as HTMLInputElement).value).toBe("http://localhost:8976/callback?code=fake-code&state=paste-1");

    // Pasted as the browser's bar shows it, without its scheme: connected, as if it came back from the sign-in.
    await type(field(), "localhost:8976/callback?code=fake-code&state=paste-2", 10);
    expect(screen().getByRole("dialog", { name: "acme.com conectado" })).toBe(flow());
  });

  test("a server that lets in only apps it approved: our address to register, then the app's ID; a key from the footer", async () => {
    const state = await byAddress("https://mcp.vendor.com/closed");
    expect(screen().getByRole("dialog", { name: "Conectar vendor.com" })).toBe(flow());
    expect(flow().textContent).toContain("O vendor.com só aceita apps que ele aprovou");
    expect(flow().querySelector(".cflow__said")?.textContent).toBe(
      "O servidor respondeu: invalid_client_metadata: Dynamic registration is not available for this client.",
    );
    expect(flow().querySelector(".machine-command__code")?.textContent).toBe(
      "https://chat.example.com/api/app/connectors/oauth/callback",
    );
    snapshot();

    await click(within(flow()).getByRole("button", { name: "Já criei" }));
    expect(within(flow()).getByLabelText("Cole o ID do app")).toBeTruthy();
    // Its secret and scopes, which few apps need, folded.
    expect(
      within(flow())
        .getByRole("button", { name: /^Chave secreta e escopos/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await click(within(flow()).getByRole("button", { name: "Salvar e continuar" }));
    expect(flow().textContent).toContain("Cole o ID do cliente do app.");
    snapshot();
    await click(back());
    expect(flow().textContent).toContain("O vendor.com só aceita apps que ele aprovou");

    // The key, from the footer: its own stage, with the app as the other way.
    await click(within(flow()).getByRole("button", { name: "Conectar com a chave" }));
    expect(flow().textContent).toContain("Se ele te der uma chave de API, dá para conectar com ela.");
    expect(within(flow()).getByRole("button", { name: "Usar um app seu" })).toBeTruthy();
    await click(within(flow()).getByRole("button", { name: "Conectar com a chave" }));
    expect(flow().textContent).toContain("Cole a chave de API (pelo menos 8 caracteres).");
    snapshot();
    await type(within(flow()).getByLabelText("Chave de API"), "fake-key-12345");
    await click(within(flow()).getByRole("button", { name: "Conectar com a chave" }), 6);
    expect(connectCalls(state).at(-1)).toMatchObject({
      serverUrl: "https://mcp.vendor.com/closed",
      label: "vendor.com",
      apiKey: "[redacted]",
    });
    expect(screen().getByRole("dialog", { name: "vendor.com conectado" })).toBe(flow());
    snapshot();
  });

  test("a member refused the same way: the key, and that an admin can do the rest", async () => {
    const state = seedState();
    const org = state.me?.organizations[0];
    if (org) org.role = "member";
    await byAddress("https://mcp.vendor.com/closed", state);
    expect(flow().textContent).toContain("O vendor.com só aceita apps que ele aprovou");
    expect(flow().textContent).toContain(
      "Um admin pode conectar com um app do workspace, ou use uma chave de API se o vendor.com der uma.",
    );
    expect(within(flow()).getByLabelText("Chave de API")).toBeTruthy();
    expect(within(flow()).queryByRole("button", { name: "Usar um app seu" })).toBeNull();
    // Back: the address again.
    await click(back());
    expect(screen().getByRole("dialog", { name: "Conectar um servidor" })).toBe(flow());
  });
});
