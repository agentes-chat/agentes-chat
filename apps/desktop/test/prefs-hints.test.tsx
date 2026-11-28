import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { ComputerDevice } from "@agenteschat/client";
import { CLOUD_SERVER } from "@agenteschat/client/lib/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import type { Essential } from "../src/control/essentials";
import type { LocalServerStatus } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import type { UpdateCheck } from "../src/hooks";
import { createFakeHost, type FakeHost, type HereOptions, layerModeFor, type Scenario } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { Advanced } from "../src/layer/settings/Advanced";
import { essentialRows } from "../src/layer/settings/AlwaysOn";
import { Settings } from "../src/layer/settings/Settings";
import { sectionFor, sectionsOf } from "../src/layer/settings/sections";
import { About, Updates } from "../src/layer/settings/Updates";
import { ToastProvider } from "../src/ui/Toast";
import { InternetRow } from "../src/windows/InternetRow";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Settings › This computer (ADR 0265) on a fake host, once `ready` says it shows what the test looks at.
 * `options.host` changes the host before the screen first reads it.
 */
async function pane(
  scenario: Scenario,
  view: ReactNode,
  ready: (el: HTMLElement) => unknown,
  check: (el: HTMLElement, host: FakeHost, opened: string[]) => Promise<void> | void,
  options: {
    someCommands?: boolean;
    here?: HereOptions;
    site?: boolean;
    macReady?: boolean;
    host?: (host: FakeHost) => void;
  } = {},
) {
  const host = createFakeHost("app", scenario, {
    someCommands: options.someCommands,
    here: options.here,
    site: options.site,
    macReady: options.macReady,
    route: { screen: "settings" },
  });
  options.host?.(host);
  const opened: string[] = [];
  host.openExternal = async (url) => {
    opened.push(url);
  };
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
    await until(() => ready(el));
    await check(el, host, opened);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

/** What an element is described by, each description in order (a hint's text is in the page while it's closed). */
const describedBy = (el: Element | null | undefined) =>
  (el?.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(" ") || null;

/** Each row: its title, its ⓘ's hint, the hint its switch reads (when it has one) and the line under the title. */
const rows = (root: ParentNode) =>
  [...root.querySelectorAll(".dk-crow")].map((row) => {
    const control = row.querySelector(':scope > .dk-crow__end > [role="switch"]');
    return {
      title: row.querySelector(".dk-crow__title")?.textContent ?? null,
      hint: describedBy(row.querySelector("button.ac-hint")),
      ...(control ? { switch: describedBy(control) } : {}),
      line: row.querySelector(".dk-crow__text > small")?.textContent ?? null,
    };
  });
const row = (root: ParentNode, title: string) => rows(root).find((r) => r.title === title);
const rowEl = (root: ParentNode, title: string) =>
  [...root.querySelectorAll<HTMLElement>(".dk-crow")].find(
    (r) => r.querySelector(".dk-crow__title")?.textContent === title,
  );
const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text);
/** Types into a React field: the value through the field's own setter, then the event React listens to. */
function typeInto(field: Element | null, value: string) {
  const input = field as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
/** What follows a card title: its card. */
const cardUnder = (root: ParentNode, title: string) =>
  [...root.querySelectorAll(".dk-ctitle")].find((h) => h.textContent === title)?.nextElementSibling as
    | HTMLElement
    | undefined;
/** The section list's entries, in order, by their words. */
const navItems = (root: ParentNode) =>
  [...root.querySelectorAll(".dk-pnav button")].map((b) => b.querySelector(".dk-sx__label")?.textContent);
/** The server's ⋯ beside Restart (or Start it here), opened: its items, in order. */
async function serverMenu(el: HTMLElement) {
  const more = el.querySelector<HTMLButtonElement>('.dk-phead button[aria-label="More"]');
  more?.focus();
  await act(async () => more?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await until(() => document.querySelector('[role="menuitem"]'));
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
/** Erase and start over…, in the server's menu. */
const eraseItem = async (el: HTMLElement) =>
  (await serverMenu(el)).find((m) => m.textContent === "Erase and start over…");
/** The filled buttons on screen: one at most, the screen's forward action. */
const primaries = (root: ParentNode) => [...root.querySelectorAll(".ac-btn--primary")].map((b) => b.textContent);
/** A failed erase: its line inside the dialog, which stays open with both buttons pressable again, and no toast. */
const expectFailureInDialog = (dialog: HTMLElement, line: string) => {
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(line);
  expect((buttonIn(dialog, "Cancel") as HTMLButtonElement).disabled).toBe(false);
  expect((buttonIn(dialog, "Erase it") as HTMLButtonElement).disabled).toBe(false);
  expect(document.querySelector(".dk-toast")?.textContent).toBe("");
};

describe("Settings › This computer: its sections", () => {
  test("which sections this computer has, and the one a route opens on", () => {
    expect(sectionsOf({ works: false, server: false })).toEqual(["overview", "app"]);
    const all = sectionsOf({ works: true, server: true });
    expect(all).toEqual(["overview", "folders", "server", "activity", "app"]);
    // A row decides its section, so an older way in ("updates" on the Overview) lands on its row.
    expect(sectionFor({ section: "overview", focus: "updates" }, all)).toBe("app");
    expect(sectionFor({ focus: "tools" }, all)).toBe("folders");
    expect(sectionFor({ focus: "phone" }, all)).toBe("folders");
    expect(sectionFor({ focus: "backups" }, all)).toBe("server");
    expect(sectionFor({ section: "activity" }, all)).toBe("activity");
    expect(sectionFor({}, all)).toBe("overview");
    // A section this computer doesn't have: the Overview; reach without the server here is App settings'.
    const none = sectionsOf({ works: false, server: false });
    expect(sectionFor({ section: "folders" }, none)).toBe("overview");
    expect(sectionFor({ focus: "reach" }, none)).toBe("app");
  });

  test("with the workspace's page there: a dialog over it with This Mac's sections alone, closed with ×", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => navItems(el).includes("Folders and tools"),
      async (el, host) => {
        expect(navItems(el)).toEqual(["Overview", "Folders and tools", "Activity", "App settings"]);
        expect(el.querySelector(".dk-sx__title")?.textContent).toBe("This Mac");
        // The workspace's own settings stay on its page (ADR 0265 §6).
        expect(buttonIn(el, "People")).toBeUndefined();
        // No line about the connection: the page is there.
        expect(el.querySelector(".dk-sx__away")).toBeNull();
        const close = el.querySelector<HTMLButtonElement>(".dk-sx__close button");
        expect(close?.getAttribute("aria-label")).toBe("Close");
        await act(async () => close?.click());
        expect(host.layer.route).toBeNull();
      },
    ));

  test("settings show as a dialog over the site on a Mac, and fill the window without it or elsewhere", () => {
    const route = { screen: "settings" } as const;
    expect(layerModeFor(route, true, "mac")).toBe("sheet");
    expect(layerModeFor(route, false, "mac")).toBe("full");
    expect(layerModeFor(route, true, "windows")).toBe("full");
    expect(layerModeFor({ screen: "firstRun" }, true, "mac")).toBe("full");
  });

  test("without the site: the same sections, a row on top with Try again, and no way to close onto nothing", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => el.querySelector(".dk-sx__away") && navItems(el).includes("Activity"),
      async (el, host) => {
        expect(navItems(el)).toEqual(["Overview", "Folders and tools", "Activity", "App settings"]);
        expect(el.querySelector(".dk-sx__title")?.textContent).toBe("This Mac");
        // Nothing would be under it: no ×.
        expect(el.querySelector(".dk-sx__close")).toBeNull();
        // A row like the others: what is missing, what still works, and Try again at its end.
        const away = el.querySelector(".dk-sx__away") as HTMLElement;
        expect(rows(away)).toEqual([
          {
            title: "No connection with Acme.",
            hint: null,
            line: "What belongs to this Mac works the same. Who can use it and the agents' names come back with the connection.",
          },
        ]);
        expect(away.querySelector(".dk-crow__end button")?.textContent).toBe("Try again");
        // Esc and ⌘W keep the settings: nothing is behind them.
        const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        await act(async () => window.dispatchEvent(esc));
        expect(esc.defaultPrevented).toBe(true);
        let chosen = "";
        host.chooseServer = async (server) => {
          chosen = server;
        };
        await act(async () => buttonIn(el.querySelector(".dk-sx__away") as HTMLElement, "Try again")?.click());
        expect(chosen).toBe("https://agentes.tail1234.ts.net");
      },
      { site: false },
    ));

  test("the server here adds its section; Overview's dot says what needs the person", () =>
    pane(
      "here",
      <Settings />,
      (el) => navItems(el).includes("Server on this Mac") && el.querySelector(".dk-sx__dot"),
      (el) => {
        const overview = [...el.querySelectorAll(".dk-pnav button")].find(
          (b) => b.querySelector(".dk-sx__label")?.textContent === "Overview",
        );
        // A dot in the waiting colour, its words for screen readers.
        expect(overview?.querySelector(".dk-sx__dot")?.textContent).toMatch(/^\d+ (thing needs|things need) you$/);
      },
    ));
});

describe("Settings › This computer › Overview", () => {
  test("the Mac's name, what needs the person in the waiting colour, and Always ready with each fix first", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) =>
        el.querySelector(".dk-sx__head h2")?.textContent === "MacBook de Você" && el.querySelector(".dk-sx__warn"),
      (el) => {
        // The three permissions are off on this Mac until allowed: one row, one thing that needs the person.
        expect(el.querySelector(".dk-sx__headtext > p")?.className).toBe("dk-sx__warn");
        expect(el.querySelector(".dk-sx__headtext > p")?.textContent).toBe("1 thing needs you");
        expect(el.querySelector(".dk-sx__sub")?.textContent).toBe(
          "Agents of Acme and Horizonte use this Mac · version 0.6.0, up to date",
        );
        const always = cardUnder(el, "Always ready") as HTMLElement;
        expect(rows(always)[0]?.title).toBe("macOS permissions");
        expect(row(always, "macOS permissions")?.line).toBe(
          "Still off: Notifications, Screen Recording, and Full Disk Access.",
        );
        expect(rowEl(always, "macOS permissions")?.querySelector(".dk-crow__end button")?.textContent).toBe("Allow");
        // Opening at login is on: "On" in words, never a pill.
        expect(rowEl(always, "Opens when the Mac starts")?.querySelector(".dk-sx__on")?.textContent).toBe("On");
        expect(always.querySelector(".ac-chip")).toBeNull();
        // The workspaces that use it, each with its switch, and the way to one more.
        const who = cardUnder(el, "Who uses this Mac") as HTMLElement;
        expect(rowEl(who, "Acme")?.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
        expect(rowEl(who, "Another workspace")?.querySelector(".dk-crow__end button")?.textContent).toBe(
          "Add a workspace…",
        );
        // One filled button on the screen: the fix of what needs the person, not the workspaces to allow.
        expect(primaries(el)).toEqual(["Allow"]);
        expect(rowEl(always, "macOS permissions")?.querySelector(".ac-btn--primary")).not.toBeNull();
      },
    ));

  test("every permission allowed: All set in the ok colour, and the permissions' row says All on", () =>
    pane(
      "selfhost",
      <Settings />,
      // Until the workspaces' pairing is read this Mac isn't used yet, so its permissions' row waits for that too.
      (el) =>
        el.querySelector(".dk-sx__headtext .dk-sx__ok") &&
        rowEl(cardUnder(el, "Always ready") ?? el, "macOS permissions")?.querySelector(".dk-sx__on"),
      async (el) => {
        expect(el.querySelector(".dk-sx__headtext > p")?.textContent).toBe("All set");
        const always = cardUnder(el, "Always ready") as HTMLElement;
        expect(rowEl(always, "macOS permissions")?.querySelector(".dk-sx__on")?.textContent).toBe("All on");
        expect(el.querySelector(".dk-sx__dot")).toBeNull();
        // Nothing needs the person: the first workspace to allow is the one filled button, the next one is bordered.
        const who = cardUnder(el, "Who uses this Mac") as HTMLElement;
        await until(() => buttonIn(rowEl(who, "Oficina") ?? who, "Allow"));
        expect(primaries(el)).toEqual(["Allow"]);
        expect(rowEl(who, "Estúdio Norte")?.querySelector(".ac-btn--primary")?.textContent).toBe("Allow");
        expect(rowEl(who, "Oficina")?.querySelector(".ac-btn--primary")).toBeNull();
      },
      { macReady: true },
    ));

  test("Rename: the field takes the name, and Esc leaves the field, not the settings", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => el.querySelector(".dk-sx__head h2 button"),
      async (el, host) => {
        await act(async () => el.querySelector<HTMLButtonElement>(".dk-sx__head h2 button")?.click());
        const input = el.querySelector<HTMLInputElement>("#machine-name") as HTMLInputElement;
        expect(input.value).toBe("MacBook de Você");
        const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        await act(async () => input.dispatchEvent(esc));
        expect(el.querySelector("#machine-name")).toBeNull();
        expect(esc.defaultPrevented).toBe(true);
        expect(host.layer.route).toEqual({ screen: "settings" });
      },
    ));

  test("the server here's essentials: reach, the nightly backup and the Mac's own settings, each with its line", () =>
    pane(
      "here",
      <Settings />,
      (el) => row(el, "Reach from anywhere") && row(el, "Backup every night"),
      (el) => {
        expect(row(el, "Reach from anywhere")?.line).toBe("Only on this Mac. Your phone and team can't open it.");
        expect(rowEl(el, "Reach from anywhere")?.querySelector(".dk-crow__end button")?.textContent).toBe("Turn on");
        expect(row(el, "Backup every night")?.line).toMatch(/^Last one /);
        // macOS's own settings: their way there, never counted.
        expect(row(el, "Starts by itself after a power cut")?.line).toBe("Only macOS's settings turn this on.");
      },
    ));

  test("reach's Turn on in the Overview opens the server's section on its row, with the picker open", () =>
    pane(
      "here",
      <Settings />,
      (el) => rowEl(el, "Reach from anywhere")?.querySelector(".dk-crow__end button"),
      async (el) => {
        await act(async () => buttonIn(rowEl(el, "Reach from anywhere") as HTMLElement, "Turn on")?.click());
        await until(() => el.querySelector(".dk-sx__choose .dk-way"));
        expect(el.querySelector('.dk-pnav [aria-current="page"] .dk-sx__label')?.textContent).toBe(
          "Server on this Mac",
        );
        expect(el.querySelector('[data-focus="reach"] .dk-sx__choose')).not.toBeNull();
      },
    ));

  test("the order: what needs the person, then what is optional and off, then what is on", () => {
    const e = (id: Essential["id"], state: Essential["state"], optional = false): Essential => ({
      id,
      state,
      fix: state === "off" ? { kind: "autostart" } : null,
      ...(optional ? { optional } : {}),
    });
    const order = essentialRows([
      e("launchAtLogin", "on"),
      e("notifications", "on"),
      e("screen", "off"),
      e("disk", "on"),
      e("reach", "off", true),
      e("backup", "off"),
      e("autoUpdate", "na"),
    ]).map((r) => [r.id, r.state]);
    expect(order).toEqual([
      ["permissions", "off"],
      ["backup", "off"],
      ["reach", "off"],
      ["launchAtLogin", "on"],
    ]);
  });
});

describe("Settings › This computer › Server on this computer", () => {
  test("its state in words with Restart and its menu; reach off is one row with Turn on; backups with their links", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-phead .dk-sx__ok") && el.querySelector('.dk-phead button[aria-label="More"]'),
      async (el) => {
        expect(el.querySelector(".dk-phead h2")?.textContent).toBe("agentes.chat on this Mac");
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe("Running · only on this Mac");
        expect(el.querySelector(".dk-phead .ac-btn")?.textContent).toBe("Restart");
        // "Only on this Mac" said once: as the row's title, its line says what it means.
        expect(row(el, "Only on this Mac")?.line).toBe("Your phone and team can't open it.");
        expect(buttonIn(rowEl(el, "Only on this Mac") as HTMLElement, "Turn on")).toBeTruthy();
        // While it runs, Turn on is the screen's one filled button.
        expect(primaries(el)).toEqual(["Turn on"]);
        expect(row(el, "A copy also in")?.hint).toBe(
          "Each new backup is copied to this folder too, like a USB drive or iCloud Drive. The two newest stay there.",
        );
        // What is done to the backups, as links under the nightly backup's row.
        const backups = cardUnder(el, "Backups") as HTMLElement;
        const backupLinks = [...backups.querySelectorAll(".dk-crow__under .dk-sx__rowlinks button")];
        expect(backupLinks.map((b) => b.textContent)).toEqual(["Back up now", "Restore…", "Show in Finder"]);
        // What stops it, in the menu beside Restart: the two that end it here in the danger colour.
        const items = await serverMenu(el);
        expect(items.map((m) => m.textContent)).toEqual(["Stop", "Stop running it here…", "Erase and start over…"]);
        expect(items.map((m) => m.classList.contains("ac-menu__item--danger"))).toEqual([false, true, true]);
        expect(el.querySelector(".ac-chip")).toBeNull();
      },
    ));

  test("reach on: the address to copy, the phone's QR code from the window's own sign-in, and inviting the team", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-sx__qr svg"),
      async (el, host) => {
        expect(row(el, "ana-mac.tail1234.ts.net")?.line).toBe("Through Tailscale, with a lock");
        // Choosing the way again and turning access off: quiet links under its row (ADR 0265 §4).
        const links = [...(rowEl(el, "ana-mac.tail1234.ts.net")?.querySelectorAll(".dk-sx__rowlinks button") ?? [])];
        expect(links.map((b) => b.textContent)).toEqual(["Change", "Turn off"]);
        expect(row(el, "On your phone")?.line).toBe(
          "Install the agentes.chat app and Tailscale with the same account, and point the camera. It signs in by itself.",
        );
        expect(el.querySelector(".dk-sx__qr svg")?.getAttribute("aria-label")).toBe("QR code to sign in on the phone");
        // The site's invite page, with the layer out of the way.
        await act(async () => buttonIn(rowEl(el, "Invite someone from the team") as HTMLElement, "Invite")?.click());
        expect(host.sitePaths).toEqual(["/org/org_acme/settings/invites"]);
      },
      { here: { reach: true } },
    ));

  test("reach through the person's own address: its host, its way, and the phone and the team without Tailscale", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-sx__qr svg") && row(el, "agentes.example.com"),
      (el) => {
        expect(row(el, "agentes.example.com")?.line).toBe("Through your address");
        expect(rowEl(el, "agentes.example.com")?.querySelector(".dk-logo .ac-icon")).not.toBeNull();
        expect(rowEl(el, "agentes.example.com")?.querySelector(".dk-tailscale")).toBeNull();
        expect(row(el, "On your phone")?.line).toBe(
          "Install the agentes.chat app and point the camera. It signs in by itself.",
        );
        expect(row(el, "Invite someone from the team")?.line).toBe(
          "Invite them to the workspace. They open it at your address.",
        );
        expect(buttonIn(el, "Share in Tailscale")).toBeUndefined();
      },
      { here: { reach: true, way: "address" } },
    ));

  test("the address down: said on its row with Check again, which turns it back once it leads here", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => rowEl(el, "agentes.example.com")?.querySelector(".dk-crow__end button"),
      async (el) => {
        expect(row(el, "agentes.example.com")?.line).toBe("Your address doesn't lead here now.");
        const check = buttonIn(rowEl(el, "agentes.example.com") as HTMLElement, "Check again");
        expect(check).toBeTruthy();
        // Change and Turn off are there too, under the row.
        const links = [...(rowEl(el, "agentes.example.com")?.querySelectorAll(".dk-sx__rowlinks button") ?? [])];
        expect(links.map((b) => b.textContent)).toEqual(["Change", "Turn off"]);
        // The phone's code and inviting would lead nowhere while it's down: only the row with its fix.
        expect(rowEl(el, "On your phone")).toBeUndefined();
        expect(rowEl(el, "Invite someone from the team")).toBeUndefined();
        await act(async () => check?.click());
        await until(() => row(el, "agentes.example.com")?.line === "Through your address", 5000);
        expect(buttonIn(rowEl(el, "agentes.example.com") as HTMLElement, "Copy")).toBeTruthy();
        // Back: the phone and the team with it.
        await until(() => rowEl(el, "On your phone") && rowEl(el, "Invite someone from the team"));
      },
      { here: { reach: true, way: "address", health: "address" } },
    ));

  test("HTTPS waiting in the Tailscale network: said on its row, with Tailscale's page a button away", () => {
    const opened: string[] = [];
    return pane(
      "here",
      <Settings section="server" />,
      (el) => rowEl(el, "ana-mac.tail1234.ts.net")?.querySelector(".dk-crow__end button"),
      async (el) => {
        expect(row(el, "ana-mac.tail1234.ts.net")?.line).toBe(
          "Tailscale waits for HTTPS to be turned on in your network.",
        );
        // Nothing that leads nowhere until then: no phone code, no invite.
        expect(rowEl(el, "On your phone")).toBeUndefined();
        expect(rowEl(el, "Invite someone from the team")).toBeUndefined();
        await act(async () => buttonIn(el, "Open Tailscale's page")?.click());
        await until(() => opened.length > 0);
        expect(opened).toEqual(["https"]);
      },
      {
        here: { reach: true, health: "approve" },
        host: (host) => {
          host.openTailscale = async (page) => {
            opened.push(page);
          };
        },
      },
    );
  });

  test("Tailscale not connected here: only reach's row with its fix and its links, no phone code or invite", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => rowEl(el, "ana-mac.tail1234.ts.net")?.querySelector(".dk-crow__end button"),
      (el) => {
        expect(row(el, "ana-mac.tail1234.ts.net")?.line).toBe("Tailscale isn't connected on this Mac.");
        const links = [...(rowEl(el, "ana-mac.tail1234.ts.net")?.querySelectorAll(".dk-sx__rowlinks button") ?? [])];
        expect(links.map((b) => b.textContent)).toEqual(["Change", "Turn off"]);
        expect(rowEl(el, "On your phone")).toBeUndefined();
        expect(rowEl(el, "Invite someone from the team")).toBeUndefined();
        expect(el.querySelector(".dk-sx__qr")).toBeNull();
      },
      { here: { reach: true, health: "down" } },
    ));

  test("Turn on opens the picker inline: an address checked by its form, then where it leads, then reach on", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => buttonIn(rowEl(el, "Only on this Mac") as HTMLElement, "Turn on"),
      async (el, host) => {
        await act(async () => buttonIn(rowEl(el, "Only on this Mac") as HTMLElement, "Turn on")?.click());
        await until(() => el.querySelector(".dk-sx__choose .dk-way"));
        // Under the row, with no card: the two ways, then Cancel and Turn on.
        expect(el.querySelector(".dk-crow__under .dk-sx__choose")).not.toBeNull();
        const acts = () => el.querySelector(".dk-sx__chooseacts") as HTMLElement;
        expect([...acts().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Turn on"]);
        await act(async () => (el.querySelector("#way-address") as HTMLElement).click());
        // Its form first: no app asked.
        await act(async () => typeInto(el.querySelector("#way-address-url"), "http://agentes.example.com"));
        await act(async () => buttonIn(acts(), "Turn on")?.click());
        expect(el.querySelector(".ac-field__error")?.textContent).toBe("The address must start with https://");
        expect((await host.localServer()).reach).toBe(false);
        // An https origin: the app checks where it leads, and turns reach on through it.
        await act(async () => typeInto(el.querySelector("#way-address-url"), "https://Agentes.Example.com/"));
        expect(el.querySelector(".ac-field__error")).toBeNull();
        await act(async () => buttonIn(acts(), "Turn on")?.click());
        await until(() => row(el, "agentes.example.com")?.line === "Through your address", 5000);
        const now = await host.localServer();
        expect(now.reach).toBe(true);
        expect(now.way).toEqual({ kind: "address", url: "https://agentes.example.com" });
        expect(el.querySelector(".dk-sx__choose")).toBeNull();
      },
    ));

  test("an address that doesn't lead here: said under its field, where the tunnel points, and reach stays off", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => buttonIn(rowEl(el, "Only on this Mac") as HTMLElement, "Turn on"),
      async (el, host) => {
        await act(async () => buttonIn(rowEl(el, "Only on this Mac") as HTMLElement, "Turn on")?.click());
        await until(() => el.querySelector("#way-address"));
        await act(async () => (el.querySelector("#way-address") as HTMLElement).click());
        // Where the tunnel points, with Copy.
        expect(el.querySelector(".dk-way__tunnel")?.textContent).toContain("http://127.0.0.1:4310");
        await act(async () => typeInto(el.querySelector("#way-address-url"), "https://agentes.example.com"));
        const acts = el.querySelector(".dk-sx__chooseacts") as HTMLElement;
        await act(async () => buttonIn(acts, "Turn on")?.click());
        await until(() => el.querySelector(".ac-field__error"), 5000);
        expect(el.querySelector(".ac-field__error")?.textContent).toBe(
          "We couldn't open it. Check that your tunnel is on and points to http://127.0.0.1:4310.",
        );
        // Said once, under the field: not again as a row.
        expect(el.querySelector('.dk-sx [role="alert"].dk-fr__problem')).toBeNull();
        expect((await host.localServer()).reach).toBe(false);
        // Cancel closes the picker; the row is as it was.
        await act(async () => buttonIn(acts, "Cancel")?.click());
        expect(el.querySelector(".dk-sx__choose")).toBeNull();
        expect(row(el, "Only on this Mac")?.line).toBe("Your phone and team can't open it.");
      },
      { here: { addr: "unreachable" } },
    ));

  test("once erased, its section leaves the list and the first run opens on Run here's form", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-phead .dk-sx__ok"),
      async (el, host) => {
        const erase = await eraseItem(el);
        expect(erase?.getAttribute("aria-disabled")).toBeNull();
        await act(async () => erase?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        await act(async () => buttonIn(document.querySelector('[role="dialog"]') as HTMLElement, "Erase it")?.click());
        await until(() => !document.querySelector('[role="dialog"]'));
        await until(() => !navItems(el).includes("Server on this Mac"));
        expect(host.layer.route).toEqual({ screen: "firstRun", mode: "owner" });
      },
    ));

  test("Erase and start over… asks once, then a line says where its data went", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-phead .dk-sx__ok"),
      async (el, host) => {
        const items = await serverMenu(el);
        expect(items.map((m) => m.textContent)).toContain("Stop running it here…");
        await act(async () => items.find((m) => m.textContent === "Erase and start over…")?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog.textContent).toContain("Erase agentes.chat on this Mac?");
        // Its date never breaks at a hyphen (U+2011).
        expect(dialog.textContent).toContain("~/agentes.chat erased 2026‑11‑14");
        expect([...dialog.querySelectorAll("button")].map((b) => b.textContent).filter(Boolean)).toEqual([
          "Cancel",
          "Erase it",
        ]);
        await act(async () => buttonIn(dialog, "Erase it")?.click());
        // While it erases, nothing else can be pressed in its dialog, and it stays up once the server stopped.
        expect((buttonIn(dialog, "Cancel") as HTMLButtonElement).disabled).toBe(true);
        expect((await host.localServer()).phase).toBe("stopped");
        await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
        expect(document.querySelector('[role="dialog"]')).toBe(dialog);
        await until(() => !navItems(el).includes("Server on this Mac") && !document.querySelector('[role="dialog"]'));
        expect(document.querySelector(".dk-toast")?.textContent).toContain(
          "Erased. Its old data is in ~/agentes.chat erased 2026-11-14.",
        );
        expect(host.layer.route).toEqual({ screen: "firstRun", mode: "owner" });
        expect(await host.localServer()).toMatchObject({ installed: "none", run: false });
      },
    ));

  test("stopped running here: Start it here, and a folder that couldn't move says so in its dialog", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector('.dk-phead button[aria-label="More"]'),
      async (el) => {
        // Start it here in the heading, its menu holding what is left: erasing it.
        expect(buttonIn(el.querySelector(".dk-phead") as HTMLElement, "Start it here")).toBeTruthy();
        expect(primaries(el)).toEqual(["Start it here"]);
        const items = await serverMenu(el);
        expect(items.map((m) => m.textContent)).toEqual(["Erase and start over…"]);
        await act(async () => items[0]?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        await act(async () => buttonIn(dialog, "Erase it")?.click());
        await until(() => dialog.querySelector('[role="alert"]'));
        expectFailureInDialog(
          dialog,
          "Its data couldn't be moved, so nothing was erased and it stays in ~/.agentes. It's stopped until you start it again.",
        );
        // Opened again later, it starts clean.
        await act(async () => buttonIn(dialog, "Cancel")?.click());
        await until(() => !document.querySelector('[role="dialog"]'));
        const again = await eraseItem(el);
        await act(async () => again?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
      },
      {
        here: { run: false },
        host: (host) => {
          host.eraseLocalServer = () => Promise.reject("move");
        },
      },
    ));

  test("another server holding its folder: its dialog says to stop it first, and a second try erases", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-phead .dk-sx__ok"),
      async (el) => {
        const erase = await eraseItem(el);
        await act(async () => erase?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        // Everything that goes and everything that stays, in that order.
        expect(dialog.textContent).toContain(
          "Its workspaces go for everyone who uses them, on every device. Its data moves to ~/agentes.chat erased 2026‑11‑14 and stays there. What its agents kept on this Mac, such as their browsers and sign-ins, is deleted. The agents' files in ~/agentes are yours and stay where they are. Then you set it up again with a new owner.",
        );
        await act(async () => buttonIn(dialog, "Erase it")?.click());
        await until(() => dialog.querySelector('[role="alert"]'));
        expectFailureInDialog(
          dialog,
          "Another agentes.chat server is using its folder, so nothing was erased. Stop that server, then try again.",
        );
        await act(async () => buttonIn(dialog, "Erase it")?.click());
        await until(() => !document.querySelector('[role="dialog"]'));
        expect(document.querySelector(".dk-toast")?.textContent).toContain("Erased. Its old data is in");
      },
      {
        host: (host) => {
          const erase = host.eraseLocalServer;
          let tries = 0;
          host.eraseLocalServer = () => (tries++ === 0 ? Promise.reject("held") : erase());
        },
      },
    ));

  test("Erase and start over… waits while it starts, updates or restarts, since its files are being copied", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector('.dk-phead button[aria-label="More"]'),
      async (el) => {
        expect((await eraseItem(el))?.getAttribute("aria-disabled")).toBe("true");
      },
      { here: { phase: "updating" } },
    ));
});

describe("Settings › This computer › Folders and tools", () => {
  test("every workspace's folders in one list, each with its workspace; the note links to how folders work", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) => rowEl(el, "loja-v5") && rowEl(el, "site"),
      async (el, _host, opened) => {
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe(
          "What agents use on this Mac, in every workspace.",
        );
        expect(rowEl(el, "loja-v5")?.querySelector("small")?.textContent).toContain("Acme");
        expect(rowEl(el, "site")?.querySelector("small")?.textContent).toContain("Horizonte");
        expect(row(el, "Allow another folder")?.line).toBe("When an agent needs one, it asks in the chat and here.");
        const link = [...el.querySelectorAll("button")].find((b) => b.textContent === "How folders work");
        expect(link?.className).toBe("ac-link ac-link--muted dk-link");
        await act(async () => link?.click());
        expect(opened).toEqual(["https://agentes.chat/docs/computers#folders"]);
      },
    ));

  test("Tools: the browser, Commands with what they reach in sight, then each program with its state in words", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) => el.querySelector('#tool-claude[aria-checked="true"]'),
      (el) => {
        const card = cardUnder(el, "Tools") as HTMLElement;
        const tools = [...card.querySelectorAll(":scope > .dk-crow")].map((r) => ({
          title: r.querySelector(".dk-crow__title")?.textContent ?? null,
          hint: describedBy(r.querySelector("button.ac-hint")),
        }));
        expect(tools.map((tool) => tool.title)).toEqual([
          "Browser",
          "Commands",
          "Claude Code",
          "Codex",
          "Cursor",
          "OpenCode",
          "Grok Build",
          "Antigravity CLI",
          "Devin CLI",
        ]);
        expect(tools[1]?.hint).toBe(
          "Tests, builds and other Terminal commands. Each one shows in Activity. Commands run as you. They can read anything you can on this Mac, agentes.chat's database and keys included. Turn them on only for workspaces you trust with all of it.",
        );
        expect(row(card, "Browser")?.line).toBe("Only the agents', without your logins");
        expect(row(card, "Commands")?.line).toBe("Run as you and reach the rest of this Mac");
        expect(row(card, "Claude Code")?.line).toBe("Connected");
        expect(row(card, "Cursor")?.line).toBe("Not on this Mac yet");
        // No pills: states are words.
        expect(card.querySelector(".ac-chip")).toBeNull();
        // One switch per workspace under Commands, named after it.
        const orgs = [...card.querySelectorAll(".dk-crow__under > .dk-crow")].map((r) => [
          r.querySelector(".dk-crow__title")?.textContent,
          r.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
        ]);
        expect(orgs).toEqual([
          ["Acme", "true"],
          ["Horizonte", "true"],
        ]);
      },
    ));

  test("Tools: every coding program has a switch of its own, on or off whether or not it is installed", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) => el.querySelector('#tool-claude[aria-checked="true"]'),
      async (el) => {
        const state = (id: string) => el.querySelector(`#tool-${id}`)?.getAttribute("aria-checked");
        const programs = ["claude", "codex", "cursor", "opencode", "grok", "antigravity"];
        expect(programs.map(state)).toEqual(["true", "false", "false", "false", "false", "false"]);
        await act(async () => (el.querySelector("#tool-opencode") as HTMLElement).click());
        await until(() => state("opencode") === "true");
      },
    ));

  test("Tools: turning Commands on for one workspace asks first, and only that workspace changes", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) =>
        [...el.querySelectorAll('.dk-crow__under [role="switch"]')].some((s) => !(s as HTMLButtonElement).disabled),
      async (el) => {
        const switchOf = (org: string) =>
          [...el.querySelectorAll(".dk-crow__under > .dk-crow")]
            .find((r) => r.querySelector(".dk-crow__title")?.textContent === org)
            ?.querySelector('[role="switch"]') as HTMLButtonElement;
        expect(switchOf("Horizonte").getAttribute("aria-checked")).toBe("false");
        await act(async () => switchOf("Horizonte").click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog.textContent).toContain("Turn on Commands for Horizonte?");
        const turnOn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Turn on");
        await act(async () => turnOn?.click());
        await until(() => switchOf("Horizonte").getAttribute("aria-checked") === "true");
        expect(switchOf("Acme").getAttribute("aria-checked")).toBe("true");
      },
      { someCommands: true },
    ));

  test("Tools on Windows: Devin's row says why it doesn't run there, in place of its install line", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) => el.querySelector("#tool-devin"),
      (el) => {
        const devin = el.querySelector("#tool-devin")?.closest(".dk-crow") as HTMLElement;
        expect(devin.textContent).toContain(
          "Devin doesn't run on Windows yet: here its CLI can't keep each account's sign-in apart.",
        );
      },
      { host: (h) => Object.assign(h, { platform: "windows" }) },
    ));

  test("accounts: what the card is for behind its title's ⓘ", () =>
    pane(
      "selfhost",
      <Settings section="folders" />,
      (el) => [...el.querySelectorAll("button")].some((b) => b.textContent === "Add account" && !b.disabled),
      (el) => {
        const title = [...el.querySelectorAll(".dk-ctitle")].find((t) => t.textContent?.includes("Claude accounts"));
        expect(title?.querySelector(":scope > button.ac-hint")?.getAttribute("aria-label")).toBe(
          "About Claude accounts",
        );
        expect(describedBy(title?.querySelector(":scope > button.ac-hint"))).toBe(
          "Each Acme agent picks its account on its own page. Accounts stay on this Mac only.",
        );
      },
    ));
});

describe("Settings › This computer › App settings", () => {
  test("notifications, then the app's own choices, each on one line, its ⓘ where it has something to say", () =>
    pane(
      "selfhost",
      <Settings section="app" />,
      (el) =>
        row(el, "Let me know when an agent asks for a folder") &&
        row(el, "Open at login")?.hint &&
        row(cardUnder(el, "Servers and accounts") ?? el, "agentes.chat"),
      (el) => {
        expect(rows(cardUnder(el, "Notifications") as HTMLElement)).toEqual([
          {
            title: "Let me know about messages and requests",
            hint: "Mentions, direct messages and what waits for you, while the app is in the background.",
            switch: "Mentions, direct messages and what waits for you, while the app is in the background.",
            line: null,
          },
          { title: "Let me know when an agent asks for a folder", hint: null, switch: null, line: null },
          {
            title: "Let me know when an agent needs me in its browser",
            hint: "The request already reaches your phone and the site. This tells you here too.",
            switch: "The request already reaches your phone and the site. This tells you here too.",
            line: null,
          },
        ]);
        expect(rows(cardUnder(el, "This app") as HTMLElement)).toEqual([
          { title: "Language", hint: null, line: null },
          {
            title: "Open at login",
            hint: "Agents work only while the app is open.",
            switch: "Agents work only while the app is open.",
            line: null,
          },
          { title: "Show in the menu bar", hint: null, switch: null, line: null },
          {
            title: "Show the agents in the notch",
            hint: "On MacBooks with a notch: who is working shows around the camera.",
            switch: "On MacBooks with a notch: who is working shows around the camera.",
            line: null,
          },
        ]);
        // The servers this app opens; Updates, About and the advanced limits after them, Advanced a caption like the
        // others.
        const captions = [...el.querySelectorAll(".dk-ctitle")].map((h) => h.textContent);
        expect(captions.indexOf("Updates")).toBeGreaterThan(captions.indexOf("Servers and accounts"));
        expect(captions.indexOf("Advanced")).toBeGreaterThan(captions.indexOf("Updates"));
      },
    ));

  test("the server here: what the usage switch sends and that changing it restarts agentes.chat sit behind its ⓘ", () =>
    pane(
      "here",
      <Settings section="app" />,
      (el) =>
        row(el, "Send anonymous usage statistics to agentes.chat") &&
        row(el, "Reach it from your phone and teammates")?.line === null,
      (el) => {
        expect(row(el, "Send anonymous usage statistics to agentes.chat")).toEqual({
          title: "Send anonymous usage statistics to agentes.chat",
          hint: "Counts such as people, agents, machine sizes, AI tokens used, how much data the agents' browsers send and receive, and how fast the apps open and run. Never messages, files, names or sites. Changing it restarts agentes.chat for a moment.",
          switch:
            "Counts such as people, agents, machine sizes, AI tokens used, how much data the agents' browsers send and receive, and how fast the apps open and run. Never messages, files, names or sites. Changing it restarts agentes.chat for a moment.",
          line: null,
        });
        // The server here has its own section: never in the servers' list.
        expect(cardUnder(el, "Servers and accounts")?.textContent ?? "").not.toContain("127.0.0.1");
      },
    ));

  test("reach's switch turns on through the picker under it, and says the way once on (ADR 0265 §4)", () =>
    pane(
      "here",
      <Settings section="app" />,
      (el) => el.querySelector("#here-reach"),
      async (el) => {
        const reach = () => row(el, "Reach it from your phone and teammates");
        const toggle = () => el.querySelector("#here-reach") as HTMLElement;
        expect(reach()?.hint).toBe(
          "Through Tailscale, a free private network for your devices, or through an address of your own: your phone and the people you invite open agentes.chat from anywhere.",
        );
        // On: the picker opens, the switch stays off until reach is on.
        await act(async () => toggle().click());
        await until(() => el.querySelector(".dk-sx__choose .dk-way"));
        expect(toggle().getAttribute("aria-checked")).toBe("false");
        // Tailscale is connected here: its row says so, and Turn on applies it.
        await until(() => el.querySelector(".dk-way__line--ok"));
        const acts = el.querySelector(".dk-sx__chooseacts") as HTMLElement;
        await until(() => !(buttonIn(acts, "Turn on") as HTMLButtonElement | undefined)?.disabled);
        await act(async () => buttonIn(acts, "Turn on")?.click());
        await until(() => reach()?.line === "Through Tailscale, with a lock", 5000);
        expect(toggle().getAttribute("aria-checked")).toBe("true");
        expect(el.querySelector(".dk-sx__choose")).toBeNull();
      },
    ));

  test("About: the installed and internal versions stay distinct through a restart, and Jev's key a button away", () =>
    pane(
      "here",
      <About />,
      (el) => row(el, "Internal server version"),
      async (el, host, opened) => {
        const installed = () => row(el, "Installed package version")?.line;
        const internal = () => row(el, "Internal server version")?.line;
        expect(installed()).toBe("0.8.5");
        expect(internal()).toBe("0.1.1");
        const restarted = host.restartLocalServer();
        await until(() => internal() === undefined);
        expect(installed()).toBe("0.8.5");
        await act(() => restarted);
        await until(() => internal() === "0.1.1");
        // Jev's key is the server's: its card on the web, at the address the server has now.
        const jev = rowEl(el, "Jev");
        expect(jev?.querySelector("button.ac-hint")?.getAttribute("aria-label")).toBe("About Jev");
        expect(jev?.querySelector(".dk-crow__text > small")).toBeNull();
        await act(async () => jev?.querySelector<HTMLButtonElement>(".dk-crow__end button")?.click());
        expect(opened).toEqual(["http://127.0.0.1:4310/?open=jev"]);
        // The license's attribution and legal notices, always.
        expect(el.textContent).toContain("Based on agentes.chat by AGENTESCHAT, LLC");
        expect(el.textContent).toContain("Copyright © 2026 AGENTESCHAT, LLC and contributors");
      },
    ));

  test("About without the server here: only the legal notices", () =>
    pane(
      "selfhost",
      <About />,
      (el) => el.textContent?.includes("Based on agentes.chat"),
      (el) => {
        expect(row(el, "Jev")).toBeUndefined();
      },
    ));
});

describe("App settings › Updates", () => {
  const update = (over: Partial<UpdateCheck["state"]> = {}): UpdateCheck => ({
    state: { latest: null, available: false, required: false, ...over },
    checkedAt: null,
    checking: false,
    failed: false,
    check: async () => null,
    version: "0.6.0",
  });
  const latest = { version: "9.9.9", url: "https://app.agentes.chat/api/desktop/download/9.9.9/agentes.dmg" };

  test("the version's row: its state in words, Update and reopen at its end, and the manual way keeps what stays", () =>
    pane(
      "selfhost",
      <Updates update={update({ latest, available: true })} />,
      (el) => rowEl(el, "Version 0.6.0")?.querySelector(".dk-crow__end button"),
      async (el, host) => {
        const version = rowEl(el, "Version 0.6.0") as HTMLElement;
        expect(row(el, "Version 0.6.0")?.line).toBe("Version 9.9.9 is available · Not checked yet");
        expect(version.querySelector(".dk-crow__text > small .dk-sx__warn")?.textContent).toBe(
          "Version 9.9.9 is available",
        );
        expect(el.querySelector(".ac-chip")).toBeNull();
        // Update and reopen alone at the row's end, the screen's one filled button.
        const end = version.querySelector(".dk-crow__end") as HTMLElement;
        expect(end.textContent).toBe("Update and reopen");
        expect(primaries(el)).toEqual(["Update and reopen"]);
        host.installUpdate = async () => false;
        await act(async () => (end.querySelector("button") as HTMLButtonElement).click());
        await until(() => el.textContent?.includes("Download version 9.9.9"));
        expect(el.querySelector(".dk-ver__acts .dk-help")?.textContent).toBe("Your servers and settings stay.");
        // The row goes back to Check now: the download is the way now.
        expect(rowEl(el, "Version 0.6.0")?.querySelector(".dk-crow__end")?.textContent).toBe("Check now");
        expect(primaries(el)).toEqual(["Download version 9.9.9"]);
      },
    ));

  test("up to date: said in the ok colour on the version's row, with Check now at its end", () =>
    pane(
      "selfhost",
      <Updates update={update()} />,
      (el) => rowEl(el, "Version 0.6.0") && rowEl(el, "System details"),
      (el) => {
        expect(row(el, "Version 0.6.0")?.line).toBe("Up to date · Not checked yet");
        expect(rowEl(el, "Version 0.6.0")?.querySelector(".dk-sx__ok")?.textContent).toBe("Up to date");
        expect(rowEl(el, "Version 0.6.0")?.querySelector(".dk-crow__end")?.textContent).toBe("Check now");
        // One group: the version, installing at night and the system details, with no second card.
        expect(cardUnder(el, "Updates")?.querySelectorAll(".dk-crow").length).toBe(3);
        expect(primaries(el)).toEqual([]);
      },
    ));

  test("installing at night: on by default, and a change reaches this computer's essentials", () =>
    pane(
      "selfhost",
      <Updates update={update()} />,
      (el) => el.querySelector("#auto-update"),
      async (el) => {
        const sw = el.querySelector<HTMLButtonElement>("#auto-update") as HTMLButtonElement;
        expect(sw.getAttribute("aria-checked")).toBe("true");
        const told: (string | null)[] = [];
        const listen = (e: StorageEvent) => told.push(e.key);
        window.addEventListener("storage", listen);
        try {
          await act(async () => sw.click());
          expect(sw.getAttribute("aria-checked")).toBe("false");
          expect(told).toEqual(["agentes.desktop.autoUpdate"]);
        } finally {
          window.removeEventListener("storage", listen);
          // Back on for the files after this one.
          await act(async () => sw.click());
        }
      },
    ));

  test("the system details to copy, on every system", async () => {
    const copied: string[] = [];
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    try {
      await pane(
        "linux",
        <Updates update={update()} />,
        (el) => rows(el).some((r) => r.title === "System details"),
        async (el) => {
          const details = rowEl(el, "System details") as HTMLElement;
          const line =
            "agentes.chat 0.6.0 · Linux · Ubuntu 26.04 LTS · wayland (GNOME) · WebKitGTK 2.50.4 · Intel (i915) · CPU (chosen) · AppImage";
          // On screen each "·" keeps to the part before it (a no-break space), so a wrapped line never starts with one.
          expect(details.querySelector("small")?.textContent).toBe(line.replaceAll(" · ", "\u00a0· "));
          await act(async () => (details.querySelector("button") as HTMLButtonElement).click());
          await until(() => copied.length > 0);
          expect(copied).toEqual([line]);
        },
      );
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    }
  });

  test("the download with its bar and Cancel, which drops it; once whole, Installing… with no Cancel", () =>
    pane(
      "selfhost",
      <Updates update={update({ latest, available: true })} />,
      (el) => rowEl(el, "Version 0.6.0")?.querySelector(".dk-crow__end button"),
      async (el) => {
        const end = () => rowEl(el, "Version 0.6.0")?.querySelector(".dk-crow__end");
        const install = () => act(async () => end()?.querySelector("button")?.click());
        // The download under the version's row, on its words' line.
        const bar = () => rowEl(el, "Version 0.6.0")?.querySelector('.dk-crow__under .dk-upd [role="progressbar"]');
        await install();
        await until(() => Number(bar()?.getAttribute("aria-valuenow")) > 0);
        expect(el.querySelector(".dk-upd__label")?.textContent).toBe("Downloading…");
        await act(async () => (el.querySelector(".dk-upd button") as HTMLButtonElement).click());
        await until(() => end()?.textContent === "Update and reopen");
        expect(el.textContent).not.toContain("Update by hand");
        await install();
        await until(() => el.querySelector(".dk-upd__label")?.textContent === "Installing…");
        expect(el.querySelector(".dk-upd button")).toBeNull();
        // The fake ends the install a moment later: wait for it, or its state lands after the DOM is gone.
        await until(() => el.textContent?.includes("Download version 9.9.9"));
      },
    ));
});

describe("App settings › Advanced", () => {
  test("workspaces at different limits: the row says each one's number until a change sets all", () =>
    pane(
      "selfhost",
      <Advanced />,
      (el) => el.textContent?.includes("Not the same everywhere"),
      async (el) => {
        const limit = () =>
          [...el.querySelectorAll(".dk-crow")].find((r) => r.textContent?.includes("At the same time"));
        expect(limit()?.textContent).toMatch(/Not the same everywhere: .+ 3, .+ 12\. A change here sets all of them\./);
        expect(el.textContent?.match(/Not the same everywhere/g)).toHaveLength(1);
        await act(async () => limit()?.querySelector<HTMLButtonElement>('button[aria-label="Less"]')?.click());
        await until(() => !el.textContent?.includes("Not the same everywhere"));
      },
      {
        host: (h) => {
          const [first, second] = [...h.runners.values()];
          (second as unknown as { config: { maxConcurrentTasks?: number } }).config.maxConcurrentTasks = 12;
          (first as unknown as { config: { maxConcurrentTasks?: number } }).config.maxConcurrentTasks = 3;
        },
      },
    ));

  test("on Linux: back to defaults keeps eight conversations open for 60 minutes, as the runner does", () =>
    pane(
      "selfhost",
      <Advanced />,
      (el) =>
        el.querySelectorAll(".dk-card").length === 4 &&
        !(buttonIn(el, "Back to defaults") as HTMLButtonElement | undefined)?.disabled,
      async (el) => {
        // Its own group: when to touch it, and Back to defaults at the row's end.
        const advanced = cardUnder(el, "Advanced") as HTMLElement;
        expect(rows(advanced)).toEqual([
          { title: null, hint: null, line: "Only change this if the computer feels slow or busy." },
        ]);
        const defaults = advanced.querySelector<HTMLButtonElement>(".dk-crow__end button");
        expect(defaults?.textContent).toBe("Back to defaults");
        await act(async () => defaults?.click());
        const idle = () =>
          [...el.querySelectorAll('[role="radiogroup"]')]
            .find((g) => g.textContent?.includes("min"))
            ?.querySelector('[aria-checked="true"]')?.textContent;
        await until(() => idle() === "60 min");
        expect(el.querySelector('[aria-label="Open conversations"] output')?.textContent).toBe("8");
      },
      {
        host: (h) => {
          (h as { platform: string }).platform = "linux";
        },
      },
    ));
});

describe("App settings: Compatibility mode (Linux)", () => {
  const compatRow = (el: HTMLElement) => row(el, "Compatibility mode");
  const toast = () => document.querySelector(".dk-toast");
  const app = <Settings section="app" />;

  test("only on Linux, on by default, its explanation behind ⓘ; a change says it takes effect on reopening", () =>
    pane(
      "linux",
      app,
      (el) => compatRow(el) && !el.querySelector<HTMLButtonElement>("#compat")?.disabled,
      async (el, host) => {
        expect(compatRow(el)).toEqual({
          title: "Compatibility mode",
          hint: "Draws the window without the graphics card. It's slower but works on any computer. Use it if the window goes black, gets cut off or freezes.",
          switch:
            "Draws the window without the graphics card. It's slower but works on any computer. Use it if the window goes black, gets cut off or freezes.",
          line: null,
        });
        const chosen: boolean[] = [];
        let reopened = 0;
        let save = () => {};
        host.setCompatMode = (on) =>
          new Promise<void>((done) => {
            chosen.push(on);
            save = done;
          });
        host.reopen = async () => {
          reopened++;
        };
        const sw = el.querySelector<HTMLButtonElement>("#compat") as HTMLButtonElement;
        expect(sw.getAttribute("aria-checked")).toBe("true");
        await act(async () => sw.click());
        expect(chosen).toEqual([false]);
        expect(sw.disabled).toBe(true);
        await act(async () => save());
        await until(() => !sw.disabled);
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(toast()?.textContent).toBe("Takes effect when the app reopens.Reopen now");
        await act(async () => buttonIn(toast() as HTMLElement, "Reopen now")?.click());
        expect(reopened).toBe(1);
      },
    ));

  test("a switch that couldn't be saved goes back, and says so", () =>
    pane(
      "linux",
      app,
      (el) => compatRow(el) && !el.querySelector<HTMLButtonElement>("#compat")?.disabled,
      async (el, host) => {
        host.setCompatMode = async () => {
          throw new Error("read-only");
        };
        const sw = el.querySelector<HTMLButtonElement>("#compat") as HTMLButtonElement;
        await act(async () => sw.click());
        await until(() => !sw.disabled);
        expect(sw.getAttribute("aria-checked")).toBe("true");
        expect(toast()?.textContent).toBe("Something went wrong. Try again.");
      },
    ));

  test("after an opening with the graphics card that never painted: on again, said once, with the way back", () =>
    pane(
      "linux",
      app,
      () => toast()?.textContent?.includes("compatibility mode"),
      async (el, host) => {
        expect(el.querySelector("#compat")?.getAttribute("aria-checked")).toBe("true");
        expect(toast()?.textContent).toBe(
          "The window didn't open with the graphics card, so it opened in compatibility mode.Try the graphics card again",
        );
        const chosen: boolean[] = [];
        let reopened = 0;
        host.setCompatMode = async (on) => void chosen.push(on);
        host.reopen = async () => {
          reopened++;
        };
        await act(async () => buttonIn(toast() as HTMLElement, "Try the graphics card again")?.click());
        await until(() => reopened === 1);
        expect(chosen).toEqual([false]);
      },
      { host: (h) => (h.compat = { on: true, fellBack: true, own: false }) },
    ));

  test("the fallback's way back asks first when agentes.chat starts running here after the window opened", () => {
    const listeners: ((status: LocalServerStatus) => void)[] = [];
    return pane(
      "linux",
      app,
      () => toast()?.textContent?.includes("compatibility mode"),
      async (_el, host) => {
        let reopened = 0;
        host.setCompatMode = async () => {};
        host.reopen = async () => {
          reopened++;
        };
        const status = await host.localServer();
        await act(async () => {
          for (const said of listeners) said({ ...status, run: true });
        });
        await act(async () => buttonIn(toast() as HTMLElement, "Try the graphics card again")?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]')?.textContent;
        expect(dialog).toContain("Reopen agentes.chat?");
        expect(dialog).toContain("agentes.chat stops on this computer: nobody can use it");
        expect(reopened).toBe(0);
      },
      {
        host: (h) => {
          h.compat = { on: true, fellBack: true, own: false };
          h.onLocalServer = (cb) => {
            listeners.push(cb);
            return () => {};
          };
        },
      },
    );
  });

  test("Reopen now asks first while agents work here, and waits while the app reopens", () =>
    pane(
      "selfhost",
      app,
      // Agents work here once their notifications show.
      (el) =>
        row(el, "Let me know when an agent asks for a folder") &&
        compatRow(el) &&
        !el.querySelector<HTMLButtonElement>("#compat")?.disabled,
      async (el, host) => {
        let reopened = 0;
        host.reopen = () => {
          reopened++;
          return new Promise<void>(() => {});
        };
        await act(async () => el.querySelector<HTMLButtonElement>("#compat")?.click());
        await until(() => buttonIn(toast() as HTMLElement, "Reopen now"));
        await act(async () => buttonIn(toast() as HTMLElement, "Reopen now")?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        expect(dialog.textContent).toContain("Reopen agentes.chat?");
        expect(dialog.textContent).toContain("Agents can't use this computer until the app opens again.");
        expect(reopened).toBe(0);
        await act(async () => buttonIn(dialog, "Reopen now")?.click());
        expect(reopened).toBe(1);
        expect((buttonIn(dialog, "Cancel") as HTMLButtonElement).disabled).toBe(true);
        expect((buttonIn(dialog, "Reopen now") as HTMLButtonElement).disabled).toBe(true);
      },
      { host: (h) => Object.assign(h, { platform: "linux" }) },
    ));

  test("the system's own WEBKIT_DISABLE_DMABUF_RENDERER decides: the switch shows it, can't change it, and its ⓘ says why", () =>
    pane(
      "linux",
      app,
      (el) => compatRow(el)?.hint?.includes("decides this now"),
      (el) => {
        const desc =
          "Draws the window without the graphics card. It's slower but works on any computer. Use it if the window goes black, gets cut off or freezes.";
        expect(compatRow(el)?.hint).toBe(
          `${desc} WEBKIT_DISABLE_DMABUF_RENDERER decides this now. To choose here, quit the app and open it without that variable.`,
        );
        const sw = el.querySelector<HTMLButtonElement>("#compat") as HTMLButtonElement;
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(sw.disabled).toBe(true);
      },
      { host: (h) => (h.compat = { on: false, fellBack: false, own: true }) },
    ));

  test("not on a Mac or Windows", async () => {
    for (const scenario of ["selfhost", "windows"] as const)
      await pane(
        scenario,
        app,
        (el) => row(el, "Language"),
        (el) => {
          expect(compatRow(el)).toBeUndefined();
        },
      );
  });
});

describe("Agents use this computer's internet: what goes through it, by server", () => {
  const computer = {
    id: "m-desk",
    mayManage: true,
    shareInternet: { on: true, inUse: false },
  } as unknown as ComputerDevice;
  test("all TCP on agentes.chat; what follows proxy settings on a self-hosted server", async () => {
    for (const [server, has] of [
      [CLOUD_SERVER, "websites, git, SSH, databases and other TCP connections"],
      ["https://agents.example.com", "ignore proxy settings use their usual connection"],
    ] as const)
      await pane(
        "selfhost",
        <InternetRow server={server} orgId="o-1" computer={computer} />,
        (el) => row(el, "Agents use this computer's internet"),
        (el) => {
          expect(row(el, "Agents use this computer's internet")?.hint).toContain(has);
          expect(row(el, "Agents use this computer's internet")?.hint).toContain("port 25");
        },
      );
  });

  test("use only this computer's internet: nested under the switch while it lends, none from an older server", async () => {
    const lent = { ...computer, shareInternet: { on: true, inUse: false, only: false } } as ComputerDevice;
    await pane(
      "selfhost",
      <InternetRow server={CLOUD_SERVER} orgId="o-1" computer={lent} />,
      (el) => row(el, "Use only this computer's internet"),
      (el) => {
        const only = row(el, "Use only this computer's internet");
        expect(only?.hint).toContain("their AI included");
        const line = el.querySelector("#internet-m-desk-only")?.closest(".dk-crow");
        expect(line?.getAttribute("data-nested")).toBe("true");
      },
    );
    await pane(
      "selfhost",
      <InternetRow server={CLOUD_SERVER} orgId="o-1" computer={computer} />,
      (el) => row(el, "Agents use this computer's internet"),
      (el) => {
        expect(row(el, "Use only this computer's internet")).toBeUndefined();
      },
    );
  });
});
