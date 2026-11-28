import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readInstance } from "@agenteschat/client/lib/server";
import { networkFix, networkWords, privateTitle } from "../src/cover/network";
import { versionProblem } from "../src/control/server";
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

describe("a workspace on a private network this computer can't reach (ADR 0265)", () => {
  test("the system's Tailscale only (ADR 0265 §4): its Mac app, its download page, Windows' icon by the clock", () => {
    expect(networkFix("mac", { state: "off", app: true })).toEqual({ act: "openApp" });
    // Not read yet: its app.
    expect(networkFix("mac", null)).toEqual({ act: "openApp" });
    // Only the command-line tool: nothing to open from here.
    expect(networkFix("mac", { state: "off", app: false })).toEqual({ act: "elsewhere" });
    expect(networkFix("windows", { state: "off", app: false })).toEqual({ act: "tray" });
    expect(networkFix("linux", { state: "off", app: false })).toEqual({ act: "elsewhere" });
    expect(networkFix("windows", null)).toEqual({ act: "tray" });
    expect(networkFix("linux", null)).toEqual({ act: "elsewhere" });
    for (const platform of ["mac", "windows", "linux"] as const) {
      expect(networkFix(platform, { state: "missing" })).toEqual({ act: "download" });
      // Tailscale on: the network isn't why, the server itself doesn't answer.
      expect(networkFix(platform, { state: "on", device: "ana-mac.tail1234.ts.net" })).toBeNull();
    }
  });

  test("its words: Open Tailscale or Download Tailscale where the cover can, the way to it where it can't", () => {
    expect(networkWords({ act: "openApp" })).toEqual({ line: "privateLine", button: "openTailscale" });
    expect(networkWords({ act: "download" })).toEqual({ line: "privateMissing", button: "getTailscale" });
    expect(networkWords({ act: "tray" })).toEqual({ line: "privateTray", button: null });
    expect(networkWords({ act: "elsewhere" })).toEqual({ line: "privateElsewhere", button: null });
    expect(privateTitle([{ name: "Acme" }])).toEqual({ key: "privateTitle", org: "Acme" });
    expect(privateTitle([{ name: "Acme" }, { name: "Horizonte" }])).toEqual({ key: "privateTitleAny" });
    expect(privateTitle(null)).toEqual({ key: "privateTitleAny" });
    for (const { cover } of [desktopEn, desktopPtBR]) {
      expect(cover.privateTitle).toContain("{{org}}");
      for (const words of [
        cover.privateLine,
        cover.privateMissing,
        cover.privateTray,
        cover.privateElsewhere,
        cover.useOther,
        cover.openTailscale,
        cover.getTailscale,
      ]) {
        expect(words).toBeTruthy();
        expect(words).not.toMatch(/sudo|terminal|tailnet/i);
      }
    }
    expect(desktopEn.cover.getTailscale).toBe("Download Tailscale");
    expect(desktopPtBR.cover.getTailscale).toBe("Baixar o Tailscale");
    expect(desktopPtBR.cover.openTailscale).toBe("Abrir o Tailscale");
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

test("over the server here the cover never turns reach off: the window opens it at loopback (ADR 0265 §5)", () => {
  const main = read(join(COVER, "main.ts"));
  expect(main).not.toContain("local_server_reach");
  expect(main).not.toContain("tailnetOff");
  // Tailscale is named only for a workspace on a private network the cover can't reach.
  expect(main).toContain("isTailnet(server) ? await readNetwork()");
  const capability = JSON.parse(read(join(import.meta.dir, "../src-tauri/capabilities/cover.json"))) as {
    permissions: string[];
  };
  expect(capability.permissions).not.toContain("allow-local-server-reach");
  // It names the workspace and turns the network on through the system's Tailscale: the app carries none of its own.
  for (const permission of ["allow-workspaces-get", "allow-tailscale-status", "allow-tailscale-open"]) {
    expect(capability.permissions).toContain(permission);
  }
  for (const permission of ["allow-tailnet-status", "allow-tailnet-sign-in"]) {
    expect(capability.permissions).not.toContain(permission);
  }
  expect(main).not.toContain("tailnet_status");
  expect(main).not.toContain("tailnet_sign_in");
});

test("the cover's fake answers only while designing in a browser, never in the app", () => {
  const main = read(join(COVER, "main.ts"));
  expect(main).toContain(
    'if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("../dev/fake-cover");',
  );
});

test("each time a saved server opens, the cover asks its app API again and stays over one this app can't use", () => {
  const instance = (api: number, minApi: number) =>
    readInstance("https://chat.example.com", { name: "agentes.chat", version: "1.0.0", api, minApi });
  expect(versionProblem(instance(2, 2))).toBe("app-too-old");
  expect(versionProblem(instance(0, 0))).toBe("server-too-old");
  expect(versionProblem(instance(1, 1))).toBeNull();
  // Out of reach is the cover's own line, not this one.
  expect(versionProblem({ ok: false, server: "https://chat.example.com", problem: "unreachable" })).toBeNull();
  expect(versionProblem(null)).toBeNull();
  const main = read(join(COVER, "main.ts"));
  const shown = /function shown\(\) \{[\s\S]*?\n\}/.exec(main)?.[0] ?? "";
  expect(shown).toContain("checkVersion()");
  expect(main).toContain('invoke("cover_hold")');
  const rust = read(join(import.meta.dir, "../src-tauri/src/cover.rs"));
  // The site's paint doesn't lift a held cover.
  expect(rust).toContain("if !shown.covering || shown.held {");
});
