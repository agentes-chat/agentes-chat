import { afterEach, expect, setSystemTime, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../src/app";
import type { ReachStage } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import { useTailnet } from "../src/hooks";
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

test("the fake host: the system's Tailscale only, nothing of the app's own (ADR 0256 §4)", () => {
  const host = createFakeHost("app", "here") as unknown as Record<string, unknown>;
  for (const gone of ["tailnet", "onTailnet", "signInTailnet", "cancelTailnetSignIn", "onTailnetSignIn"])
    expect({ gone, there: gone in host }).toEqual({ gone, there: false });
  expect(typeof host.tailscale).toBe("function");
  expect(typeof host.checkAddress).toBe("function");
});

test("`?install=1`: Tailscale missing turns on about 6 s after its download page opened", async () => {
  const host = createFakeHost("app", "first", { here: { tailscale: "missing", install: true } });
  expect(await host.tailscale()).toEqual({ state: "missing" });
  const realTimeout = globalThis.setTimeout;
  const later: { ms: number; fn: () => void }[] = [];
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    later.push({ fn, ms });
    return 0;
  }) as unknown as typeof setTimeout;
  try {
    await host.openTailscale("download");
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  expect(later.map((l) => l.ms)).toEqual([6000]);
  // Still missing until then.
  expect(await host.tailscale()).toEqual({ state: "missing" });
  later[0]?.fn();
  expect(await host.tailscale()).toEqual({ state: "on", device: "ana-mac.tail1234.ts.net" });
  // Without `?install=1` it stays as it is.
  const stays = createFakeHost("app", "first", { here: { tailscale: "missing" } });
  await stays.openTailscale("download");
  expect(await stays.tailscale()).toEqual({ state: "missing" });
});

test("an address of the person's own: its form, then where it leads (`?addr=`)", async () => {
  const host = createFakeHost("app", "first", { here: { pace: 1 } });
  expect(await host.checkAddress("http://agentes.example.com")).toEqual({ ok: false, why: "notHttps" });
  expect(await host.checkAddress(" https://agentes.example.com/ ")).toEqual({
    ok: true,
    url: "https://agentes.example.com",
  });
  const fails = { unreachable: "unreachable", other: "otherServer", nothttps: "notHttps" } as const;
  for (const [addr, why] of Object.entries(fails)) {
    const failing = createFakeHost("app", "first", { here: { pace: 1, addr } });
    expect({ addr, check: await failing.checkAddress("https://agentes.example.com") }).toEqual({
      addr,
      check: { ok: false, why },
    });
  }
  const error = createFakeHost("app", "first", { here: { pace: 1, addr: "error" } });
  expect(await error.checkAddress("https://agentes.example.com")).toEqual({ ok: false, why: "error", status: 502 });
});

test("reach through an address: checked, the server starts again behind the window, and the phone's code uses it", async () => {
  const host = createFakeHost("app", "here", { here: { pace: 1 } });
  expect(await host.phoneLink().catch((e) => e)).toBe("not_served");
  const stages: ReachStage["stage"][] = [];
  const stop = host.onLocalReach((s) => stages.push(s.stage));
  const result = await host.setLocalReach(true, { kind: "address", url: "https://agentes.example.com" });
  stop();
  expect(result).toEqual({ ok: true, url: "https://agentes.example.com" });
  expect(stages).toEqual(["checking", "restarting", "done"]);
  expect(await host.localServer()).toMatchObject({
    reach: true,
    way: { kind: "address", url: "https://agentes.example.com" },
    publicUrl: "https://agentes.example.com",
    reachHealth: "on",
    reachDown: false,
    port: 4310,
  });
  expect((await host.phoneLink()).server).toBe("https://agentes.example.com");
  // The window stays at loopback (ADR 0256 §5).
  expect(host.list.current).toBe("http://127.0.0.1:4310");
  // On again without a way: the saved one.
  expect(await host.setLocalReach(true)).toEqual({ ok: true, url: "https://agentes.example.com" });
});

test("an address that doesn't lead here: reach stays off, with why", async () => {
  const host = createFakeHost("app", "here", { here: { pace: 1, addr: "other" } });
  const result = await host.setLocalReach(true, { kind: "address", url: "https://agentes.example.com" });
  expect(result).toEqual({ ok: false, problem: { reason: "address", why: "otherServer" } });
  expect((await host.localServer()).reach).toBe(false);
});

test("a saved address and its health while designing (`?way=address&addr=…&health=address`)", async () => {
  const host = createFakeHost("app", "here", {
    here: { reach: true, way: "address", addr: "https://chat.example.org", health: "address" },
  });
  expect(await host.localServer()).toMatchObject({
    reach: true,
    way: { kind: "address", url: "https://chat.example.org" },
    publicUrl: "https://chat.example.org",
    reachHealth: "address",
    reachDown: true,
  });
  // Through Tailscale by default, and its phone's code.
  const tailscale = createFakeHost("app", "here", { here: { reach: true } });
  expect(await tailscale.localServer()).toMatchObject({
    way: { kind: "tailscale" },
    publicUrl: "https://ana-mac.tail1234.ts.net",
  });
  const link = await tailscale.phoneLink();
  expect(link.link.startsWith("agenteschat://connect?server=https%3A%2F%2Fana-mac.tail1234.ts.net&token=")).toBe(true);
});
