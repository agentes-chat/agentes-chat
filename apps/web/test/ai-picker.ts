import { act, fireEvent, within } from "@testing-library/react";
import { screen, settle } from "./render";

/** An open dialog's AI select: what thinks ("Quem pensa"), or the providers of "Conectar outra IA". */
type SelectName = "Quem pensa" | "Conectar outra IA";

export const aiSelect = (box: HTMLElement, name: SelectName = "Conectar outra IA") =>
  within(box).getByRole("combobox", { name });

/** That select opened: its rows. */
export async function openAiSelect(box: HTMLElement, name: SelectName = "Conectar outra IA") {
  const select = aiSelect(box, name);
  select.focus();
  await act(async () => fireEvent.keyDown(select, { key: "Enter" }));
  await settle(3);
  return screen().getAllByRole("option");
}

export const closeAiSelect = async () => {
  await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));
  await settle(2);
};

const clicked = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};

/** A row of a select by the title it shows. */
export const brainTitle = (option: Element) =>
  option.querySelector(".ac-menu__label > span:first-child")?.textContent ?? "";

/** The heading of the group a row is in ("Seu plano de IA", "Ou pague pelo uso"…). */
const groupOf = (option: Element) =>
  option.closest('[role="group"]')?.querySelector(".ac-menu__heading")?.textContent ?? "";

/** "Conectar outra IA" from the AI select, where the providers' select isn't showing yet. */
export async function connectOther(box: HTMLElement) {
  if (within(box).queryByRole("combobox", { name: "Conectar outra IA" })) return;
  const rows = await openAiSelect(box, "Quem pensa");
  await clicked(rows.find((o) => brainTitle(o) === "Conectar outra IA") as Element);
}

/**
 * Picks a provider in "Conectar outra IA" (opened from the AI select first if need be): a plan by its name, "Chave de
 * API" (Claude's key, to pay as you go), or with `maker` the maker of the key.
 */
export async function chooseAi(box: HTMLElement, name: string, maker = false) {
  await connectOther(box);
  const rows = await openAiSelect(box, "Conectar outra IA");
  const keys = rows.filter((o) => groupOf(o) === "Ou pague pelo uso");
  const plans = rows.filter((o) => !keys.includes(o));
  const row =
    name === "Chave de API"
      ? keys[0]
      : (maker ? keys : plans).find((o) => brainTitle(o) === name || brainTitle(o).startsWith(name));
  await clicked(row as Element);
}

/** Picks what thinks in "Quem pensa". */
export async function chooseBrain(box: HTMLElement, name: RegExp) {
  const rows = await openAiSelect(box, "Quem pensa");
  await clicked(rows.find((o) => name.test(brainTitle(o))) as Element);
}
