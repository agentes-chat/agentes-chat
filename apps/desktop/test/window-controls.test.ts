import { expect, mock, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

test("the Windows caption buttons control the main window and show its maximized state", async () => {
  const source = await Bun.file(new URL("../src-tauri/src/window_controls.js", import.meta.url)).text();
  const attachShadow = spyOn(window.HTMLElement.prototype, "attachShadow");
  const initialSheets = [...document.adoptedStyleSheets];
  const initialLanguage = document.documentElement.lang;
  const events = new EventTarget();
  let maximized = false;
  const invoke = mock(async (_command: string, { action }: { action: string }) => {
    if (action === "toggleMaximize") maximized = !maximized;
    return maximized;
  });

  try {
    document.documentElement.lang = "pt-BR";
    // Evaluate the native app's initialization script with a fake Tauri IPC.
    const appWindow = {
      get top() {
        return this;
      },
      __TAURI_INTERNALS__: { invoke },
      addEventListener: events.addEventListener.bind(events),
    };
    new Function("window", "CSSStyleSheet", source)(appWindow, window.CSSStyleSheet);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const shadow = attachShadow.mock.results[0]?.value as ShadowRoot;
    const [minimize, maximize, close] = shadow.querySelectorAll("button");
    expect(maximize.getAttribute("aria-label")).toBe("Maximizar");

    maximize.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(maximize.getAttribute("aria-label")).toBe("Restaurar");
    maximize.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(maximize.getAttribute("aria-label")).toBe("Maximizar");

    maximized = true;
    events.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(maximize.getAttribute("aria-label")).toBe("Restaurar");

    minimize.click();
    close.click();
    expect(invoke).toHaveBeenCalledWith("main_window_action", { action: "minimize" });
    expect(invoke).toHaveBeenCalledWith("main_window_action", { action: "close" });
  } finally {
    document.querySelector("agentes-window-controls")?.remove();
    document.adoptedStyleSheets = initialSheets;
    document.documentElement.lang = initialLanguage;
    attachShadow.mockRestore();
  }
});
