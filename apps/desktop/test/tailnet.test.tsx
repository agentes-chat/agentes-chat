import { afterEach, expect, setSystemTime, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../src/app";
import type { TailnetState } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import { useTailnet, useTailnetState } from "../src/hooks";
import { createFakeHost } from "../src/host/fake";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => setSystemTime());

function Tailnet() {
  return <span>{useTailnet()?.state ?? "…"}</span>;
}

test("Tailscale is read as the window opens and when it comes up again, at most every 15 seconds", async () => {
  const start = new Date(2026, 10, 18, 12, 0, 0);
  setSystemTime(start);
  const host = createFakeHost("app", "selfhost");
  let reads = 0;
  const read = host.tailscale;
  host.tailscale = () => {
    reads++;
    return read();
  };
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <AppProvider host={host} store={new DesktopStore(host, {})}>
          <Tailnet />
        </AppProvider>,
      ),
    );
    expect(reads).toBe(1);
    // Each read runs `tailscale status`: a window brought up again and again doesn't run it each time.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(reads).toBe(1);
    setSystemTime(new Date(start.getTime() + 16_000));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(reads).toBe(2);
    expect(el.textContent).toBe("on");
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});

function Own() {
  const state = useTailnetState();
  return <span>{state ? (state.mode === "none" ? "none" : `${state.mode} ${state.state}`) : "…"}</span>;
}

test("the app's own Tailscale: read as the window opens, then followed through a sign-in", async () => {
  const host = createFakeHost("app", "here", { here: { tailnet: "signedOut", pace: 10 } });
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <AppProvider host={host} store={new DesktopStore(host, {})}>
          <Own />
        </AppProvider>,
      ),
    );
    expect(el.textContent).toBe("app signedOut");
    const stages: string[] = [];
    const stop = host.onTailnetSignIn((s) => stages.push(s.stage));
    let device = "";
    await act(async () => {
      device = (await host.signInTailnet()).device;
    });
    stop();
    expect(device).toBe("agentes.tail1234.ts.net");
    expect(stages).toEqual(["url", "done"]);
    expect(el.textContent).toBe("app on");
    const local = await host.localServer();
    expect((local.tailnet as TailnetState & { device?: string }).device).toBe("agentes.tail1234.ts.net");
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});

test("a sign-in stopped while it waits ends as cancelled, signed out", async () => {
  const host = createFakeHost("app", "here", { here: { tailnet: "signedOut", pace: 10 } });
  const signingIn = host.signInTailnet();
  await host.cancelTailnetSignIn();
  expect(await signingIn.catch((e) => e)).toBe("cancelled");
  expect(await host.tailnet()).toEqual({ mode: "app", state: "signedOut" });
});

test("no Tailscale carried by this build: nothing to sign in, and the phone's code waits for reach", async () => {
  const host = createFakeHost("app", "here");
  expect(await host.tailnet()).toEqual({ mode: "none" });
  expect(await host.signInTailnet().catch((e) => e)).toBe("start");
  expect(await host.phoneLink().catch((e) => e)).toBe("not_served");
  const shared = createFakeHost("app", "here", { here: { reach: true } });
  const link = await shared.phoneLink();
  expect(link.server).toBe("https://ana-mac.tail1234.ts.net");
  expect(link.link.startsWith("agenteschat://connect?server=https%3A%2F%2Fana-mac.tail1234.ts.net&token=")).toBe(true);
});
