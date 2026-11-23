import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { createFakeAuth } from "./fake-auth";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const SETTINGS = `/org/${ORG_ID}/settings/account`;

/** Configurações › Sua conta on a server that offers Google and GitHub, the account signing in with GitHub. */
async function openAccount(path = SETTINGS, providers: ("google" | "github" | "apple")[] | null = ["github"]) {
  const state = seedState({ authConfig: { socialProviders: { google: true, github: true, apple: false } } });
  if (providers && state.me) state.me.user.providers = providers;
  const { auth, calls } = createFakeAuth();
  await renderApp(path, { api: createFakeApi(state), auth });
  await settle(6);
  return { calls, state };
}

const card = () => screen().getByRole("region", { name: "Formas de entrar" });

describe("Sua conta › Formas de entrar", () => {
  test("each provider the server offers: connected, or a button that connects it back to this page", async () => {
    const { calls } = await openAccount();
    const rows = within(card());
    expect(rows.queryByText("Apple")).toBeNull();
    expect(rows.getByText("GitHub")).toBeTruthy();
    expect(rows.getByText("Conectado")).toBeTruthy();
    expect(rows.queryByRole("button", { name: "Conectar GitHub" })).toBeNull();

    await act(async () => fireEvent.click(rows.getByRole("button", { name: "Conectar Google" })));
    expect(calls.filter((c) => c.method === "linkSocial")).toEqual([
      { method: "linkSocial", args: ["google", SETTINGS, `${SETTINGS}?connecting=google`] },
    ]);
  });

  test("back from Google with another email: why, in the person's words, until closed", async () => {
    await openAccount(`${SETTINGS}?connecting=google&error=email_does_not_match`);
    const alert = within(card()).getByRole("alert");
    expect(alert.textContent).toBe("Essa conta do Google usa outro e-mail. Conecte uma que use walter@acme.com.br.");

    await act(async () => fireEvent.click(within(card()).getByRole("button", { name: "Fechar" })));
    await settle(2);
    expect(within(card()).queryByRole("alert")).toBeNull();
  });

  test("a server from before the list sends no `providers`: no card", async () => {
    await openAccount(SETTINGS, null);
    expect(screen().queryByRole("heading", { name: "Formas de entrar" })).toBeNull();
    expect(screen().getByRole("heading", { name: "Neste aparelho" })).toBeTruthy();
  });
});
