import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { FolderAccessRequest } from "@agenteschat/client";
import { ApiError, keys } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(cleanup);

const request = (machineId: string, patch: Partial<FolderAccessRequest> = {}): FolderAccessRequest => ({
  id: "00000000-0000-4000-8000-000000000111",
  machineId,
  agent: { id: ADA_ID, name: "Ada", handle: "ada" },
  path: `/home/test/Projects/${"a-long-folder-name/".repeat(8)}Project's docs`,
  reason: "Verificar os documentos sem alterar arquivos.",
  status: "pending",
  createdAt: "2026-11-14T12:00:00Z",
  expiresAt: "2099-11-15T12:00:00Z",
  decidedAt: null,
  command: "agentes-runner folders allow '/home/test/Project'\\''s docs' --agent ada",
  ...patch,
});

async function open(canManage = true) {
  const state = seedState();
  const api = createFakeApi(state);
  const fake = fakeMachinesOf.get(api);
  if (!fake) throw new Error("Missing computer fixture");
  const m = fake.pair({ name: "Test computer", canManage, online: false });
  const r = request(m.id);
  fake.setFolderRequests(m.id, [r, { ...r, id: "older" }]);
  return { state, api, fake, m, r };
}

test("computer shows a pending request once, full path, offline state and a local command, never a web approval", async () => {
  const { api, m, r } = await open();
  await renderApp(`/org/${ORG_ID}/settings/devices/${m.id}`, { api });
  await settle(8);
  const card = screen().getByRole("region", { name: "Pedidos de acesso a pastas" });
  expect(card.querySelectorAll("[data-request-id]")).toHaveLength(1);
  expect(card.textContent).toContain(r.path);
  expect(card.textContent).toContain("Aguardando acesso");
  const how = within(card).getByText("Como liberar acesso");
  await act(async () => {
    fireEvent.click(how);
  });
  expect(card.textContent).toContain("não no servidor do chat");
  expect(card.textContent).toContain("Não é uma permissão de somente leitura");
  expect(card.querySelector(".machine-command__code")?.textContent).toBe(r.command ?? "");
  expect(within(card).getByRole("button", { name: "Copiar" })).toBeTruthy();
  expect(within(card).queryByRole("button", { name: "Aprovar" })).toBeNull();
});

test("only a manager lists requests, and failures have a retry", async () => {
  const { api, m, state } = await open(false);
  await renderApp(`/org/${ORG_ID}/settings/devices/${m.id}`, { api });
  await settle(8);
  expect(screen().queryByRole("region", { name: "Pedidos de acesso a pastas" })).toBeNull();
  expect(state.calls.some((c) => c.method === "machines.folderRequests")).toBe(false);
  cleanup();
  const own = await open();
  own.api.machines.folderRequests = async () => {
    throw new ApiError(503, "unavailable", "Unavailable");
  };
  await renderApp(`/org/${ORG_ID}/settings/devices/${own.m.id}`, { api: own.api });
  await settle(8);
  const card = screen().getByRole("region", { name: "Pedidos de acesso a pastas" });
  expect(within(card).getByRole("alert")).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});

test("conversation card looks up its exact request and updates after a decision, including on reload", async () => {
  const { api, fake, m, r, state } = await open();
  const base = state.messages[0];
  if (!base) throw new Error("Missing message fixture");
  state.messages.push({
    ...base,
    id: "folder-note",
    threadId: null,
    author: { type: "agent", id: ADA_ID },
    body: "Asked for a folder",
    mentionedAgentIds: [],
    createdAt: new Date().toISOString(),
    meta: {
      bodyCode: "machine_access_requested",
      machineAccess: {
        machineId: m.id,
        requestId: r.id,
        computer: m.name,
      },
      bodyParams: { path: r.path, computer: m.name },
    },
  });
  const app = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(10);
  expect(document.querySelector("[data-request-id]")?.textContent).toContain("Aguardando acesso");
  fake.setFolderRequests(m.id, [{ ...r, status: "granted", decidedAt: new Date().toISOString() }]);
  await act(async () => {
    await app.services.queryClient.invalidateQueries({ queryKey: keys.folderRequests(ORG_ID, m.id, r.id) });
  });
  await settle(4);
  expect(document.querySelector("[data-request-id]")?.textContent).toContain("Acesso liberado");
  expect(document.querySelector(".folder-request__help")).toBeNull();
  cleanup();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(10);
  expect(document.querySelector("[data-request-id]")?.textContent).toContain("Acesso liberado");
});

test("closed requests show their real status and no longer offer local grant instructions", async () => {
  const { api, fake, m, r } = await open();
  fake.setFolderRequests(m.id, [
    { ...r, status: "denied" },
    { ...r, id: "expired", status: "expired" },
    { ...r, id: "failed", status: "failed" },
  ]);
  await renderApp(`/org/${ORG_ID}/settings/devices/${m.id}`, { api });
  await settle(8);
  const card = screen().getByRole("region", { name: "Pedidos de acesso a pastas" });
  for (const text of ["Acesso recusado", "Pedido expirado", "Pedido falhou"]) expect(card.textContent).toContain(text);
  expect(card.querySelector("summary")).toBeNull();
});
