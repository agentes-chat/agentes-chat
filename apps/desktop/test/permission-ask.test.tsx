import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { PermissionNeed } from "@agenteschat/adapters/machine-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import { allowSteps, PERMISSION_ASK_PREF } from "../src/control/permissions";
import { DesktopStore, pairedHomes } from "../src/control/store";
import { readPref, writePref } from "../src/hooks";
import { createFakeHost, type FakeHost } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ToastProvider } from "../src/ui/Toast";
import { WindowView } from "../src/WindowView";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => writePref(PERMISSION_ASK_PREF, false));

const need = (permission: PermissionNeed["permission"], trigger: string): PermissionNeed => ({
  permission,
  trigger,
  agentId: "ag_dev",
  since: "2026-11-26T18:00:00.000Z",
});

async function welcome(
  check: (el: HTMLElement, host: FakeHost, store: DesktopStore) => Promise<void>,
  prepare?: (host: FakeHost) => void,
) {
  const host = createFakeHost("welcome", "selfhost");
  prepare?.(host);
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={createDesktopI18n("en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>
              <WindowView name="welcome" />
            </ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      ),
    );
    await until(() => pairedHomes(store.getSnapshot()).length > 0);
    await check(el, host, store);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
const buttons = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent);
const firstRunner = (host: FakeHost) => [...host.runners.values()][0];

test("Full Disk Access an agent's command waits on: what, why, who asked, its Settings pane; on when back, the wait ends", () =>
  welcome(async (el, host) => {
    const runner = firstRunner(host);
    host.mac.disk = false;
    await act(async () => runner?.setPermissions([need("disk", "ls ~/Desktop")]));
    writePref(PERMISSION_ASK_PREF, true);
    await act(async () => host.showWindow("welcome"));
    await until(() => el.querySelector("h1")?.textContent === "agentes.chat needs Full Disk Access");
    expect(readPref(PERMISSION_ASK_PREF, true)).toBe(false);
    const sheet = el.querySelector(".dk-fr__sheet") as HTMLElement;
    // Short: why, who asked for what, one button. The steps wait behind How to allow.
    expect([...sheet.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Agents need it to open your files without macOS asking for each folder.",
      "Asked by Devls ~/Desktop",
    ]);
    expect(sheet.querySelector(".dk-ask-how summary")?.textContent).toBe("How to allow it");
    expect(buttons(el)).toEqual(["Not now", "Open Settings"]);
    // macOS says whether it is on: no "I allowed it" to press.
    expect(button(el, "I allowed it")).toBeUndefined();
    await act(async () => button(el, "Open Settings")?.click());
    expect(host.mac.panes).toEqual(["disk"]);
    // macOS quits the app to apply it: the sheet is kept to come back.
    expect(host.mac.setup).toMatchObject({ step: "permission", permission: "disk", agent: "Dev" });
    // Turned on in System Settings: back in front, the wait ends here and on the server, and the sheet goes.
    host.mac.disk = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await until(() => runner?.permissions.length === 0);
    await until(() => el.querySelector("h1")?.textContent !== "agentes.chat needs Full Disk Access");
  }));

test("Automation, which macOS never tells: its pane, and I allowed it ends the wait", () =>
  welcome(async (el, host) => {
    const runner = firstRunner(host);
    await act(async () => runner?.setPermissions([need("automation", "osascript -e 'tell app \"Finder\" to quit'")]));
    writePref(PERMISSION_ASK_PREF, true);
    await act(async () => host.showWindow("welcome"));
    await until(() => el.querySelector("h1")?.textContent === "agentes.chat needs Automation");
    expect(el.textContent).toContain("Agents need it to control other apps on this Mac.");
    expect(el.textContent).not.toContain("Quit & Reopen");
    expect(button(el, "I allowed it")).toBeUndefined();
    await act(async () => button(el, "Open Settings")?.click());
    expect(host.mac.panes).toEqual(["automation"]);
    // Only the person knows: the one button is now I allowed it, and nothing is kept for a reopening.
    expect(button(el, "Open Settings")).toBeUndefined();
    expect(host.mac.setup).toBeNull();
    await act(async () => button(el, "I allowed it")?.click());
    await until(() => runner?.permissions.length === 0);
  }));

test("Screen Recording: the app asks before macOS, and its one button raises macOS's prompt, with the steps for this macOS", () =>
  welcome(async (el, host) => {
    const runner = firstRunner(host);
    await act(async () => runner?.setPermissions([need("screen", "screencapture -x a.png")]));
    writePref(PERMISSION_ASK_PREF, true);
    await act(async () => host.showWindow("welcome"));
    await until(() => el.querySelector("h1")?.textContent === "agentes.chat needs Screen Recording");
    expect(el.textContent).toContain("Agents need it to take screenshots of this Mac.");
    expect(buttons(el)).toEqual(["Not now", "Allow"]);
    // macOS 15: the pane's new name, + for an app not in the list, then Quit & Reopen.
    expect([...el.querySelectorAll(".dk-steps li")].map((li) => li.textContent)).toEqual([
      "Open System Settings\u00a0›\u00a0Privacy & Security\u00a0›\u00a0Screen & System Audio Recording.",
      "Turn on agentes.chat. Not in the list? Click +, then choose agentes.chat in Applications.",
      "When macOS asks, choose Quit & Reopen: agentes.chat opens again here, and the agent goes on by itself.",
    ]);
    expect(host.mac.screenAsks).toBe(0);
    await act(async () => button(el, "Allow")?.click());
    await until(() => host.mac.screenAsks === 1);
    expect(host.mac.panes).toEqual([]);
    expect(host.mac.setup).toMatchObject({ step: "permission", permission: "screen", agent: "Dev" });
  }));

test("reopened by macOS with it on: the sheet says so and that the agent goes on, and closing forgets it", () =>
  welcome(
    async (el, host) => {
      await until(() => el.querySelector("h1")?.textContent === "Screen Recording is on");
      expect(el.textContent).toContain("Dev goes on with what it was doing.");
      await act(async () => button(el, "Done")?.click());
      expect(host.mac.setup).toBeNull();
      expect(host.mac.screenAsks).toBe(0);
    },
    (host) => {
      host.mac.screen = true;
      host.mac.setup = { step: "permission", permission: "screen", agent: "Dev", resumed: true };
    },
  ));

test("How to allow follows the Mac's version: System Preferences before 13, Screen Recording's old name before 15", () => {
  expect(allowSteps("screen", "12.7")).toEqual([
    { step: "prefs", pane: "screen" },
    { step: "turnOnAdd" },
    { step: "reopen" },
  ]);
  expect(allowSteps("screen", "14.6")[0]).toEqual({ step: "settings", pane: "screen" });
  expect(allowSteps("screen", null)[0]).toEqual({ step: "settings", pane: "screen15" });
  expect(allowSteps("automation", "15.5")).toEqual([
    { step: "settings", pane: "automation" },
    { step: "automation" },
    { step: "back" },
  ]);
  expect(allowSteps("camera", "15.5")[1]).toEqual({ step: "turnOn" });
});
