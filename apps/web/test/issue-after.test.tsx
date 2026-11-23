import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { IssuePage } from "@/pages/IssuePage";
import { ADA_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderPage, settle } from "./render";

afterEach(() => cleanup());

const button = (words: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) as HTMLButtonElement;

/** A task for Ada that waits on "Migrar a tabela de pedidos". */
async function waiting() {
  const api = createFakeApi(seedState());
  const first = await api.issues.create(ORG_ID, { title: "Migrar a tabela de pedidos" });
  const next = await api.issues.create(ORG_ID, {
    title: "Usar a tabela nova no checkout",
    assignees: [{ type: "agent", id: ADA_ID }],
  });
  await api.issues.update(ORG_ID, next.id, { afterIssueId: first.id });
  await renderPage(<IssuePage number={next.number} />, { api, org: true });
  await settle(5);
  return { api, first, next };
}

describe('"Depois de": a task that waits on another', () => {
  test("the card says Ada starts when the first is done, with Começar agora and Tirar a ordem; the strip names it", async () => {
    const { api, first, next } = await waiting();
    const card = document.querySelector('section[aria-label="Depois de uma tarefa"]') as HTMLElement;
    expect(card.textContent).toContain(`A Ada começa quando a #${first.number} estiver feita`);
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`/org/${ORG_ID}/issues/${first.number}`);
    expect(card.textContent).toContain("Migrar a tabela de pedidos");
    expect(document.querySelector('.issue-props [aria-label="Depois de uma tarefa"]')?.textContent).toContain(
      `Depois da #${first.number}`,
    );
    // Nobody started it, so "Pedir à Ada" isn't offered on top of it.
    expect(document.body.textContent).not.toContain("Pedir à Ada para fazer esta tarefa");
    (globalThis as { geometrySnapshot?: () => void }).geometrySnapshot?.();

    await act(async () => fireEvent.click(button("Começar agora")));
    await settle(5);
    const started = await api.issues.get(ORG_ID, next.number);
    expect(started.status).toBe("in_progress");
    expect(document.querySelector('section[aria-label="Depois de uma tarefa"]')).toBeNull();
  });

  test("Tirar a ordem takes it off at once", async () => {
    const { api, next } = await waiting();
    await act(async () => fireEvent.click(button("Tirar a ordem")));
    await settle(5);
    expect((await api.issues.get(ORG_ID, next.number)).after).toBeNull();
    expect(document.querySelector('section[aria-label="Depois de uma tarefa"]')).toBeNull();
    expect(document.querySelector('.issue-props [aria-label="Depois de uma tarefa"]')?.textContent).toContain(
      "Depois de uma tarefa",
    );
  });
});
