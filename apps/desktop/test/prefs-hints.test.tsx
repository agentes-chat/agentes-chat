import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import type { Essential } from "../src/control/essentials";
import type { LocalServerStatus, Tailnet } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import type { UpdateCheck } from "../src/hooks";
import { createFakeHost, type FakeHost, type HereOptions, type Scenario } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { Advanced } from "../src/layer/settings/Advanced";
import { essentialRows } from "../src/layer/settings/AlwaysOn";
import { Settings } from "../src/layer/settings/Settings";
import { sectionFor, sectionsOf } from "../src/layer/settings/sections";
import { About, Updates } from "../src/layer/settings/Updates";
import { ToastProvider } from "../src/ui/Toast";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Settings › This computer (ADR 0256) on a fake host, once `ready` says it shows what the test looks at.
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
/** What follows a card title: its card. */
const cardUnder = (root: ParentNode, title: string) =>
  [...root.querySelectorAll(".dk-ctitle")].find((h) => h.textContent === title)?.nextElementSibling as
    | HTMLElement
    | undefined;
/** The section list's entries, in order, by their words. */
const navItems = (root: ParentNode) =>
  [...root.querySelectorAll(".dk-pnav button")].map((b) => b.querySelector(".dk-sx__label")?.textContent);
const eraseButton = (root: ParentNode) => buttonIn(root, "Erase and start over…");
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

  test("with the workspace's page there: its sections lead, each moves the site; This Mac's follow; a way back", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => navItems(el).includes("Folders and tools") && navItems(el).includes("People"),
      async (el, host) => {
        expect(navItems(el)).toEqual([
          "Back to Acme",
          "General",
          "People",
          "Agents",
          "Connectors",
          "Usage",
          "Overview",
          "Folders and tools",
          "Activity",
          "App settings",
        ]);
        expect(el.querySelector(".dk-pnav__whotext")?.textContent).toBe("SettingsAcme");
        expect(el.querySelector(".dk-pnav__group")?.textContent).toBe("This Mac");
        // No line about the connection: the page is there.
        expect(el.querySelector(".dk-sx__away")).toBeNull();
        await act(async () => buttonIn(el, "People")?.click());
        expect(host.sitePaths).toEqual(["/org/org_acme/settings/members"]);
        expect(host.layer.route).toBeNull();
      },
    ));

  test("without the site: This Mac's sections alone under its picture, and a quiet line with Try again", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => el.querySelector(".dk-sx__away") && navItems(el).includes("Activity"),
      async (el, host) => {
        expect(navItems(el)).toEqual(["Overview", "Folders and tools", "Activity", "App settings"]);
        expect(el.querySelector(".dk-pnav__whotext")?.textContent).toBe("This MacSettings");
        expect(el.querySelector(".dk-sx__away")?.textContent).toBe(
          "No connection with Acme. What belongs to this Mac works the same. Who can use it and the agents' names come back with the connection.Try again",
        );
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
        expect(rowEl(who, "Another workspace")?.querySelector("button")?.textContent).toBe("Add a workspace…");
      },
    ));

  test("every permission allowed: All set in the ok colour, and the permissions' row says All on", () =>
    pane(
      "selfhost",
      <Settings />,
      (el) => el.querySelector(".dk-sx__headtext .dk-sx__ok"),
      (el) => {
        expect(el.querySelector(".dk-sx__headtext > p")?.textContent).toBe("All set");
        const always = cardUnder(el, "Always ready") as HTMLElement;
        expect(rowEl(always, "macOS permissions")?.querySelector(".dk-sx__on")?.textContent).toBe("All on");
        expect(el.querySelector(".dk-sx__dot")).toBeNull();
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
  test("its state in words with Restart; reach off is one row with Turn on; backups and the quiet links", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-phead .dk-sx__ok") && eraseButton(el),
      (el) => {
        expect(el.querySelector(".dk-phead h2")?.textContent).toBe("agentes.chat on this Mac");
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe("Running · only on this Mac");
        expect(el.querySelector(".dk-phead .ac-btn")?.textContent).toBe("Restart");
        expect(row(el, "Only on this Mac")?.line).toBe("Only on this Mac. Your phone and team can't open it.");
        expect(row(el, "A copy also in")?.hint).toBe(
          "Each new backup is copied to this folder too, like a USB drive or iCloud Drive. The two newest stay there.",
        );
        const links = [...(el.querySelector(".dk-sx__links")?.querySelectorAll("button") ?? [])].map(
          (b) => b.textContent,
        );
        expect(links).toEqual([
          "Back up now",
          "Restore…",
          "Show in Finder",
          "Stop",
          "Stop running it here…",
          "Erase and start over…",
        ]);
        expect(el.querySelector(".ac-chip")).toBeNull();
      },
    ));

  test("reach on: the address to copy, the phone's QR code from the window's own sign-in, and inviting the team", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => el.querySelector(".dk-sx__qr svg"),
      async (el, host) => {
        expect(row(el, "ana-mac.tail1234.ts.net")?.line).toBe("On your private network, with a lock");
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

  test("the app's own Tailscale signed out: the address row says so, with its one fix", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => rowEl(el, "agentes.tail1234.ts.net")?.querySelector(".dk-crow__end button"),
      (el) => {
        expect(row(el, "agentes.tail1234.ts.net")?.line).toBe(
          "Tailscale isn't signed in, so your phone and team can't reach it.",
        );
        expect(rowEl(el, "agentes.tail1234.ts.net")?.querySelector(".dk-crow__end button")?.textContent).toBe(
          "Sign in to Tailscale",
        );
      },
      { here: { reach: true, tailnet: "signedOut" } },
    ));

  test("once erased, its section leaves the list and the first run opens on Run here's form", () =>
    pane(
      "here",
      <Settings section="server" />,
      (el) => eraseButton(el) && !eraseButton(el)?.disabled,
      async (el, host) => {
        await act(async () => eraseButton(el)?.click());
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
      (el) => eraseButton(el),
      async (el, host) => {
        expect(eraseButton(el)?.closest(".dk-sx__links")?.textContent).toContain("Stop running it here…");
        await act(async () => eraseButton(el)?.click());
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
        await until(() => !eraseButton(el) && !document.querySelector('[role="dialog"]'));
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
      (el) => eraseButton(el),
      async (el) => {
        expect(eraseButton(el)?.closest(".dk-crow")).toBeNull();
        expect(eraseButton(el)?.closest(".dk-sx__links")).toBeTruthy();
        expect(el.textContent).toContain("Start it here");
        await act(async () => eraseButton(el)?.click());
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
        await act(async () => eraseButton(el)?.click());
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
      (el) => eraseButton(el),
      async (el) => {
        await act(async () => eraseButton(el)?.click());
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
      (el) => eraseButton(el),
      (el) => {
        expect((eraseButton(el) as HTMLButtonElement).disabled).toBe(true);
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
        // The servers this app opens; Updates, About and the advanced limits after them.
        expect(el.querySelector(".dk-sx__subhead h3")?.textContent).toBe("Advanced");
        expect([...el.querySelectorAll(".dk-ctitle")].map((h) => h.textContent)).toContain("Updates");
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

  test("until Tailscale answers, reach says it is checking and its switch waits", async () => {
    // Tailscale is connected, but its read takes a moment: the line says so, never "Needs Tailscale" meanwhile.
    const answers: ((tailnet: Tailnet) => void)[] = [];
    await pane(
      "here",
      <Settings section="app" />,
      (el) => row(el, "Reach it from your phone and teammates"),
      async (el) => {
        const reach = () => row(el, "Reach it from your phone and teammates");
        expect(reach()?.line).toBe("Checking whether Tailscale is connected…");
        expect(el.querySelector("#here-reach")?.hasAttribute("disabled")).toBe(true);
        await act(async () => {
          for (const answer of answers) answer({ state: "on", device: "macbook" });
        });
        await until(() => !el.querySelector("#here-reach")?.hasAttribute("disabled"));
        expect(reach()?.line).toBeNull();
      },
      {
        host: (host) => {
          host.tailscale = () => new Promise((resolve) => answers.push(resolve));
        },
      },
    );
  });

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

  test("its state in words; Update and reopen alone, and the manual way keeps what stays", () =>
    pane(
      "selfhost",
      <Updates update={update({ latest, available: true })} />,
      (el) => el.querySelector(".dk-ver__acts"),
      async (el, host) => {
        expect(el.querySelector(".dk-ver .dk-sx__warn")?.textContent).toBe("Version 9.9.9 is available");
        expect(el.querySelector(".ac-chip")).toBeNull();
        const acts = el.querySelector(".dk-ver__acts") as HTMLElement;
        expect(acts.textContent).toBe("Update and reopen");
        host.installUpdate = async () => false;
        await act(async () => (acts.querySelector("button") as HTMLButtonElement).click());
        await until(() => el.textContent?.includes("Download version 9.9.9"));
        expect(el.querySelector(".dk-ver__acts .dk-help")?.textContent).toBe("Your servers and settings stay.");
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
          expect(details.querySelector("small")?.textContent).toBe(line);
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
      (el) => el.querySelector(".dk-ver__acts"),
      async (el) => {
        const install = () => act(async () => (el.querySelector(".dk-ver__acts button") as HTMLButtonElement).click());
        const bar = () => el.querySelector('.dk-upd [role="progressbar"]');
        await install();
        await until(() => Number(bar()?.getAttribute("aria-valuenow")) > 0);
        expect(el.querySelector(".dk-upd__label")?.textContent).toBe("Downloading…");
        await act(async () => (el.querySelector(".dk-upd button") as HTMLButtonElement).click());
        await until(() => el.querySelector(".dk-ver__acts")?.textContent === "Update and reopen");
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
        el.querySelectorAll(".dk-card").length === 3 &&
        !el.querySelector(".dk-sx__subhead button")?.hasAttribute("disabled"),
      async (el) => {
        const defaults = el.querySelector<HTMLButtonElement>(".dk-sx__subhead button");
        expect(defaults?.textContent).toBe("Back to defaults");
        expect(el.querySelector(".dk-sx__subhead .dk-lead")?.textContent).toBe(
          "Only change this if the computer feels slow or busy.",
        );
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
