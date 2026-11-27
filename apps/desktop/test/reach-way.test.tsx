import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import type { AddressProblem, ReachWay, Tailnet, TailscalePage } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import { createFakeHost, type FakeHost, type HereOptions, type Scenario } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ReachWayPicker, TAILSCALE_POLL_MS } from "../src/ui/reach-way";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Options {
  scenario?: Scenario;
  here?: HereOptions;
  start?: ReachWay;
  tailnet?: Tailnet | null;
  port?: number | null;
  problem?: { why: AddressProblem; status?: number } | null;
  lang?: "en" | "pt-BR";
  /** Changes the host before the picker shows. */
  host?: (host: FakeHost) => void;
}

/** The picker as a screen holds it: its value in state, what it said back, and what it opened in Tailscale. */
async function picker(check: (screen: ReturnType<typeof screenOf>) => Promise<void>, options: Options = {}) {
  const host = createFakeHost("app", options.scenario ?? "first", { here: options.here });
  const opened: TailscalePage[] = [];
  host.openTailscale = async (page) => {
    opened.push(page);
  };
  options.host?.(host);
  const seen = { ways: [] as ReachWay[], ready: 0, submits: 0 };
  function Holder() {
    const [way, setWay] = useState<ReachWay>(options.start ?? { kind: "tailscale" });
    return (
      <ReachWayPicker
        value={way}
        onChange={(next) => {
          seen.ways.push(next);
          setWay(next);
        }}
        platform={host.platform}
        tailnet={options.tailnet === undefined ? null : options.tailnet}
        port={options.port === undefined ? 4310 : options.port}
        onReady={() => {
          seen.ready++;
        }}
        problem={options.problem ?? null}
        onSubmit={() => {
          seen.submits++;
        }}
      />
    );
  }
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={createDesktopI18n(options.lang ?? "en", host.platform)}>
          <AppProvider host={host} store={new DesktopStore(host, {})}>
            <Holder />
          </AppProvider>
        </I18nextProvider>,
      ),
    );
    await check(screenOf(el, seen, opened));
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
}

function screenOf(
  el: HTMLElement,
  seen: { ways: ReachWay[]; ready: number; submits: number },
  opened: TailscalePage[],
) {
  const buttons = () => [...el.querySelectorAll("button")];
  return {
    el,
    seen,
    opened,
    /** The rows' titles and whether each one's radio is checked. */
    rows: () =>
      [...el.querySelectorAll<HTMLElement>(".dk-way__item")].map((row) => [
        row.querySelector(".dk-way__text b")?.textContent,
        row.querySelector('[role="radio"]')?.getAttribute("aria-checked"),
      ]),
    part: () => el.querySelector(".dk-way__part"),
    button: (name: string) => buttons().find((b) => b.textContent === name),
    press: async (name: string) => {
      const target = buttons().find((b) => b.textContent === name);
      expect({ name, found: !!target }).toEqual({ name, found: true });
      await act(async () => target?.click());
    },
    pick: (kind: ReachWay["kind"]) => act(async () => (el.querySelector(`#way-${kind}`) as HTMLElement).click()),
    field: () => el.querySelector<HTMLInputElement>("#way-address-url"),
  };
}

/** Types into a React field: the value through the field's own setter, then the event React listens to. */
function typeInto(field: Element | null, value: string) {
  const input = field as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("the two ways (ADR 0256 §4)", () => {
  test("two rows with a hairline, a tile and a radio, Tailscale chosen; no card and no tag", () =>
    picker(
      async ({ el, rows }) => {
        expect(rows()).toEqual([
          ["Through Tailscale", "true"],
          ["Through an address of mine", "false"],
        ]);
        expect([...el.querySelectorAll(".dk-way__text small")].map((s) => s.textContent)).toEqual([
          "Free. A private network between your devices and your team's.",
          "A tunnel on this Mac that already leads here.",
        ]);
        // Tailscale's own mark on its tile, a plain link icon on the other.
        expect(el.querySelector('[data-way="tailscale"] .dk-logo .dk-tailscale')).not.toBeNull();
        expect(el.querySelector('[data-way="address"] .dk-logo .ac-icon')).not.toBeNull();
        expect(el.querySelector(".dk-way .dk-card, .dk-way .ac-chip")).toBeNull();
        expect(el.querySelector(".dk-way")?.getAttribute("role")).toBe("radiogroup");
        expect(el.querySelector(".dk-way")?.getAttribute("aria-label")).toBe("How the phone and the team get here");
      },
      { tailnet: { state: "off", app: true } },
    ));

  test("only the chosen row shows its part, and the address typed stays when the person looks at Tailscale", () =>
    picker(
      async ({ el, pick, field, seen, rows }) => {
        expect(el.querySelectorAll(".dk-way__part")).toHaveLength(1);
        expect(el.querySelector('[data-way="tailscale"] .dk-way__part')).not.toBeNull();
        await pick("address");
        expect(rows().map(([, on]) => on)).toEqual(["false", "true"]);
        expect(el.querySelector('[data-way="address"] .dk-way__part')).not.toBeNull();
        expect(el.querySelector('[data-way="tailscale"] .dk-way__part')).toBeNull();
        // Picked by the person: the field takes the keyboard.
        expect(document.activeElement).toBe(field());
        await act(async () => typeInto(field(), "https://agentes.example.com"));
        await pick("tailscale");
        await pick("address");
        expect(field()?.value).toBe("https://agentes.example.com");
        expect(seen.ways.at(-1)).toEqual({ kind: "address", url: "https://agentes.example.com" });
      },
      { tailnet: { state: "off", app: true } },
    ));

  test("in Portuguese, on a PC", () =>
    picker(
      async ({ el, rows }) => {
        expect(rows().map(([title]) => title)).toEqual(["Pelo Tailscale", "Por um endereço meu"]);
        expect(el.querySelector('[data-way="address"] small')?.textContent).toBe(
          "Um túnel neste PC que já leva até aqui.",
        );
      },
      { scenario: "windows", lang: "pt-BR", tailnet: { state: "off", app: false } },
    ));
});

describe("through Tailscale", () => {
  test("missing: Download Tailscale opens its official page, then the waiting look with what to do there", () =>
    picker(
      async ({ el, press, opened, part }) => {
        expect(el.querySelector(".dk-way__wait")).toBeNull();
        expect(part()?.textContent).toContain("Free, from Tailscale's own site.");
        await press("Download Tailscale");
        expect(opened).toEqual(["download"]);
        // The app and Tailscale joined by the trail, what it waits for in bold with the spinner, what to do there.
        expect(el.querySelectorAll(".dk-way__hop > *")).toHaveLength(3);
        expect(el.querySelector(".dk-way__now")?.textContent).toBe("Waiting for Tailscale…");
        expect(el.querySelector(".dk-way__now .ac-pixspin")).not.toBeNull();
        expect(el.querySelector(".dk-way__how")?.textContent).toBe(
          "Install it, open it and sign in. This goes on by itself, no rush.",
        );
      },
      { tailnet: { state: "missing" } },
    ));

  test("off on a Mac with its app: Open Tailscale and sign in, and the waiting look at once", () =>
    picker(
      async ({ el, press, opened }) => {
        expect(el.querySelector(".dk-way__now")?.textContent).toBe("Waiting for Tailscale…");
        expect(el.querySelector(".dk-way__how")?.textContent).toBe("Sign in there. This goes on by itself, no rush.");
        await press("Open Tailscale and sign in");
        expect(opened).toEqual(["app"]);
      },
      { tailnet: { state: "off", app: true } },
    ));

  test("off on Windows: its icon by the clock; on Linux or a Mac with only its command line: the command", async () => {
    await picker(
      async ({ part }) => {
        expect(part()?.querySelector(".dk-way__note")?.textContent).toBe(
          "Open Tailscale from its icon by the clock and sign in.",
        );
        expect(part()?.querySelector("button.ac-btn")).toBeNull();
      },
      { scenario: "windows", tailnet: { state: "off", app: false } },
    );
    for (const scenario of ["linux", "first"] as const)
      await picker(
        async ({ part }) => {
          expect(part()?.querySelector(".dk-way__note")?.textContent).toContain("Connect Tailscale in the terminal:");
          expect(part()?.querySelector("code")?.textContent).toBe("sudo tailscale up");
        },
        { scenario, tailnet: { state: "off", app: false } },
      );
  });

  test("not read yet: it reads it and says it is checking meanwhile", () =>
    picker(
      async ({ el }) => {
        expect(el.querySelector(".dk-way__line .dk-shimmer")?.textContent).toBe("Checking Tailscale on this Mac…");
        await until(() => el.querySelector(".dk-way__now"));
        expect(el.querySelector(".dk-way__how")?.textContent).toBe("Sign in there. This goes on by itself, no rush.");
      },
      {
        tailnet: null,
        here: { tailscale: "off" },
        host: (host) => {
          const read = host.tailscale;
          let first = true;
          host.tailscale = async () => {
            // The first read takes a moment: the line says it is checking.
            if (first) await new Promise((resolve) => setTimeout(resolve, 60));
            first = false;
            return read();
          };
        },
      },
    ));

  test("waiting: read every 2 s with no time limit, and once it turns on, onReady", async () => {
    expect(TAILSCALE_POLL_MS).toBe(2000);
    let state: Tailnet = { state: "off", app: true };
    let reads = 0;
    await picker(
      async ({ el, seen }) => {
        await act(() => new Promise((resolve) => setTimeout(resolve, 2100)));
        expect(reads).toBeGreaterThanOrEqual(1);
        expect(seen.ready).toBe(0);
        state = { state: "on", device: "ana-mac.tail1234.ts.net" };
        await until(() => seen.ready === 1, 5000);
        // On: no waiting look, the line that says so.
        expect(el.querySelector(".dk-way__now")).toBeNull();
        expect(el.querySelector(".dk-way__line--ok")?.textContent).toBe("Tailscale is connected on this Mac.");
        // Told once, and no more reads once it is on.
        const after = reads;
        await act(() => new Promise((resolve) => setTimeout(resolve, 2100)));
        expect(seen.ready).toBe(1);
        expect(reads).toBe(after);
      },
      {
        tailnet: { state: "off", app: true },
        host: (host) => {
          host.tailscale = async () => {
            reads++;
            return state;
          };
        },
      },
    );
  });

  test("on from the start (Settings): it says so, and onReady isn't called", () =>
    picker(
      async ({ el, seen }) => {
        expect(el.querySelector(".dk-way__line--ok")?.textContent).toBe("Tailscale is connected on this Mac.");
        expect(seen.ready).toBe(0);
      },
      { tailnet: { state: "on", device: "ana-mac.tail1234.ts.net" } },
    ));
});

describe("through an address of the person's own", () => {
  test("the field, and where the tunnel points under it with Copy", async () => {
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
      await picker(
        async ({ el, field, press, button, seen }) => {
          expect(el.querySelector('label[for="way-address-url"]')?.textContent).toBe("Your address");
          expect(field()?.getAttribute("placeholder")).toBe("https://…");
          expect(el.querySelector(".dk-way__tunnel")?.textContent).toBe("Point it at http://127.0.0.1:4310Copy");
          expect(el.querySelector(".dk-way__tunnel b")?.textContent).toBe("http://127.0.0.1:4310");
          await press("Copy");
          await until(() => button("Copied"));
          expect(copied).toEqual(["http://127.0.0.1:4310"]);
          // Enter is the screen's Continue.
          await act(async () =>
            field()?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
          );
          expect(seen.submits).toBe(1);
        },
        { start: { kind: "address", url: "" }, tailnet: { state: "off", app: true } },
      );
    } finally {
      if (clipboard) Object.defineProperty(window.navigator, "clipboard", clipboard);
      else delete (window.navigator as { clipboard?: unknown }).clipboard;
    }
  });

  test("no port known: no line under the field", () =>
    picker(
      async ({ el }) => {
        expect(el.querySelector(".dk-way__tunnel")).toBeNull();
      },
      { start: { kind: "address", url: "" }, port: null, tailnet: { state: "off", app: true } },
    ));

  test("what is wrong with it, under the field in place of the tunnel's line", async () => {
    const cases: [{ why: AddressProblem; status?: number }, string][] = [
      [{ why: "notHttps" }, "The address must start with https://"],
      [
        { why: "unreachable" },
        "We couldn't open it. Check that your tunnel is on and points to http://127.0.0.1:4310.",
      ],
      [{ why: "otherServer" }, "It opens another server, not this Mac's."],
      [{ why: "error", status: 502 }, "It answered with an error (502)."],
    ];
    for (const [problem, words] of cases)
      await picker(
        async ({ el, field }) => {
          expect(el.querySelector(".ac-field__error")?.textContent).toBe(words);
          expect(field()?.getAttribute("aria-invalid")).toBe("true");
          expect(el.querySelector(".dk-way__tunnel")).toBeNull();
        },
        {
          start: { kind: "address", url: "https://agentes.example.com/x" },
          problem,
          tailnet: { state: "off", app: true },
        },
      );
  });
});
