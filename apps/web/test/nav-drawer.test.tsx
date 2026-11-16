import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { COMPACT_QUERY } from "@/components/NavDrawer";
import { createFakeApi, GENERAL_ID, ORG_ID } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/** A phone: only the compact query matches (the rest goes to the real `matchMedia`). */
let restore: (() => void) | null = null;
function onPhone() {
  const real = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    query === COMPACT_QUERY
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as unknown as MediaQueryList)
      : real(query)) as typeof window.matchMedia;
  restore = () => {
    window.matchMedia = real;
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  restore?.();
  restore = null;
});

const click = (el: Element) => act(async () => fireEvent.click(el));
const go = async (path: string) => {
  const r = await renderApp(`/org/${ORG_ID}/${path}`, { api: createFakeApi() });
  await settle(6);
  return r;
};
const nav = () => screen().getByRole("navigation", { name: "Navegação do workspace" });
const tabs = () => screen().getByRole("navigation", { name: "Abas principais" });
const menuButton = () => within(tabs()).getByRole("button", { name: "Conversas" });

describe("the sidebar on a phone (a sheet behind the Conversas tab)", () => {
  test("wide screens have no tabs: the sidebar is always there", async () => {
    await go(`c/${GENERAL_ID}`);
    expect(screen().queryByRole("navigation", { name: "Abas principais" })).toBeNull();
    expect(nav().getAttribute("data-open")).toBe("false");
  });

  test("the tabs are Início, Conversas, Threads, Atividade and Buscar, Conversas the current one in a channel", async () => {
    onPhone();
    await go(`c/${GENERAL_ID}`);
    const names = within(tabs())
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(names).toEqual(["Início", "Conversas", "Threads", "Atividade", "Buscar"]);
    expect(menuButton().getAttribute("data-status")).toBe("active");
    // The hamburger is gone from the header: the tab bar opens the sheet.
    expect(screen().queryByRole("button", { name: "Abrir menu" })).toBeNull();
  });

  test("Conversas opens it; Esc closes it and focus goes back", async () => {
    onPhone();
    await go(`c/${GENERAL_ID}`);
    const button = menuButton();
    expect(button.getAttribute("aria-controls")).toBe(nav().id);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.focus();
    await click(button);
    expect(nav().getAttribute("data-open")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement === nav()).toBe(true);
    // The page behind can't be reached while it's open.
    // The work area (an offline-computer notice and the page) is inert as a whole.
    const main = document.querySelector(".shell__work") as HTMLElement;
    expect(main.inert).toBe(true);

    await act(async () => {
      fireEvent.keyDown(nav(), { key: "Escape" });
    });
    expect(nav().getAttribute("data-open")).toBe("false");
    expect(main.inert).toBe(false);
    expect(document.activeElement === button).toBe(true);
  });

  test("a tap on the dimmed page closes it", async () => {
    onPhone();
    await go(`c/${GENERAL_ID}`);
    await click(menuButton());
    expect(nav().getAttribute("data-open")).toBe("true");
    await click(document.querySelector(".shell__scrim") as HTMLElement);
    expect(nav().getAttribute("data-open")).toBe("false");
    expect(document.querySelector(".shell__scrim")).toBeNull();
  });

  test("a pull down follows the finger, then closes it", async () => {
    // How far or fast is enough needs a laid-out sheet and real event times, which this DOM has neither of.
    onPhone();
    await go(`c/${GENERAL_ID}`);
    await click(menuButton());
    await act(async () => {
      const el = nav();
      fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 10 }] });
      fireEvent.touchMove(el, { touches: [{ clientX: 100, clientY: 130 }] });
      expect(el.style.transform).toBe("translateY(120px)");
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100, clientY: 130 }] });
      // Released: back to the stylesheet's transition, from where the finger left it.
      expect(el.style.transform).toBe("");
    });
    expect(nav().getAttribute("data-open")).toBe("false");
  });

  test("a sideways swipe is not a pull", async () => {
    onPhone();
    await go(`c/${GENERAL_ID}`);
    await click(menuButton());
    await act(async () => {
      const el = nav();
      fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 10 }] });
      fireEvent.touchMove(el, { touches: [{ clientX: 220, clientY: 30 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: 220, clientY: 30 }] });
    });
    expect(nav().getAttribute("data-open")).toBe("true");
  });

  test("following a link closes it, and the new page has the workspace in its top bar", async () => {
    onPhone();
    const { router } = await go(`c/${GENERAL_ID}`);
    await click(menuButton());
    // Docs starts closed: Drive is the icon on its header.
    await click(within(nav()).getAllByRole("link", { name: "Drive" })[0] as HTMLElement);
    await settle(6);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/drive`);
    expect(nav().getAttribute("data-open")).toBe("false");
    // Not a chat page: the shell's bar carries the workspace; the tabs stay at the bottom.
    const bar = document.querySelector(".shell__bar") as HTMLElement;
    expect(bar.textContent).toContain("Acme");
    expect(menuButton().getAttribute("data-status")).toBeNull();
  });

  test("a link to the page already open closes it too", async () => {
    onPhone();
    await go("drive");
    await click(menuButton());
    expect(nav().getAttribute("data-open")).toBe("true");
    // Docs starts closed: Drive is the icon on its header.
    await click(within(nav()).getAllByRole("link", { name: "Drive" })[0] as HTMLElement);
    await settle();
    expect(nav().getAttribute("data-open")).toBe("false");
  });
});
