import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { AiChoice, PlanChoice } from "@agenteschat/client/lib/no-ai";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ConnectChoices } from "@/components/arrival/ConnectChoices";
import { createFakeApi, seedState } from "./fake-api";
import { renderPage, screen, settle } from "./render";

/*
 * Which AI (ADR 0160), as flat rows everywhere the choices show (ADR 0256, addendum of 2026-11-27): each maker's bare
 * mark on the title's line, the title, its line, the chevron; no card, no chip. The other plans' row leads with three
 * of their makers and opens them here; the free way in says what it is in its line.
 */

afterEach(() => cleanup());

const choices = async (opts: { mayAddKey?: boolean; dims?: (c: PlanChoice) => boolean } = {}) => {
  const picked: AiChoice[] = [];
  await renderPage(
    <ConnectChoices
      mayAddKey={opts.mayAddKey ?? true}
      dims={opts.dims ?? (() => false)}
      onPick={(c) => picked.push(c)}
    />,
    { api: createFakeApi(seedState()) },
  );
  await settle(2);
  return picked;
};
const list = () => document.querySelector(".arrival-opts") as HTMLElement;
const rows = () =>
  [...list().querySelectorAll(":scope > .ac-optrow")].map((r) => ({
    title: r.querySelector(".ac-optrow__title")?.textContent,
    line: r.querySelector(".ac-optrow__desc")?.textContent,
  }));

describe("the AI's choices as flat rows (ConnectChoices)", () => {
  test("the two plans most people have, the others, a key, and starting free last; flat, with no chip", async () => {
    await choices();
    expect(list().classList.contains("ac-optlinks--flat")).toBe(true);
    expect(rows()).toEqual([
      { title: "Claude", line: "Pro, Max, Ultra, Team ou Enterprise" },
      { title: "ChatGPT", line: "Plus, Pro, Business ou Enterprise" },
      { title: "Outro plano", line: expect.stringMatching(/^Gemini, Grok, Cursor, /) },
      { title: "Chave de API", line: expect.any(String) },
      { title: "Começar grátis", line: "Sem assinatura, com os modelos grátis do OpenCode" },
    ]);
    // No pill anywhere: "Começar grátis" says what it is in its line.
    expect(list().querySelector(".ac-chip")).toBeNull();
    // Every row leads with its mark (or the key's icon), a chevron at its end.
    expect(list().querySelectorAll(":scope > .ac-optrow > .ac-optrow__lead")).toHaveLength(5);
    expect(list().querySelectorAll(":scope > .ac-optrow > .ac-optrow__go")).toHaveLength(5);
  });

  test("each maker's bare mark at a line icon's size; the other plans' row, a stack of three makers", async () => {
    await choices();
    const lead = (title: string) =>
      within(list()).getByRole("button", { name: title }).closest(".ac-optrow")?.querySelector(".ac-optrow__lead");
    expect(lead("Claude")?.querySelector(".ac-brand")?.classList.contains("ac-brand--xs")).toBe(true);
    expect(lead("Começar grátis")?.querySelector(".ac-brand")?.getAttribute("data-mark")).toBeTruthy();
    const stack = lead("Outro plano")?.querySelector(".ac-brand-stack");
    expect(stack?.querySelectorAll(":scope > .ac-brand")).toHaveLength(3);
  });

  test("the other plans open here, each its own row; a pick says which", async () => {
    const picked = await choices();
    const others = within(list()).getByRole("button", { name: "Outro plano" });
    expect(others.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fireEvent.click(others));
    await settle(2);
    const titles = rows().map((r) => r.title);
    expect(titles.slice(0, 5)).toEqual(["Claude", "ChatGPT", "Gemini", "Grok", "Cursor"]);
    expect(titles).not.toContain("Outro plano");
    await act(async () => fireEvent.click(within(list()).getByRole("button", { name: "Grok" })));
    await act(async () => fireEvent.click(within(list()).getByRole("button", { name: "Começar grátis" })));
    expect(picked).toEqual(["grok", "zen"]);
  });

  test("no key for who may not add one; a plan that can't sign in now dims its mark", async () => {
    await choices({ mayAddKey: false, dims: (c) => c === "claude" });
    expect(rows().map((r) => r.title)).not.toContain("Chave de API");
    const claude = within(list()).getByRole("button", { name: "Claude" }).closest(".ac-optrow");
    expect(claude?.querySelector(".ac-brand--off")).not.toBeNull();
    expect(
      screen().getByRole("button", { name: "ChatGPT" }).closest(".ac-optrow")?.querySelector(".ac-brand--off"),
    ).toBeNull();
  });
});
