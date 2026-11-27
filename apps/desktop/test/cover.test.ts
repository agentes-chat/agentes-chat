import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { networkFix, networkWords, privateTitle } from "../src/cover/network";
import { STUCK_STEPS_MS, stuckAction } from "../src/cover/stuck";
import { desktopEn } from "../src/i18n/keys.en";
import { desktopPtBR } from "../src/i18n/keys.pt-BR";

const COVER = join(import.meta.dir, "../src/cover");
const read = (file: string) => readFileSync(file, "utf8");

test("the cover names only fonts its own page loads (it doesn't load the app's styles)", () => {
  const sheets = [...read(join(COVER, "main.ts")).matchAll(/^import "([^"]+\.css)";$/gm)].map((m) =>
    read(Bun.resolveSync(m[1] as string, COVER)),
  );
  const loaded = sheets.flatMap((css) =>
    [...css.matchAll(/@font-face\s*{[^}]*?font-family:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  );
  const named = [...read(join(COVER, "cover.css")).matchAll(/font(?:-family)?:([^;]+);/g)].flatMap((m) =>
    [...(m[1] as string).matchAll(/"([^"]+)"/g)].map((q) => q[1]),
  );
  expect(named.length).toBeGreaterThan(0);
  for (const family of named) expect(loaded).toContain(family);
});

describe("a workspace on a private network this computer can't reach (ADR 0256)", () => {
  test("the app's own Tailscale, when it is the one chosen, signs in or starts from the cover", () => {
    const own = (state: string) => ({ mode: "app", state }) as never;
    expect(networkFix("mac", { state: "off", app: true }, own("signedOut"))).toEqual({ act: "signIn" });
    expect(networkFix("linux", null, own("expired"))).toEqual({ act: "signIn" });
    expect(networkFix("windows", null, own("signingIn"))).toEqual({ act: "signingIn" });
    expect(networkFix("mac", null, own("needsApproval"))).toEqual({ act: "approve" });
    expect(networkFix("mac", null, own("off"))).toEqual({ act: "start" });
    expect(networkFix("mac", null, own("failing"))).toEqual({ act: "start" });
  });

  test("the system's: its Mac app, its download page, Windows' icon by the clock, never a command to type", () => {
    const none = { mode: "none" } as const;
    expect(networkFix("mac", { state: "off", app: true }, none)).toEqual({ act: "openApp" });
    // Not read yet: its app.
    expect(networkFix("mac", null, null)).toEqual({ act: "openApp" });
    // Only the command-line tool: nothing to open from here.
    expect(networkFix("mac", { state: "off", app: false }, none)).toEqual({ act: "elsewhere" });
    expect(networkFix("windows", { state: "off", app: false }, none)).toEqual({ act: "tray" });
    expect(networkFix("linux", { state: "off", app: false }, none)).toEqual({ act: "elsewhere" });
    for (const platform of ["mac", "windows", "linux"] as const) {
      expect(networkFix(platform, { state: "missing" }, none)).toEqual({ act: "download" });
      // Tailscale on: the network isn't why, the server itself doesn't answer.
      expect(networkFix(platform, { state: "on", device: "ana-mac.tail1234.ts.net" }, none)).toBeNull();
    }
  });

  test("its words: Turn the network on where the cover can, the way to it where it can't", () => {
    expect(networkWords({ act: "openApp" })).toEqual({ line: "privateLine", button: "turnOn" });
    expect(networkWords({ act: "signIn" })).toEqual({ line: "privateLine", button: "turnOn" });
    expect(networkWords({ act: "download" })).toEqual({ line: "privateMissing", button: "getTailscale" });
    expect(networkWords({ act: "tray" })).toEqual({ line: "privateTray", button: null });
    expect(networkWords({ act: "elsewhere" })).toEqual({ line: "privateElsewhere", button: null });
    expect(networkWords({ act: "signingIn" })).toEqual({ line: "privateSigningIn", button: null });
    expect(privateTitle([{ name: "Acme" }])).toEqual({ key: "privateTitle", org: "Acme" });
    expect(privateTitle([{ name: "Acme" }, { name: "Horizonte" }])).toEqual({ key: "privateTitleAny" });
    expect(privateTitle(null)).toEqual({ key: "privateTitleAny" });
    for (const { cover } of [desktopEn, desktopPtBR]) {
      expect(cover.privateTitle).toContain("{{org}}");
      for (const words of [
        cover.privateLine,
        cover.privateMissing,
        cover.privateApprove,
        cover.privateSigningIn,
        cover.privateTray,
        cover.privateElsewhere,
        cover.useOther,
        cover.turnOn,
        cover.getTailscale,
      ]) {
        expect(words).toBeTruthy();
        expect(words).not.toMatch(/sudo|terminal|tailnet/i);
      }
    }
    expect(desktopPtBR.cover.turnOn).toBe("Ligar a rede");
    expect(desktopPtBR.cover.useOther).toBe("Usar outro workspace");
  });
});

test("a page that never paints while its server answers: loaded again, then with the cache cleared, then said", () => {
  const [reload, fresh, say] = STUCK_STEPS_MS;
  expect(stuckAction(reload - 1, 0)).toBeNull();
  expect(stuckAction(reload + 1, 0)).toEqual({ step: 1, action: "reload" });
  // Each step once per showing.
  expect(stuckAction(reload + 2, 1)).toBeNull();
  expect(stuckAction(fresh + 1, 1)).toEqual({ step: 2, action: "fresh" });
  expect(stuckAction(say + 1, 2)).toEqual({ step: 3, action: "say" });
  expect(stuckAction(say + 60_000, 3)).toBeNull();
  // A check that comes late still goes one step at a time: it loads again before it says anything.
  expect(stuckAction(say + 1, 0)).toEqual({ step: 1, action: "reload" });
  expect(stuckAction(say + 4_000, 1)).toEqual({ step: 2, action: "fresh" });
  for (const { cover } of [desktopEn, desktopPtBR]) {
    expect(cover.stuck).toBeTruthy();
    expect(cover.showAnyway).toBeTruthy();
  }
});

test("the cover never steps aside on its own while the page hasn't painted", () => {
  const main = read(join(COVER, "main.ts"));
  // Only the person's "Show it anyway" hides it; the old 15 s give-up left a blank window.
  expect(main.match(/invoke\("cover_hide"\)/g)).toHaveLength(1);
  expect(main).toContain('words.showAnyway, () => void invoke("cover_hide")');
});

test("over the server here the cover never turns reach off: the window opens it at loopback (ADR 0256 §5)", () => {
  const main = read(join(COVER, "main.ts"));
  expect(main).not.toContain("local_server_reach");
  expect(main).not.toContain("tailnetOff");
  // Tailscale is named only for a workspace on a private network the cover can't reach.
  expect(main).toContain("isTailnet(server) ? await readNetwork()");
  const capability = JSON.parse(read(join(import.meta.dir, "../src-tauri/capabilities/cover.json"))) as {
    permissions: string[];
  };
  expect(capability.permissions).not.toContain("allow-local-server-reach");
  // It names the workspace and turns the network on: the system's Tailscale opens, the app's own signs in.
  for (const permission of ["allow-workspaces-get", "allow-tailnet-status", "allow-tailnet-sign-in"]) {
    expect(capability.permissions).toContain(permission);
  }
});

test("the cover's fake answers only while designing in a browser, never in the app", () => {
  const main = read(join(COVER, "main.ts"));
  expect(main).toContain(
    'if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("../dev/fake-cover");',
  );
});
