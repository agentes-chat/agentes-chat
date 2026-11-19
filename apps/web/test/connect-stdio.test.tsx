import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConnectFlow } from "@/components/ConnectFlow";
import { ConnectStdio } from "@/components/ConnectStdio";
import { createFakeApi, seedState } from "./fake-api";
import { renderPage, screen } from "./render";

afterEach(cleanup);

test("the existing MCP dialog keeps both drafts when switching transport tabs", async () => {
  const api = createFakeApi(seedState());
  api.customConnectors.transports = async () => ({ stdio: true });
  await renderPage(<ConnectFlow flow={{ step: 0, def: null }} onChange={() => {}} onClose={() => {}} />, {
    api,
    org: true,
  });
  const click = async (label: string) =>
    act(async () => {
      fireEvent.click(screen().getByRole("radio", { name: label }));
    });
  await click("Programa local · stdio");
  const field = await screen().findByLabelText("Executável");
  await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false));
  await act(async () => {
    fireEvent.change(field, { target: { value: "my-mcp" } });
  });
  await click("HTTP");
  await click("Programa local · stdio");
  expect((screen().getByLabelText("Executável") as HTMLInputElement).value).toBe("my-mcp");
});

test("disabled stdio explains execution host and cannot submit", async () => {
  const api = createFakeApi(seedState());
  await renderPage(<ConnectStdio tabs={null} returnTo="/" onClose={() => {}} onConnected={() => {}} />, {
    api,
    org: true,
  });
  await screen().findByText(/Programas locais estão desativados/);
  expect(screen().getByText(/Executa onde o agentes/).textContent).toContain("contêiner");
  expect((screen().getByRole("button", { name: "Conectar" }) as HTMLButtonElement).disabled).toBe(true);
});

test("validates JSON before submitting and passes separate argv/env to existing connect flow", async () => {
  const api = createFakeApi(seedState());
  api.customConnectors.transports = async () => ({ stdio: true });
  const sent: unknown[] = [];
  const connect = api.customConnectors.connect;
  api.customConnectors.connect = async (orgId, input) => {
    sent.push(input);
    return connect(orgId, input);
  };
  let connected = false;
  await renderPage(
    <ConnectStdio
      tabs={null}
      returnTo="/"
      onClose={() => {}}
      onConnected={() => {
        connected = true;
      }}
    />,
    { api, org: true },
  );
  const submit = await screen().findByRole("button", { name: "Conectar" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  const type = async (name: string, value: string) =>
    act(async () => {
      fireEvent.change(screen().getByLabelText(name), { target: { value } });
    });
  await type("Executável", "node");
  await type("Argumentos (lista JSON)", "broken");
  await act(async () => {
    fireEvent.click(submit);
  });
  expect(sent).toEqual([]);
  await screen().findByText(/Informe um executável, uma lista JSON/);
  await type("Argumentos (lista JSON)", '["C:/a path/server.js","mcp"]');
  await act(async () => {
    fireEvent.click(submit);
  });
  await waitFor(() => expect(connected).toBe(true));
  expect((sent[0] as { stdio: unknown }).stdio).toEqual({
    command: "node",
    args: ["C:/a path/server.js", "mcp"],
    env: {},
  });
});
