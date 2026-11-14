import { afterEach, describe, expect, test } from "bun:test";
import type { MachineAccount } from "@agenteschat/client";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppProviders } from "@/app/providers";
import { AddAccount } from "@/components/ai/AddAccountFlow";
import { OrgProvider } from "@/components/org-context";
import { createFakeApi, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { makeServices, screen, settle } from "./render";

/*
 * Adding a Muse account (ADR 0174): its CLI signs in by device code, so the dialog shows the page, then the code Meta's
 * page asks the person to confirm, then waits for the computer to finish by itself. The code belongs to that sign-in:
 * nothing shows it before one starts.
 */

afterEach(() => cleanup());

const CODE = "PXGP-CRND";

/** The dialog for one account of `kind` on a connected MacBook, as the agent's place shows it. */
async function open(kind: "muse") {
  const state = seedState();
  const api = createFakeApi(state);
  fakeMachinesOf.get(api)?.pair({
    id: "machine_1",
    name: "MacBook",
    os: "darwin",
    access: { folders: [], tools: { claude: true, codex: true, commands: true } },
  });
  const org = await api.orgs.get(ORG_ID);
  const me = await api.account.me();
  if (!org || !me) throw new Error("the seeded workspace and person are there");
  const services = makeServices(api);
  const added: MachineAccount[] = [];
  render(
    <AppProviders services={services}>
      <OrgProvider org={org} me={me}>
        <AddAccount machineId="machine_1" kind={kind} computer="MacBook" onAdded={(account) => added.push(account)} />
      </OrgProvider>
    </AppProviders>,
  );
  await settle(4);
  return { api, state, services, added };
}

/** The code a device sign-in shows, by the label above it; null while none shows. */
const codeShown = () => screen().queryByLabelText("Código para o Muse")?.textContent ?? null;

/** Presses the sign-in's button, the provider's page opening beside (`window.open`, as the click itself does). */
async function startSignIn() {
  const realOpen = window.open;
  window.open = (() => ({ closed: false, opener: {}, location: { replace: () => {} }, close: () => {} })) as never;
  try {
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Entrar com o Muse Code" })));
    await settle(6);
  } finally {
    window.open = realOpen;
  }
}

describe("a Muse account's sign-in", () => {
  test("no code shows before the sign-in starts: only its step and its button", async () => {
    await open("muse");
    expect(codeShown()).toBeNull();
    expect(screen().getByRole("button", { name: "Entrar com o Muse Code" })).toBeTruthy();
    expect(screen().queryByText(/Aguardo|Aguardando/)).toBeNull();
  });

  test("the computer's sign-in brings Meta's page and its code, shown under the step", async () => {
    const { state } = await open("muse");
    await startSignIn();
    // The computer began a Muse sign-in, and its answer carried the code.
    expect(state.calls.some((c) => c.method === "machines.beginAccountLogin")).toBe(true);
    expect(codeShown()).toBe(CODE);
    // Its one-time code is typed on the page that opened, and the step waits for the computer.
    expect(screen().getByText("Digite este código na página que abrir.")).toBeTruthy();
    expect(
      screen()
        .queryAllByRole("status")
        .map((s) => s.textContent),
    ).toContain("Esperando");
  });

  test("a sign-in that comes back with no code says to confirm it on Muse's page instead", async () => {
    const { api } = await open("muse");
    // The computer printed no code: the page alone has to be confirmed.
    const begin = api.machines.beginAccountLogin;
    api.machines.beginAccountLogin = async (...args) => {
      const { userCode: _, ...rest } = await begin(...args);
      return rest;
    };
    await startSignIn();
    expect(codeShown()).toBeNull();
    expect(screen().getByText("Confirme o código na página do Muse. O MacBook termina sozinho.")).toBeTruthy();
  });
});
