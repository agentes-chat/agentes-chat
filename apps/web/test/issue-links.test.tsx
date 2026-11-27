import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { IssueLink } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());
test("task links show inverse labels and keep unavailable tasks anonymous", async () => {
  const api = createFakeApi(seedState());
  api.issueLinks.list = async () => [{ id: "hidden", type: "blocks", incoming: true, task: null }];
  await renderApp(`/org/${ORG_ID}/issues/131`, { api });
  await settle(8);
  const section = screen().getByRole("region", { name: "Vínculos" });
  expect(section.textContent).toContain("é bloqueada por");
  expect(section.textContent).toContain("Indisponível");
  expect(within(section).queryAllByRole("link")).toHaveLength(0);
});
test("links use the native type and task pickers", async () => {
  const api = createFakeApi(seedState());
  const task = (await api.issues.list(ORG_ID)).find((i) => i.number !== 131);
  if (!task) throw new Error("Missing task fixture");
  let links: IssueLink[] = [];
  api.issueLinks = {
    list: async () => links,
    add: async (_o, _id, to, type) => {
      expect(to).toBe(task.id);
      links = [
        {
          id: "link",
          type,
          incoming: false,
          task: { id: task.id, number: task.number, title: task.title, status: task.status },
        },
      ];
      return links;
    },
    remove: async () => {
      links = [];
      return links;
    },
  };
  await renderApp(`/org/${ORG_ID}/issues/131`, { api });
  await settle(8);
  const section = screen().getByRole("region", { name: "Vínculos" });
  await act(async () => {
    fireEvent.click(within(section).getByRole("button", { name: "Adicionar vínculo" }));
  });
  await settle(3);
  const pickers = within(section).getAllByRole("combobox");
  expect(pickers).toHaveLength(2);
  const picker = pickers[1];
  if (!picker) throw new Error("Missing picker");
  await act(async () => {
    picker.focus();
    fireEvent.keyDown(picker, { key: "Enter" });
  });
  await settle(3);
  await act(async () => {
    fireEvent.change(screen().getByPlaceholderText("Buscar tarefas"), { target: { value: task.title } });
  });
  await settle(5);
  await act(async () => {
    fireEvent.click(screen().getByRole("option", { name: `#${task.number} ${task.title}` }));
  });
  await settle(5);
  expect(within(section).getByRole("link").textContent).toContain(task.title);
});
