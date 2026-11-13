import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { AiAccounts, AiComputer } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { createFakeAuth } from "./fake-auth";
import { renderApp, screen, settle } from "./render";

/*
 * A plan serves the whole workspace unless whoever connected it keeps it to themselves (ADR 0059 §3, amended
 * 2026-11-12): IA e uso says who uses each one and lets its owner choose; Sua conta changes the account's address.
 */

afterEach(() => cleanup());

const MAC: AiComputer = {
  machineId: "machine_1",
  name: "MacBook",
  online: true,
  mine: true,
  canAdd: true,
  keys: true,
  brains: { claude_code: true, codex: true },
};
const plan = (id: string, over: Partial<AiAccounts["accounts"][number]> = {}): AiAccounts["accounts"][number] => ({
  id,
  kind: "claude_code",
  label: "Claude",
  email: null,
  plan: "team",
  status: "active",
  ownerId: "u-walter",
  ownerName: "Walter",
  mine: true,
  usedBy: [],
  usage: null,
  provider: null,
  keyHint: null,
  machineId: "machine_1",
  computer: "MacBook",
  serves: "everyone",
  ...over,
});

const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};

describe("IA e uso: who uses each plan", () => {
  test("each row says it, and only who connected a plan chooses Todos do workspace or Só eu", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.setAiAccounts({
      accounts: [
        plan("acct_mine", { label: "Claude Team" }),
        plan("acct_joao", {
          label: "Claude 2",
          ownerId: "u-joao",
          ownerName: "João Silva",
          mine: false,
          serves: "owner",
        }),
      ],
      computers: [MAC],
    });
    await renderApp(`/org/${ORG_ID}/settings/usage`, { api });
    await settle(6);
    const plans = screen().getByRole("region", { name: "Contas" });
    const rows = [...plans.querySelectorAll(".plan-row")] as HTMLElement[];
    const mine = rows.find((r) => r.textContent?.includes("Claude Team")) as HTMLElement;
    const joao = rows.find((r) => r.textContent?.includes("Claude 2")) as HTMLElement;
    expect(mine.querySelector(".plan-acct__name")?.textContent).toContain("de Walter · Todos usam");
    expect(joao.querySelector(".plan-acct__name")?.textContent).toContain("de João · Só João usa");
    // Opened, the plan's owner chooses; on someone else's there is nothing to choose.
    await click(mine.querySelector(".plan-row__head") as HTMLElement);
    await click(joao.querySelector(".plan-row__head") as HTMLElement);
    expect(within(joao).queryByRole("radiogroup", { name: "Quem usa" })).toBeNull();
    const choice = within(mine).getByRole("radiogroup", { name: "Quem usa" });
    expect(within(mine).getByRole("button", { name: "Sobre os termos do plano" })).toBeTruthy();
    await click(within(choice).getByRole("radio", { name: "Só eu" }));
    expect(state.calls.filter((c) => c.method === "machines.setAccountServes").map((c) => c.args)).toEqual([
      [ORG_ID, "acct_mine", "owner"],
    ]);
  });
});

describe("Sua conta: the account's e-mail", () => {
  test("a new address gets a confirmation link, and the account stays the same", async () => {
    const fake = createFakeAuth();
    await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(seedState()), auth: fake.auth });
    await settle(6);
    await click(screen().getByRole("button", { name: /^E-mail/ }));
    const dialog = screen().getByRole("dialog", { name: "Mudar e-mail" });
    const change = within(dialog).getByRole("button", { name: "Mudar e-mail" });
    expect(change.hasAttribute("disabled")).toBe(true);
    await act(async () =>
      fireEvent.change(within(dialog).getByLabelText("Novo e-mail"), { target: { value: "walter@novo.example.com" } }),
    );
    await click(within(dialog).getByRole("button", { name: "Mudar e-mail" }));
    expect(fake.calls.filter((c) => c.method === "changeEmail").map((c) => c.args)).toEqual([
      ["walter@novo.example.com"],
    ]);
    expect(dialog.textContent).toContain("Enviamos um link para walter@novo.example.com.");
  });

  test("a server that sends no e-mail says so, with who can fix it", async () => {
    const fake = createFakeAuth({
      changeEmail: { ok: false, status: 400, message: "Verification email isn't enabled" },
    });
    await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(seedState()), auth: fake.auth });
    await settle(6);
    await click(screen().getByRole("button", { name: /^E-mail/ }));
    const dialog = screen().getByRole("dialog", { name: "Mudar e-mail" });
    await act(async () =>
      fireEvent.change(within(dialog).getByLabelText("Novo e-mail"), { target: { value: "walter@novo.example.com" } }),
    );
    await click(within(dialog).getByRole("button", { name: "Mudar e-mail" }));
    expect(dialog.textContent).toContain("Este servidor não envia e-mails");
  });
});
