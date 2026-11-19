import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { IssueDependencies } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());
const click = (el: Element) => act(async () => fireEvent.click(el));

test("a task adds and removes a prerequisite using the native searchable picker", async () => {
  const api = createFakeApi(seedState());
  const task = (await api.issues.list(ORG_ID, {})).find((i) => i.number !== 131);
  if (!task) throw new Error("Expected a prerequisite fixture");
  let view: IssueDependencies = { dependencies: [], waiting: 0, inputsChanged: false };
  api.issueDependencies = {
    list: async () => view,
    add: async (_org, _id, dependencyId) => {
      expect(dependencyId).toBe(task.id);
      view = {
        dependencies: [
          { id: "relation-1", task: { id: task.id, number: task.number, title: task.title, status: "todo" } },
        ],
        waiting: 1,
        inputsChanged: false,
      };
      return view;
    },
    remove: async (_org, _id, relationId) => {
      expect(relationId).toBe("relation-1");
      view = { dependencies: [], waiting: 0, inputsChanged: false };
      return view;
    },
  };
  await renderApp(`/org/${ORG_ID}/issues/131`, { api });
  await settle(8);
  const section = screen().getByRole("region", { name: "Depende de" });
  expect(section.textContent).toContain("Nenhuma dependência");
  await click(within(section).getByRole("button", { name: "Adicionar tarefa" }));
  const picker = within(section).getByRole("combobox");
  await act(async () => {
    picker.focus();
    fireEvent.keyDown(picker, { key: "Enter" });
  });
  await settle(3);
  await click(screen().getByRole("option", { name: `#${task.number} ${task.title}` }));
  await settle(5);
  expect(section.textContent).toContain("Aguardando 1 tarefa");
  expect(
    within(section)
      .getByRole("link", { name: `#${task.number} ${task.title}` })
      .getAttribute("href"),
  ).toContain(`/issues/${task.number}`);
  await click(within(section).getByRole("button", { name: `Remover dependência #${task.number}` }));
  await settle(5);
  expect(section.textContent).toContain("Nenhuma dependência");
});

test("a prerequisite without access is generic and changed inputs remain visible", async () => {
  const api = createFakeApi(seedState());
  api.issueDependencies.list = async () => ({
    dependencies: [{ id: "hidden", task: null }],
    waiting: 1,
    inputsChanged: true,
  });
  await renderApp(`/org/${ORG_ID}/issues/131`, { api });
  await settle(8);
  const section = screen().getByRole("region", { name: "Depende de" });
  expect(section.textContent).toContain("Dependência indisponível");
  expect(section.textContent).toContain("Uma entrada mudou depois do início");
  expect(within(section).queryAllByRole("link")).toHaveLength(0);
});
