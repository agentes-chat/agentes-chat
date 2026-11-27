import { afterEach, beforeEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, ENG_ID, GENERAL_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

// What I type and don't send stays in this browser: switching conversations or reloading keeps it.

const BOOK = "agentes.drafts.u-walter";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const box = (name: string) => screen().getByRole("combobox", { name }) as HTMLTextAreaElement;
const type = (el: HTMLTextAreaElement, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

test("a text left in a channel's composer is there again after a reload, and only in that channel", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
  await settle(8);
  await type(box("Mensagem para #eng"), "metade de uma ideia");
  await wait(500);
  expect(JSON.parse(localStorage.getItem(BOOK) ?? "{}")[`channel:${ENG_ID}`]?.text).toBe("metade de uma ideia");
  cleanup();

  // "Reload": the app starts again with the same browser storage.
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  expect(box("Mensagem para #eng").value).toBe("metade de uma ideia");
  cleanup();

  await renderApp(`/org/${ORG_ID}/c/${GENERAL_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  expect(box("Mensagem para #general").value).toBe("");
});

test("leaving the conversation right after typing still keeps the text", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  await type(box("Mensagem para #eng"), "rápido");
  cleanup();
  expect(JSON.parse(localStorage.getItem(BOOK) ?? "{}")[`channel:${ENG_ID}`]?.text).toBe("rápido");
});

/** Picks files in the open conversation's composer, as its paper clip does. */
const attach = async (...files: File[]) => {
  const input = document.querySelector('.channel__composer input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => fireEvent.change(input));
  await settle(4);
};

test("a file attached and not sent is there again after leaving the conversation, with the text", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  await type(box("Mensagem para #eng"), "olha esse print");
  await attach(new File([new Uint8Array([137, 80, 78, 71])], "print.png", { type: "image/png" }));
  expect(screen().getByRole("button", { name: "Remover print.png" })).toBeTruthy();
  cleanup();

  // Another screen and back (or a reload): the same browser storage.
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  expect(box("Mensagem para #eng").value).toBe("olha esse print");
  expect(screen().getByRole("button", { name: "Remover print.png" })).toBeTruthy();
  // It goes with the message, already in the Drive: nothing is uploaded again.
  expect(state.calls.filter((c) => c.method === "artifacts.upload")).toHaveLength(1);
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Enviar" })));
  await settle(4);
  const post = state.calls.find((c) => c.method === "chat.post")?.args[2] as { attachments?: string[] };
  expect(post.attachments).toHaveLength(1);
  await wait(500);
  expect(localStorage.getItem(BOOK)).toBeNull();
});

test("a file removed from the composer is gone from the draft too; other conversations never get it", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  await attach(new File(["oi"], "notas.txt", { type: "text/plain" }));
  expect(JSON.parse(localStorage.getItem(BOOK) ?? "{}")[`channel:${ENG_ID}`]?.files).toHaveLength(1);
  cleanup();

  await renderApp(`/org/${ORG_ID}/c/${GENERAL_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  expect(screen().queryByRole("button", { name: "Remover notas.txt" })).toBeNull();
  cleanup();

  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Remover notas.txt" })));
  await settle(2);
  expect(localStorage.getItem(BOOK)).toBeNull();
});

test("sending clears the saved text", async () => {
  const state = seedState();
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state), reload: true });
  await settle(8);
  const el = box("Mensagem para #eng");
  await type(el, "vai agora");
  await wait(500);
  await act(async () => fireEvent.keyDown(el, { key: "Enter" }));
  await settle(4);
  expect(state.calls.some((c) => c.method === "chat.post")).toBe(true);
  await wait(500);
  expect(localStorage.getItem(BOOK)).toBeNull();
});
