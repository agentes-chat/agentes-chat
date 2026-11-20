import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { isTypingKey, setSoundChoice, setTypingSound, typingSoundOn } from "@/lib/sounds";
import { STORAGE_KEYS, storage } from "@/lib/storage";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/** The key click in the message box (ADR 0070, addendum): off by default, a switch beside Sons, on this device. */

afterEach(() => {
  cleanup();
  setTypingSound(false);
  setSoundChoice("tactile");
  localStorage.clear();
});

const key = (k: string, more: Partial<Parameters<typeof isTypingKey>[0]> = {}) =>
  isTypingKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, repeat: false, isComposing: false, ...more });

describe("which keys are typing", () => {
  test("a character, a space, Backspace and Delete", () => {
    for (const k of ["a", "Z", "1", " ", "ç", "?", "Backspace", "Delete"]) expect([k, key(k)]).toEqual([k, true]);
  });

  test("not Enter (the send sound says it), moves, shortcuts, a held letter's repeats or an accent being composed", () => {
    for (const k of ["Enter", "Tab", "ArrowLeft", "Shift", "Meta", "Escape"]) expect([k, key(k)]).toEqual([k, false]);
    expect(key("c", { metaKey: true })).toBe(false);
    expect(key("v", { ctrlKey: true })).toBe(false);
    expect(key("e", { altKey: true })).toBe(false);
    expect(key("a", { repeat: true })).toBe(false);
    expect(key("´", { isComposing: true })).toBe(false);
    // Holding Backspace erases a run: each erase clicks (the player keeps them apart).
    expect(key("Backspace", { repeat: true })).toBe(true);
  });
});

describe("Sua conta", () => {
  const typingSwitch = () => screen().getByRole("switch", { name: "Som de digitação" });

  test("off until the person turns it on; on is kept on this device", async () => {
    await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(typingSwitch().getAttribute("aria-checked")).toBe("false");
    await act(async () => fireEvent.click(typingSwitch()));
    expect(typingSwitch().getAttribute("aria-checked")).toBe("true");
    expect(typingSoundOn()).toBe(true);
    expect(storage.get(STORAGE_KEYS.typingSounds)).toBe("on");
  });

  test("with the sounds off the switch is off and can't be turned on", async () => {
    setTypingSound(true);
    setSoundChoice("off");
    await renderApp(`/org/${ORG_ID}/settings/account`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(typingSwitch().getAttribute("aria-checked")).toBe("false");
    expect(typingSwitch().hasAttribute("disabled")).toBe(true);
  });
});
