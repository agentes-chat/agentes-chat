import { afterEach, describe, expect, test } from "bun:test";
import { domWindow, setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import {
  isLoopbackOrigin,
  ownOrigins,
  ownOriginsFor,
  publicOrigin,
  publicOriginFor,
  rememberPublicUrl,
} from "../src/lib/public-origin";
import { inAppPath } from "../src/lib/web-push";

/**
 * The links a page hands out name the address people open (ADR 0256 §5): the desktop app opens a server on the same
 * computer at its loopback address, which opens nowhere else.
 */

const LOOPBACK = "http://127.0.0.1:4310";
const PEOPLE = "https://agentes.tailnet-example.ts.net";

afterEach(() => {
  rememberPublicUrl(null);
  domWindow().happyDOM.setURL("http://localhost:3000/");
});

describe("the origin links use", () => {
  test("at a loopback origin of a server people open elsewhere: PUBLIC_URL", () => {
    expect(publicOriginFor(LOOPBACK, PEOPLE)).toBe(PEOPLE);
    expect(publicOriginFor(LOOPBACK, `${PEOPLE}/`)).toBe(PEOPLE);
    expect(publicOriginFor("http://localhost:4310", PEOPLE)).toBe(PEOPLE);
    expect(publicOriginFor("http://[::1]:4310", PEOPLE)).toBe(PEOPLE);
  });

  test("anywhere else, or before the server says: the page's own origin, as before", () => {
    // Opened at the people address itself.
    expect(publicOriginFor(PEOPLE, PEOPLE)).toBe(PEOPLE);
    // A server only this computer opens: its loopback origin is its address.
    expect(publicOriginFor(LOOPBACK, LOOPBACK)).toBe(LOOPBACK);
    // Another address the server answers (a LAN name) keeps its own links.
    expect(publicOriginFor("https://lan.example", PEOPLE)).toBe("https://lan.example");
    // Development: the web app's own dev server beside the API's, both on this computer.
    expect(publicOriginFor("http://localhost:5173", "http://localhost:3000")).toBe("http://localhost:5173");
    expect(publicOriginFor(LOOPBACK, null)).toBe(LOOPBACK);
    expect(publicOriginFor(LOOPBACK, "not an address")).toBe(LOOPBACK);
  });

  test("loopback origins", () => {
    for (const origin of [LOOPBACK, "http://localhost:3000", "http://127.1.2.3", "http://[::1]:80"]) {
      expect([origin, isLoopbackOrigin(origin)]).toEqual([origin, true]);
    }
    for (const origin of [PEOPLE, "http://127.0.0.1.evil.example", "", "nope"]) {
      expect([origin, isLoopbackOrigin(origin)]).toEqual([origin, false]);
    }
  });

  test("the page's own origins: its own, then PUBLIC_URL's when that differs", () => {
    expect(ownOriginsFor(LOOPBACK, PEOPLE)).toEqual([LOOPBACK, PEOPLE]);
    expect(ownOriginsFor(PEOPLE, `${PEOPLE}/`)).toEqual([PEOPLE]);
    expect(ownOriginsFor(LOOPBACK, null)).toEqual([LOOPBACK]);
  });
});

describe("this page", () => {
  test("at the loopback origin, once auth-config named PUBLIC_URL", () => {
    domWindow().happyDOM.setURL(`${LOOPBACK}/org/o1/c/c1`);
    expect(publicOrigin()).toBe(LOOPBACK);
    rememberPublicUrl(PEOPLE);
    expect(publicOrigin()).toBe(PEOPLE);
    expect(ownOrigins()).toEqual([LOOPBACK, PEOPLE]);
    // A notification naming the people address opens in this window.
    expect(inAppPath(`${PEOPLE}/org/o1/c/c1?m=1`, ownOrigins())).toBe("/org/o1/c/c1?m=1");
    expect(inAppPath("https://evil.example/org/o1", ownOrigins())).toBeNull();
  });

  test("at the people address, nothing changes", () => {
    domWindow().happyDOM.setURL(`${PEOPLE}/org/o1`);
    rememberPublicUrl(PEOPLE);
    expect(publicOrigin()).toBe(PEOPLE);
    expect(ownOrigins()).toEqual([PEOPLE]);
  });
});
