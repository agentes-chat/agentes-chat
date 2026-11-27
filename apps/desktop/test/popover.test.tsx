import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import { ControlError } from "../src/control/client";
import { siteApi } from "../src/control/devices";
import { ESSENTIALS_NOTIFIED_PREF } from "../src/control/essentials";
import { MAC_ASKED_PREF } from "../src/control/permissions";
import { DesktopStore, pairedHomes } from "../src/control/store";
import { FAKE_SERVER } from "../src/dev/fake-runner";
import { writePref } from "../src/hooks";
import { createFakeHost, type FakeHost } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ToastProvider } from "../src/ui/Toast";
import { Popover } from "../src/windows/Popover";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The menu checks agentes.chat for a desktop update: tests stay off the network, so no release yet. And
// intersections come by hand (happy-dom reports none), to the observer watching inside a given root.
const realFetch = globalThis.fetch;
const realObserver = globalThis.IntersectionObserver;
const observers: { root: unknown; callback: IntersectionObserverCallback }[] = [];
beforeAll(() => {
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      observers.push({ root: options?.root, callback });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  globalThis.IntersectionObserver = realObserver;
});

/**
 * The menu, by default with agentes.chat on this Mac, a folder request and two jobs (taller than the menu gets),
 * once `ready` says it shows what the test looks at.
 */
async function withMenu(
  check: (el: HTMLElement, store: DesktopStore) => unknown,
  host: FakeHost = createFakeHost("popover", "here"),
  ready: (el: HTMLElement) => unknown = (el) => el.querySelector(".dk-req"),
) {
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={createDesktopI18n("en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>
              <Popover />
            </ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      );
    });
    await until(() => ready(el));
    await check(el, store);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

/** Each banner on the menu: its title, the line under it (null without one) and its buttons. */
const banners = (el: HTMLElement) =>
  [...el.querySelectorAll(".dk-banner")].map((banner) => ({
    title: banner.querySelector(".dk-banner__text b")?.textContent,
    line: banner.querySelector(".dk-banner__text small")?.textContent ?? null,
    actions: [...banner.querySelectorAll(".dk-banner__acts button")].map((b) => b.textContent),
  }));

test("the menu bar menu: what goes on here scrolls, and Open, Preferences and Quit stay below it", () =>
  withMenu((el) => {
    const body = el.querySelector(".dk-pop__body");
    const foot = el.querySelector(".dk-pop__foot");
    expect(body?.querySelector(".dk-req")).toBeTruthy();
    expect(body?.querySelector(".dk-job")).toBeTruthy();
    expect(body?.querySelector("button.dk-mi")).toBeNull();
    const actions = [...(foot?.querySelectorAll("button.dk-mi") ?? [])].map((b) => b.textContent ?? "");
    for (const label of ["Open agentes.chat", "Preferences…", "Quit agentes.chat"]) {
      expect(actions.some((text) => text.includes(label))).toBe(true);
    }
  }));

test("a new OS permission an agent's work waits on opens the app layer's ask, and stays on the menu until it ends", async () => {
  const host = createFakeHost("popover", "here");
  const asks = () => host.routes.filter((r) => r.screen === "permissionAsk").length;
  await withMenu(async (el) => {
    const runner = [...host.runners.values()][0];
    await act(async () =>
      runner?.setPermissions([
        { permission: "screen", trigger: "screencapture -x a.png", since: "2026-11-26T18:00:00.000Z" },
      ]),
    );
    await until(() => asks() === 1);
    expect(banners(el)).toContainEqual({
      title: "Waiting for Screen Recording",
      line: "Agents need it to take screenshots of this Mac.",
      actions: ["Allow"],
    });
    // Asked again from the menu after the sheet was closed.
    const allow = [...el.querySelectorAll(".dk-banner__acts button")].find((b) => b.textContent === "Allow");
    await act(async () => (allow as HTMLElement).click());
    expect(asks()).toBe(2);
    await act(async () => runner?.setPermissions([]));
    await until(() => !banners(el).some((b) => b.title === "Waiting for Screen Recording"));
  }, host);
});

test("a folder request the computer can't answer says why, and stays to be answered again", () =>
  withMenu(async (el, store) => {
    const real = store.request.bind(store);
    store.request = (async (homeId: string, req: { type: string }) => {
      if (req.type === "access.answer") throw new ControlError("invalid_path", "/Users/voce/roteiros doesn't exist");
      return real(homeId, req as never);
    }) as typeof store.request;
    const allow = [...el.querySelectorAll(".dk-req button")].find((b) => b.textContent === "Allow") as HTMLElement;
    await act(async () => allow.click());
    await until(() => document.querySelector(".dk-toast")?.textContent);
    expect(document.querySelector(".dk-toast")?.textContent).toContain(
      "Couldn't answer this request: /Users/voce/roteiros doesn't exist",
    );
    expect((allow as HTMLButtonElement).disabled).toBe(false);
  }));

test("on a short screen the card's cap is lower, so the window and the actions at its bottom stay on it", async () => {
  const screen = window.screen as { availHeight: number };
  const height = screen.availHeight;
  screen.availHeight = 640;
  try {
    await withMenu((el) => {
      // 640 less the window's margins around the card (6 above, 34 below).
      const shell = el.querySelector<HTMLElement>(".dk-pop-shell");
      expect(shell?.style.getPropertyValue("--pop-room")).toBe("600px");
    });
  } finally {
    screen.availHeight = height;
  }
});

test("the middle fades out at the bottom while its end is out of sight, by the latest crossing", () =>
  withMenu(async (el) => {
    const body = el.querySelector(".dk-pop__body");
    const watcher = observers.findLast((o) => o.root === body);
    expect(watcher).toBeDefined();
    const cross = (...seen: boolean[]) =>
      act(async () => watcher?.callback(seen.map((isIntersecting) => ({ isIntersecting })) as never, {} as never));
    await cross(true, false);
    expect(body?.hasAttribute("data-more")).toBe(true);
    await cross(false, true);
    expect(body?.hasAttribute("data-more")).toBe(false);
  }));

describe("the menu's banners say only what matters there", () => {
  /** A newer version of the app, from the release the menu checks. */
  async function withUpdate(run: () => Promise<void>) {
    const before = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        version: "9.9.9",
        url: "https://app.agentes.chat/api/desktop/download/9.9.9/agentes_9.9.9_universal.dmg",
      })) as unknown as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = before;
    }
  }
  const update = { title: "Version 9.9.9 is available", line: null, actions: ["See what's new"] };

  test("a new version: its title and See what's new, with or without agents working here", () =>
    withUpdate(async () => {
      await withMenu(
        (el) => expect(banners(el)).toContainEqual(update),
        createFakeHost("popover", "here"),
        (el) => el.querySelector(".dk-req") && banners(el).length > 0,
      );
      await withMenu(
        (el) => expect(banners(el)).toEqual([update]),
        createFakeHost("popover", "cloud"),
        (el) => banners(el).length > 0,
      );
    }));

  test("agentes.chat not starting here: its title, why and where to look, Copy details, the logs and Try again", () =>
    withMenu(
      (el) =>
        expect(banners(el)).toContainEqual({
          title: "agentes.chat isn't starting on this Mac",
          line: "The details say why: copy them for whoever helps you, or look at the logs. Help",
          actions: ["Copy details", "Show the logs", "Try again"],
        }),
      createFakeHost("popover", "here", { here: { phase: "failing" } }),
      (el) => banners(el).length > 0,
    ));

  test("no internet: what already started keeps going", async () => {
    const host = createFakeHost("popover", "here");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      await withMenu(async (el) => {
        await act(async () => {
          for (const runner of host.runners.values()) runner.setOnline(false);
        });
        await until(() => banners(el).some((b) => b.title === "No internet. Trying again…"));
        expect(banners(el).find((b) => b.title === "No internet. Trying again…")?.line).toBe(
          "What already started keeps running here and sends the result when the connection is back.",
        );
      }, host);
    } finally {
      delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  test("paused: no agent starts anything new here", () =>
    withMenu(async (el, store) => {
      await act(async () => {
        await store.requestAll({ type: "pause", until: null });
      });
      await until(() => banners(el).some((b) => b.title === "Paused until you resume"));
      expect(banners(el).find((b) => b.title === "Paused until you resume")?.line).toBe(
        "No agent, from any workspace, starts anything new on this Mac.",
      );
    }));

  test("paused: Resume now, pressed, waits for its answer: it shows it and takes no second press", () =>
    withMenu(async (el, store) => {
      await act(async () => {
        await store.requestAll({ type: "pause", until: null });
      });
      await until(() => banners(el).some((b) => b.title === "Paused until you resume"));
      const sent: string[] = [];
      let answer = () => {};
      const real = store.requestAll.bind(store);
      store.requestAll = ((request: { type: string }) => {
        sent.push(request.type);
        return new Promise((resolve) => {
          answer = () => resolve(real(request as never));
        });
      }) as typeof store.requestAll;
      const resume = () =>
        [...el.querySelectorAll<HTMLButtonElement>(".dk-banner__acts button")].find(
          (b) => b.textContent === "Resume now",
        );
      await act(async () => resume()?.click());
      await act(async () => resume()?.click());
      expect(sent).toEqual(["resume"]);
      expect(resume()?.getAttribute("aria-busy")).toBe("true");
      expect(resume()?.disabled).toBe(true);
      await act(async () => answer());
      await until(() => !banners(el).some((b) => b.title === "Paused until you resume"));
    }));

  test("Quit: what happens to the work running here, and to everyone when agentes.chat runs here", async () => {
    const quit = async (el: HTMLElement) => {
      const button = [...el.querySelectorAll("button.dk-mi")].find((b) => b.textContent?.includes("Quit agentes.chat"));
      await act(async () => (button as HTMLButtonElement | undefined)?.click());
      return el.querySelector(".dk-confirm p")?.textContent;
    };
    await withMenu(
      async (el) =>
        expect(await quit(el)).toBe(
          "Agents can't use this Mac while the app is closed. What is already running finishes and sends the result when you open it again.",
        ),
      createFakeHost("popover", "selfhost"),
    );
    await withMenu(async (el) =>
      expect(await quit(el)).toBe(
        "agentes.chat stops on this Mac: nobody can use it, here, on your phone or your teammates', until you open the app again.",
      ),
    );
  });
});

describe("Quit from the menu while agents work here", () => {
  /** The fake host with the menu's choices sent by hand, and what the system's dialog was asked. */
  const menuHost = (answer: (words: { title: string; body: string }) => Promise<boolean>) => {
    const host = createFakeHost("popover", "here");
    const menu: ((action: string) => void)[] = [];
    host.onMenuAction = (cb) => {
      menu.push(cb as (action: string) => void);
      return () => {};
    };
    host.askQuit = answer;
    return { host, choose: (action: string) => act(async () => menu.at(-1)?.(action)) };
  };

  test("the system's own dialog asks, never the popover that hides when another window takes focus", async () => {
    const asked: { title: string; body: string }[] = [];
    const { host, choose } = menuHost(async (words) => {
      asked.push(words);
      return false;
    });
    await withMenu(async (el) => {
      await choose("quit");
      expect(asked).toEqual([
        {
          title: "Quit agentes.chat?",
          body: "agentes.chat stops on this Mac: nobody can use it, here, on your phone or your teammates', until you open the app again.",
          quit: "Quit",
          cancel: "Cancel",
        } as never,
      ]);
      expect(el.querySelector(".dk-confirm")).toBeNull();
    }, host);
  });

  test("when the system can't ask, the popover does", async () => {
    const { host, choose } = menuHost(async () => {
      throw new Error("no dialog");
    });
    await withMenu(async (el) => {
      await choose("quit");
      await until(() => el.querySelector(".dk-confirm"));
      expect(el.querySelector(".dk-confirm h2")?.textContent).toBe("Quit agentes.chat?");
    }, host);
  });
});

describe("the server here's Stop (ADR 0158)", () => {
  test("in its ··· menu, with how long and what it cuts off; an hour says when it's back", () =>
    withMenu(async (el) => {
      expect([...el.querySelectorAll(".dk-ph button")].some((b) => b.textContent === "Stop")).toBe(false);
      await act(async () => (el.querySelector(".dk-ph .dk-iconbtn") as HTMLElement).click());
      const menu = () => [...el.querySelectorAll(".dk-here__more > button")].map((b) => b.textContent);
      expect(menu()).toEqual(["Restart", "Stop", "Preferences…"]);
      const stop = [...el.querySelectorAll(".dk-here__more > button")].find((b) => b.textContent === "Stop");
      await act(async () => (stop as HTMLElement).click());
      const rows = [...el.querySelectorAll(".dk-here__stop button")].map((b) => b.textContent);
      expect(rows).toEqual(["Stop for 1 hour", "Stop until I start it", "Don't start it with the app…"]);
      expect(el.querySelector(".dk-here__stop .dk-sub__hint")?.textContent).toBe(
        "Stopping cuts everyone off, the phone included.",
      );
      await act(async () => (el.querySelector(".dk-here__stop button") as HTMLElement).click());
      await until(() => el.querySelector(".dk-ph small")?.textContent?.startsWith("Stopped · back at"));
      const start = [...el.querySelectorAll(".dk-ph button")].find((b) => b.textContent === "Start it");
      expect(start).toBeTruthy();
    }));
});

describe("several workspaces on this Mac", () => {
  const menuRows = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)].map((b) => b.textContent);
  const press = async (el: HTMLElement, text: string) => {
    const button = [...el.querySelectorAll<HTMLButtonElement>("button.dk-mi")].find((b) => b.textContent === text);
    await act(async () => button?.click());
  };

  test("under the server here's card: the other servers' workspaces using this Mac too", () => {
    const host = createFakeHost("popover", "here");
    for (const runner of host.runners.values()) runner.server = FAKE_SERVER;
    return withMenu(
      (el) => expect(el.querySelector(".dk-here__also")?.textContent).toBe("Also works for Acme"),
      host,
      (el) => el.querySelector(".dk-here__also"),
    );
  });

  test("Pause the agents: all of them, or one workspace with the same choices", () =>
    withMenu(
      async (el, store) => {
        await press(el, "Pause the agents");
        expect(menuRows(el, ".dk-pop__foot .dk-sub > button.dk-mi")).toEqual(["All workspaces", "Acme", "Horizonte"]);
        await press(el, "Acme");
        expect(menuRows(el, ".dk-sub .dk-sub > button.dk-mi")).toEqual([
          "For 1 hour",
          "Until tomorrow at 9 AM",
          "Until I resume",
        ]);
        await press(el, "Until I resume");
        await until(() => banners(el).some((b) => b.title === "Paused until you resume"));
        expect(banners(el).find((b) => b.title === "Paused until you resume")?.line).toBe(
          "On hold: Acme. The other workspaces' agents keep working.",
        );
        const paused = store
          .getSnapshot()
          .homes.filter((h) => h.status?.paused?.paused)
          .map((h) => h.status?.org?.name);
        expect(paused).toEqual(["Acme"]);
      },
      createFakeHost("popover", "selfhost"),
      (el) => el.querySelectorAll(".dk-ohead").length === 2,
    ));
});

test("the site's This computer: the Mac pairs with commands on, then the app layer prepares it", async () => {
  const host = createFakeHost("popover", "selfhost");
  await withMenu(
    async (_el, store) => {
      let userCode = "";
      await act(async () => {
        const reply = await host.askThisMac({
          kind: "connect",
          orgId: "o-norte",
          origin: FAKE_SERVER,
          agentsHere: true,
        });
        userCode = (reply.data as { userCode: string }).userCode;
      });
      await act(async () => {
        await siteApi(host, FAKE_SERVER).machines.confirmDevice("o-norte", userCode, {});
      });
      const norte = () => pairedHomes(store.getSnapshot()).find((h) => h.status?.org?.id === "o-norte");
      await until(() => norte()?.access?.tools.commands === true);
      // Prepare this Mac, as a sheet on the main window's app layer (ADR 0256).
      await until(() => host.layer.route?.screen === "prepare");
      expect(host.layer.route).toEqual({ screen: "prepare", org: "Estúdio Norte", server: FAKE_SERVER });
      expect(await host.autostart()).toBe(true);
    },
    host,
    (el) => el.querySelector(".dk-pop__foot"),
  );
});

describe("this computer's essentials (ADR 0256 §7)", () => {
  const screenOff = (host: FakeHost) => host.notified.filter((n) => n.title === "Screen Recording is off").length;

  test("one that falls by itself: the tray turns to attention, one notification however often it is read, the count for the site", async () => {
    writePref(ESSENTIALS_NOTIFIED_PREF, null);
    const host = createFakeHost("popover", "here", { macReady: true });
    await withMenu(async () => {
      // Everything on: the site hears nothing needs the person, and that the server runs here.
      await until(() => host.publishedHealth !== null);
      expect(host.publishedHealth).toEqual({ needs: 0, server: true });
      expect(host.tray).not.toBe("attention");
      expect(screenOff(host)).toBe(0);

      // macOS takes Screen Recording back (an update): read again as the app comes to the front.
      host.mac.screen = false;
      await act(async () => host.sayHealth());
      await until(() => host.publishedHealth?.needs === 1);
      await until(() => host.tray === "attention");
      await until(() => screenOff(host) === 1);
      expect(host.notified.find((n) => n.title === "Screen Recording is off")?.body).toBe(
        "macOS turned it off. Agents can't take screenshots until you allow it again.",
      );

      // Read again and again while it stays off: told once.
      await act(async () => host.sayHealth());
      await act(async () => host.sayHealth());
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(screenOff(host)).toBe(1);

      // Back on: the usual icon, nothing needs the person. Taken back again later: told again.
      host.mac.screen = true;
      await act(async () => host.sayHealth());
      await until(() => host.publishedHealth?.needs === 0);
      await until(() => host.tray !== "attention");
      host.mac.screen = false;
      await act(async () => host.sayHealth());
      await until(() => screenOff(host) === 2);
    }, host);
  });

  test("one off since before (never seen on) is counted and shown, never a notification; one that fell while the app was closed is told at once", async () => {
    writePref(ESSENTIALS_NOTIFIED_PREF, null);
    const first = createFakeHost("popover", "here");
    await withMenu(async () => {
      // Notifications, Screen Recording and Full Disk Access not allowed yet: three things need the person.
      await until(() => first.publishedHealth?.needs === 3);
      await until(() => first.tray === "attention");
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(first.notified.filter((n) => n.title.endsWith(" is off"))).toEqual([]);
    }, first);

    // Seen on at the last opening, off at this one: macOS took it back while the app was closed.
    writePref(ESSENTIALS_NOTIFIED_PREF, { on: ["notifications", "screen", "disk"] });
    const next = createFakeHost("popover", "here", { macReady: true });
    next.mac.disk = false;
    await withMenu(async () => {
      await until(() => next.notified.some((n) => n.title === "Full Disk Access is off"));
      expect(next.notified.filter((n) => n.title === "Full Disk Access is off")).toHaveLength(1);
      expect(screenOff(next)).toBe(0);
      expect(next.publishedHealth).toEqual({ needs: 1, server: true });
    }, next);
  });

  test("Local Network is asked only when the site needs it: the system's prompt once, then System Settings", async () => {
    writePref(MAC_ASKED_PREF, null);
    const host = createFakeHost("popover", "selfhost", { macReady: true });
    await withMenu(
      async () => {
        expect(host.mac.networkAsks).toBe(0);
        await act(() => host.askThisMac({ kind: "localNetwork" }));
        expect(host.mac.networkAsks).toBe(1);
        expect(host.mac.panes).toEqual([]);
        await act(() => host.askThisMac({ kind: "localNetwork" }));
        expect(host.mac.networkAsks).toBe(1);
        expect(host.mac.panes).toEqual(["network"]);
      },
      host,
      (el) => el.querySelector(".dk-pop__foot"),
    );
    writePref(MAC_ASKED_PREF, null);
  });

  test("a computer nothing uses yet: no essentials to keep, the usual icon", async () => {
    writePref(ESSENTIALS_NOTIFIED_PREF, null);
    const host = createFakeHost("popover", "cloud");
    await withMenu(
      async () => {
        await until(() => host.publishedHealth !== null);
        expect(host.publishedHealth).toEqual({ needs: 0, server: false });
        expect(host.tray).not.toBe("attention");
      },
      host,
      (el) => el.querySelector(".dk-pop__foot"),
    );
  });
});
