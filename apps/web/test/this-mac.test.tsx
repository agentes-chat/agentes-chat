import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createI18n } from "@/i18n";
import { applyDesktopDevice, type ThisDeviceHealth, type ThisMacStatus } from "@/lib/desktop";
import { createFakeApi, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/**
 * agentes for Mac (ADR 0036, ADR 0256): the site in the app's window connects this Mac in one click (the app hands over
 * the runner's code, the site confirms it), opens This Mac's settings in the app for what is granted on the Mac itself,
 * lists them in the site's settings, and tells the app its own settings list.
 */

const win = () => window as { __agentesDesktop?: unknown; __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  cleanup();
  delete win().__agentesDesktop;
  delete win().__TAURI_INTERNALS__;
  focusManager.setFocused(undefined);
});

/**
 * The app around the site: answers `this_mac` from `mac`, records every request. `layer`: an app with This Mac's
 * settings in its own layer (`settings` in `__agentesDesktop`); without it, an app from before, with Preferences.
 */
function inTheApp(mac: { status: ThisMacStatus; code: string | null; health?: ThisDeviceHealth }, layer = true) {
  const asked: Record<string, unknown>[] = [];
  win().__agentesDesktop = { version: layer ? "0.20.0" : "0.6.0", ...(layer ? { settings: 1 } : {}) };
  win().__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { request: Record<string, unknown> }) => {
      if (cmd !== "this_mac") throw new Error(`unexpected ${cmd}`);
      asked.push(args.request);
      if (args.request.kind === "status") return mac.status;
      if (args.request.kind === "connect") return { userCode: mac.code };
      if (args.request.kind === "thisMacHealth") return mac.health ?? { needs: 0, server: false };
      return {};
    },
  };
  return asked;
}

describe("Configurações → Dispositivos, in the app", () => {
  test("“Usar este Mac”: one click, the site confirms the runner's code", async () => {
    const mac = { status: { orgs: [] } as ThisMacStatus, code: "WXYZ-1234" };
    const asked = inTheApp(mac);
    const state = seedState();
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.addDevice("WXYZ-1234");
    await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Conectar um dispositivo" })));
    await settle(4);
    const card = screen().getByRole("dialog", { name: "Conectar um dispositivo" });
    // In the app, this computer connects in one click: no download.
    expect(within(card).queryByRole("link", { name: /^Baixar para/ })).toBeNull();

    // The runner picks its token up right after the site confirms.
    const connected: ThisMacStatus = { orgs: [{ orgId: ORG_ID, machineId: "m-this", connection: "online" }] };
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Usar este Mac" }));
      mac.status = connected;
    });
    await settle(8);
    // The organization's name goes along, for the app's own dialog before it pairs this computer.
    expect(asked).toContainEqual({ kind: "connect", orgId: ORG_ID, orgName: "Acme" });
    expect(state.calls.find((c) => c.method === "machines.confirmDevice")?.args.slice(0, 2)).toEqual([
      ORG_ID,
      "WXYZ-1234",
    ]);

    // This Mac is in the organization now: the button opens its Folders and tools.
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Pastas deste Mac" })));
    expect(asked).toContainEqual({ kind: "settings", section: "folders" });
  });

  test("this Mac's page: allowing folders, turning a tool or the browser on open This Mac's settings", async () => {
    const mac = { status: { orgs: [] } as ThisMacStatus, code: null };
    const asked = inTheApp(mac);
    const api = createFakeApi(seedState());
    const machines = fakeMachinesOf.get(api) as NonNullable<ReturnType<typeof fakeMachinesOf.get>>;
    const m = machines.pair({
      name: "MacBook do Walter",
      os: "darwin",
      access: { folders: [], tools: { claude: true, codex: false, commands: false } },
    });
    mac.status = { orgs: [{ orgId: ORG_ID, machineId: m.id, connection: "online" }] };
    await renderApp(`/org/${ORG_ID}/settings/computers/${m.id}`, { api });
    await settle(8);
    expect(screen().queryByText(/Liberar é no próprio computador/)).toBeNull();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Abrir Pastas e ferramentas" })));
    expect(asked).toContainEqual({ kind: "settings", section: "folders" });
    // The site only turns a tool off: one that is off says where it goes on.
    const tools = screen().getByRole("region", { name: "Ferramentas" });
    expect(tools.textContent).toContain(
      "Desligado neste Mac. Ligue em Configurações › Este Mac, em Pastas e ferramentas.",
    );
    expect(tools.textContent).not.toContain("Preferências");
    await act(async () => fireEvent.click(within(tools).getByRole("button", { name: "Abrir Ferramentas" })));
    const toTools = () => asked.filter((r) => r.kind === "settings" && r.section === "folders" && r.focus === "tools");
    expect(toTools()).toHaveLength(1);
    const elsewhere = screen()
      .getAllByRole("button", { name: "Abrir Ferramentas" })
      .find((b) => !tools.contains(b));
    await act(async () => fireEvent.click(elsewhere as HTMLElement));
    expect(toTools()).toHaveLength(2);
    // Never the old Preferences window, in an app that has the layer.
    expect(asked.some((r) => r.kind === "prefs")).toBe(false);
  });

  test("an app from before This Mac's settings: the same buttons open its Preferences on the matching tab", async () => {
    const mac = { status: { orgs: [] } as ThisMacStatus, code: null };
    const asked = inTheApp(mac, false);
    const api = createFakeApi(seedState());
    const machines = fakeMachinesOf.get(api) as NonNullable<ReturnType<typeof fakeMachinesOf.get>>;
    const m = machines.pair({
      name: "MacBook do Walter",
      os: "darwin",
      access: { folders: [], tools: { claude: true, codex: false, commands: false } },
    });
    mac.status = { orgs: [{ orgId: ORG_ID, machineId: m.id, connection: "online" }] };
    await renderApp(`/org/${ORG_ID}/settings/computers/${m.id}`, { api });
    await settle(8);
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Abrir Pastas e ferramentas" })));
    expect(asked).toContainEqual({ kind: "prefs", tab: "folders" });
    const tools = screen().getByRole("region", { name: "Ferramentas" });
    await act(async () => fireEvent.click(within(tools).getByRole("button", { name: "Abrir Ferramentas" })));
    expect(asked).toContainEqual({ kind: "prefs", tab: "tools" });
    expect(asked.some((r) => r.kind === "settings" || r.kind === "thisMacHealth" || r.kind === "settingsNav")).toBe(
      false,
    );
  });

  test("another computer's page, in the app: the usual words", async () => {
    const mac = { status: { orgs: [{ orgId: ORG_ID, machineId: "m-this", connection: "online" }] }, code: null };
    inTheApp(mac);
    const api = createFakeApi(seedState());
    const m = fakeMachinesOf.get(api)?.pair({
      name: "Servidor",
      access: { folders: [], tools: { claude: true, codex: false, commands: false } },
    });
    await renderApp(`/org/${ORG_ID}/settings/computers/${m?.id}`, { api });
    await settle(8);
    expect(screen().getByText(/Liberar é no próprio computador/)).toBeTruthy();
    expect(screen().queryByRole("button", { name: "Abrir Pastas e ferramentas" })).toBeNull();
    expect(screen().getByRole("region", { name: "Ferramentas" }).textContent).not.toContain("Desligado neste");
  });

  test("a server on this computer: the app says no, and no This Mac shows", async () => {
    const asked = inTheApp({ status: { orgs: [], agentsHere: false }, code: "WXYZ-1234" });
    const api = createFakeApi(seedState());
    await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    expect(screen().queryByRole("button", { name: "Usar este Mac" })).toBeNull();
    expect(asked.some((r) => r.kind === "connect")).toBe(false);
  });

  test("this computer's own name, on Linux, in the app's language", () => {
    const i18n = createI18n("pt-BR");
    applyDesktopDevice(i18n, "linux");
    expect(i18n.t("machines.thisMac.connect")).toBe("Usar este computador");
    expect(i18n.t("machines.thisMac.connected")).toBe(
      "Este computador está conectado. Escolha as pastas que os agentes podem usar.",
    );
    expect(i18n.t("settings.thisDevice.title")).toBe("Este computador");
    expect(i18n.t("settings.thisDevice.section.server")).toBe("Servidor neste computador");
    void i18n.changeLanguage("en");
    expect(i18n.t("machines.thisMac.connect")).toBe("Use this computer");
    expect(createI18n("en").t("machines.thisMac.connect")).toBe("Use this Mac");
    expect(createI18n("en").t("settings.thisDevice.title")).toBe("This Mac");
  });

  test("outside the app: the download, and nothing asks the Mac", async () => {
    const api = createFakeApi(seedState());
    await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    expect(screen().queryByRole("button", { name: "Usar este Mac" })).toBeNull();
  });
});

describe("Configurações › Este Mac, in the app", () => {
  const group = () => screen().queryByRole("list", { name: "Este Mac" });
  const rows = () => within(group() as HTMLElement).getAllByRole("button");

  test("the settings list ends with This Mac's sections; each opens that section in the app", async () => {
    const mac = { status: { orgs: [] } as ThisMacStatus, code: null, health: { needs: 0, server: true } };
    const asked = inTheApp(mac);
    await renderApp(`/org/${ORG_ID}/settings`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(screen().getByRole("heading", { name: "Este Mac" })).toBeTruthy();
    expect(rows().map((b) => b.textContent)).toEqual([
      "Visão geral",
      "Pastas e ferramentas",
      "Servidor neste Mac",
      "Atividade",
      "Ajustes do app",
    ]);
    // Nothing needs the person: no dot.
    expect(group()?.querySelector(".settings__needs")).toBeNull();
    await act(async () => fireEvent.click(within(group() as HTMLElement).getByRole("button", { name: "Atividade" })));
    expect(asked).toContainEqual({ kind: "settings", section: "activity" });
    await act(async () =>
      fireEvent.click(within(group() as HTMLElement).getByRole("button", { name: "Servidor neste Mac" })),
    );
    expect(asked).toContainEqual({ kind: "settings", section: "server" });
    // Rows of the app's, never a link of the site's: the page stays where it is.
    expect(within(group() as HTMLElement).queryAllByRole("link")).toEqual([]);
  });

  test("no server here: no Server on this Mac; something that needs the person: a dot on Overview, read again on focus", async () => {
    const mac = { status: { orgs: [] } as ThisMacStatus, code: null, health: { needs: 0, server: false } };
    const asked = inTheApp(mac);
    await renderApp(`/org/${ORG_ID}/settings`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(rows().map((b) => b.textContent)).toEqual([
      "Visão geral",
      "Pastas e ferramentas",
      "Atividade",
      "Ajustes do app",
    ]);
    expect(group()?.querySelector(".settings__needs")).toBeNull();
    // macOS took a permission back while the window was away: coming back reads it again.
    mac.health = { needs: 2, server: false };
    const asks = asked.filter((r) => r.kind === "thisMacHealth").length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(6);
    expect(asked.filter((r) => r.kind === "thisMacHealth").length).toBeGreaterThan(asks);
    const dot = group()?.querySelector(".settings__needs");
    expect(dot?.getAttribute("aria-label")).toBe("2 coisas precisam de você");
    // A dot, never a count in a pill.
    expect(dot?.textContent).toBe("");
    expect(dot?.closest("button")?.textContent).toBe("Visão geral");
  });

  test("an app without the layer, or the browser: no This Mac in the list, and nothing asked", async () => {
    const asked = inTheApp({ status: { orgs: [] } as ThisMacStatus, code: null }, false);
    await renderApp(`/org/${ORG_ID}/settings`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(group()).toBeNull();
    expect(asked.some((r) => r.kind === "thisMacHealth")).toBe(false);
    cleanup();
    delete win().__agentesDesktop;
    delete win().__TAURI_INTERNALS__;
    await renderApp(`/org/${ORG_ID}/settings`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(group()).toBeNull();
  });

  test("the app is told the workspace's settings list, and that it went once the workspace's pages leave", async () => {
    const asked = inTheApp({ status: { orgs: [] } as ThisMacStatus, code: null });
    await renderApp(`/org/${ORG_ID}`, { api: createFakeApi(seedState()) });
    await settle(8);
    const sent = asked.filter((r) => r.kind === "settingsNav");
    const last = sent.at(-1) as {
      org: { id: string; name: string };
      main: { id: string; label: string; icon: string; path: string }[];
      advanced: { id: string; path: string }[];
    };
    expect(last.org).toEqual({ id: ORG_ID, name: "Acme" });
    expect(last.main[0]).toEqual({
      id: "account",
      label: "Sua conta",
      icon: "person",
      path: `/org/${ORG_ID}/settings/account`,
    });
    expect(last.main.map((s) => s.label)).toContain("Workspace");
    for (const s of [...last.main, ...last.advanced])
      expect(s.path).toMatch(/^\/org\/[A-Za-z0-9_-]{1,64}\/settings(\/[a-z_]{1,32})?$/);
    // Sent when it changes, not on every render.
    await settle(6);
    expect(asked.filter((r) => r.kind === "settingsNav")).toHaveLength(sent.length);
    cleanup();
    expect(asked.filter((r) => r.kind === "settingsNav").at(-1)).toEqual({
      kind: "settingsNav",
      org: null,
      main: [],
      advanced: [],
    });
  });
});
