import { describe, expect, setSystemTime, test } from "bun:test";
import type { RunnerPhone } from "@agenteschat/adapters/machine-protocol";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider, useSnapshot } from "../src/app";
import { DesktopStore, pairedHomes } from "../src/control/store";
import { createFakeHost, type FakeHost } from "../src/host/fake";
import type { LayerRoute } from "../src/host/types";
import { createDesktopI18n } from "../src/i18n";
import { Phones, WhoUses } from "../src/layer/settings/ThisMac";
import { ToastProvider } from "../src/ui/Toast";
import { WindowView } from "../src/WindowView";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The app layer (ADR 0265) on `route`, with `view` drawn in it. */
async function mount(route: LayerRoute, view: ReactNode, check: (el: HTMLElement, host: FakeHost) => Promise<void>) {
  const host = createFakeHost("app", "selfhost", { route });
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={createDesktopI18n("en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>{view}</ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      ),
    );
    await check(el, host);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

const SETTINGS: LayerRoute = { screen: "settings" };
const IPHONE: LayerRoute = { screen: "iphone" };
const layer = <WindowView name="app" />;

/** The first workspace alone (the fake has two): Overview's "Who uses this Mac" and Folders and tools' phones. */
function OneWorkspace() {
  const homes = pairedHomes(useSnapshot()).slice(0, 1);
  return homes.length ? (
    <>
      <WhoUses homes={homes} offers={[]} />
      <Phones homes={homes} />
    </>
  ) : null;
}

const rowOf = (el: HTMLElement, title: string) =>
  [...el.querySelectorAll<HTMLElement>(".dk-crow")].find(
    (r) => r.querySelector(".dk-crow__title")?.textContent === title,
  );
const button = (root: ParentNode | undefined, text: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === text);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]') ?? undefined;

/** Who can use it: the workspace's ⋯, then its item, in a dialog. */
async function openWho(el: HTMLElement, org: string) {
  const more = rowOf(el, org)?.querySelector<HTMLButtonElement>(`button[aria-label="More for ${org}"]`);
  more?.focus();
  await act(async () => more?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (m) => m.textContent === "Who can use it",
  );
  await act(async () => item?.click());
  await until(() => dialog());
}

describe("Settings › This Mac: who uses it, and its phones", () => {
  test("agents, who can use it, and each phone with its state and one way out", () =>
    mount(SETTINGS, <OneWorkspace />, async (el, host) => {
      await until(() => rowOf(el, "Pixel 8"));
      expect(rowOf(el, "Acme")?.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
      // The phones' help is one line in their card.
      expect(rowOf(el, "Pixel 8")?.closest(".dk-card")?.textContent).toContain(
        "Plug a phone into this Mac to add it. Android steps · iPhone steps",
      );
      await openWho(el, "Acme");
      await until(() => rowOf(dialog() as HTMLElement, "Acme")?.querySelector('[role="combobox"]'));
      expect(rowOf(dialog() as HTMLElement, "Acme")?.querySelector('[role="combobox"]')?.textContent).toBe("Only me");
      await act(async () => dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
      await until(() => !dialog());

      const pixel = rowOf(el, "Pixel 8");
      // Each phone's state in words on its title's line, never a pill.
      expect(pixel?.querySelector(".ac-chip")).toBeNull();
      expect(pixel?.querySelector(".dk-sx__state")?.textContent).toBe("In use by Ada");
      expect(pixel?.querySelector("small")?.textContent).toMatch(/^for Rui since .+ · Everyone can use it$/);
      const iphone = rowOf(el, "Sam's iPhone 16");
      expect(iphone?.querySelector(".dk-sx__state")?.textContent).toBe("Needs you");
      expect(iphone?.querySelector(".dk-sx__state")?.getAttribute("data-tone")).toBe("warn");
      expect(iphone?.querySelector("small")?.textContent).toBe("Developer Mode is off");

      // Stop: the web's own stop, on this computer's server; the phone is free once the list comes back.
      await act(async () => button(pixel, "Stop")?.click());
      await until(() => rowOf(el, "Pixel 8")?.querySelector(".dk-sx__state")?.textContent === "Ready");
      expect(host.site.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        "/api/app/organizations/org_acme/devices/phones/0b6c5a8e-0000-4000-8000-000000000001/stop",
      ]);

      // Show me how on the iPhone: the setup, the app layer's sheet.
      await act(async () => button(rowOf(el, "Sam's iPhone 16"), "Show me how")?.click());
      expect(host.layer.route).toEqual({ screen: "iphone" });
    }));

  test("a simulator on this Mac: Start when it's off, then Shut down while it starts", () =>
    mount(SETTINGS, <OneWorkspace />, async (el, host) => {
      await until(() => rowOf(el, "iPhone 17 Pro"));
      expect(rowOf(el, "iPhone 17 Pro")?.querySelector(".dk-sx__state")?.textContent).toBe("Offline");
      await act(async () => button(rowOf(el, "iPhone 17 Pro"), "Start")?.click());
      await until(() => button(rowOf(el, "iPhone 17 Pro"), "Shut down"));
      expect(host.site.calls.filter((c) => c.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/api/app/organizations/org_acme/devices/phones/0b6c5a8e-0000-4000-8000-000000000003/power",
          body: { on: true },
        },
      ]);
      expect(document.body.textContent).toContain("iPhone 17 Pro is starting. It's ready in a moment.");
    }));

  test("an iPhone on this Mac's Wi-Fi: offered, used once picked, and let go again", () =>
    mount(SETTINGS, <OneWorkspace />, async (el, host) => {
      const offer = "Also on this Mac's Wi-Fi: Ana's iPhone 14";
      await until(() => rowOf(el, offer));
      expect(host.site.calls.some((c) => c.method === "PUT")).toBe(false);
      await act(async () => button(rowOf(el, offer), "Use over Wi-Fi")?.click());
      await until(() => rowOf(el, "Ana's iPhone 14"));
      expect(rowOf(el, offer)).toBeUndefined();
      expect(host.site.calls.find((c) => c.method === "PUT")?.path).toMatch(
        /^\/api\/app\/organizations\/org_acme\/devices\/computers\/[^/]+\/wifi-iphones\/00008120-000A1B2C3D4E5F60$/,
      );
      // Over Wi-Fi now, its helper still being set up: Show me how, as for one on the cable.
      const phone = rowOf(el, "Ana's iPhone 14");
      expect(button(phone, "Show me how")).toBeTruthy();
    }));

  test("signed out on that server: says so, with the way to sign in", () =>
    mount(SETTINGS, <OneWorkspace />, async (el, host) => {
      host.site.signedOut = true;
      await until(() => rowOf(el, "Acme"));
      await openWho(el, "Acme");
      await until(() => rowOf(dialog() as HTMLElement, "Acme")?.querySelector("small"));
      expect(rowOf(dialog() as HTMLElement, "Acme")?.querySelector("small")?.textContent).toBe(
        "Sign in to agentes.tail1234.ts.net in the app to see who can use this Mac.",
      );
      expect(button(rowOf(dialog() as HTMLElement, "Acme"), "Open")).toBeTruthy();
    }));
});

describe("the iPhone setup window", () => {
  test("Show me how opens it on the app layer; the Mac downloads what Xcode needs by itself", async () => {
    await mount(IPHONE, layer, async (el, host) => {
      await until(() => el.querySelector('[data-screen="iphone"]') && el.querySelector('[aria-current="step"]'));
      // Asked again while it shows: the same setup, where it was.
      await act(() => host.showLayer({ screen: "iphone" }));
      expect(el.querySelector("h1")?.textContent).toBe("Connect an iPhone");
      // Xcode is there, the iOS platform isn't: it starts downloading and reaches the iPhone's own step.
      await until(() => el.querySelector('[aria-current="step"] b')?.textContent === "Turn on Developer Mode");
      const steps = [...el.querySelectorAll(".dk-fr__steps > li")].map((li) => [
        li.querySelector("b")?.textContent,
        li.getAttribute("data-state"),
      ]);
      expect(steps).toEqual([
        ["Xcode", "done"],
        ["iPhone tools", "done"],
        ["Apple Account in Xcode", "done"],
        ["iPhone connected", "done"],
        ["Turn on Developer Mode", "warn"],
        ["Turn on UI Automation", "todo"],
        ["Test helper", "todo"],
      ]);
      expect(el.querySelector('[aria-current="step"] .ac-setpath')?.textContent).toBe(
        "SettingsPrivacy & SecurityDeveloper Mode",
      );
      expect(el.textContent).toContain("Sam Rivera · Personal Team");
      // Our phone app is in no store yet: no QR that would only open a web page on the iPhone.
      expect(el.querySelector(".dk-ip__qr")).toBeNull();
      expect(button(el, "Back")).toBeTruthy();
      expect(button(el, "Cancel")).toBeTruthy();

      // The helper built, but the iPhone doesn't trust its developer yet: where on the iPhone to trust it.
      for (const runner of host.runners.values())
        runner.setPhones(runner.phones.map((p) => (p.platform === "ios" ? { ...p, reason: "helper_untrusted" } : p)));
      await until(() => el.querySelector('[aria-current="step"] b')?.textContent === "Test helper");
      expect(el.querySelector('[aria-current="step"]')?.textContent).toContain("Tap the developer's name, then Trust.");
      expect(el.querySelector('[aria-current="step"] .ac-setpath')?.textContent).toBe(
        "SettingsGeneralVPN & Device Management",
      );
    });
  });

  test("every iPhone state names its way out, and a step that sits still says what most likely holds it", async () => {
    await mount(IPHONE, layer, async (el, host) => {
      const step = () => el.querySelector('[aria-current="step"]');
      const at = (name: string) => until(() => step()?.querySelector("b")?.textContent === name);
      const phone = (over: Partial<RunnerPhone>) => {
        for (const runner of host.runners.values())
          runner.setPhones(runner.phones.map((p) => (p.platform === "ios" ? { ...p, ...over } : p)));
      };
      await at("Turn on Developer Mode");

      phone({ reason: "ui_not_authorized" });
      await at("Turn on UI Automation");
      // Each thing only the person can do on the iPhone, Check again, and the Mac's own repair.
      expect(step()?.textContent).toContain("Agents see the iPhone's screen, but iOS refuses their taps.");
      expect([...(step()?.querySelectorAll(".ac-setpath") ?? [])].map((p) => p.textContent)).toEqual([
        "SettingsPrivacy & SecurityDeveloper Mode",
        "SettingsDeveloperEnable UI Automation",
      ]);
      expect(step()?.textContent).toContain("Enter its passcode when it asks, and keep it unlocked.");
      const runners = [...host.runners.values()];
      const looked = runners.reduce((n, r) => n + r.looks, 0);
      await act(async () => button(step() ?? undefined, "Check again")?.click());
      await until(() => runners.reduce((n, r) => n + r.looks, 0) === looked + 1);
      const repair = () => button(step() ?? undefined, "Repair the test helper");
      await until(() => repair()?.disabled === false);
      await act(async () => repair()?.click());
      await until(() => runners.some((r) => r.repairs.length === 1));
      const iphone = runners.flatMap((r) => r.phones).find((p) => p.platform === "ios");
      expect(runners.flatMap((r) => r.repairs)).toEqual([iphone?.serial ?? ""]);

      for (const runner of host.runners.values()) runner.iphone = { ...runner.iphone, sdk: "26.2" };
      phone({ reason: "xcode_too_old", osVersion: "27.0" });
      await at("Xcode");
      // The SDK comes with the next ask of the Mac (every 2 s), after the phone's own report.
      await until(() => step()?.textContent?.includes("knows iOS 26.2 at most"));
      expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 27.0 and Xcode on");
      expect(step()?.textContent).toContain("knows iOS 26.2 at most. Install Xcode 27, then run this in Terminal.");
      expect(step()?.querySelector("code")?.textContent).toBe("xcrun devicectl manage ddis update");

      // Below iOS 17: what it runs and what agents need, with no spinner left turning.
      phone({ state: "unsupported", reason: "os_too_old", osVersion: "16.7.10" });
      await at("iPhone connected");
      expect(step()?.getAttribute("data-state")).toBe("warn");
      expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 16.7.10, and agents need iOS 17 or newer.");
      expect(el.querySelector(".dk-fr__stepmark .ac-pixspin")).toBeNull();

      // Xcode lists an account that shows no team: its own words, not "sign in".
      for (const runner of host.runners.values()) runner.iphone = { ...runner.iphone, account: null, noTeam: true };
      await at("Apple Account in Xcode");
      expect(step()?.textContent).toContain("Xcode is signed in but shows no team yet.");

      for (const runner of host.runners.values())
        runner.iphone = { ...runner.iphone, account: { name: "Sam Rivera", personal: true } };
      phone({ state: "preparing", reason: "helper_missing", osVersion: "27.1" });
      await at("Test helper");
      expect(step()?.querySelector(".dk-ip__stall")).toBeNull();
      try {
        // The next ask of the Mac, 45 s on with nothing changed: what the helper waits for.
        setSystemTime(new Date(Date.now() + 46_000));
        await until(() => step()?.querySelector(".dk-ip__stall"));
        expect(step()?.querySelector(".dk-ip__stall")?.textContent).toContain(
          "builds the test helper and starts it on the iPhone",
        );
      } finally {
        setSystemTime();
      }
    });
    // The window asks the Mac every 2 s and this walks six states, each seen on the next ask: up to 12 s of
    // waiting, past the 5 s a test gets. Cut short, it went on running under the files after it (its window still
    // mounted, the clock moved 46 s on) and failed their tests.
  }, 30_000);

  test("Developer Mode: a restart keeps the step, check again asks the Mac, and why the switch may be missing", async () => {
    await mount(IPHONE, layer, async (el, host) => {
      const step = () => el.querySelector('[aria-current="step"]');
      await until(() => step()?.querySelector("b")?.textContent === "Turn on Developer Mode");
      const runners = [...host.runners.values()];
      await act(async () => button(step() ?? undefined, "I turned it on, check again")?.click());
      await until(() => step()?.textContent?.includes("The iPhone still says Developer Mode is off."));
      expect(runners.some((r) => r.looks === 1)).toBe(true);
      // Why the switch may be missing, each with its one action, when asked.
      await act(async () => button(step() ?? undefined, "Don't see the option?")?.click());
      const causes = () => [...(step()?.querySelectorAll(".dk-ip__causes li") ?? [])].map((li) => li.textContent);
      expect(causes()).toEqual([
        "The iPhone hides the option until Xcode asks to show it.Open Xcode",
        "Turned it on and the iPhone restarted? Unlock it. The alert with Turn On shows only after that.",
      ]);
      await act(async () => button(step() ?? undefined, "Open Xcode")?.click());
      await until(() => causes()[0]?.startsWith("Xcode opened on"));

      // It restarts and leaves the Mac's list: the step stays, under way.
      const iphones = runners.map((r) => r.phones.filter((p) => p.platform === "ios"));
      for (const runner of runners) runner.setPhones(runner.phones.filter((p) => p.platform !== "ios"));
      await until(() => step()?.textContent?.includes("The iPhone is restarting."));
      expect(step()?.querySelector("b")?.textContent).toBe("Turn on Developer Mode");
      expect(step()?.getAttribute("data-state")).toBe("active");
      runners.forEach((runner, i) => {
        runner.setPhones([...runner.phones, ...(iphones[i] ?? [])]);
      });
      await until(() => step()?.textContent?.includes("The iPhone is back. Unlock it, tap Turn On"));
    });
  });

  test("Back goes to this computer's settings, Cancel steps the layer aside", () =>
    mount(IPHONE, layer, async (el, host) => {
      await until(() => button(el, "Back"));
      await act(async () => button(el, "Back")?.click());
      expect(host.layer.route).toEqual({ screen: "settings", section: "folders", focus: "phone" });
      await act(async () => host.showLayer({ screen: "iphone" }));
      await until(() => button(el, "Cancel"));
      await act(async () => button(el, "Cancel")?.click());
      expect(host.layer.route).toBeNull();
    }));
});
