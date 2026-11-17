import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { createFakeAuth } from "./fake-auth";
import { renderApp, screen, settle } from "./render";

/** Configurações › Sua conta › Verificação em duas etapas (ADR 0194). */

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const URI = "otpauth://totp/agentes.chat:ana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=agentes.chat";

async function open(state: ReturnType<typeof seedState>, auth = createFakeAuth()) {
  await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(state), auth: auth.auth });
  await settle(6);
  await click(screen().getByRole("button", { name: /^Verificação em duas etapas/ }));
  await settle(4);
  return { dialog: screen().getByRole("dialog", { name: "Verificação em duas etapas" }), calls: auth.calls };
}

describe("two-step sign-in in Sua conta", () => {
  test("turning it on: the password, the QR code and its key, the app's first code, then the recovery codes", async () => {
    const auth = createFakeAuth({
      twoFactorSetup: { ok: true, totpURI: URI, backupCodes: ["aaaaa-11111", "bbbbb-22222"] },
    });
    const { dialog, calls } = await open(seedState(), auth);
    await type(within(dialog).getByLabelText("Sua senha"), "correct horse battery");
    await click(within(dialog).getByRole("button", { name: "Continuar" }));
    await settle(4);
    expect(within(dialog).getByRole("img", { name: /Escaneie este código/ })).toBeTruthy();
    expect(within(dialog).getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    const turnOn = within(dialog).getByRole("button", { name: "Ativar" });
    expect(turnOn.hasAttribute("disabled")).toBe(true);
    await type(within(dialog).getByLabelText("Código do app"), "123456");
    await click(turnOn);
    await settle(4);
    const codes = screen().getByRole("dialog", { name: "Guarde seus códigos de recuperação" });
    expect(within(codes).getByText("aaaaa-11111")).toBeTruthy();
    expect(within(codes).getByText("bbbbb-22222")).toBeTruthy();
    expect(calls.map((c) => c.method)).toEqual(["enableTwoFactor", "verifyTwoFactor"]);
    expect(calls[1]?.args[0]).toEqual({ code: "123456" });
  });

  test("a session too old to change it: sign in again instead", async () => {
    const auth = createFakeAuth({
      twoFactorSetup: { ok: false, status: 403, code: "reauth.sign_in", message: "Sign in again" },
    });
    const { dialog } = await open(seedState(), auth);
    await type(within(dialog).getByLabelText("Sua senha"), "correct horse battery");
    await click(within(dialog).getByRole("button", { name: "Continuar" }));
    await settle(4);
    expect(within(dialog).getByText("Entre de novo para mudar a verificação em duas etapas.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Entrar de novo" })).toBeTruthy();
  });

  test("an account with no password adds one first", async () => {
    const state = seedState();
    if (!state.me) throw new Error("signed in");
    state.me.user.hasPassword = false;
    const { dialog } = await open(state);
    expect(within(dialog).queryByLabelText("Sua senha")).toBeNull();
    await click(within(dialog).getByRole("button", { name: "Adicionar uma senha" }));
    await settle(4);
    expect(screen().getByRole("dialog", { name: "Adicionar uma senha" })).toBeTruthy();
  });

  test("turned on: new recovery codes or turn it off, each with the password", async () => {
    const state = seedState();
    if (!state.me) throw new Error("signed in");
    state.me.user.twoFactorEnabled = true;
    const { dialog, calls } = await open(state);
    expect(within(dialog).getByText(/deixam de valer/)).toBeTruthy();
    const off = within(dialog).getByRole("button", { name: "Desativar" });
    expect(off.hasAttribute("disabled")).toBe(true);
    await type(within(dialog).getByLabelText("Sua senha"), "correct horse battery");
    await click(off);
    await settle(4);
    expect(calls.map((c) => c.method)).toEqual(["disableTwoFactor"]);
    expect(screen().queryByRole("dialog", { name: "Verificação em duas etapas" })).toBeNull();
  });
});
