import { describe, expect, setSystemTime, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider, useHost } from "../src/app";
import type { LocalChoice } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import { createFakeHost, type FakeHost, type HereOptions, type Scenario } from "../src/host/fake";
import { type AppLocale, createDesktopI18n } from "../src/i18n";
import { FirstRun } from "../src/layer/first-run/FirstRun";
import { ToastProvider } from "../src/ui/Toast";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The first run as the app layer draws it (ADR 0256): drawn again from the start when its route names something else
 * (as AppLayer keys it), its route's mode, each time it is shown again, and a connect link's sheet alone.
 */
function LayerFirstRun() {
  const host = useHost() as FakeHost;
  const [state, setState] = useState(() => ({ ...host.layer }));
  useEffect(() => host.onLayer(setState), [host]);
  const route = state.route;
  if (route?.screen === "link") return <FirstRun key="link" shownAt={state.seq} linkOnly />;
  const mode = route?.screen === "firstRun" ? route.mode : undefined;
  return <FirstRun key={`firstRun ${mode ?? ""}`} mode={mode} shownAt={state.seq} />;
}

interface Options {
  here?: HereOptions;
  lang?: AppLocale;
  /** The fake servers' own answers (`fake.ts`), not "nothing answers" at once. */
  realChecks?: boolean;
  /** Changes the host before the first run opens. */
  host?: (host: FakeHost) => void;
}

/**
 * The first run on a fake host, with what it opened in the browser and in Tailscale, the sign-ins it started, and the
 * setups it asked for.
 */
async function firstRun(scenario: Scenario, check: (screen: Screen) => Promise<void>, options: Options = {}) {
  const host = createFakeHost("app", scenario, { here: options.here });
  const opened: string[] = [];
  host.openExternal = async (url) => {
    opened.push(url);
  };
  const tailscale: string[] = [];
  host.openTailscale = async (page) => {
    tailscale.push(page);
  };
  const signIns: string[] = [];
  host.firstRunSignIn = async (method) => {
    signIns.push(method);
  };
  const choices: LocalChoice[] = [];
  const install = host.installLocalServer;
  host.installLocalServer = (choice) => {
    choices.push(choice);
    return install(choice);
  };
  // Nothing found, and nothing else answers on this computer, at once (the fake host waits like a network would).
  host.discover = async () => [];
  if (!options.realChecks) host.checkServer = async (server) => ({ ok: false, server, problem: "unreachable" });
  options.host?.(host);
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={createDesktopI18n(options.lang ?? "en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>
              <LayerFirstRun />
            </ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      ),
    );
    // Whether this build runs agentes.chat here arrives from the host first.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await check(screenOf(el, { opened, tailscale, signIns, choices, host }));
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

type Screen = ReturnType<typeof screenOf>;

function screenOf(
  el: HTMLElement,
  seen: { opened: string[]; tailscale: string[]; signIns: string[]; choices: LocalChoice[]; host: FakeHost },
) {
  const buttons = () => [...el.querySelectorAll("button")];
  // The button named exactly so, else the first whose words hold the name (a row's title and its line).
  const button = (name: string) =>
    buttons().find((b) => b.textContent === name) ?? buttons().find((b) => b.textContent?.includes(name));
  return {
    el,
    ...seen,
    button,
    press: async (name: string) => {
      const target = button(name);
      expect({ name, found: !!target }).toEqual({ name, found: true });
      await act(async () => target?.click());
    },
    /** Which step of the first run shows (`data-step`). */
    step: () => el.querySelector("[data-step]")?.getAttribute("data-step"),
    title: () => el.querySelector("h1")?.textContent,
    lead: () => el.querySelector(".dk-first__lead")?.textContent,
    /** "Run on this Mac · 1 of 3". */
    counter: () => el.querySelector(".dk-flow__step")?.textContent,
    /** The footer's buttons, in order. */
    foot: () => [...el.querySelectorAll(".dk-flow__foot button")].map((b) => b.textContent),
    /** Submits a form the way its footer's button does (`form=` points at it). */
    submit: (id: string) => {
      const submitted = new window.Event("submit", { bubbles: true, cancelable: true });
      return act(async () => void el.querySelector(`form#${id}`)?.dispatchEvent(submitted));
    },
  };
}

/** Types into a React field: the value through the field's own setter, then the event React listens to. */
function typeInto(field: Element | null, value: string) {
  const input = field as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

const pressEscape = () =>
  act(async () => void window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));

/** Run here's owner step with an email typed in, then Continue: the "where" step shows. */
async function toWhere(screen: Screen, words = { row: "Run free on this Mac" }) {
  await screen.press(words.row);
  await until(() => screen.step() === "owner");
  await act(async () => typeInto(screen.el.querySelector('input[type="email"]'), "ana@example.com"));
  await screen.submit("dk-first-owner");
  await until(() => screen.step() === "where");
}

const stepOf = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll<HTMLElement>(".dk-first__steps > li")].find(
    (li) => li.querySelector("b")?.textContent === name,
  );

/** Run here up to the setup, on this computer's own Tailscale (connected), with an email. */
async function toSetup(screen: Screen) {
  await toWhere(screen);
  await screen.press("Continue");
  await until(() => screen.step() === "setup");
}

describe("Sign in first", () => {
  test("Google, Apple or email in this window, the other ways under it, and the install as the last line", () =>
    firstRun("first", async ({ el, press, title, lead, signIns }) => {
      expect(title()).toBe("Welcome to agentes.chat");
      expect(lead()).toBe("Your team of AI agents, working with you in the chat.");
      expect([...el.querySelectorAll(".dk-welcome__signin button")].map((b) => b.textContent)).toEqual([
        "Continue with Google",
        "Continue with Apple",
        "Continue with email",
      ]);
      // Each provider by its own mark, e-mail by the kit's icon.
      expect(el.querySelectorAll(".dk-welcome__signin svg.dk-welcome__mark")).toHaveLength(2);
      expect(el.querySelector(".dk-welcome__or")?.textContent).toBe("Other ways to use it");
      expect([...el.querySelectorAll(".ac-optrow__title")].map((r) => r.textContent)).toEqual([
        "Run free on this Mac",
        "Sign in to my company's server",
      ]);
      expect(el.querySelector(".dk-welcome__col > .dk-first__foot:last-child")?.textContent).toBe(
        "Installing it for the team on a server? See how",
      );
      // Nothing found: nothing on top.
      expect(el.querySelector(".dk-welcome__found")).toBeNull();
      // The team's sky beside it, the cloud's.
      expect(el.querySelector(".dk-welcome__sky .ac-place")?.getAttribute("data-place")).toBe("cloud");
      await press("Continue with Google");
      await press("Continue with Apple");
      await press("Continue with email");
      expect(signIns).toEqual(["google", "apple", "email"]);
    }));

  test("a build without the server: only a company's server under the sign-in", () =>
    firstRun(
      "first",
      async ({ el }) => {
        await until(() => el.querySelector(".ac-optrow__title"));
        expect([...el.querySelectorAll(".ac-optrow__title")].map((r) => r.textContent)).toEqual([
          "Sign in to my company's server",
        ]);
      },
      {
        host: (host) => {
          const read = host.localServer;
          host.localServer = async () => ({ ...(await read()), bundled: false });
        },
      },
    ));

  test("a server found on the Tailscale network on top, by its address, and Sign in opens it", () =>
    firstRun(
      "first",
      async ({ el, press, host }) => {
        await until(() => el.querySelector(".dk-welcome__found"));
        const found = el.querySelector(".dk-welcome__found") as HTMLElement;
        expect(found.querySelector("b")?.textContent).toBe("agentes.chat is on your network");
        expect(found.querySelector("small")?.textContent).toBe("agentes.tail1234.ts.net");
        expect(found.querySelector(".dk-logo--lg svg")?.getAttribute("class")).toBe("dk-tailscale");
        // On top: before the title.
        expect(found.nextElementSibling?.tagName).toBe("H1");
        await press("Sign in");
        await until(() => host.list.current === "https://agentes.tail1234.ts.net");
      },
      {
        realChecks: true,
        host: (host) => {
          host.discover = async () => [{ server: "https://agentes.tail1234.ts.net", where: "tailnet" }];
        },
      },
    ));

  test("Add a workspace: its own title and the same sign-in, a new workspace the line under it", () => {
    const chosen: (string | undefined)[] = [];
    return firstRun(
      "first",
      async ({ press, title, button }) => {
        await until(() => button("Create one"));
        expect(title()).toBe("Add a workspace");
        expect(button("Continue with Google")).toBeTruthy();
        await press("Create one");
        expect(chosen).toEqual(["/onboarding"]);
      },
      { host: adding(false, chosen) },
    );
  });

  test("Add a workspace, signed in to agentes.chat here already: making one is the button", () => {
    const chosen: (string | undefined)[] = [];
    return firstRun(
      "first",
      async ({ press, button }) => {
        await until(() => button("Create a workspace on agentes.chat"));
        expect(button("Continue with Google")).toBeUndefined();
        expect(button("Create one")).toBeUndefined();
        await press("Create a workspace on agentes.chat");
        expect(chosen).toEqual(["/onboarding"]);
      },
      { host: adding(true, chosen) },
    );
  });
});

/** The first run opened by the site's "Add workspace", with agentes.chat signed in here or not. */
function adding(cloud: boolean, chosen: (string | undefined)[]) {
  return (host: FakeHost) => {
    host.layer.route = { screen: "firstRun", mode: "add" };
    host.workspaces = async () => [{ server: "https://app.agentes.chat", signedIn: cloud, orgs: [] }];
    host.chooseServer = async (_server, page) => {
      chosen.push(page);
    };
    host.hideLayer = async () => {};
  };
}

describe("A company's server", () => {
  test("its address in the frame, Sign in in the footer, what's wrong under the field, and Back", () =>
    firstRun("first", async ({ el, press, title, step, foot, submit }) => {
      await press("Sign in to my company's server");
      expect(step()).toBe("company");
      expect(title()).toBe("Sign in to a workspace that already exists");
      expect(el.querySelector(".dk-flow__band .ac-place")?.getAttribute("data-place")).toBe("box");
      expect(foot()).toEqual(["Back", "Sign in"]);
      await act(async () => typeInto(el.querySelector(".dk-first__address input"), "not an address"));
      await submit("dk-first-connect");
      await until(() => el.querySelector(".dk-first__problem"));
      expect(el.querySelector(".dk-first__problem")?.textContent).toBe(
        "Check the address, something like agentes.yourteam.ts.net.",
      );
      await press("Back");
      expect(title()).toBe("Welcome to agentes.chat");
    }));

  test("installing for the team: two steps with the command, the words to send, and its address after", async () => {
    const copied: string[] = [];
    const clipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
    try {
      await firstRun("first", async ({ el, press, title, step, button }) => {
        await press("See how");
        expect(step()).toBe("install");
        expect(title()).toBe("Install on a server or VPS");
        expect([...el.querySelectorAll(".dk-first__numbered > li > b")].map((b) => b.textContent)).toEqual([
          "On the server, open the Terminal (or connect over SSH) and paste this",
          "At the end a link shows up. Open it here and that's it.",
        ]);
        expect(el.querySelector(".dk-first__numbered code")?.textContent).toBe(
          "curl -fsSL https://agentes.chat/install | sh",
        );
        await press("Copy the instructions");
        await until(() => button("Instructions copied"));
        expect(copied[0]).toContain("curl -fsSL https://agentes.chat/install | sh");
        await press("Sign in by its address");
        expect(title()).toBe("Sign in to a workspace that already exists");
        // Back retraces the way: the install, then the welcome.
        await press("Back");
        expect(step()).toBe("install");
        await press("Back");
        expect(step()).toBe("welcome");
      });
    } finally {
      if (clipboard) Object.defineProperty(window.navigator, "clipboard", clipboard);
      else delete (window.navigator as { clipboard?: unknown }).clipboard;
    }
  });

  test("a connect link alone: the server in large type, nothing before Continue, Cancel opens the first run", () =>
    firstRun(
      "link",
      async ({ el, press, host, step }) => {
        await until(() => el.querySelector(".dk-linksheet__question"));
        expect(el.querySelector(".dk-linksheet__host")?.textContent).toBe("agentes.tail1234.ts.net");
        expect(el.querySelector(".dk-linksheet__question")?.textContent).toBe("Open the workspace you installed?");
        expect([...el.querySelectorAll(".dk-linksheet__acts button")].map((b) => b.textContent)).toEqual([
          "Cancel",
          "Continue",
        ]);
        expect(host.list.current).toBeNull();
        await press("Cancel");
        // No server open: the whole first run takes the window.
        await until(() => step() === "welcome");
        expect(host.layer.route).toEqual({ screen: "firstRun" });
      },
      {
        realChecks: true,
        host: (host) => {
          host.layer.route = { screen: "link" };
        },
      },
    ));
});

describe("Run on this Mac, in three steps", () => {
  test("one frame: the band, the count, the title, the owner's fields and the usage line, Back and Continue", () =>
    firstRun(
      "first",
      async ({ el, press, step, title, lead, counter, foot, submit }) => {
        await press("Run free on this Mac");
        await until(() => step() === "owner");
        expect(el.querySelector(".dk-flow__band .ac-place")?.getAttribute("data-place")).toBe("here");
        expect(counter()).toBe("Run on this Mac · 1 of 3");
        expect(title()).toBe("Who will be the owner?");
        expect(lead()).toBe(
          "You sign in with this email and invite whoever you want later. Everything is kept on this Mac.",
        );
        expect([...el.querySelectorAll(".ac-field label")].map((l) => l.textContent)).toEqual([
          "Your name",
          "Your email",
        ]);
        // This computer's user's name is there already.
        expect((el.querySelector('input[autocomplete="name"]') as HTMLInputElement).value).toBe("Ana Souza");
        expect(el.querySelector(".dk-first__check")?.textContent).toBe(
          "Send anonymous usage statisticsCounts, never messages, files or names.",
        );
        expect(el.querySelector("#here-usage")?.getAttribute("aria-checked")).toBe("true");
        expect(foot()).toEqual(["Back", "Continue"]);
        // No email: it says what it needs, and stays.
        await submit("dk-first-owner");
        await until(() => el.textContent?.includes("Write your email, like ana@example.com."));
        expect(step()).toBe("owner");
      },
      { here: { tailnet: "signedOut", tailscale: "off" } },
    ));

  test("where: two rows with a hairline, a plain icon and a radio at the end, the phone and the team chosen", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, counter, title, lead } = screen;
        await toWhere(screen);
        expect(counter()).toBe("Run on this Mac · 2 of 3");
        expect(title()).toBe("Where will you use it?");
        expect(lead()).toBe("You can change it anytime.");
        const rows = [...el.querySelectorAll(".dk-first__picks > .dk-first__pick")];
        expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual([
          "On this Mac, your phone and your team",
          "Only on this Mac",
        ]);
        expect(rows.map((r) => r.querySelector('[role="radio"]')?.getAttribute("aria-checked"))).toEqual([
          "true",
          "false",
        ]);
        // No cards and no tags: the rows are the list.
        expect(el.querySelector(".dk-first__picks .dk-card, .dk-first__picks .ac-chip")).toBeNull();
      },
      { here: { tailnet: "signedOut", tailscale: "off" } },
    ));

  test("the private network: Tailscale's tile, what it is, Do it later and Sign in to Tailscale", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step, counter, title, foot } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        expect(counter()).toBe("Run on this Mac · 3 of 3");
        expect(title()).toBe("Sign in to your private network");
        expect(el.querySelector(".dk-first__tailscale b")?.textContent).toBe("Tailscale");
        expect(el.querySelector(".dk-first__tailscale .dk-tailscale")).not.toBeNull();
        expect(el.querySelector(".dk-first__note")?.textContent).toBe(
          "Already use Tailscale on this Mac? This step goes away and we use the same network.",
        );
        expect(foot()).toEqual(["Back", "Do it later", "Sign in to Tailscale"]);
        // Esc goes back a step.
        await pressEscape();
        expect(step()).toBe("where");
      },
      { here: { tailnet: "signedOut", tailscale: "off" } },
    ));

  test("signing in: Continue in your browser, the page again, Back stops it; once in, the setup starts", async () => {
    await firstRun(
      "first",
      async (screen) => {
        const { el, press, step, title, foot, tailscale } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        await press("Sign in to Tailscale");
        await until(() => step() === "wait");
        expect(title()).toBe("Continue in your browser");
        // The app and Tailscale joined by the trail, then what it waits for, in bold with the spinner.
        expect(el.querySelectorAll(".dk-first__hop > *")).toHaveLength(3);
        expect(el.querySelector(".dk-first__waitnow")?.textContent).toBe("Waiting for you to sign in to Tailscale");
        expect(el.querySelector(".dk-first__waitnow .ac-pixspin")).not.toBeNull();
        expect(foot()).toEqual(["Back", "Open the page again"]);
        await press("Open the page again");
        expect(tailscale).toEqual(["signIn"]);
        await press("Back");
        await until(() => step() === "net");
      },
      { here: { tailnet: "signedOut", tailscale: "off", signIn: "hold", pace: 10 } },
    );
    await firstRun(
      "first",
      async (screen) => {
        const { press, step, choices } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        await press("Sign in to Tailscale");
        await until(() => step() === "wait");
        // Signed in about 1.5 s later: the setup runs, shared with the phone and the team, then the phone's code.
        await until(() => step() === "done");
        expect(choices).toEqual([{ name: "Ana Souza", email: "ana@example.com", place: "everywhere", usage: true }]);
      },
      { here: { tailnet: "signedOut", tailscale: "off", pace: 10 } },
    );
  });

  test("the network's admin approves new devices: it says so, with its page", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step, tailscale } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        await press("Sign in to Tailscale");
        await until(() => el.querySelector(".dk-first__waitnow")?.textContent === "Waiting for your network's admin");
        await press("Open Tailscale's admin");
        expect(tailscale).toEqual(["approve"]);
      },
      { here: { tailnet: "signedOut", tailscale: "off", signIn: "approval" } },
    ));

  test("a sign-in that didn't finish says so, and Sign in to Tailscale tries again", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step, button } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        await press("Sign in to Tailscale");
        await until(() => el.querySelector(".dk-first__problem"));
        expect(step()).toBe("net");
        expect(el.querySelector(".dk-first__problem")?.textContent).toBe(
          "Signing in to Tailscale didn't finish. Try again.",
        );
        expect(button("Sign in to Tailscale")).toBeTruthy();
      },
      { here: { tailnet: "signedOut", tailscale: "off", signIn: "fail" } },
    ));

  test("Do it later: agentes.chat only on this Mac, no access step", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step, choices } = screen;
        await toWhere(screen);
        await press("Continue");
        await until(() => step() === "net");
        await press("Do it later");
        await until(() => step() === "setup");
        expect(choices[0]?.place).toBe("here");
        expect(stepOf(el, "Turning on access from anywhere")).toBeUndefined();
      },
      { here: { tailnet: "signedOut", tailscale: "off", hold: "account", pace: 10 } },
    ));

  test("the system's Tailscale connected: no network step, two steps, and Continue starts the setup", () =>
    firstRun(
      "first",
      async (screen) => {
        const { counter, press, step, choices } = screen;
        await screen.press("Run free on this Mac");
        await until(() => step() === "owner");
        expect(counter()).toBe("Run on this Mac · 1 of 2");
        await act(async () => typeInto(screen.el.querySelector('input[type="email"]'), "ana@example.com"));
        await screen.submit("dk-first-owner");
        await until(() => step() === "where");
        expect(counter()).toBe("Run on this Mac · 2 of 2");
        await press("Continue");
        await until(() => step() === "setup");
        expect(choices).toEqual([{ name: "Ana Souza", email: "ana@example.com", place: "everywhere", usage: true }]);
      },
      { here: { hold: "account", pace: 10 } },
    ));

  test("only on this Mac: the layer steps aside once it's set up", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step, host, choices } = screen;
        await toWhere(screen);
        await act(async () => (el.querySelector("#where-here") as HTMLElement).click());
        await press("Continue");
        await until(() => step() === "setup");
        await until(() => host.layer.route === null);
        expect(choices[0]?.place).toBe("here");
      },
      { here: { pace: 10 } },
    ));
});

describe("Setting everything up", () => {
  test("the steps in the frame, the title focused for screen readers, Cancel alone and no Back", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, counter, title, foot } = screen;
        await toSetup(screen);
        await until(() => stepOf(el, "Creating your account")?.dataset.state === "active");
        expect(counter()).toBe("Run on this Mac");
        expect(title()).toBe("Getting everything ready");
        expect(document.activeElement).toBe(el.querySelector("h1"));
        expect(foot()).toEqual(["Cancel"]);
        expect(
          [...el.querySelectorAll<HTMLElement>(".dk-first__steps > li")].map((li) => [
            li.querySelector("b")?.textContent,
            li.dataset.state,
          ]),
        ).toEqual([
          ["Making room for your data", "done"],
          ["Turning agentes.chat on", "done"],
          ["Creating your account", "active"],
          ["Calling your agents", "todo"],
          ["Turning on access from anywhere", "todo"],
        ]);
        // Before 10 s, no time.
        expect(el.querySelector(".dk-fr__steptime")).toBeNull();
        expect(el.querySelector(".dk-fr__stepline")).toBeNull();
      },
      { here: { hold: "account", pace: 10 } },
    ));

  test("past 30 s: its time, and the slow line with Copy details", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, foot } = screen;
        await toSetup(screen);
        await until(() => stepOf(el, "Turning agentes.chat on")?.dataset.state === "active");
        setSystemTime(new Date(Date.now() + 31_000));
        try {
          await until(() => stepOf(el, "Turning agentes.chat on")?.querySelector(".dk-fr__steptime"));
          const step = stepOf(el, "Turning agentes.chat on") as HTMLElement;
          expect(step.querySelector(".dk-fr__steptime")?.textContent).toBe("0:31");
          expect(step.querySelector(".dk-fr__steptime")?.getAttribute("aria-hidden")).toBe("true");
          expect(step.querySelector(".dk-fr__stepline")?.textContent).toBe(
            "Taking a little longer than expected · Copy details",
          );
          expect(foot()).toEqual(["Cancel"]);
        } finally {
          setSystemTime();
        }
      },
      { here: { hold: "start", pace: 10 } },
    ));

  test("Cancel stops it, and the step it started from comes back as it was", async () => {
    let cancels = 0;
    let cancelNow: (() => Promise<void>) | null = null;
    await firstRun(
      "first",
      async (screen) => {
        const { el, step, button, press } = screen;
        await toSetup(screen);
        await until(() => stepOf(el, "Creating your account")?.dataset.state === "active");
        await press("Cancel");
        expect(cancels).toBe(1);
        // Busy while what it started stops, the same width.
        expect(button("Cancel")?.getAttribute("aria-busy")).toBe("true");
        await act(async () => cancelNow?.());
        await until(() => step() === "where");
        expect(el.querySelector('[role="radio"][aria-checked="true"]')?.id).toBe("where-everywhere");
        await pressEscape();
        expect(step()).toBe("owner");
        expect((el.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("ana@example.com");
      },
      {
        here: { hold: "account", pace: 10 },
        host: (host) => {
          const cancel = host.cancelLocalSetup;
          host.cancelLocalSetup = async () => {
            cancels++;
            cancelNow = cancel;
          };
        },
      },
    );
  });

  test("Esc is Cancel while it runs, and after a failure", async () => {
    await firstRun(
      "first",
      async (screen) => {
        await toSetup(screen);
        await until(() => stepOf(screen.el, "Creating your account")?.dataset.state === "active");
        await pressEscape();
        await until(() => screen.step() === "where");
      },
      { here: { hold: "account", pace: 10 } },
    );
    await firstRun(
      "first",
      async (screen) => {
        await toSetup(screen);
        await until(() => screen.button("Try again"));
        await pressEscape();
        await until(() => screen.step() === "where");
      },
      { here: { fail: "start", pace: 10 } },
    );
  });

  test("a failed step: what happened, with Copy details, then Cancel and Try again", async () => {
    let runs = 0;
    await firstRun(
      "first",
      async (screen) => {
        const { el, button, press, foot, step } = screen;
        await toSetup(screen);
        await until(() => button("Try again"));
        const failed = stepOf(el, "Turning agentes.chat on") as HTMLElement;
        expect(failed.dataset.state).toBe("failed");
        expect(failed.querySelector(".dk-honest")?.textContent).toBe(
          "agentes.chat didn't start on this Mac. Copy details",
        );
        expect(foot()).toEqual(["Cancel", "Try again"]);
        expect(document.activeElement).toBe(button("Try again") ?? null);
        await press("Try again");
        await until(() => runs === 2 && button("Try again"));
        await press("Cancel");
        await until(() => step() === "where");
        expect(runs).toBe(2);
      },
      {
        here: { fail: "start", pace: 10 },
        host: (host) => {
          const install = host.installLocalServer;
          host.installLocalServer = (choice) => {
            runs++;
            return install(choice);
          };
        },
      },
    );
  });

  test("One click left: Tailscale's page a button away, no time limit, and Finish without it ends on this Mac", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, host, tailscale } = screen;
        await toSetup(screen);
        await until(() => el.querySelector(".dk-first__ask"));
        const reach = stepOf(el, "Turning on access from anywhere") as HTMLElement;
        expect(reach.dataset.state).toBe("active");
        expect(reach.querySelector(".dk-first__ask")?.textContent).toStartWith(
          "One click left. On the Tailscale page that opened, click Enable.",
        );
        expect([...reach.querySelectorAll(".dk-first__ask b")].map((b) => b.textContent)).toEqual([
          "One click left.",
          "Enable",
        ]);
        await press("Open the page");
        expect(tailscale).toEqual(["https"]);
        // Waiting on the person is never slow.
        setSystemTime(new Date(Date.now() + 120_000));
        try {
          await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
          expect(reach.querySelector(".dk-fr__steptime, .dk-fr__stepline")).toBeNull();
        } finally {
          setSystemTime();
        }
        await press("Finish without it");
        await until(() => host.layer.route === null);
      },
      { here: { approve: true, pace: 10 } },
    ));

  test("access that didn't turn on: why, with its fix, then Continue", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, host, foot } = screen;
        await toSetup(screen);
        await until(() => foot().includes("Continue"));
        const reach = stepOf(el, "Turning on access from anywhere") as HTMLElement;
        expect(reach.dataset.state).toBe("warn");
        expect(reach.querySelector(".dk-fr__problem")?.textContent).toContain(
          "HTTPS is off on your Tailscale network. Turn it on",
        );
        expect(foot()).toEqual(["Continue"]);
        await press("Continue");
        await until(() => host.layer.route === null);
      },
      { here: { fail: "reach", pace: 10 } },
    ));

  test("in Portuguese, on this PC", async () => {
    await firstRun(
      "first",
      async (screen) => {
        const { el, title, counter } = screen;
        await toWhere(screen, { row: "Rodar grátis neste Mac" });
        expect(counter()).toBe("Rodar neste Mac · 2 de 2");
        await screen.press("Continuar");
        await until(() => stepOf(el, "Criando a sua conta")?.dataset.state === "active");
        expect(title()).toBe("Preparando tudo");
        expect(screen.foot()).toEqual(["Cancelar"]);
      },
      { here: { hold: "account", pace: 10 }, lang: "pt-BR" },
    );
    await firstRun(
      "windows",
      async (screen) => {
        await toWhere(screen, { row: "Run free on this PC" });
        expect(screen.el.querySelector("#where-here")?.closest("label")?.textContent).toContain("Only on this PC");
        expect(screen.el.querySelector(".dk-flow__band canvas.ac-computer")?.getAttribute("data-kind")).toBe("windows");
      },
      { here: { hold: "account", pace: 10 } },
    );
  });

  test("shown again mid-setup, the window keeps the setup", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, host, step } = screen;
        await toSetup(screen);
        await until(() => stepOf(el, "Creating your account")?.dataset.state === "active");
        await act(async () => host.showLayer({ screen: "firstRun" }));
        expect(step()).toBe("setup");
        expect(stepOf(el, "Creating your account")?.dataset.state).toBe("active");
      },
      { here: { hold: "account", pace: 10 } },
    ));
});

describe("Done, take it to your phone", () => {
  test("the code beside its three steps, the address with Copy, Do it later and Open agentes.chat", async () => {
    const copied: string[] = [];
    const clipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
    try {
      await firstRun(
        "first",
        async (screen) => {
          const { el, press, step, title, foot, host, counter, button } = screen;
          await toSetup(screen);
          await until(() => step() === "done");
          expect(counter()).toBe("Run on this Mac");
          expect(title()).toBe("Done. Take it to your phone");
          await until(() => el.querySelector('.dk-first__qr svg[role="img"]'));
          expect(el.querySelector('.dk-first__qr svg[role="img"]')?.getAttribute("aria-label")).toBe(
            "QR code to sign in on your phone",
          );
          expect([...el.querySelectorAll(".dk-first__numbered > li > b")].map((b) => b.textContent)).toEqual([
            "Install the agentes.chat app",
            "Install Tailscale and sign in with the same account",
            "Point the camera at the code",
          ]);
          expect(el.querySelector(".dk-first__addr")?.textContent).toBe("Your address: ana-mac.tail1234.ts.netCopy");
          expect(el.querySelector(".dk-first__addr b")?.textContent).toBe("ana-mac.tail1234.ts.net");
          await press("Copy");
          await until(() => button("Copied"));
          expect(copied).toEqual(["https://ana-mac.tail1234.ts.net"]);
          expect(foot()).toEqual(["Do it later", "Open agentes.chat"]);
          await press("Open agentes.chat");
          await until(() => host.layer.route === null);
        },
        { here: { pace: 10 } },
      );
    } finally {
      if (clipboard) Object.defineProperty(window.navigator, "clipboard", clipboard);
      else delete (window.navigator as { clipboard?: unknown }).clipboard;
    }
  });

  test("a code that didn't load says so, and tries again", () =>
    firstRun(
      "first",
      async (screen) => {
        const { el, press, step } = screen;
        await toSetup(screen);
        await until(() => step() === "done");
        await until(() => el.querySelector(".dk-first__problem"));
        expect(el.querySelector(".dk-first__problem")?.textContent).toBe("The code didn't load. Try again");
        expect(el.querySelector(".dk-first__addr")).toBeNull();
        await press("Try again");
        await until(() => el.querySelector('.dk-first__qr svg[role="img"]'));
      },
      {
        here: { pace: 10 },
        host: (host) => {
          const link = host.phoneLink;
          let asks = 0;
          host.phoneLink = () => (++asks === 1 ? Promise.reject("signed_out") : link());
        },
      },
    ));
});

describe("Run here as it already is", () => {
  test("no account left: it opens on the owner step, says so, and the name and email make the new owner", () =>
    firstRun(
      "here",
      async (screen) => {
        const { el, step, lead, submit, press, choices } = screen;
        await until(() => step() === "owner");
        expect(lead()).toBe("No account is left on it. Your name and email make you its new owner.");
        const [name, email] = [...el.querySelectorAll(".dk-first__fields input")];
        await act(async () => typeInto(name ?? null, "Carla Dias"));
        await act(async () => typeInto(email ?? null, "carla@example.com"));
        await submit("dk-first-owner");
        await until(() => step() === "where");
        await press("Continue");
        await until(() => choices.length > 0);
        expect(choices[0]).toMatchObject({ name: "Carla Dias", email: "carla@example.com" });
      },
      { here: { owner: false, hold: "account", pace: 10 } },
    ));

  test("erased from its settings: the owner step says where the old data went", () =>
    firstRun("here", async ({ host, step, lead }) => {
      await act(async () => {
        await host.eraseLocalServer();
      });
      await until(() => step() === "owner");
      expect(lead()).toBe("Erased. Its old data is in ~/agentes.chat erased 2026-11-14.");
    }));

  test("having run here before: no owner step, and where it is used says where its data still is", () =>
    firstRun(
      "here",
      async ({ press, step, lead, counter }) => {
        await press("Run free on this Mac");
        await until(() => step() === "where");
        expect(lead()).toBe("It ran here before, and its data is still in ~/.agentes.");
        // Only this Mac, as it was: one step, so no count.
        expect(counter()).toBe("Run on this Mac");
      },
      { here: { run: false } },
    ));

  test("running here already: one sentence, never its address, and Open it", () =>
    firstRun("here", async ({ press, title, lead, button }) => {
      await press("Run free on this Mac");
      await until(() => title() === "agentes.chat already runs on this Mac");
      expect(lead()).toBe("This app runs it. Open it to sign in.");
      expect(button("Open it")).toBeTruthy();
    }));
});
