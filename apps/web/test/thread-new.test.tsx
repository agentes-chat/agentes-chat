import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const searchOf = (r: { router: { state: { location: { search: unknown } } } }) =>
  r.router.state.location.search as Record<string, unknown>;
const posts = (state: ReturnType<typeof seedState>) => state.calls.filter((c) => c.method === "chat.post");

describe("Nova thread", () => {
  test("from the channel's Threads: the subject posts to the channel and its thread opens beside it, to reply", async () => {
    const state = seedState();
    const r = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);
    const header = document.querySelector(".channel__header") as HTMLElement;
    await click(header.querySelector(".channel__threads") as HTMLElement);
    await settle(3);
    const pop = screen().getByRole("dialog", { name: "Threads em #eng" });
    await click(within(pop).getByRole("button", { name: "Nova thread" }));
    const field = within(pop).getByRole("textbox", { name: "Assunto" });
    // Nothing to start yet: the button waits for words.
    expect((within(pop).getByRole("button", { name: "Abrir thread" }) as HTMLButtonElement).disabled).toBe(true);
    await type(field, "Revisão das capas de dezembro");
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await settle(6);
    const sent = posts(state);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.args[2]).toMatchObject({ body: "Revisão das capas de dezembro" });
    expect((sent[0]?.args[2] as { threadId?: string | null } | undefined)?.threadId ?? null).toBeNull();
    // Its thread is open in the panel, the reply field ready.
    expect(searchOf(r)).toMatchObject({ reply: true });
    expect(typeof searchOf(r).thread).toBe("string");
    expect(screen().queryByRole("dialog", { name: "Threads em #eng" })).toBeNull();
  });

  test("Cancelar leaves the list as it was, and Shift+Enter is a new line, not a send", async () => {
    const state = seedState();
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(8);
    await click(document.querySelector(".channel__threads") as HTMLElement);
    await settle(3);
    const pop = screen().getByRole("dialog", { name: "Threads em #eng" });
    await click(within(pop).getByRole("button", { name: "Nova thread" }));
    const field = within(pop).getByRole("textbox", { name: "Assunto" });
    await type(field, "uma linha");
    await act(async () => fireEvent.keyDown(field, { key: "Enter", shiftKey: true }));
    expect(posts(state)).toHaveLength(0);
    await click(within(pop).getByRole("button", { name: "Cancelar" }));
    expect(within(pop).queryByRole("textbox", { name: "Assunto" })).toBeNull();
    expect(within(pop).getByRole("button", { name: "Nova thread" })).toBeTruthy();
  });

  test("on the Threads page it is the first action: pick the channel, and the new thread opens on the page", async () => {
    const state = seedState();
    const r = await renderApp(`/org/${ORG_ID}/threads`, { api: createFakeApi(state) });
    await settle(8);
    const start = screen().getByRole("button", { name: "Nova thread" });
    expect(start.className).toContain("ac-btn--primary");
    await click(start);
    await settle(3);
    const dialog = screen().getByRole("dialog", { name: "Nova thread" });
    expect(within(dialog).getByRole("combobox", { name: "Canal" }).textContent).toContain("#");
    await type(within(dialog).getByRole("textbox", { name: "Assunto" }), "Plano do lançamento");
    await click(within(dialog).getByRole("button", { name: "Abrir thread" }));
    await settle(6);
    expect(posts(state)[0]?.args[2]).toMatchObject({ body: "Plano do lançamento" });
    expect(screen().queryByRole("dialog", { name: "Nova thread" })).toBeNull();
    expect(typeof searchOf(r).open).toBe("string");
  });
});
