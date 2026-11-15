import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const key = async (el: HTMLElement, k: string) => {
  el.focus();
  await act(async () => {
    fireEvent.keyDown(el, { key: k });
    fireEvent.keyUp(el, { key: k });
  });
  await settle(3);
};
const rows = () => [...document.querySelectorAll<HTMLElement>(".projects-table tbody tr")];
const cells = (row: HTMLElement) => [...row.querySelectorAll("td")].map((c) => c.textContent?.trim());

/** Three projects as a software house keeps them: one running, one all done, one archived. */
async function withProjects() {
  const api = createFakeApi(seedState());
  const make = (input: Parameters<typeof api.issues.createProject>[1]) => api.issues.createProject(ORG_ID, input);
  const clinic = await make({
    name: "Clínica Teo",
    color: "teal",
    description: "Agenda e lembretes de retorno dos pacientes.",
    githubRepo: "acme/clinica",
  });
  const bakery = await make({ name: "Padaria Lia", color: "amber" });
  const old = await make({ name: "Acme 2025", color: "graphite", githubRepo: "acme/antigo" });
  const tasks = await api.issues.list(ORG_ID, {});
  const put = async (number: number, patch: { projectId?: string; status?: "done" }) => {
    const task = tasks.find((i) => i.number === number);
    if (task) await api.issues.update(ORG_ID, task.id, patch);
  };
  // Two tasks in the clinic, one finished. One in the bakery, finished: nothing left open there.
  await put(131, { projectId: clinic.id });
  await put(129, { projectId: clinic.id });
  await put(129, { status: "done" });
  await put(132, { projectId: bakery.id });
  await put(132, { status: "done" });
  await api.issues.updateProject(ORG_ID, old.id, { archived: true });
  return { api, clinic, bakery, old };
}

const go = async (api = createFakeApi(seedState())) => {
  const r = await renderApp(`/org/${ORG_ID}/projects`, { api });
  await settle(8);
  return { ...r, api };
};

describe("Projetos: the projects page (ADR 0188)", () => {
  test("a row per project by name with the archived last: its tasks, the done ones and where it stands", async () => {
    const { api } = await withProjects();
    await go(api);
    expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Projetos");
    expect([...document.querySelectorAll(".projects-table thead th")].map((h) => h.textContent?.trim())).toEqual([
      "Projeto",
      "Repositório",
      // The ⓘ's words come with the column's name.
      "TarefasConta as tarefas que você pode ver. Tarefas canceladas não contam.",
      "Concluídas",
      "Status",
      "Ações",
    ]);
    const body = rows().map(cells);
    expect(body.map((r) => r[0])).toEqual([
      "Clínica TeoAgenda e lembretes de retorno dos pacientes.",
      "Padaria Lia",
      "Acme 2025",
    ]);
    // Tasks, done, status: a project with open work is active, one with every task done is done, an archived one says so.
    expect(body.map((r) => r.slice(2, 5))).toEqual([
      ["2", "1", "Ativo"],
      ["1", "1", "Concluído"],
      ["0", "0", "Arquivado"],
    ]);
    // A project with no task yet is active, not done.
    expect(rows()[2]?.hasAttribute("data-archived")).toBe(true);
  });

  test("the GitHub mark is the link to the repository, and a project with none says so", async () => {
    const { api } = await withProjects();
    await go(api);
    const link = within(rows()[0] as HTMLElement).getByRole("link", { name: "Abrir acme/clinica no GitHub" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/clinica");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("[data-mark=github]")).toBeTruthy();
    expect(cells(rows()[1] as HTMLElement)[1]).toBe("Nenhum");
    expect(within(rows()[1] as HTMLElement).queryByRole("link", { name: /GitHub/ })).toBeNull();
  });

  test("a project's name opens its board", async () => {
    const { api, clinic } = await withProjects();
    const { router } = await go(api);
    await click(within(rows()[0] as HTMLElement).getByRole("link", { name: "Abrir o quadro de Clínica Teo" }));
    await settle(8);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/issues`);
    expect((router.state.location.search as { project?: string }).project).toBe(clinic.id);
  });

  test("Editar projeto opens with the description and the repository, and saving changes the row", async () => {
    const { api } = await withProjects();
    await go(api);
    await key(within(rows()[1] as HTMLElement).getByRole("button", { name: "Opções de Padaria Lia" }), "Enter");
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Editar projeto" }));
    await settle(3);
    const dialog = screen().getByRole("dialog", { name: "Editar projeto" });
    expect((within(dialog).getByLabelText("Descrição") as HTMLTextAreaElement).value).toBe("");
    expect((within(dialog).getByRole("textbox", { name: "Repositório do GitHub" }) as HTMLInputElement).value).toBe("");
    await type(within(dialog).getByLabelText("Descrição"), "Cardápio e pedidos.");
    // The server normalizes an address into owner/name (the engine's tests); the fake keeps what it is sent.
    await type(within(dialog).getByRole("textbox", { name: "Repositório do GitHub" }), "acme/padaria");
    await click(within(dialog).getByRole("button", { name: "Salvar" }));
    await settle(8);
    const saved = (await api.issues.projects(ORG_ID)).projects.find((p) => p.name === "Padaria Lia");
    expect(saved).toMatchObject({
      description: "Cardápio e pedidos.",
      githubRepo: "acme/padaria",
    });
    expect(cells(rows()[1] as HTMLElement)[0]).toBe("Padaria LiaCardápio e pedidos.");
    expect(
      within(rows()[1] as HTMLElement)
        .getByRole("link", { name: "Abrir acme/padaria no GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/acme/padaria");
  });

  test("a workspace with no project says so and offers to create the first", async () => {
    await go();
    expect(screen().getByText("Nenhum projeto ainda")).toBeTruthy();
    await click(screen().getAllByRole("button", { name: "Novo projeto" })[0] as HTMLElement);
    await settle(3);
    expect(screen().getByRole("dialog", { name: "Novo projeto" })).toBeTruthy();
  });
});
