import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { useChatHistory } from "@agenteschat/client/lib/chat-history";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const composer = () => screen().getByRole("combobox", { name: /Mensagem para/ }) as HTMLTextAreaElement;
const send = async (text: string) => {
  await act(async () => fireEvent.change(composer(), { target: { value: text } }));
  // Dismiss the slash menu to exercise the typed-command send path too.
  await act(async () => fireEvent.keyDown(composer(), { key: "Escape" }));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: /^Enviar$/ })));
  await settle(5);
};

test("clear hides this chat without posting, survives reopening, and restores previous messages", async () => {
  const state = seedState();
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(6);
  expect(screen().getByText(/o login está devolvendo 401/)).toBeTruthy();
  const posts = state.calls.filter((c) => c.method === "chat.post").length;
  await send("/clear");
  expect(screen().queryByText(/o login está devolvendo 401/)).toBeNull();
  expect(screen().getByRole("button", { name: "Mostrar mensagens anteriores" })).toBeTruthy();
  expect(composer().value).toBe("");
  expect(state.calls.filter((c) => c.method === "chat.post")).toHaveLength(posts);
  await send("A new topic");
  expect(screen().getByText("A new topic")).toBeTruthy();
  expect(screen().queryByText(/o login está devolvendo 401/)).toBeNull();
  cleanup();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(6);
  expect(screen().queryByText(/o login está devolvendo 401/)).toBeNull();
  expect(screen().getByText("A new topic")).toBeTruthy();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Mostrar mensagens anteriores" })));
  await settle(3);
  expect(screen().getByText(/o login está devolvendo 401/)).toBeTruthy();
  expect(screen().getByText("A new topic")).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Mostrar mensagens anteriores" })).toBeNull();
});

test("the slash menu clears a DM and leaves another chat visible", async () => {
  const api = createFakeApi(seedState());
  await renderApp(`/org/${ORG_ID}/dm/agent/${ADA_ID}`, { api });
  await settle(6);
  await act(async () => fireEvent.change(composer(), { target: { value: "/cl" } }));
  await settle(2);
  await act(async () => fireEvent.keyDown(composer(), { key: "Enter" }));
  await settle(3);
  expect(screen().getByRole("button", { name: "Mostrar mensagens anteriores" })).toBeTruthy();
  expect(screen().queryAllByRole("article")).toHaveLength(0);
  cleanup();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(6);
  expect(screen().getByText(/o login está devolvendo 401/)).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Mostrar mensagens anteriores" })).toBeNull();
});

test("opening a link to a hidden message reveals it", async () => {
  const state = seedState();
  const target = "01a1ce56-d315-730e-b701-41fb61149384";
  const message = state.messages.find((m) => m.id === "m-1");
  if (!message) throw new Error("Missing fixture message");
  message.id = target;
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(6);
  await send("/clear");
  expect(document.querySelector(`[data-message-id="${target}"]`)).toBeNull();
  cleanup();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}?m=${target}`, { api });
  await settle(8);
  expect(document.querySelector(`[data-message-id="${target}"]`)).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Mostrar mensagens anteriores" })).toBeNull();
});

test("a thread clears its own replies without clearing the parent channel", async () => {
  const state = seedState();
  const root = state.messages.find((m) => m.id === "m-1");
  if (!root) throw new Error("Missing fixture message");
  state.messages.push({ ...root, id: "thread-reply", threadId: root.id, body: "Previous thread topic" });
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/threads/${root.id}`, { api });
  await settle(6);
  expect(screen().getByText("Previous thread topic")).toBeTruthy();
  const box = screen().getByRole("combobox", { name: "Responder na thread" });
  await act(async () => fireEvent.change(box, { target: { value: "/clear" } }));
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  await settle(3);
  expect(screen().queryByText("Previous thread topic")).toBeNull();
  expect(screen().getByRole("button", { name: "Mostrar mensagens anteriores" })).toBeTruthy();
  cleanup();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
  await settle(6);
  expect(screen().getByText(/o login está devolvendo 401/)).toBeTruthy();
  expect(screen().queryByRole("button", { name: "Mostrar mensagens anteriores" })).toBeNull();
});

test("a reused history hook keeps each person and conversation's own preference", () => {
  const values = new Map<string, string>();
  const read = (key: string) => values.get(key) ?? null;
  const write = (key: string, value: string) => values.set(key, value);
  const { result, rerender } = renderHook(({ scope }) => useChatHistory(scope, read, write), {
    initialProps: { scope: "person-a.chat-a" },
  });
  act(() => result.current.clear(seedState().messages));
  expect(result.current.cleared).toBe(true);
  rerender({ scope: "person-a.chat-b" });
  expect(result.current.cleared).toBe(false);
  rerender({ scope: "person-b.chat-a" });
  expect(result.current.cleared).toBe(false);
  rerender({ scope: "person-a.chat-a" });
  expect(result.current.cleared).toBe(true);
});
