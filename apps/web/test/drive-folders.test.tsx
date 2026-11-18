import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import {
  DRIVE_DRAG_TYPE,
  folderAndInside,
  folderOutline,
  folderTrail,
  parseDriveDrag,
} from "@agenteschat/client/lib/drive";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("agentes.drive.view"));

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const names = () => Array.from(document.querySelectorAll(".drive-card .drive-hit")).map((b) => b.textContent);
const folderNames = () => Array.from(document.querySelectorAll(".drive-folder .drive-hit")).map((b) => b.textContent);

async function goDrive(path = "") {
  const api = createFakeApi(seedState(), { seed: true });
  const r = await renderApp(`/org/${ORG_ID}/drive${path}`, { api });
  await settle(8);
  return { ...r, api };
}

/** A folder made through "Nova pasta". */
async function newFolder(name: string) {
  await click(screen().getByRole("button", { name: "Nova pasta" }));
  const dialog = screen().getByRole("dialog");
  await type(within(dialog).getByRole("textbox", { name: "Nome" }), name);
  await click(within(dialog).getByRole("button", { name: "Criar" }));
  await settle(6);
}

/** What a drag of Drive items hands a drop. */
const carrying = (drag: { files: string[]; folders: string[] }) => ({
  dataTransfer: { types: [DRIVE_DRAG_TYPE], getData: () => JSON.stringify(drag), dropEffect: "" },
});

describe("Drive folders", () => {
  test("make a folder, move a file into it, open it, its path, back up, and an empty folder says so", async () => {
    const { api } = await goDrive();
    await newFolder("Relatórios");
    expect(folderNames()).toEqual(["Relatórios"]);
    expect(screen().getByRole("region", { name: "Pastas" })).toBeTruthy();

    // Select a file, then "Mover" in the selection bar.
    const first = names()[0] ?? "";
    await click(screen().getByRole("checkbox", { name: `Selecionar ${first}` }));
    await click(screen().getByRole("button", { name: "Mover" }));
    const dialog = screen().getByRole("dialog", { name: "Mover 1 item" });
    await click(within(dialog).getByRole("radio", { name: /Relatórios/ }));
    await click(within(dialog).getByRole("button", { name: "Mover para Relatórios" }));
    await settle(6);
    expect(names()).not.toContain(first);

    await click(screen().getByRole("button", { name: "Relatórios" }));
    await settle(6);
    expect(screen().getByRole("heading", { level: 1, name: "Relatórios" })).toBeTruthy();
    const path = screen().getByRole("navigation", { name: "Caminho da pasta" });
    expect(path.textContent).toBe("DriveRelatórios");
    expect(names()).toEqual([first]);

    // Dropped on "Drive" in the path, it goes back to the top level, and the folder is empty.
    const [file] = await api.artifacts.list(ORG_ID, { q: first });
    await act(async () => {
      const crumb = within(path).getByRole("button", { name: "Drive" });
      const drag = carrying({ files: [file?.id ?? ""], folders: [] });
      fireEvent.dragEnter(crumb, drag);
      fireEvent.dragOver(crumb, drag);
      fireEvent.drop(crumb, drag);
    });
    await settle(6);
    expect(screen().getByText("Esta pasta está vazia")).toBeTruthy();

    await click(screen().getByRole("button", { name: "Subir um nível" }));
    await settle(6);
    expect(screen().getByRole("heading", { level: 1, name: "Drive" })).toBeTruthy();
    expect(names()).toContain(first);
  });

  test("rename a folder and delete it with what's inside", async () => {
    await goDrive();
    await newFolder("Rascunhos");
    const more = screen().getByRole("button", { name: "Mais ações de Rascunhos" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Renomear" }));
    const dialog = screen().getByRole("dialog", { name: "Renomear pasta" });
    await type(within(dialog).getByRole("textbox", { name: "Nome" }), "Arquivo morto");
    await click(within(dialog).getByRole("button", { name: "Renomear" }));
    await settle(6);
    expect(folderNames()).toEqual(["Arquivo morto"]);

    const again = screen().getByRole("button", { name: "Mais ações de Arquivo morto" });
    again.focus();
    await act(async () => {
      fireEvent.keyDown(again, { key: "Enter" });
      fireEvent.keyUp(again, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Excluir pasta" }));
    const confirm = screen().getByRole("dialog", { name: "Excluir “Arquivo morto”?" });
    await click(within(confirm).getByRole("button", { name: "Excluir pasta" }));
    await settle(6);
    expect(folderNames()).toEqual([]);
  });
});

describe("folder helpers", () => {
  const f = (id: string, parentId: string | null, name = id) => ({
    id,
    name,
    parentId,
    createdBy: { type: "person" as const, id: "u" },
    createdAt: "",
    updatedAt: "",
  });
  const all = [f("a", null), f("b", "a"), f("c", "b"), f("d", null)];
  test("the path, what's inside, the outline", () => {
    expect(folderTrail(all, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(folderTrail(all, "gone")).toEqual([]);
    expect([...folderAndInside(all, "a")].sort()).toEqual(["a", "b", "c"]);
    expect(folderOutline(all).map((x) => `${x.folder.id}${x.depth}`)).toEqual(["a0", "b1", "c2", "d0"]);
    // A loop in bad data never hangs.
    expect(folderTrail([f("x", "y"), f("y", "x")], "x").length).toBeLessThanOrEqual(3);
  });
  test("a drag's data: ours, or nothing", () => {
    expect(parseDriveDrag('{"files":["1"],"folders":[]}')).toEqual({ files: ["1"], folders: [] });
    expect(parseDriveDrag("not json")).toBeNull();
    expect(parseDriveDrag('{"files":[],"folders":[]}')).toBeNull();
    expect(parseDriveDrag(null)).toBeNull();
  });
});
