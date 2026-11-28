import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { CLOUD_SERVER } from "@agenteschat/client/lib/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import { nextOffer, PAIR_OFFERED_PREF, type PairTarget, parsePairLink, unpairedWorkspaces } from "../src/control/pair";
import { MAC_ASKED_PREF } from "../src/control/permissions";
import type { ServerWorkspaces } from "../src/control/server";
import { DesktopStore, pairedHomes, type Snapshot } from "../src/control/store";
import { FAKE_LINKS, FAKE_SERVER } from "../src/dev/fake-runner";
import { writePref } from "../src/hooks";
import { createFakeHost, type FakeHost, type Scenario } from "../src/host/fake";
import type { LayerRoute } from "../src/host/types";
import { createDesktopI18n } from "../src/i18n";
import { Settings } from "../src/layer/settings/Settings";
import { ToastProvider } from "../src/ui/Toast";
import { WindowView } from "../src/WindowView";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The app layer (ADR 0265) on `route` (This computer's settings by default), with `view` drawn in it. */
async function mount(
  route: LayerRoute,
  view: ReactNode,
  check: (el: HTMLElement, host: FakeHost, store: DesktopStore) => Promise<void>,
  options: {
    link?: string;
    macReady?: boolean;
    scenario?: Scenario;
    tools?: "claude" | "none";
    host?: (host: FakeHost) => void;
  } = {},
) {
  const { link, macReady, tools } = options;
  const host = createFakeHost("app", options.scenario ?? "selfhost", { link, macReady, tools, route });
  options.host?.(host);
  await host.setAutostart(false);
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
    await check(el, host, store);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

afterEach(() => {
  writePref(PAIR_OFFERED_PREF, []);
  writePref(MAC_ASKED_PREF, null);
});

const SETTINGS: LayerRoute = { screen: "settings" };
const layer = <WindowView name="app" />;

const button = (root: ParentNode | undefined, text: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === text);
const rowOf = (el: HTMLElement, title: string) =>
  [...el.querySelectorAll<HTMLElement>(".dk-crow")].find(
    (r) => r.querySelector(".dk-crow__title")?.textContent === title,
  );
const toggle = (el: HTMLElement, title: string) =>
  rowOf(el, title)?.querySelector<HTMLElement>('[role="switch"]')?.click();
/** The pairing's "What agents can do here" switches, by title. */
const switches = (el: HTMLElement) =>
  Object.fromEntries(
    ["Commands", "Claude Code", "Codex", "Browser"].flatMap((title) => {
      const on = rowOf(el, title)?.querySelector('[role="switch"]')?.getAttribute("aria-checked");
      return on ? [[title, on]] : [];
    }),
  );
const pairLink = (code: string) => `agenteschat://pair?server=${encodeURIComponent(FAKE_SERVER)}&link=${code}`;
const pairedWith = (store: DesktopStore, orgId: string) =>
  pairedHomes(store.getSnapshot()).some((h) => h.status?.org?.id === orgId);

describe("pairing from the app", () => {
  test("a pair link as Rust hands it over: the server and the stored code", () => {
    expect(parsePairLink(pairLink("ABCDEFGH"))).toEqual({ server: FAKE_SERVER, code: "ABCDEFGH" });
    expect(parsePairLink("agenteschat://pair/?link=abcd-efgh&server=https://app.agentes.chat")).toEqual({
      server: CLOUD_SERVER,
      code: "ABCDEFGH",
    });
    for (const bad of [
      "agenteschat://connect?server=https%3A%2F%2Fapp.agentes.chat",
      "agenteschat://pair?server=http%3A%2F%2Fagentes.example.com&link=ABCDEFGH",
      "agenteschat://pair?server=https%3A%2F%2Fapp.agentes.chat&link=ABCDEFG",
    ])
      expect(parsePairLink(bad)).toBeNull();
  });

  test("offered after sign-in: workspaces that may pair, where agents may work, not paired here yet, once each", () => {
    const list: ServerWorkspaces[] = [
      {
        server: FAKE_SERVER,
        signedIn: true,
        agentsHere: true,
        orgs: [
          { id: "org_acme", name: "Acme", logo: null, unread: 0, waiting: 0, pair: true },
          { id: "o-norte", name: "Estúdio Norte", logo: null, unread: 0, waiting: 0, pair: true },
          { id: "o-guest", name: "Guests", logo: null, unread: 0, waiting: 0, pair: false },
        ],
      },
      { server: CLOUD_SERVER, signedIn: false, agentsHere: true, orgs: [] },
      {
        server: "http://127.0.0.1:4310",
        signedIn: true,
        agentsHere: false,
        orgs: [{ id: "o-here", name: "Here", logo: null, unread: 0, waiting: 0, pair: true }],
      },
    ];
    const home = (orgId: string, running = true) => ({
      homeId: orgId,
      dir: "",
      running,
      hello: null,
      status: {
        paired: true,
        server: FAKE_SERVER,
        org: { id: orgId, name: orgId },
        connection: "online",
        paused: { paused: false },
      },
      jobs: [],
      requests: [],
      access: null,
      logo: null,
    });
    const snap = { loaded: true, homes: [home("org_acme")] } as unknown as Snapshot;
    expect(unpairedWorkspaces(list, snap).map((t) => t.orgId)).toEqual(["o-norte"]);
    // Offered right after signing in there: the read before had the server signed out.
    const signedOut = list.map((s) => ({ ...s, signedIn: false, orgs: [] }));
    expect(nextOffer(list, signedOut, snap, [])?.name).toBe("Estúdio Norte");
    expect(nextOffer(list, signedOut, snap, [`${FAKE_SERVER} o-norte`])).toBeNull();
    // The app's first read, and a read after one where it was already signed in (an unread count changed): nothing.
    expect(nextOffer(list, null, snap, [])).toBeNull();
    expect(nextOffer(list, list, snap, [])).toBeNull();
    // A home whose runner hasn't said yet whether it's paired: nothing offered until it has.
    const starting = { loaded: true, homes: [{ ...home("org_acme"), status: null }] } as unknown as Snapshot;
    expect(nextOffer(list, signedOut, starting, [])).toBeNull();
    expect(nextOffer(list, signedOut, { loaded: false, homes: [] }, [])).toBeNull();
  });

  test("Get this Mac ready: what agents get here in four lines, no switch and no checkbox; it pairs, opens at login and goes on to Prepare", () => {
    const target: PairTarget = { server: FAKE_SERVER, orgId: "o-norte", name: "Estúdio Norte", logo: null };
    return mount({ screen: "pairOffer", target }, layer, async (el, host, store) => {
      await until(() => el.querySelector("h1")?.textContent === "Get this Mac ready for Estúdio Norte's agents?");
      // A sheet over the site there (a Mac), in the sheet frame.
      expect(host.layer.mode).toBe("sheet");
      expect(el.querySelector('.dk-shf[data-mode="sheet"] [role="dialog"] [data-screen="ready"]')).toBeTruthy();
      // A Mac with permissions still off: the first of two steps.
      await until(() => el.querySelector(".dk-sh__step")?.textContent === "This Mac · 1 of 2");
      // A server this Mac only opens: lending it is optional.
      expect(el.querySelector(".dk-sh__lead")?.textContent).toBe(
        "Only if you want this Mac to do agents' work too. With Not now you still use Estúdio Norte here as usual.",
      );
      // The four lines, the coding tools found here by name.
      await until(() => el.textContent?.includes("Claude Code and Codex, already here."));
      expect([...el.querySelectorAll(".dk-sh__line")].map((li) => li.textContent)).toEqual([
        "The agents' own browserWithout your logins and passwords.",
        "Commands and coding toolsClaude Code and Codex, already here. They run as your user.",
        "Your folders only with your OKEach request shows in the chat and in the menu bar.",
        "Opens by itself when the Mac startsSo agents come back without you having to remember.",
      ]);
      expect(el.querySelector(".dk-sh__help")?.textContent).toBe(
        "Change it any time in Settings\u00a0›\u00a0This Mac.",
      );
      // Nothing to switch, and open at login comes with it (ADR 0265 §7).
      expect(el.querySelector('[role="switch"]')).toBeNull();
      expect(el.querySelector('[role="checkbox"]')).toBeNull();
      // No card inside the card.
      expect(el.querySelector(".dk-sh .dk-card")).toBeNull();
      expect(button(el, "Not now")).toBeTruthy();
      expect(document.activeElement).not.toBe(button(el, "Get it ready"));

      await act(async () => button(el, "Get it ready")?.click());
      // Paired with the main window's session, then Prepare (a route of its own) for this workspace.
      await until(() => host.layer.route?.screen === "prepare");
      expect(host.layer.route).toEqual({ screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER });
      expect(await host.autostart()).toBe(true);
      expect(host.site.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        expect.stringMatching(/^\/api\/app\/organizations\/o-norte\/machines\/device\/[A-Z0-9]{6}\/confirm$/),
      ]);
      // It joins as the person's alone (Settings shares it), with the tools open as the other workspaces have them.
      expect(host.site.calls.some((c) => c.method === "PATCH")).toBe(false);
      const norte = () => pairedHomes(store.getSnapshot()).find((h) => h.status?.org?.id === "o-norte");
      await until(() => {
        const tools = norte()?.access?.tools;
        return tools?.claude === true && tools.codex === false && tools.commands === true && tools.browser === false;
      });
      await until(() => el.querySelector("h1")?.textContent === "macOS asks three things, once");
    });
  });

  test("Get this PC ready: the same card on the app's background, no menu bar, no second step", () => {
    const target: PairTarget = { server: FAKE_SERVER, orgId: "o-norte", name: "Estúdio Norte", logo: null };
    return mount(
      { screen: "pairOffer", target },
      layer,
      async (el, host) => {
        await until(() => el.querySelector("h1")?.textContent === "Get this PC ready for Estúdio Norte's agents?");
        // Nothing is drawn over the site on Windows: the same card on the app's background.
        expect(host.layer.mode).toBe("full");
        expect(el.querySelector('.dk-shf[data-mode="full"] [role="dialog"]')).toBeTruthy();
        expect(el.querySelector(".dk-shf__scrim")).toBeNull();
        expect(el.querySelector(".dk-sh__step")?.textContent).toBe("This PC");
        expect(el.textContent).toContain("Each request shows in the chat and on the app's icon.");
        expect(el.textContent).not.toContain("menu bar");
        // No coding tool found here yet: only how they run.
        expect(el.textContent).toContain("Commands and coding toolsThey run as your user.");
      },
      { scenario: "windows" },
    );
  });

  test("Get this Mac ready names only the coding tool found here", () => {
    const target: PairTarget = { server: FAKE_SERVER, orgId: "o-norte", name: "Estúdio Norte", logo: null };
    return mount(
      { screen: "pairOffer", target },
      layer,
      async (el) => {
        await until(() => el.textContent?.includes("Claude Code, already here. They run as your user."));
        expect(el.textContent).not.toContain("Codex");
      },
      { tools: "claude" },
    );
  });

  test("a Mac with every permission on: Get it ready pairs and the sheet steps aside, no Prepare", () => {
    const target: PairTarget = { server: FAKE_SERVER, orgId: "o-norte", name: "Estúdio Norte", logo: null };
    return mount(
      { screen: "pairOffer", target },
      layer,
      async (el, host, store) => {
        await until(() => button(el, "Get it ready"));
        expect(el.querySelector(".dk-sh__step")?.textContent).toBe("This Mac");
        await act(async () => button(el, "Get it ready")?.click());
        await until(() => host.layer.route === null);
        expect(host.routes.some((r) => r.screen === "prepare")).toBe(false);
        await until(() => pairedWith(store, "o-norte"));
      },
      { macReady: true },
    );
  });

  test("Prepare: three rows between hairlines, read live; notifications and Screen Recording asked once, then System Settings with the wait under the row", () =>
    mount(SETTINGS, layer, async (el, host) => {
      await act(async () => host.showLayer({ screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER }));
      await until(() => el.querySelector("h1")?.textContent === "macOS asks three things, once");
      expect(el.querySelector(".dk-sh__step")?.textContent).toBe("This Mac · 2 of 2");
      expect(el.querySelector(".dk-sh__lead")?.textContent).toBe(
        "Without them, agents stop in the middle of their work to ask.",
      );
      // Kept from the start: macOS quitting the app now brings it back here.
      await until(() => host.mac.setup?.step === "prepare");
      expect(host.mac.setup).toMatchObject({ step: "prepare", org: "Estúdio Norte", server: FAKE_SERVER });
      const end = (title: string) => rowOf(el, title)?.querySelector(".dk-crow__end")?.textContent;
      const waits = (title: string) => rowOf(el, title)?.querySelector(".dk-sh__wait")?.textContent ?? null;
      await until(() => end("Screen Recording") === "Allow");
      // Rows, not a card in the card; Local Network is asked only when an Android phone pairs over Wi-Fi.
      expect(el.querySelector(".dk-sh .dk-card")).toBeNull();
      expect(el.querySelectorAll(".dk-sh__rows > .dk-crow").length).toBe(3);
      expect([...el.querySelectorAll(".dk-crow__title")].map((n) => n.textContent)).toEqual([
        "Notifications",
        "Screen Recording",
        "Full Disk Access",
      ]);
      expect([...el.querySelectorAll(".dk-crow__text small")].map((n) => n.textContent)).toEqual([
        "When an agent needs you.",
        "So agents can see what they do on the screen.",
        "To open the folders you allow without macOS asking again.",
      ]);
      expect(end("Notifications")).toBe("Allow");
      expect(end("Full Disk Access")).toBe("Allow");
      expect(el.querySelector(".dk-sh__wait")).toBeNull();
      expect(el.querySelector(".dk-sh__help")?.textContent).toBe(
        "If an update turns one off, we'll tell you right away.",
      );
      expect(button(el, "Do it later")).toBeTruthy();

      // Notifications: the system's prompt once, read back at once; nothing to wait on in System Settings.
      await act(async () => button(rowOf(el, "Notifications"), "Allow")?.click());
      await until(() => end("Notifications") === "On");
      expect(host.mac.notifyAsks).toBe(1);
      expect(host.mac.panes).toEqual([]);
      expect(waits("Notifications")).toBeNull();

      // Screen Recording: the system's prompt first (it sends the person to System Settings), and the row waits.
      await act(async () => button(rowOf(el, "Screen Recording"), "Allow")?.click());
      await until(() => waits("Screen Recording") !== null);
      expect(waits("Screen Recording")).toBe(
        "In the System Settings that opened, turn on agentes.chat in the list. We'll notice by ourselves." +
          "When macOS asks to Quit & Reopen, choose it. agentes.chat opens again right here.",
      );
      expect(host.mac.panes).toEqual([]);
      // Asked once: Allow now opens its pane.
      await act(async () => button(rowOf(el, "Screen Recording"), "Allow")?.click());
      expect(host.mac.panes).toEqual(["screen"]);

      // Full Disk Access has no prompt: its pane, and the wait moves under it.
      await act(async () => button(rowOf(el, "Full Disk Access"), "Allow")?.click());
      expect(host.mac.panes).toEqual(["screen", "disk"]);
      await until(() => waits("Full Disk Access") !== null);
      expect(waits("Screen Recording")).toBeNull();
      // Turned on there, it reads On once the window comes back to the front; the wait goes back to the one left.
      host.mac.disk = true;
      await act(async () => window.dispatchEvent(new Event("focus")));
      await until(() => end("Full Disk Access") === "On");
      expect(waits("Full Disk Access")).toBeNull();
      await until(() => waits("Screen Recording") !== null);
      // Read live while one is still off: turned on in System Settings with the window behind it, it reads On.
      host.mac.screen = true;
      await until(() => end("Screen Recording") === "On", 8000);
      expect(el.querySelector(".dk-sh__wait")).toBeNull();
      // All on: Continue alone.
      expect(button(el, "Do it later")).toBeUndefined();
      expect(host.mac.networkAsks).toBe(0);

      await act(async () => button(el, "Continue")?.click());
      await until(() => host.layer.route === null);
      expect(host.mac.setup).toBeNull();
    }));

  test("Prepare: notifications turned off once go to System Settings, never a second prompt", () =>
    mount(
      SETTINGS,
      layer,
      async (el, host) => {
        await act(async () => host.showLayer({ screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER }));
        const end = (title: string) => rowOf(el, title)?.querySelector(".dk-crow__end")?.textContent;
        await until(() => end("Notifications") === "Allow");
        await act(async () => button(rowOf(el, "Notifications"), "Allow")?.click());
        expect(host.mac.panes).toEqual(["notifications"]);
        expect(host.mac.notifyAsks).toBe(0);
        await until(() => rowOf(el, "Notifications")?.querySelector(".dk-sh__wait"));
        expect(rowOf(el, "Notifications")?.querySelector(".dk-sh__wait")?.textContent).toBe(
          "In the System Settings that opened, allow notifications for agentes.chat. We'll notice by ourselves.",
        );
        // Turned on there: read back live.
        host.mac.notifications = "granted";
        await act(async () => window.dispatchEvent(new Event("focus")));
        await until(() => end("Notifications") === "On");
        await act(async () => button(el, "Do it later")?.click());
        await until(() => host.layer.route === null);
        expect(host.mac.setup).toBeNull();
      },
      {
        host: (host) => {
          host.mac.notifications = "denied";
        },
      },
    ));

  test("opened again by macOS: Prepare comes back with fresh states and says it took effect", () =>
    mount(
      { screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER, resumed: true },
      layer,
      async (el, host) => {
        await until(() => el.querySelector("h1")?.textContent === "macOS asks three things, once");
        const end = (title: string) => rowOf(el, title)?.querySelector(".dk-crow__end")?.textContent;
        await until(() => end("Screen Recording") === "On");
        expect(rowOf(el, "Screen Recording")?.querySelector(".dk-sh__on")).toBeTruthy();
        await until(
          () => el.querySelector(".dk-sh__help")?.textContent === "agentes.chat opened again with your changes.",
        );
        expect(el.textContent).not.toContain("When macOS asks to Quit & Reopen");
        await act(async () => button(el, "Continue")?.click());
        expect(host.mac.setup).toBeNull();
      },
      {
        host: (host) => {
          host.mac.screen = true;
          host.mac.setup = { step: "prepare", org: "Estúdio Norte", server: FAKE_SERVER, resumed: true };
        },
      },
    ));

  test("Prepare after a quit with Full Disk Access asked and still off: the wait is under it again", () =>
    mount(
      { screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER, resumed: true },
      layer,
      async (el) => {
        await until(() => rowOf(el, "Full Disk Access")?.querySelector(".dk-sh__wait"));
        expect(el.querySelectorAll(".dk-sh__wait").length).toBe(1);
        // Not taken effect yet: the usual help line.
        expect(el.querySelector(".dk-sh__help")?.textContent).toBe(
          "If an update turns one off, we'll tell you right away.",
        );
      },
      {
        host: (host) => {
          host.mac.screen = true;
          writePref(MAC_ASKED_PREF, { version: "0.6.0", asked: ["screen", "disk"] });
        },
      },
    ));

  test("a pair link: who asked, from where, this computer, what agents can do; Connect waits for its maker, then it's in", () =>
    mount(
      { screen: "pairLink", server: FAKE_SERVER, code: FAKE_LINKS.live },
      layer,
      async (el, host, store) => {
        await until(() => el.querySelector("h1")?.textContent === "Connect this Mac to Estúdio Norte?");
        expect(el.querySelector('[role="dialog"] [data-screen="pairLink"]')).toBeTruthy();
        expect(rowOf(el, "Asked by")?.textContent).toContain("Sam Rivera");
        expect(rowOf(el, "From")?.textContent).toContain("agentes.tail1234.ts.net");
        expect(rowOf(el, "This Mac")?.textContent).toContain("Sam's MacBook Pro");
        expect(el.querySelector(".dk-sh__lead")?.textContent).toBe("If you didn't ask for this, choose Not now.");
        expect(document.activeElement).not.toBe(button(el, "Connect"));
        await until(() => rowOf(el, "Codex"));
        expect(switches(el)).toMatchObject({ Commands: "true", Browser: "false" });
        expect(rowOf(el, "Commands")?.textContent).toContain("Commands can reach the rest of this Mac");
        await act(async () => toggle(el, "Browser"));

        await act(async () => button(el, "Connect")?.click());
        await until(() => el.textContent?.includes("Waiting for Sam Rivera to let it in…"));
        expect(button(el, "Cancel")).toBeTruthy();
        await until(() => el.querySelector("h1")?.textContent === "Connected to Estúdio Norte");
        expect(await host.autostart()).toBe(true);
        await until(() => pairedWith(store, "o-norte"));
        const norte = () => pairedHomes(store.getSnapshot()).find((h) => h.status?.org?.id === "o-norte");
        await until(() => norte()?.access?.tools.browser === true);
        expect(norte()?.access?.tools.commands).toBe(true);
        // Folders come after pairing: one click to This computer's settings, on its folders.
        await act(async () => button(el, "Add folders")?.click());
        expect(host.layer.route).toEqual({ screen: "settings", section: "folders" });
      },
      { macReady: true },
    ));

  test("a pair link on a Mac with a permission off: once it's in, Prepare follows as its own route", () =>
    mount({ screen: "pairLink", server: FAKE_SERVER, code: FAKE_LINKS.live }, layer, async (el, host) => {
      await until(() => button(el, "Connect"));
      await act(async () => button(el, "Connect")?.click());
      await until(() => host.layer.route?.screen === "prepare");
      expect(host.layer.route).toEqual({ screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER });
      await until(() => el.querySelector("h1")?.textContent === "macOS asks three things, once");
    }));

  test("a pair link cancelled while waiting: the runner stops asking and nothing joins", () =>
    mount(
      { screen: "pairLink", server: FAKE_SERVER, code: FAKE_LINKS.live },
      layer,
      async (el, host, store) => {
        await until(() => button(el, "Connect"));
        await act(async () => button(el, "Connect")?.click());
        await act(async () => button(el, "Cancel")?.click());
        expect(el.textContent).not.toContain("Waiting for Sam Rivera");
        // Longer than the fake maker takes to let it in.
        await act(() => new Promise((resolve) => setTimeout(resolve, 2500)));
        expect(pairedWith(store, "o-norte")).toBe(false);
        expect([...host.runners.values()].some((r) => r.pendingCode)).toBe(false);
        expect(await host.autostart()).toBe(false);
      },
      { macReady: true },
    ));

  test("a pair link whose maker says no, one that expired, and one whose server doesn't answer", async () => {
    await mount({ screen: "pairLink", server: FAKE_SERVER, code: FAKE_LINKS.denied }, layer, async (el, host) => {
      await until(() => button(el, "Connect"));
      await act(async () => button(el, "Connect")?.click());
      await until(() => el.textContent?.includes("Sam Rivera didn't let it in. Nothing changed."));
      expect(button(el, "Close")).toBeTruthy();
      expect(button(el, "Try again")).toBeUndefined();
      // Open at login only comes with a computer that joined.
      expect(await host.autostart()).toBe(false);
    });
    await mount({ screen: "pairLink", server: FAKE_SERVER, code: "WXYZWXYZ" }, layer, async (el, host) => {
      await until(() => el.textContent?.includes("This link expired. Make a new one in Devices."));
      expect(el.querySelector("h1")?.textContent).toContain("agentes.tail1234.ts.net");
      expect(button(el, "Connect")).toBeUndefined();
      // Devices on the server that made the link, where a new one is made.
      const opened: string[] = [];
      host.openExternal = async (url) => void opened.push(url);
      await act(async () => button(el, "Open Devices")?.click());
      expect(opened).toEqual([`${FAKE_SERVER}/?open=devices`]);
      expect(host.runners.size).toBe(2);
      // Closed with a server open, the layer steps aside.
      await act(async () => button(el, "Close")?.click());
      await until(() => host.layer.route === null);
    });
    const away = "https://chat.example.com";
    await mount({ screen: "pairLink", server: away, code: FAKE_LINKS.live }, layer, async (el) => {
      await until(() => button(el, "Try again"));
      expect(el.textContent).toContain("chat.example.com");
      expect(button(el, "Cancel")).toBeTruthy();
    });
  });

  test("Settings › This Mac › Overview: the permissions' row turns each on again; asking for the screen keeps Settings to reopen", async () => {
    const perms = (el: HTMLElement) => rowOf(el, "macOS permissions");
    await mount(SETTINGS, <Settings />, async (el, host) => {
      await until(() => button(perms(el), "Allow"));
      expect(perms(el)?.querySelector("small")?.textContent).toBe(
        "Still off: Notifications, Screen Recording, and Full Disk Access.",
      );
      expect(el.textContent).not.toContain("agentes.chat opened again");
      // Notifications first: the system's prompt once, never a Quit & Reopen.
      await act(async () => button(perms(el), "Allow")?.click());
      await until(
        () => perms(el)?.querySelector("small")?.textContent === "Still off: Screen Recording and Full Disk Access.",
      );
      expect(host.mac.notifyAsks).toBe(1);
      expect(host.mac.setup).toBeNull();
      // Screen Recording next: kept for macOS quitting the app, and what to do when it asks.
      await until(() => button(perms(el), "Allow") && !button(perms(el), "Allow")?.disabled);
      await act(async () => button(perms(el), "Allow")?.click());
      await until(() => host.mac.setup?.step === "prefs");
      await until(() => el.textContent?.includes("When macOS asks to Quit & Reopen"));
    });
    // Opened again by macOS: the line says it took effect, and nothing is kept any more.
    await mount(
      SETTINGS,
      <Settings />,
      async (el, host) => {
        await until(() => el.textContent?.includes("agentes.chat opened again with your changes."));
        expect(host.mac.setup).toBeNull();
      },
      {
        host: (host) => {
          host.mac.screen = true;
          host.mac.setup = { step: "prefs", resumed: true };
        },
      },
    );
    // No Local Network on any macOS: it is asked only when an Android phone pairs over Wi-Fi (ADR 0265 §7).
    await mount(SETTINGS, <Settings />, async (el) => {
      await until(() => button(perms(el), "Allow"));
      expect(el.textContent).not.toContain("Local network");
    });
  });

  test(
    "Settings › This Mac › Overview: a switch for every workspace here, Allow for one not here yet, which pairs it",
    () =>
      mount(SETTINGS, <Settings />, async (el, host, store) => {
        const norte = "Estúdio Norte";
        // Until the pairing is read every workspace reads as not here yet ("Its agents don't use this Mac"): wait for
        // Acme's agents.
        await until(
          () => rowOf(el, norte) && rowOf(el, "Acme")?.querySelector("small")?.textContent?.includes("can use it"),
        );
        const on = (title: string) => rowOf(el, title)?.querySelector('[role="switch"]')?.getAttribute("aria-checked");
        expect(on("Acme")).toBe("true");
        expect(on("Horizonte")).toBe("true");
        // Where the workspace is, then its agents.
        expect(rowOf(el, "Acme")?.querySelector("small")?.textContent).toMatch(/^agentes\.tail1234\.ts\.net · /);
        // One not here yet: Allow, never a switch.
        expect(rowOf(el, norte)?.querySelector('[role="switch"]')).toBeNull();
        expect(rowOf(el, norte)?.querySelector("small")?.textContent).toBe(
          "agentes.tail1234.ts.net · Its agents don't use this Mac",
        );
        // agentes.chat's workspace too.
        expect(button(rowOf(el, "Oficina"), "Allow")).toBeTruthy();
        expect(rowOf(el, "Oficina")?.querySelector("small")?.textContent).toBe(
          "agentes.chat Cloud · Its agents don't use this Mac",
        );
        // Another workspace closes the card (opening at login is App settings' now).
        const card = rowOf(el, norte)?.closest(".dk-card");
        expect([...(card?.querySelectorAll(".dk-crow__title") ?? [])].slice(-1).map((n) => n.textContent)).toEqual([
          "Another workspace",
        ]);
        await act(async () => button(rowOf(el, "Another workspace"), "Add a workspace…")?.click());
        expect(host.layer.route).toEqual({ screen: "firstRun", mode: "add" });

        // Pausing one workspace pauses only its own agents. Every switch waits while another request is pending, and
        // on a slow runner the fake runner's answer can come late or fail (a toast, the switch back on): click whenever
        // it takes clicks and still shows on, until the pause shows. A second pause is the same pause.
        const horizonte = () => rowOf(el, "Horizonte")?.querySelector<HTMLElement>('[role="switch"]');
        await until(() => {
          if (on("Horizonte") === "false") return true;
          const s = horizonte();
          if (s && !s.hasAttribute("disabled")) s.click();
          return false;
        }, 20_000);
        expect(on("Acme")).toBe("true");

        // One at a time: the others wait for the pause to answer.
        await until(() => !button(rowOf(el, norte), "Allow")?.hasAttribute("disabled"));
        let asked = "";
        host.askToPair = async (_server, org) => {
          asked = org;
          return true;
        };
        await act(async () => button(rowOf(el, norte), "Allow")?.click());
        await until(() => pairedWith(store, "o-norte") && on(norte) === "true");
        expect(asked).toBe("Estúdio Norte");
        expect(await host.autostart()).toBe(true);
      }),
    // Several waits, the pause's up to 20 s on a slow shared runner. Cut short, it went on running under the files
    // after it (its window still mounted) and failed their tests.
    45_000,
  );
});
