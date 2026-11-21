import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { ApiError, type WikiGraph, type WikiRepository, type WikiRepositoryCheck } from "@agenteschat/client";
import {
  outlineOf,
  prefixLines,
  resolveWikiLink,
  splitSection,
  toggleTask,
  wikiQuery,
  wikiSlug,
  wikiTree,
  wrapSelection,
} from "@agenteschat/client/lib/wiki";
import { readZip } from "@agenteschat/client/lib/zip";
import { HOVER_CLOSE_MS, trackInput } from "@agenteschat/ui";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { setMermaidRenderer } from "@/components/artifacts/Mermaid";
import { graphWidth, layoutGraph, neighborsOf } from "@/components/WikiGraph";
import { headingId, Markdown, parseWikiToken, wikiLinksIn } from "@/lib/markdown";
import {
  filesFromList,
  homeOf,
  parseNote,
  readVault,
  sendVaultNotes,
  type VaultFile,
  type VaultNote,
  vaultBatches,
  vaultInputs,
} from "@/lib/obsidian";
import { ADA_ID, ADMIN_ROLE_ID, createFakeApi, ENG_ID, meWithRole, ORG_ID, seedState } from "./fake-api";
import { keepWikiRepository } from "./fakes/wiki";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) =>
  act(async () =>
    fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } }),
  );

const go = async (path: string, state = seedState(), seed = true) => {
  const api = createFakeApi(state, { seed });
  const r = await renderApp(`/org/${ORG_ID}/${path}`, { api });
  await settle(8);
  return { ...r, state, api };
};

/** Opens one of the access dialog's dropdowns and picks an option (its rows mount a moment after the key). */
const pickLevel = async (d: HTMLElement, select: string, option: string) => {
  // The dialog and the last dropdown hand focus back first: a list opened before that closes on it.
  await act(() => new Promise((r) => setTimeout(r, 30)));
  const trigger = within(d).getByRole("combobox", { name: select });
  trigger.focus();
  await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
  for (let i = 0; i < 50; i++) {
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
      o.textContent?.startsWith(option),
    );
    if (row) return click(row);
    await act(() => new Promise((r) => setTimeout(r, 10)));
  }
  throw new Error(`no ${option}`);
};

describe("toggleTask", () => {
  test("checks and unchecks one task line, leaves other lines alone", () => {
    const body = "# Passos\n- [ ] Abrir\n- [x] Revisar\nTexto";
    expect(toggleTask(body, 1)).toBe("# Passos\n- [x] Abrir\n- [x] Revisar\nTexto");
    expect(toggleTask(body, 2)).toBe("# Passos\n- [ ] Abrir\n- [ ] Revisar\nTexto");
    expect(toggleTask(body, 3)).toBe(body);
    expect(toggleTask(body, 9)).toBe(body);
  });
});

describe("wiki rules", () => {
  test("links, slugs, sections, outline, tree", () => {
    expect(parseWikiToken("[[Processos/Deploy|o deploy]]")).toEqual({ title: "Processos/Deploy", label: "o deploy" });
    expect(wikiLinksIn("ver [[Deploy]] e [[Glossário#PR]] e [[Deploy]]")).toEqual(["Deploy", "Glossário#PR"]);
    expect(wikiSlug("Guia de Deploy")).toBe("guia-de-deploy");
    expect(wikiSlug("Processos/Férias")).toBe("ferias");
    expect(splitSection("Glossário#PR")).toEqual({ title: "Glossário", section: "PR" });
    const pages = [
      { slug: "deploy", title: "Deploy", folder: "Processos" },
      { slug: "glossario", title: "Glossário", folder: "" },
    ];
    expect(resolveWikiLink(pages, "glossario")?.slug).toBe("glossario");
    expect(resolveWikiLink(pages, "Processos/Deploy")?.slug).toBe("deploy");
    expect(resolveWikiLink(pages, "Glossário#PR")?.slug).toBe("glossario");
    expect(resolveWikiLink(pages, "Nada")).toBeUndefined();
    expect(outlineOf("# A\n\n## Como pedimos acesso\n\ntexto")).toEqual([
      { level: 1, text: "A", id: "h-a" },
      { level: 2, text: "Como pedimos acesso", id: "h-como-pedimos-acesso" },
    ]);
    expect(headingId("Ação rápida!")).toBe("acao-rapida");
    const tree = wikiTree([
      { title: "B", folder: "Processos/Vendas" },
      { title: "A", folder: "" },
      { title: "C", folder: "Processos" },
    ]);
    expect(tree.pages.map((p) => p.title)).toEqual(["A"]);
    expect(tree.folders[0]?.name).toBe("Processos");
    expect(tree.folders[0]?.folders[0]?.name).toBe("Vendas");
  });

  test("editor helpers: [[ query, wrap, line prefixes", () => {
    expect(wikiQuery("veja [[Dep", 10)).toEqual({ start: 5, query: "Dep" });
    expect(wikiQuery("veja [[Dep]] ok", 15)).toBeNull();
    expect(wrapSelection("oi mundo", 3, 8, "**")).toEqual({ text: "oi **mundo**", start: 5, end: 10 });
    expect(prefixLines("a\nb", 0, 3, "- ").text).toBe("- a\n- b");
  });

  test("markdown: tasks, callouts, wiki links", () => {
    const { container } = render(
      <Markdown source={"- [x] feito\n- [ ] falta\n\n> [!warning] Cuidado\n\nVer [[Deploy]]"} />,
    );
    expect(container.querySelectorAll(".md__task")).toHaveLength(2);
    expect(container.querySelector(".md__task[data-done]")?.textContent).toContain("feito");
    expect(container.querySelector(".md__callout[data-kind='warning']")?.textContent).toBe("Cuidado");
    expect(container.querySelector(".wiki-link")?.textContent).toBe("Deploy");
  });

  test("graph layout: inside the box, the same every time; neighbors both ways", () => {
    const g: WikiGraph = {
      nodes: ["a", "b", "c", "d"].map((s) => ({ slug: s, title: s, folder: "", tags: [] })),
      edges: [
        { from: "a", to: "b" },
        { from: "c", to: "a" },
      ],
    };
    const one = layoutGraph(g);
    expect(one).toEqual(layoutGraph(g));
    for (const p of one) {
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.x).toBeLessThanOrEqual(696);
      expect(p.y).toBeGreaterThanOrEqual(24);
      expect(p.y).toBeLessThanOrEqual(436);
    }
    expect([...neighborsOf(g, "a")].sort()).toEqual(["b", "c"]);
  });

  test("the full graph draws in its box's shape: a wide box gets a wide drawing, not side bands", () => {
    expect(graphWidth(1516, 680)).toBe(1248);
    expect(graphWidth(2200, 1220)).toBe(1010);
    expect(graphWidth(400, 560)).toBe(560);
    expect(graphWidth(9000, 420)).toBe(2240);
    expect(graphWidth(0, 0)).toBe(960);
  });
});

/** Waits out the dialog's pause before it checks what was typed, and the check's answer. */
const waitCheck = async () => {
  await act(() => new Promise((r) => setTimeout(r, 650)));
  await settle(4);
};

/** The wiki already kept in a repository (`fields` over an up-to-date `acme/notas`) as the page opens. */
const goKept = async (path: string, fields: Partial<WikiRepository> = {}, state = seedState()) => {
  const api = createFakeApi(state, { seed: true });
  keepWikiRepository(api.wiki, ORG_ID, fields);
  const r = await renderApp(`/org/${ORG_ID}/${path}`, { api });
  await settle(8);
  return { ...r, state, api };
};

/**
 * The wiki's "More" menu (Radix: opened with the keyboard) → "Import": where the notes come from. The menu has no
 * GitHub item of its own.
 */
const openImport = async () => {
  const more = screen().getByRole("button", { name: "Mais ações: Wiki" });
  more.focus();
  await act(async () => {
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.keyUp(more, { key: "Enter" });
  });
  await settle(2);
  const menu = screen().getByRole("menu");
  expect(within(menu).queryByRole("menuitem", { name: /GitHub/ })).toBeNull();
  await click(within(menu).getByRole("menuitem", { name: "Importar" }));
  await settle(2);
  return screen().getByRole("dialog", { name: "Importar para a wiki" });
};

/**
 * Import › GitHub, kept in sync (an administrator's first choice, and everyone's once a repository is kept): the
 * connect form, or how the kept repository is going (`name`: "Wiki no GitHub").
 */
const openKeepOnGitHub = async (name = "Manter a wiki no GitHub") => {
  const imports = await openImport();
  await click(within(imports).getByRole("button", { name: /^GitHub/ }));
  await settle(2);
  const d = screen().getByRole("dialog", { name });
  expect(within(d).getByRole("radio", { name: "Manter sincronizado" }).getAttribute("aria-checked")).toBe("true");
  return d;
};

/** The line at the column's foot, once the sync stopped: the repository's dialog. */
const openStopped = async () => {
  await click(screen().getByRole("button", { name: "Parou de atualizar com o GitHub" }));
  await settle(2);
  return screen().getByRole("dialog", { name: "Wiki no GitHub" });
};

/** The one primary button of its area. */
const isPrimary = (button: HTMLElement) => button.classList.contains("ac-btn--primary");

/** What a field says around its control: its label, and its example or its error. */
const fieldText = (control: HTMLElement) => (control.closest(".ac-field") as HTMLElement).textContent ?? "";

/** What the check answers: `acme/notas` on the branch asked, else `main`, the app writing there unless told. */
const checked = (input: { branch?: string }, fields: Partial<WikiRepositoryCheck> = {}): WikiRepositoryCheck => ({
  owner: "acme",
  repo: "notas",
  branch: input.branch ?? "main",
  defaultBranch: "main",
  path: "",
  writable: true,
  public: false,
  url: "https://github.com/acme/notas",
  ...fields,
});

describe("the wiki kept on GitHub", () => {
  test("a repository the app writes to: checked as it is typed, straight commits by default, a pull request on its branch", async () => {
    const { state } = await go("wiki/onboarding");
    const d = await openKeepOnGitHub();
    const connect = within(d).getByRole("button", { name: "Conectar" });
    // Nothing named yet: nothing to connect.
    expect(connect.hasAttribute("disabled")).toBe(true);
    await type(within(d).getByLabelText("Repositório"), "https://github.com/acme/notas/tree/main/wiki");
    await waitCheck();
    expect(d.textContent).toContain("acme/notas, branch main: o app do GitHub lê e escreve lá.");
    expect(state.calls.find((c) => c.method === "wiki.checkRepository")?.args[1]).toMatchObject({
      repository: "https://github.com/acme/notas/tree/main/wiki",
    });
    const direct = within(d).getByRole("radio", { name: /Direto na branch/ });
    expect(direct.getAttribute("aria-checked")).toBe("true");
    expect(direct.textContent).toContain("Cada mudança daqui vira um commit em main.");
    // Through a pull request: its branch is with the folder and the branch, tucked away.
    await click(within(d).getByRole("radio", { name: /Por pull request/ }));
    await click(within(d).getByText("Pasta e branch"));
    expect((within(d).getByLabelText("Branch do pull request") as HTMLInputElement).value).toBe("agentes/wiki");
    expect(d.textContent).toContain("O que muda no GitHub chega quando o GitHub avisa de um push");
    await click(connect);
    expect(state.calls.find((c) => c.method === "wiki.connectRepository")?.args[1]).toMatchObject({
      repository: "https://github.com/acme/notas/tree/main/wiki",
      commitMode: "pull_request",
      prBranch: "agentes/wiki",
    });
  });

  test("a public repository the app doesn't reach: the wiki only follows it, and the dialog says how to write there too", async () => {
    const { state, api } = await go("wiki/onboarding");
    api.wiki.checkRepository = async (_orgId, input) => {
      state.calls.push({ method: "wiki.checkRepository", args: [ORG_ID, input] });
      return checked(input, { writable: false, public: true });
    };
    const d = await openKeepOnGitHub();
    await type(within(d).getByLabelText("Repositório"), "acme/notas");
    await waitCheck();
    expect(d.textContent).toContain("acme/notas, branch main: público, então a wiki acompanha sem escrever lá.");
    expect(d.textContent).toContain("Para escrever lá também, instale o app do GitHub nesse repositório.");
    expect(within(d).getByRole("link", { name: "Abrir Conectores" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/settings/connectors`,
    );
    const direct = within(d).getByRole("radio", { name: /Direto na branch/ });
    expect(direct.hasAttribute("disabled") || direct.getAttribute("data-disabled") !== null).toBe(true);
    expect(
      within(d)
        .getByRole("radio", { name: /Só acompanhar/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(d.textContent).toContain("A wiki confere o GitHub a cada minuto");
    await click(within(d).getByRole("button", { name: "Conectar" }));
    // What it should do once the app may write there, as the note promises: a public one, through a pull request.
    expect(state.calls.find((c) => c.method === "wiki.connectRepository")?.args[1]).toMatchObject({
      repository: "acme/notas",
      commitMode: "pull_request",
      prBranch: "agentes/wiki",
    });
  });

  test("a private repository the GitHub app may only read: said as such, with the way to let it write", async () => {
    const { state, api } = await go("wiki/onboarding");
    api.wiki.checkRepository = async (_orgId, input) => {
      state.calls.push({ method: "wiki.checkRepository", args: [ORG_ID, input] });
      return checked(input, { repo: "interno", writable: false, url: "https://github.com/acme/interno" });
    };
    const d = await openKeepOnGitHub();
    await type(within(d).getByLabelText("Repositório"), "acme/interno");
    await waitCheck();
    expect(d.textContent).toContain(
      "acme/interno, branch main: o app do GitHub só pode ler, então a wiki acompanha sem escrever lá.",
    );
    expect(d.textContent).toContain(
      "Para escrever lá também, dê ao app do GitHub permissão para escrever nesse repositório.",
    );
    expect(d.textContent).not.toContain("público, então");
    expect(within(d).getByRole("link", { name: "Abrir Conectores" })).toBeTruthy();
    await click(within(d).getByRole("button", { name: "Conectar" }));
    expect(state.calls.find((c) => c.method === "wiki.connectRepository")?.args[1]).toMatchObject({
      repository: "acme/interno",
      commitMode: "direct",
    });
  });

  test("a public repository the app writes to: a pull request first, and the dialog says anyone reads what the wiki writes there", async () => {
    const { state, api } = await go("wiki/onboarding");
    api.wiki.checkRepository = async (_orgId, input) => {
      state.calls.push({ method: "wiki.checkRepository", args: [ORG_ID, input] });
      return {
        owner: "acme",
        repo: "aberto",
        branch: "main",
        defaultBranch: "main",
        path: "",
        writable: true,
        public: true,
        url: "https://github.com/acme/aberto",
      };
    };
    const d = await openKeepOnGitHub();
    await type(within(d).getByLabelText("Repositório"), "acme/aberto");
    await waitCheck();
    expect(
      within(d)
        .getByRole("radio", { name: /Por pull request/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(d.textContent).toContain(
      "acme/aberto é público: qualquer pessoa pode ler o que a wiki escreve lá, inclusive o que os agentes escrevem.",
    );
    // Only following it: nothing is written there, so nothing to say.
    await click(within(d).getByRole("radio", { name: /Só acompanhar/ }));
    expect(d.textContent).not.toContain("qualquer pessoa pode ler");
    await click(within(d).getByRole("radio", { name: /Por pull request/ }));
    await click(within(d).getByRole("button", { name: "Conectar" }));
    expect(state.calls.find((c) => c.method === "wiki.connectRepository")?.args[1]).toMatchObject({
      repository: "acme/aberto",
      commitMode: "pull_request",
    });
  });

  test("stopped because many notes left GitHub at once: the line at the column's foot, why, and a way to let their pages go to the trash", async () => {
    // Stopped before the page opens: the line at the column's foot reads it as the wiki loads.
    const { state } = await goKept("wiki/onboarding", {
      status: "error",
      errorCode: "wiki.repo_mass_removal",
      syncedAt: null,
      notes: 40,
      removalsWaiting: 30,
    });
    const d = await openStopped();
    expect(d.textContent).toContain("Muitas notas foram removidas de acme/notas de uma vez (30)");
    await click(within(d).getByRole("button", { name: "Mandar essas páginas para a lixeira" }));
    expect(state.calls.find((c) => c.method === "wiki.syncRepository")?.args[1]).toEqual({ allowRemovals: true });
  });

  test("Import › GitHub: importing once is the other choice, the link read as before; what was typed stays across the switch; back goes to the sources", async () => {
    await go("wiki/onboarding");
    const d = await openKeepOnGitHub();
    await type(within(d).getByLabelText("Repositório"), "acme/notas");
    const choice = within(d).getByRole("radio", { name: "Importar uma vez" });
    await click(choice);
    // The same dialog, its choice the same control above the body it swapped.
    const once = screen().getByRole("dialog", { name: "Importar do GitHub" });
    expect(once).toBe(d);
    expect(within(once).getByRole("radio", { name: "Importar uma vez" })).toBe(choice);
    expect(within(once).getByLabelText("Link do GitHub")).toBeTruthy();
    expect(within(once).getByRole("button", { name: "Ler as notas" })).toBeTruthy();
    await click(within(once).getByRole("radio", { name: "Manter sincronizado" }));
    expect((within(d).getByLabelText("Repositório") as HTMLInputElement).value).toBe("acme/notas");
    await click(within(d).getByRole("radio", { name: "Importar uma vez" }));
    await click(within(d).getByRole("button", { name: "Voltar" }));
    expect(screen().getByRole("dialog", { name: "Importar para a wiki" })).toBe(d);
  });

  test("a repository GitHub hides: why, under its name, the way out through Connectors, and nothing to connect", async () => {
    const { api } = await go("wiki/onboarding");
    api.wiki.checkRepository = async () => {
      throw new ApiError(400, "wiki.repo_not_installed", "not installed");
    };
    const d = await openKeepOnGitHub();
    await settle(2);
    // GitHub isn't connected in this workspace: said before anything is typed.
    expect(d.textContent).toContain("Um repositório privado precisa do app do GitHub instalado nele.");
    await type(within(d).getByLabelText("Repositório"), "acme/secreto");
    await waitCheck();
    expect(d.textContent).toContain("O app do GitHub não está instalado nesse repositório, e ele não é público.");
    expect(d.textContent).toContain("Instale o app do GitHub nesse repositório e volte para conectá-lo.");
    expect(d.textContent).not.toContain("Um repositório privado precisa");
    expect(within(d).getByRole("link", { name: "Abrir Conectores" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/settings/connectors`,
    );
    expect(within(d).getByRole("button", { name: "Conectar" }).hasAttribute("disabled")).toBe(true);
  });

  test("the repository list: searching keeps the way to name another one, and a name typed there becomes its address", async () => {
    const state = seedState();
    state.githubRepos = {
      connected: true,
      accounts: [
        {
          login: "acme",
          type: "Organization",
          repositories: [{ fullName: "acme/notas", owner: "acme", name: "notas", private: true, updatedAt: null }],
        },
      ],
      truncated: false,
    };
    await go("wiki/onboarding", state);
    const d = await openKeepOnGitHub();
    const picker = within(d).getByRole("combobox", { name: "Repositório" });
    picker.focus();
    await act(async () => {
      fireEvent.keyDown(picker, { key: "Enter" });
      fireEvent.keyUp(picker, { key: "Enter" });
    });
    await settle(2);
    const search = screen().getByRole("combobox", { name: "Buscar repositórios" });
    const list = screen().getByRole("listbox", { name: "Repositório" });
    await type(search, "planilhas");
    expect(within(list).queryByRole("option", { name: "acme/notas" })).toBeNull();
    expect(within(list).getByRole("option", { name: "Colar o endereço de outro repositório" })).toBeTruthy();
    await type(search, "acme/outro");
    await click(within(list).getByRole("option", { name: "Usar acme/outro" }));
    await settle(2);
    expect((within(d).getByLabelText("Endereço do repositório") as HTMLInputElement).value).toBe("acme/outro");
    await waitCheck();
    expect(state.calls.filter((c) => c.method === "wiki.checkRepository").at(-1)?.args[1]).toMatchObject({
      repository: "acme/outro",
    });
  });

  test("a branch the repository doesn't have: said at the Branch field when typed there, else beside the address", async () => {
    const { api } = await go("wiki/onboarding");
    api.wiki.checkRepository = async (_orgId, input) => {
      if (input.branch === "velha" || input.repository.includes("/tree/velha"))
        throw new ApiError(400, "wiki.repo_branch_missing", "missing");
      return checked(input);
    };
    const d = await openKeepOnGitHub();
    const address = within(d).getByLabelText("Repositório");
    await type(address, "acme/notas");
    await waitCheck();
    const branch = within(d).getByLabelText("Branch");
    // Left empty, it shows the branch the wiki will follow.
    expect(branch.getAttribute("placeholder")).toBe("main");
    await type(branch, "velha");
    await waitCheck();
    expect(fieldText(branch)).toContain("Essa branch não existe no repositório.");
    expect(fieldText(address)).not.toContain("Essa branch não existe");
    await type(branch, "");
    await type(address, "https://github.com/acme/notas/tree/velha");
    await waitCheck();
    expect(fieldText(address)).toContain("Essa branch não existe no repositório.");
    expect(fieldText(branch)).not.toContain("Essa branch não existe");
  });

  test("stopped: an admin reads what to do next, and Try again starts it again", async () => {
    const { state } = await goKept("wiki/onboarding", { status: "error", errorCode: "wiki.repo_owner_gone" });
    const d = await openStopped();
    expect(d.textContent).toContain(
      "Quem conectou acme/notas não é mais admin aqui. Clique em Tentar de novo para seguir em seu nome.",
    );
    const retry = within(d).getByRole("button", { name: "Tentar de novo" });
    expect(isPrimary(retry)).toBe(true);
    await click(retry);
    await settle(4);
    expect(state.calls.find((c) => c.method === "wiki.syncRepository")?.args[1]).toEqual({});
    expect(d.textContent).not.toContain("não é mais admin");
    expect(within(d).getByRole("button", { name: "Atualizar agora" })).toBeTruthy();
    // Closed, the line at the column's foot went with the stop.
    await click(within(d).getByRole("button", { name: "Fechar" }));
    await settle(2);
    expect(screen().queryByRole("button", { name: "Parou de atualizar com o GitHub" })).toBeNull();
  });

  test("stopped on a branch that's gone: changing the repository, branch or folder leads, filled in with what the wiki follows", async () => {
    const { state, api } = await goKept("wiki/onboarding", {
      status: "error",
      errorCode: "wiki.repo_branch_missing",
      branch: "velha",
      path: "wiki",
      commitMode: "pull_request",
      prBranch: "agentes/notas",
    });
    api.wiki.checkRepository = async (_orgId, input) => {
      state.calls.push({ method: "wiki.checkRepository", args: [ORG_ID, input] });
      if (input.branch === "velha") throw new ApiError(400, "wiki.repo_branch_missing", "missing");
      return checked(input);
    };
    const d = await openStopped();
    expect(d.textContent).toContain("A branch em que a wiki ficava, velha, sumiu de acme/notas. Escolha outra branch");
    const change = within(d).getByRole("button", { name: "Trocar repositório, branch ou pasta" });
    expect(isPrimary(change)).toBe(true);
    expect(isPrimary(within(d).getByRole("button", { name: "Tentar de novo" }))).toBe(false);
    await click(change);
    await settle(2);
    expect(screen().getByRole("dialog", { name: "Trocar repositório, branch ou pasta" })).toBe(d);
    expect((within(d).getByLabelText("Repositório") as HTMLInputElement).value).toBe("acme/notas");
    expect((within(d).getByLabelText("Pasta") as HTMLInputElement).value).toBe("wiki");
    expect((within(d).getByLabelText("Branch") as HTMLInputElement).value).toBe("velha");
    expect(
      within(d)
        .getByRole("radio", { name: /Por pull request/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect((within(d).getByLabelText("Branch do pull request") as HTMLInputElement).value).toBe("agentes/notas");
    expect(d.textContent).toContain("Conectar substitui o que a wiki acompanha agora.");
    await waitCheck();
    expect(fieldText(within(d).getByLabelText("Branch"))).toContain("Essa branch não existe no repositório.");
    await type(within(d).getByLabelText("Branch"), "principal");
    await waitCheck();
    await click(within(d).getByRole("button", { name: "Conectar" }));
    await settle(4);
    expect(state.calls.find((c) => c.method === "wiki.connectRepository")?.args[1]).toEqual({
      repository: "acme/notas",
      path: "wiki",
      branch: "principal",
      commitMode: "pull_request",
      prBranch: "agentes/notas",
    });
    // Back to how it is going, on the new branch.
    expect(screen().getByRole("dialog", { name: "Wiki no GitHub" })).toBe(d);
    expect(d.textContent).toContain("acme/notas · principal");
  });

  test("stopped on a pull request branch that isn't the wiki's: its field says so, and saving another name starts it again", async () => {
    const { state } = await goKept("wiki/onboarding", {
      status: "error",
      errorCode: "wiki.repo_pr_branch_taken",
      commitMode: "pull_request",
    });
    const d = await openStopped();
    expect(d.textContent).toContain("A branch do pull request, agentes/wiki, já existe em acme/notas e não é da wiki.");
    const field = within(d).getByLabelText("Branch do pull request");
    expect(fieldText(field)).toContain("Essa branch já existe no GitHub e não é da wiki. Escolha outro nome.");
    expect(isPrimary(within(d).getByRole("button", { name: "Tentar de novo" }))).toBe(false);
    await type(field, "agentes/wiki-notas");
    expect(fieldText(field)).not.toContain("Essa branch já existe");
    const save = within(d).getByRole("button", { name: "Salvar" });
    expect(isPrimary(save)).toBe(true);
    await click(save);
    await settle(4);
    expect(state.calls.find((c) => c.method === "wiki.setRepositoryWriting")?.args[1]).toEqual({
      commitMode: "pull_request",
      prBranch: "agentes/wiki-notas",
    });
    expect(document.body.textContent).toContain("Salvo");
    expect(d.textContent).not.toContain("já existe em acme/notas");
  });

  test("someone who isn't an admin: why it stopped, that an admin starts it again, and none of an admin's buttons", async () => {
    const state = seedState();
    meWithRole(state, []);
    await goKept("wiki/onboarding", { status: "error", errorCode: "wiki.repo_not_installed" }, state);
    const d = await openStopped();
    expect(d.textContent).toContain(
      "O app do GitHub não alcança mais acme/notas, e ele não é público. Um admin pode adicionar o repositório ao app no GitHub e retomar.",
    );
    expect(d.textContent).not.toContain("Tentar de novo");
    for (const name of ["Tentar de novo", "Desconectar", "Trocar repositório, branch ou pasta", "Salvar"])
      expect(within(d).queryByRole("button", { name })).toBeNull();
    expect(within(d).getByRole("button", { name: "Abrir no GitHub" })).toBeTruthy();
  });

  test("a private repository the wiki may only read: why, and only following it to choose", async () => {
    await goKept("wiki/onboarding", { writable: false });
    const d = await openKeepOnGitHub("Wiki no GitHub");
    expect(d.textContent).toContain(
      "O app do GitHub só pode ler acme/notas: a wiki acompanha o repositório, e o que muda aqui fica aqui.",
    );
    expect(
      within(d)
        .getByRole("radio", { name: /Só acompanhar/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const direct = within(d).getByRole("radio", { name: /Direto na branch/ });
    expect(direct.hasAttribute("disabled") || direct.getAttribute("data-disabled") !== null).toBe(true);
  });

  test("how it is going: the pull request open on GitHub, pages still to go there, notes that didn't become pages", async () => {
    await goKept("wiki/onboarding", {
      commitMode: "pull_request",
      pullRequest: { number: 12, url: "https://github.com/acme/notas/pull/12", state: "open" },
      pending: 3,
      held: [{ path: "notas/Enorme.md", code: "wiki.body_too_long" }],
    });
    const d = await openKeepOnGitHub("Wiki no GitHub");
    expect(within(d).getByRole("link", { name: "Pull request #12 aberto no GitHub" }).getAttribute("href")).toBe(
      "https://github.com/acme/notas/pull/12",
    );
    expect(d.textContent).toContain("3 páginas ainda vão para o GitHub.");
    expect(d.textContent).toContain("1 nota não virou página");
    expect(d.textContent).toContain("notas/Enorme.md");
    expect(d.textContent).toContain("Maior do que uma página pode ser");
  });

  test("a pull request closed without merging: said, with its link", async () => {
    await goKept("wiki/onboarding", {
      commitMode: "pull_request",
      pullRequest: { number: 12, url: "https://github.com/acme/notas/pull/12", state: "declined" },
    });
    const d = await openKeepOnGitHub("Wiki no GitHub");
    expect(
      within(d)
        .getByRole("link", { name: /O pull request #12 foi fechado sem ser aceito/ })
        .getAttribute("href"),
    ).toBe("https://github.com/acme/notas/pull/12");
  });

  test("an admin updates now, and changes how the wiki writes there", async () => {
    const { state } = await goKept("wiki/onboarding");
    const d = await openKeepOnGitHub("Wiki no GitHub");
    const update = within(d).getByRole("button", { name: "Atualizar agora" });
    expect(isPrimary(update)).toBe(true);
    await click(update);
    await settle(4);
    expect(state.calls.find((c) => c.method === "wiki.syncRepository")?.args[1]).toEqual({});
    // Updating: not again until it is done.
    expect(update.hasAttribute("disabled")).toBe(true);
    expect(within(d).queryByRole("button", { name: "Salvar" })).toBeNull();
    await click(within(d).getByRole("radio", { name: /Por pull request/ }));
    expect((within(d).getByLabelText("Branch do pull request") as HTMLInputElement).value).toBe("agentes/wiki");
    await click(within(d).getByRole("button", { name: "Salvar" }));
    await settle(4);
    expect(state.calls.find((c) => c.method === "wiki.setRepositoryWriting")?.args[1]).toEqual({
      commitMode: "pull_request",
      prBranch: "agentes/wiki",
    });
    expect(document.body.textContent).toContain("Salvo");
  });

  test("disconnecting asks first, says it is done, and leaves Import on connecting one", async () => {
    const { state } = await goKept("wiki/onboarding", {
      commitMode: "pull_request",
      pullRequest: { number: 12, url: "https://github.com/acme/notas/pull/12", state: "open" },
    });
    const d = await openKeepOnGitHub("Wiki no GitHub");
    await click(within(d).getByRole("button", { name: "Desconectar" }));
    await settle(2);
    const confirm = screen().getByRole("dialog", { name: "Desconectar acme/notas?" });
    expect(confirm.textContent).toContain("A wiki deixa de acompanhar acme/notas e fecha o pull request #12 dela lá.");
    expect(state.calls.some((c) => c.method === "wiki.disconnectRepository")).toBe(false);
    await click(within(confirm).getByRole("button", { name: "Desconectar" }));
    await settle(4);
    expect(state.calls.some((c) => c.method === "wiki.disconnectRepository")).toBe(true);
    expect(document.body.textContent).toContain("acme/notas desconectado.");
    // Still Import › GitHub, now to connect one.
    expect(screen().getByRole("dialog", { name: "Manter a wiki no GitHub" })).toBe(d);
    expect(within(d).getByRole("button", { name: "Conectar" })).toBeTruthy();
  });

  test("Import's GitHub card says how the kept repository is going", async () => {
    await goKept("wiki/onboarding", { status: "error", errorCode: "wiki.repo_empty" });
    const imports = await openImport();
    const card = within(imports).getByRole("button", { name: /^GitHub/ });
    expect(card.textContent).toContain("Parou de atualizar com acme/notas");
  });

  test("importing once the repository the wiki keeps in sync: said, and notes named like a page are skipped", async () => {
    const { api } = await goKept("wiki/onboarding");
    api.wiki.githubNotes = async () => storedZip({ "notas/Deploy.md": "# Deploy\n\nOutra versão." });
    const d = await openKeepOnGitHub("Wiki no GitHub");
    await click(within(d).getByRole("radio", { name: "Importar uma vez" }));
    await type(within(d).getByLabelText("Link do GitHub"), "https://github.com/acme/notas");
    expect(d.textContent).toContain(
      "A wiki já mantém acme/notas sincronizado: as notas dele chegam sozinhas, e importá-las uma vez cria cópias.",
    );
    expect(d.textContent).toContain("clique em “Atualizar agora” em “Manter sincronizado”");
    await click(within(d).getByRole("button", { name: "Ler as notas" }));
    await settle(10);
    await act(() => new Promise((r) => setTimeout(r, 700)));
    await settle(4);
    const review = screen().getByRole("dialog");
    expect(review.textContent).toContain("1 nota tem o nome de uma página que já existe");
    expect(within(review).getByRole("radio", { name: "Pular" }).getAttribute("aria-checked")).toBe("true");
  });

  test("a page GitHub's version replaced says so, and opens its history", async () => {
    const api = createFakeApi(seedState(), { seed: true });
    keepWikiRepository(api.wiki, ORG_ID);
    const get = api.wiki.get;
    api.wiki.get = async (orgId, slug) => ({
      ...(await get(orgId, slug)),
      repository: {
        state: "synced",
        stopped: false,
        readOnly: false,
        url: "https://github.com/acme/notas/blob/main/Deploy.md",
        replaced: 1,
      },
    });
    await renderApp(`/org/${ORG_ID}/wiki/deploy`, { api });
    await settle(8);
    await click(screen().getByRole("button", { name: "Substituída pelo GitHub" }));
    await settle(4);
    expect(screen().getByRole("dialog", { name: "Histórico de Deploy" })).toBeTruthy();
  });

  test("a page not on GitHub because the sync stopped: its mark opens why", async () => {
    const api = createFakeApi(seedState(), { seed: true });
    keepWikiRepository(api.wiki, ORG_ID, { status: "error", errorCode: "wiki.repo_empty" });
    const get = api.wiki.get;
    api.wiki.get = async (orgId, slug) => ({
      ...(await get(orgId, slug)),
      repository: { state: "pending", stopped: true, readOnly: false, url: null, replaced: null },
    });
    await renderApp(`/org/${ORG_ID}/wiki/deploy`, { api });
    await settle(8);
    await click(screen().getByRole("button", { name: "Ainda não está no GitHub" }));
    await settle(2);
    const d = screen().getByRole("dialog", { name: "Wiki no GitHub" });
    expect(d.textContent).toContain(
      "acme/notas ainda não tem nenhum arquivo. Adicione um primeiro arquivo e clique em Tentar de novo.",
    );
  });
});

describe("the wiki", () => {
  test("sidebar item; tree with folders, search and tags; a page with links, outline, backlinks and authors", async () => {
    await go("wiki/onboarding");
    const nav = screen().getByRole("navigation", { name: "Navegação do workspace" });
    expect(within(nav).getByRole("link", { name: "Wiki" }).getAttribute("data-status")).toBe("active");
    const tree = screen().getByRole("navigation", { name: "Páginas" });
    expect(tree.textContent).toContain("Processos");
    expect(within(tree).getByRole("link", { name: "Onboarding" }).getAttribute("aria-current")).toBe("page");
    expect(screen().getByRole("heading", { level: 1, name: "Onboarding" })).toBeTruthy();
    const body = document.querySelector(".wiki-page__body") as HTMLElement;
    expect(within(body).getByRole("link", { name: "Glossário" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/wiki/glossario`,
    );
    // A missing page: dashed, offers to create it.
    const missing = within(body).getByRole("button", { name: "Plano de férias" });
    expect(missing.className).toContain("wiki-link--missing");
    const outline = screen().getByRole("navigation", { name: "Nesta página" });
    expect(
      within(outline)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Acessos", "Primeira tarefa"]);
    const backlinks = screen().getByRole("region", { name: "Mencionada em" });
    expect(backlinks.textContent).toContain("Visão geral");
    expect(backlinks.textContent).toContain("Deploy");
    expect(backlinks.textContent).toContain("Leiam o [[Onboarding]] antes de segunda.");
    expect(backlinks.textContent).toContain("#131");
    // A mention in a DM says who the conversation is with, never the DM's internal name.
    expect(backlinks.textContent).toContain("Conversa com Ada");
    expect(backlinks.textContent).not.toContain("dm-7f3a");
    // One column: what is around the page comes after its text, no side column.
    expect(screen().queryByRole("complementary", { name: "Sobre a página" })).toBeNull();
    const aside = screen().getByRole("region", { name: "Sobre a página" });
    expect(aside.textContent).toContain("por Ada, a pedido de Walter");
    expect(within(aside).getByRole("region", { name: "Agentes que usam esta página" }).textContent).toContain(
      "Nenhum agente consultou ainda",
    );
    // Search filters the tree.
    await type(screen().getByRole("searchbox", { name: "Buscar páginas" }), "glos");
    expect(within(tree).queryByRole("link", { name: "Onboarding" })).toBeNull();
    expect(within(tree).getByRole("link", { name: "Glossário" })).toBeTruthy();
  });

  test("a missing [[link]] → a new page written in place, with the title → the new page", async () => {
    const { router, state } = await go("wiki/onboarding");
    await click(screen().getByRole("button", { name: "Plano de férias" }));
    await settle(4);
    expect((screen().getByLabelText("Título") as HTMLTextAreaElement).value).toBe("Plano de férias");
    await click(screen().getByRole("button", { name: "Markdown" }));
    await type(screen().getByRole("combobox", { name: "Texto de Plano de férias" }), "Quem cobre quem.");
    await click(screen().getByRole("button", { name: /^Salvar/ }));
    await settle(6);
    expect(state.calls.find((c) => c.method === "wiki.create")?.args[1]).toMatchObject({ title: "Plano de férias" });
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/wiki/plano-de-ferias`);
  });

  test("editing Markdown: [[ autocomplete in glass, ⌘S saves with the version", async () => {
    const { state } = await go("wiki/deploy");
    await click(screen().getByRole("button", { name: /^Editar/ }));
    await click(screen().getByRole("button", { name: "Markdown" }));
    const box = screen().getByRole("combobox", { name: "Texto de Deploy" }) as HTMLTextAreaElement;
    await type(box, `${box.value}\n\nVeja [[Glos`);
    const list = screen().getByRole("listbox", { name: "Páginas" });
    expect(within(list).getAllByRole("option")[0]?.textContent).toContain("Glossário");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(box.value.endsWith("Veja [[Glossário]]")).toBe(true);
    await act(async () => fireEvent.keyDown(box, { key: "s", metaKey: true }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.update");
    expect(call?.args[1]).toBe("deploy");
    expect(call?.args[2]).toMatchObject({ baseVersion: 1 });
    expect(document.body.textContent).toContain("Página salva.");
  });

  test("one column: the page's actions on its bar, who sees it under the title", async () => {
    await go("wiki/deploy");
    const bar = document.querySelector(".wiki-top") as HTMLElement;
    expect(within(bar).getByRole("button", { name: /^Editar/ })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Mais ações" })).toBeTruthy();
    expect(screen().getByRole("button", { name: "Quem vê: Todo o workspace" })).toBeTruthy();
    expect(screen().getByRole("region", { name: "Sobre a página" })).toBeTruthy();
  });

  test("moving a page to the trash says where it goes and for how long; the Lixeira brings it back", async () => {
    await go("wiki/deploy");
    const more = screen().getByRole("button", { name: "Mais ações" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Mover para a lixeira" }));
    const dialog = screen().getByRole("dialog", { name: "Mover Deploy para a lixeira?" });
    expect(dialog.textContent).toContain("Vai para a Lixeira da wiki por 30 dias, e dá para restaurar de lá.");
    await click(within(dialog).getByRole("button", { name: "Mover para a lixeira" }));
    await settle(6);
    await click(screen().getByRole("button", { name: /^Lixeira/ }));
    await settle(6);
    expect(document.body.textContent).toContain("Páginas apagadas ficam aqui por 30 dias e depois somem.");
    const row = screen().getByText("Deploy").closest("li") as HTMLElement;
    await click(within(row).getByRole("button", { name: "Restaurar" }));
    await settle(6);
    expect(document.body.textContent).toContain("1 página restaurada.");
    expect(document.body.textContent).toContain("A Lixeira está vazia.");
  });

  test("choosing pages: the confirmation says how many, and they go to the trash together", async () => {
    const { state } = await go("wiki");
    await click(screen().getByRole("button", { name: "Selecionar" }));
    const boxes = screen().getAllByRole("checkbox");
    await click(boxes[0] as HTMLElement);
    await click(boxes[1] as HTMLElement);
    await click(screen().getByRole("button", { name: "Apagar" }));
    const dialog = screen().getByRole("dialog", { name: "Apagar 2 páginas?" });
    await click(within(dialog).getByRole("button", { name: "Mover 2 páginas para a Lixeira" }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.removeMany");
    expect(call?.args[1]).toEqual({ ids: [expect.any(String), expect.any(String)] });
    expect(document.body.textContent).toContain("2 páginas foram para a Lixeira.");
  });

  test("the visual editor: the page edits as it reads; a changed paragraph saves, the rest as written", async () => {
    const { state } = await go("wiki/onboarding");
    await click(screen().getByRole("button", { name: /^Editar/ }));
    const box = screen().getByRole("textbox", { name: "Texto de Onboarding" });
    // The title shows above it: the text's own "# Onboarding" stays out of the editor.
    expect(box.textContent?.startsWith("Passos da primeira semana")).toBe(true);
    expect(within(box).getByText("Glossário").className).toContain("wiki-link");
    (box.lastElementChild as HTMLElement).textContent = "Uma issue pequena, com par.";
    await act(async () => fireEvent.input(box));
    await click(screen().getByRole("button", { name: /^Salvar/ }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.update");
    expect(call?.args[2]).toMatchObject({
      body: "# Onboarding\n\nPassos da primeira semana. Termos em [[Glossário]]; o deploy em [[Deploy]] e o [[Plano de férias]].\n\n## Acessos\n\nPeça ao admin.\n\n## Primeira tarefa\n\nUma issue pequena, com par.",
      baseVersion: 1,
    });
  });

  test("version conflict: shows the difference and keeps mine on purpose", async () => {
    const { state, api } = await go("wiki/deploy");
    await click(screen().getByRole("button", { name: /^Editar/ }));
    await click(screen().getByRole("button", { name: "Markdown" }));
    const box = screen().getByRole("combobox", { name: "Texto de Deploy" }) as HTMLTextAreaElement;
    await type(box, "# Deploy\n\nMinha versão.");
    // Someone else saves first.
    await act(async () => {
      await api.wiki.update(ORG_ID, "deploy", { body: "# Deploy\n\nA versão do João.", baseVersion: 1 });
    });
    await click(screen().getByRole("button", { name: /^Salvar/ }));
    await settle(8);
    const dialog = screen().getByRole("dialog", { name: "Alguém editou enquanto você escrevia" });
    expect(dialog.textContent).toContain("A versão do João.");
    expect(dialog.textContent).toContain("Minha versão.");
    await click(within(dialog).getByRole("button", { name: "Manter a minha" }));
    await settle(6);
    const saves = state.calls.filter((c) => c.method === "wiki.update").map((c) => c.args[2]);
    expect(saves.at(-1)).toMatchObject({ body: "# Deploy\n\nMinha versão.", baseVersion: 2 });
  });

  test("Quem vê: limit a page to a role; the line under the title says who sees it", async () => {
    const { state } = await go("wiki/deploy");
    const more = screen().getByRole("button", { name: "Mais ações" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Acesso" }));
    const dialog = screen().getByRole("dialog", { name: "Acesso a Deploy" });
    await pickLevel(dialog, "O que Todos do workspace pode fazer", "Sem acesso");
    await pickLevel(dialog, "Adicionar pessoa, cargo ou agente", "Admin");
    await click(within(dialog).getByRole("button", { name: "Salvar" }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.audience");
    expect(call?.args.slice(1)).toEqual([
      "deploy",
      { audience: { roleIds: [ADMIN_ROLE_ID], userIds: [] }, agentIds: null, editors: null, agentEditorIds: null },
    ]);
    // The line under the title says who sees it now.
    expect(screen().getByRole("button", { name: /^Quem vê: Admin/ })).toBeTruthy();
  });

  test("Quem vê: everyone views and one role edits; agents get their own list", async () => {
    const { state } = await go("wiki/deploy");
    const more = screen().getByRole("button", { name: "Mais ações" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Acesso" }));
    const dialog = screen().getByRole("dialog", { name: "Acesso a Deploy" });
    await pickLevel(dialog, "O que Todos do workspace pode fazer", "Ver");
    await pickLevel(dialog, "Adicionar pessoa, cargo ou agente", "Admin");
    await pickLevel(dialog, "O que Todos os agentes pode fazer", "Sem acesso");
    await click(within(dialog).getByRole("button", { name: "Salvar" }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.audience");
    expect(call?.args.slice(1)).toEqual([
      "deploy",
      { audience: null, agentIds: [], editors: { roleIds: [ADMIN_ROLE_ID], userIds: [] }, agentEditorIds: null },
    ]);
  });

  test("Acesso: with everyone editing, adding a role is what limits the page", async () => {
    const { state } = await go("wiki/deploy");
    const more = screen().getByRole("button", { name: "Mais ações" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Acesso" }));
    const dialog = screen().getByRole("dialog", { name: "Acesso a Deploy" });
    await pickLevel(dialog, "Adicionar pessoa, cargo ou agente", "Admin");
    expect(within(dialog).getByRole("combobox", { name: "O que Todos do workspace pode fazer" }).textContent).toContain(
      "Sem acesso",
    );
    await click(within(dialog).getByRole("button", { name: "Salvar" }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.audience");
    expect(call?.args.slice(1)).toEqual([
      "deploy",
      { audience: { roleIds: [ADMIN_ROLE_ID], userIds: [] }, agentIds: null, editors: null, agentEditorIds: null },
    ]);
  });

  test("a page outside your audience: a plain no access", async () => {
    const api = createFakeApi(seedState(), { seed: true });
    api.wiki.get = async () => {
      throw new ApiError(403, "wiki.no_access", "You don't have access to this page");
    };
    await renderApp(`/org/${ORG_ID}/wiki/deploy`, { api });
    await settle(8);
    expect(document.body.textContent).toContain("Você não tem acesso a esta página");
  });

  test("history with a diff", async () => {
    const { api } = await go("wiki/deploy");
    await act(async () => {
      await api.wiki.update(ORG_ID, "deploy", { body: "# Deploy\n\nSó de segunda a quarta.", baseVersion: 1 });
    });
    await click(screen().getByRole("button", { name: /^editou/ }));
    await settle(4);
    const dialog = screen().getByRole("dialog", { name: "Histórico de Deploy" });
    await click(within(dialog).getByRole("button", { name: /v2/ }));
    await settle(4);
    const diff = within(dialog).getByRole("group", { name: "O que mudou na v2" });
    expect(diff.querySelector(".ac-diff__line--add")?.textContent).toContain("Só de segunda a quarta.");
  });

  test("empty wiki: a friendly start with the suggested structure", async () => {
    const { state, router } = await go("wiki", seedState(), false);
    expect(document.body.textContent).toContain("Guarde o que o time precisa saber");
    expect(screen().getByRole("list", { name: "Estrutura sugerida" }).textContent).toContain("Glossário");
    await click(screen().getByRole("button", { name: "Usar a estrutura sugerida" }));
    await settle(10);
    expect(
      state.calls.filter((c) => c.method === "wiki.create").map((c) => (c.args[1] as { title: string }).title),
    ).toEqual(["Visão geral", "Como trabalhamos", "Glossário"]);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/wiki/visao-geral`);
  });

  test("Grafo: nodes are links; hover lights the neighbors", async () => {
    await go("wiki");
    await click(screen().getByRole("button", { name: /^Grafo/ }));
    await settle(4);
    const graph = screen().getByRole("region", { name: "Grafo" });
    const node = within(graph).getByRole("link", { name: "Onboarding" });
    await act(async () => fireEvent.pointerEnter(node));
    expect(within(graph).getByRole("link", { name: "Glossário" }).hasAttribute("data-lit")).toBe(true);
    expect(within(graph).getByRole("link", { name: "Onboarding" }).hasAttribute("data-lit")).toBe(true);
  });

  test("a link's hover card shows a page's ```mermaid as code: it has only the page's first lines", async () => {
    const asked: string[] = [];
    setMermaidRenderer(async (_id, source) => {
      asked.push(source);
      return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    });
    try {
      const api = createFakeApi(seedState());
      const glossary = await api.wiki.get(ORG_ID, "glossario");
      await api.wiki.update(ORG_ID, "glossario", {
        body: "```mermaid\nflowchart LR\n  PR --> Review\n  Review --> Merge\n  Merge --> Deploy\n```",
        baseVersion: glossary.version,
      });
      await renderApp(`/org/${ORG_ID}/wiki/onboarding`, { api });
      await settle(8);
      const body = document.querySelector(".wiki-page__body") as HTMLElement;
      const link = within(body).getByRole("link", { name: "Glossário" });
      await act(async () => fireEvent.pointerEnter(link, { pointerType: "mouse" }));
      await settle(4);
      const card = document.querySelector(".wiki-preview") as HTMLElement;
      expect(card.querySelector(".code-card__code")?.textContent).toBe(
        "flowchart LR\n  PR --> Review\n  Review --> Merge",
      );
      expect(card.querySelector("img")).toBeNull();
      expect(asked).toEqual([]);
    } finally {
      setMermaidRenderer(null);
    }
  });
});

describe("links everywhere", () => {
  test("chat: [[Página]] is a wiki chip; the composer autocompletes [[", async () => {
    const state = seedState();
    state.messages.push({
      id: "m-wiki",
      channelId: ENG_ID,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: "Está no [[Onboarding]].",
      mentionedAgentIds: [],
      agentRunId: null,
      createdAt: new Date().toISOString(),
    });
    await go(`c/${ENG_ID}`, state);
    const row = screen()
      .getAllByRole("article")
      .find((a) => a.textContent?.includes("Está no")) as HTMLElement;
    expect(within(row).getByRole("link", { name: "Onboarding" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/wiki/onboarding`,
    );
    const box = screen().getByRole("combobox", { name: /Mensagem para/ }) as HTMLTextAreaElement;
    await type(box, "leia [[Onb");
    const list = screen().getByRole("listbox", { name: "Páginas" });
    expect(within(list).getAllByRole("option")[0]?.textContent).toContain("Onboarding");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(box.value).toBe("leia [[Onboarding]] ");
    // Esc closes the list and leaves the text.
    await type(box, "leia [[Onb");
    expect(screen().getByRole("listbox", { name: "Páginas" })).toBeTruthy();
    await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
    expect(screen().queryByRole("listbox", { name: "Páginas" })).toBeNull();
    expect(box.value).toBe("leia [[Onb");
  });

  test("a [[link]]'s preview, from the mouse or the keys, leaves the focus where it was", async () => {
    const state = seedState();
    state.messages.push({
      id: "m-wiki",
      channelId: ENG_ID,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: "Está no [[Onboarding]].",
      mentionedAgentIds: [],
      agentRunId: null,
      createdAt: new Date().toISOString(),
    });
    await go(`c/${ENG_ID}`, state);
    const box = screen().getByRole("combobox", { name: /Mensagem para/ });
    box.focus();
    const row = screen()
      .getAllByRole("article")
      .find((a) => a.textContent?.includes("Está no")) as HTMLElement;
    const link = within(row).getByRole("link", { name: "Onboarding" });
    const preview = () => screen().queryByRole("dialog", { name: /Onboarding/ });
    await act(async () => fireEvent.pointerEnter(link, { pointerType: "mouse" }));
    await settle(2);
    expect(preview()).not.toBeNull();
    expect(document.activeElement === box).toBe(true);
    await act(async () => fireEvent.pointerLeave(link, { pointerType: "mouse" }));
    await settle(2);
    // A moment to come back before it closes.
    expect(preview()).not.toBeNull();
    await act(() => new Promise((r) => setTimeout(r, HOVER_CLOSE_MS + 20)));
    expect(preview()).toBeNull();
    expect(document.activeElement === box).toBe(true);
    // Focus a script hands back (a panel closing) opens nothing; the keys' does.
    trackInput();
    // Other test files in the same process may have pressed keys: start from a press, as a page load with the mouse would.
    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    await act(async () => link.focus());
    await settle(2);
    expect(preview()).toBeNull();
    await act(async () => box.focus());
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      link.focus();
      fireEvent.keyUp(document.body, { key: "Tab" });
    });
    await settle(2);
    expect(preview()).not.toBeNull();
    expect(document.activeElement === link).toBe(true);
    await act(async () => fireEvent.pointerDown(document.body));
  });

  test("Salvar na wiki from an agent's message appends it with the source", async () => {
    const state = seedState();
    await go(`c/${ENG_ID}`, state);
    // The "…" of Ada's reply (in the agent action bar).
    const bar = screen().getByRole("toolbar", { name: "Ações da mensagem de Ada" });
    const more = within(bar).getByRole("button", { name: "Mais ações da mensagem" });
    more.focus();
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
      fireEvent.keyUp(more, { key: "Enter" });
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    await click(within(screen().getByRole("menu")).getByRole("menuitem", { name: "Salvar na wiki" }));
    const dialog = screen().getByRole("dialog", { name: "Salvar na wiki" });
    await click(within(dialog).getByRole("button", { name: /Glossário/ }));
    await settle(6);
    const call = state.calls.find((c) => c.method === "wiki.append");
    expect(call?.args[1]).toBe("glossario");
    expect(call?.args[2]).toMatchObject({ source: { kind: "message", channelId: ENG_ID } });
    expect(call?.args[2]).toMatchObject({ text: expect.stringContaining("de uma mensagem em #eng") });
  });

  test("⌘K lists wiki pages and Nova página", async () => {
    await go("issues");
    await act(async () => fireEvent.keyDown(window, { key: "k", metaKey: true }));
    await settle(4);
    await type(screen().getByRole("combobox", { name: "Ir para, ou pedir a um agente" }), "glossário");
    const list = screen().getByRole("listbox", { name: "Resultados" });
    expect(within(list).getAllByRole("option")[0]?.textContent).toContain("Glossário");
  });
});

/** A tiny .zip with stored (uncompressed) entries: enough for the reader (it doesn't check CRCs). */
function storedZip(files: Record<string, string>) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 255, (v >> 8) & 255];
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name);
    const d = enc.encode(text);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(d.length),
      ...u32(d.length),
      ...u16(n.length),
      ...u16(0),
    ]);
    parts.push(local, n, d);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0x800),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(d.length),
        ...u32(d.length),
        ...u16(n.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
      ]),
      n,
    );
    offset += local.length + n.length + d.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const count = Object.keys(files).length;
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(size),
    ...u32(offset),
    ...u16(0),
  ]);
  return new Blob([...parts, ...central, end] as BlobPart[]);
}

const vaultFiles = (files: Record<string, string>): VaultFile[] =>
  Object.entries(files).map(([path, text]) => ({
    path,
    size: text.length,
    text: async () => text,
    blob: async () => new Blob([text]),
  }));

describe("Obsidian vaults", () => {
  test("zip: names and contents of stored entries", async () => {
    const entries = await readZip(storedZip({ "Vault/Início.md": "# Oi", "Vault/sub/": "" }));
    expect(entries.map((e) => e.name)).toEqual(["Vault/Início.md"]);
    expect(new TextDecoder().decode(await entries[0]?.read())).toBe("# Oi");
    await expect(readZip(new Blob(["não é zip"]))).rejects.toThrow();
  });

  test("a note: frontmatter tags and aliases, inline tags, links and embeds (code skipped)", () => {
    const n = parseNote(
      "Clientes/Mercado Bom.md",
      "---\ntags: [cliente, Varejo]\naliases:\n  - MB\n---\nVer [[Início]] e [[Clientes/Casa Verde|a Casa]] #vip\n![[foto.png]]\n`[[não]]`",
    );
    expect(n).toMatchObject({
      title: "Mercado Bom",
      folder: "Clientes",
      tags: ["cliente", "varejo", "vip"],
      aliases: ["MB"],
      links: ["Início", "Clientes/Casa Verde"],
      embeds: ["foto.png"],
    });
    expect(n.body.startsWith("Ver")).toBe(true);
  });

  test("reading a vault: the vault's folder is dropped, .obsidian left out, broken links and conflicts found", async () => {
    const report = await readVault(
      vaultFiles({
        "Acme/Início.md": "Veja [[Glossário]], [[Nada]] e ![[foto.png]].\n> [!tip] Dica\n> ok",
        "Acme/Glossário.md": "# Glossário",
        "Acme/Clientes/Bom.md": "```dataview\nLIST\n```",
        "Acme/anexos/foto.png": "png",
        "Acme/.obsidian/app.json": "{}",
        "Acme/Mapa.canvas": "{}",
      }),
      { existing: [{ title: "Glossário" }] },
    );
    expect(report).toMatchObject({
      name: "Acme",
      folders: [
        { name: "Clientes", count: 1 },
        { name: "", count: 2 },
      ],
      broken: ["Nada"],
      conflicts: ["Glossário"],
      embeddedCount: 1,
      dataview: 1,
      callouts: 1,
      canvases: ["Mapa.canvas"],
      skipped: { config: 1, trash: 0, other: 0 },
    });
    await expect(readVault(vaultFiles({ "a.txt": "x" }))).rejects.toThrow();
  });

  test("loose .md files and a .zip both read", async () => {
    const md = await filesFromList([new File(["# A"], "A.md")]);
    expect(md.map((f) => f.path)).toEqual(["A.md"]);
    const zipped = await filesFromList([new File([storedZip({ "V/A.md": "x" })], "vault.zip")]);
    expect(zipped.map((f) => f.path)).toEqual(["V/A.md"]);
    expect(await zipped[0]?.text()).toBe("x");
  });

  test("sending: limits cut here, a note too long left out, batches by count and size", () => {
    const note = (title: string, body: string, extra: Partial<VaultNote> = {}): VaultNote => ({
      path: `${title}.md`,
      title,
      folder: "",
      tags: [],
      aliases: [],
      links: [],
      embeds: [],
      body,
      dataview: 0,
      callouts: 0,
      ...extra,
    });
    const { inputs, tooLong } = vaultInputs(
      [note("Tags", "x", { tags: ["t".repeat(120)], aliases: ["a".repeat(400)] }), note("Enorme", "x".repeat(200_001))],
      () => ({ ["n".repeat(400)]: "id", "ok.png": "id2" }),
    );
    expect(tooLong).toEqual(["Enorme"]);
    expect(inputs[0]?.tags?.[0]).toHaveLength(80);
    expect(inputs[0]?.aliases?.[0]).toHaveLength(300);
    expect(inputs[0]?.attachments).toEqual({ "ok.png": "id2" });
    const many = Array.from({ length: 450 }, (_, i) => ({ title: `N${i}`, body: "x" }));
    expect(vaultBatches(many).map((b) => b.length)).toEqual([200, 200, 50]);
    const heavy = Array.from({ length: 5 }, (_, i) => ({ title: `H${i}`, body: "x".repeat(3_000_000) }));
    expect(vaultBatches(heavy).map((b) => b.length)).toEqual([2, 2, 1]);
  });

  test("sending: a failed batch is tried again; one that keeps failing comes back to retry, the rest still go", async () => {
    const calls: number[] = [];
    let n = 0;
    const api = {
      wiki: {
        import: async (_org: string, input: { notes: { title: string }[]; importId?: string }) => {
          n++;
          calls.push(input.notes.length);
          expect(input.importId).toBe("imp");
          // The first batch fails once, then goes; the second always fails.
          if (n === 1 || input.notes[0]?.title === "N200") throw new ApiError(503, "unavailable", "down");
          return { created: input.notes.map((x) => ({ title: x.title })), skipped: [], failed: [] };
        },
      },
    } as unknown as Parameters<typeof sendVaultNotes>[0];
    const notes = Array.from({ length: 347 }, (_, i) => ({ title: `N${i}`, body: "x" }));
    const r = await sendVaultNotes(api, ORG_ID, { name: "V", onConflict: "keep_both", importId: "imp", notes });
    expect(r.created).toHaveLength(200);
    expect(r.retry).toHaveLength(147);
    expect(r.failures.filter((f) => f.reason === "batch")).toHaveLength(147);
    expect(calls).toEqual([200, 200, 147, 147, 147]);
    // Stopped: nothing more is sent, the rest waits for a retry.
    const stopped = await sendVaultNotes(
      api,
      ORG_ID,
      { name: "V", onConflict: "skip", importId: "imp", notes },
      undefined,
      () => true,
    );
    expect(stopped.retry).toHaveLength(347);
    expect(stopped.failures.every((f) => f.reason === "stopped")).toBe(true);
  }, 15_000);

  test("homeOf: the vault's home note, else the first", () => {
    const p = (title: string) => ({
      id: title,
      slug: title,
      title,
      folder: "",
      tags: [],
      updatedAt: "",
      updatedBy: { type: "person" as const, id: "u" },
    });
    expect(homeOf([p("Glossário"), p("Início")])?.title).toBe("Início");
    expect(homeOf([p("Glossário")])?.title).toBe("Glossário");
  });

  test("markdown: callout title and body; embeds go to the renderer", () => {
    const { container } = render(
      <Markdown
        source={"> [!warning] Atenção\n> Só às terças.\n\n![[foto.png]]\n\nTexto com ![[doc.pdf]] no meio."}
        embed={(target, key, block) => (
          <span key={key} className="emb" data-block={block || undefined}>
            {target}
          </span>
        )}
      />,
    );
    const callout = container.querySelector(".md__callout[data-kind='warning']");
    expect(callout?.querySelector(".md__callout-title")?.textContent).toBe("Atenção");
    expect(callout?.querySelector(".md__callout-body")?.textContent).toBe("Só às terças.");
    expect([...container.querySelectorAll(".emb")].map((e) => [e.textContent, e.hasAttribute("data-block")])).toEqual([
      ["foto.png", true],
      ["doc.pdf", false],
    ]);
    expect(container.textContent).not.toContain("!");
  });

  test("import: pick .md files → review → import sends the notes; done opens the home note", async () => {
    const { state, router } = await go("wiki");
    // "Import" is in the header; the side column keeps it in the "…" beside "New page", no button at its foot.
    expect(document.querySelector(".wiki-nav .wiki-import-btn")).toBeNull();
    expect(
      within(document.querySelector(".wiki-nav__head") as HTMLElement).getByRole("button", {
        name: "Mais ações: Wiki",
      }),
    ).toBeTruthy();
    const [open] = screen().getAllByRole("button", { name: /^Importar$/ });
    await click(open as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Importar para a wiki" });
    await click(within(dialog).getByRole("button", { name: "Obsidian" }));
    const input = within(dialog).getByLabelText("Escolher .zip ou .md") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [
            new File(["Veja [[Notas]].\n#mapa"], "Início.md"),
            new File(["---\naliases: [N]\n---\nVolta ao [[Início]]"], "Notas.md"),
          ],
        },
      });
    });
    await settle(10);
    await act(() => new Promise((r) => setTimeout(r, 700)));
    await settle(4);
    const review = screen().getByRole("dialog");
    expect(review.textContent).toContain("2 de 2");
    expect(review.textContent).toContain("1 tag do frontmatter e do texto");
    await click(within(review).getByRole("button", { name: "Importar 2 notas" }));
    await settle(10);
    const call = state.calls.find((c) => c.method === "wiki.import");
    expect(call?.args[1]).toMatchObject({
      source: { type: "obsidian" },
      onConflict: "keep_both",
      notes: [
        { title: "Início", tags: ["mapa"] },
        { title: "Notas", aliases: ["N"] },
      ],
    });
    expect(document.body.textContent).toContain("2 páginas na wiki");
    await click(screen().getByRole("button", { name: "Abrir Início" }));
    await settle(6);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/wiki/inicio`);
  });
});

describe("the wiki's header", () => {
  test("one subtitle line, then one link to how the wiki works", async () => {
    await go("wiki");
    const head = document.querySelector(".ac-pagehead") as HTMLElement;
    expect(head.querySelector(".ac-pagehead__meta")?.textContent).toBe(
      "O que a empresa sabe, em páginas ligadas. Como a wiki funciona",
    );
    const how = within(head).getByRole("link", { name: "Como a wiki funciona" });
    expect(how.getAttribute("href")).toBe("https://agentes.chat/pt/docs/wiki");
    expect(how.getAttribute("target")).toBe("_blank");
    expect(how.getAttribute("rel")).toBe("noopener noreferrer");
    expect(how.className).toBe("ac-link ac-link--muted");
  });
});
