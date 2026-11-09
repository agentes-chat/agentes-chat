import { afterEach, expect, test } from "bun:test";
import { ApiError, type ArtifactDetail } from "@agenteschat/client";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { ArtifactViewerProvider } from "@/components/artifacts/ArtifactViewer";
import { ChoicesCard } from "@/components/blocks/ChoicesCard";
import { ADA_ID, createFakeApi } from "./fake-api";
import { renderPage, settle } from "./render";

afterEach(cleanup);

const QUESTIONS = [
  { question: "Quando?", options: [{ label: "Hoje" }, { label: "Amanhã" }] },
  { question: "Quem revisa?", options: [{ label: "Lia" }, { label: "Theo" }] },
];

async function card(questions = QUESTIONS, answer?: () => Promise<never>) {
  const api = createFakeApi();
  api.artifacts.get = async (_orgId, id) =>
    ({
      id,
      title: "Revisão",
      kind: "choices",
      createdBy: { type: "agent", id: ADA_ID },
      shownVersion: 1,
      content: { kind: "choices", questions },
    }) as unknown as ArtifactDetail;
  if (answer) api.artifacts.answerChoices = answer;
  await renderPage(<ChoicesCard id="card-1" />, { api, org: true });
  await settle(6);
}

const focused = () => document.activeElement as HTMLElement;
const key = async (k: string) => {
  await act(async () => fireEvent.keyDown(focused(), { key: k }));
  await settle(4);
};

test("Left and Right keep the focus on the card's options, so letter keys keep answering", async () => {
  await card();
  (document.querySelector(".choices__option") as HTMLElement).focus();
  await key("a");
  expect(focused().textContent).toContain("Lia");
  await key("ArrowLeft");
  expect(focused().className).toContain("choices__option");
  expect(focused().textContent).toContain("Hoje");
  await key("ArrowRight");
  expect(focused().textContent).toContain("Lia");
});

test("someone answering first is no failure: no 'try again'; another error still says it", async () => {
  const one = [QUESTIONS[0] as (typeof QUESTIONS)[number]];
  await card(one, async () => {
    throw new ApiError(409, "choices.answered", "This card was already answered");
  });
  await act(async () => fireEvent.click(document.querySelector(".choices__option") as HTMLElement));
  await settle(6);
  expect(document.querySelector(".ac-toast")?.textContent ?? null).toBeNull();
  cleanup();
  await card(one, async () => {
    throw new ApiError(500, "internal", "boom");
  });
  await act(async () => fireEvent.click(document.querySelector(".choices__option") as HTMLElement));
  await settle(6);
  const toasts = [...document.querySelectorAll(".ac-toast")].map((t) => t.textContent);
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toContain("Não deu para mandar sua escolha");
});

test("Outra resposta: the last row opens a field; Enter sends what was written, and the card shows it", async () => {
  const sent: unknown[] = [];
  const one = [{ question: "Qual cor?", options: [{ label: "Azul" }, { label: "Verde" }] }];
  const api = createFakeApi();
  api.artifacts.get = async (_orgId, id) =>
    ({
      id,
      title: "Teste do cartão",
      kind: "choices",
      createdBy: { type: "agent", id: ADA_ID },
      shownVersion: 1,
      content: { kind: "choices", questions: one },
    }) as unknown as ArtifactDetail;
  const answer = api.artifacts.answerChoices;
  api.artifacts.answerChoices = (...args) => {
    sent.push(args.slice(2));
    return answer(...args);
  };
  await renderPage(<ChoicesCard id="card-1" />, { api, org: true });
  await settle(6);
  const rows = [...document.querySelectorAll(".choices__option")];
  expect(rows.map((r) => r.textContent)).toEqual(["AAzul", "BVerde", "COutra resposta"]);
  await act(async () => fireEvent.click(rows[2] as HTMLElement));
  await settle(2);
  // Opening it sends nothing: the person writes first.
  expect(sent).toEqual([]);
  const field = document.querySelector(".choices__write textarea") as HTMLTextAreaElement;
  expect(document.activeElement).toBe(field);
  await act(async () => fireEvent.change(field, { target: { value: "  Um vermelho bem escuro  " } }));
  await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
  await settle(6);
  expect(sent).toHaveLength(1);
  expect((sent[0] as unknown[])[0]).toEqual([2]);
  expect((sent[0] as unknown[])[2]).toEqual(["Um vermelho bem escuro"]);
  const picked = document.querySelector(".choices__picked") as HTMLElement;
  expect(picked.textContent).toBe("CUm vermelho bem escuro");
});

test("Outra resposta by its letter key; Cancelar closes the field and sends nothing", async () => {
  await card();
  (document.querySelector(".choices__option") as HTMLElement).focus();
  await key("c");
  const field = document.querySelector(".choices__write textarea") as HTMLTextAreaElement;
  expect(field).toBeTruthy();
  const cancel = [...document.querySelectorAll(".choices__write button")].find((b) => b.textContent === "Cancelar");
  await act(async () => fireEvent.click(cancel as HTMLElement));
  await settle(2);
  expect(document.querySelector(".choices__write")).toBeNull();
  expect(document.querySelector(".choices__picked")).toBeNull();
});

const detail = (id: string) =>
  ({
    id,
    title: "Revisão",
    kind: "choices",
    version: 1,
    createdBy: { type: "agent", id: ADA_ID },
    shownVersion: 1,
    content: { kind: "choices", questions: QUESTIONS },
  }) as unknown as ArtifactDetail;

/** A read that answers only once `release` is called. */
function held<T>(read: () => Promise<T>) {
  let release = () => {};
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  return {
    read: async () => {
      await gate;
      return read();
    },
    release: () => release(),
  };
}

test("before it loads, a question card holds its own shape from its message's ref, never a file's tile", async () => {
  const api = createFakeApi();
  const artifact = held(async () => detail("card-1"));
  api.artifacts.get = artifact.read;
  const ref = { id: "card-1", version: 1, title: "Revisão", kind: "choices", options: 2, questions: 2 } as const;
  await renderPage(
    <ArtifactViewerProvider>
      <ArtifactCard artifact={ref} />
    </ArtifactViewerProvider>,
    { api, org: true },
  );
  await settle(4);
  expect(document.querySelector(".artifact-tile")).toBeNull();
  const placeholder = document.querySelector('.live-block.choices[aria-busy="true"]');
  expect(placeholder?.textContent).toContain("Revisão");
  // Its two options and Outra resposta, and the foot of a card with two questions.
  expect(placeholder?.querySelectorAll(".choices__option")).toHaveLength(3);
  expect(placeholder?.querySelector(".choices__foot")).not.toBeNull();
  await act(async () => artifact.release());
  await settle(6);
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  expect(document.querySelectorAll(".choices__option")).toHaveLength(3);
});

test("while its answer loads, the card is already its question, with nothing to press yet", async () => {
  const api = createFakeApi();
  api.artifacts.get = async (_orgId, id) => detail(id);
  const answer = held(() => Promise.resolve({ id: "card-1", answer: null }));
  api.artifacts.choices = answer.read;
  await renderPage(<ChoicesCard id="card-1" />, { api, org: true });
  await settle(4);
  const options = () => [...document.querySelectorAll<HTMLButtonElement>(".choices__option")];
  expect(options()).toHaveLength(3);
  expect(options().every((o) => o.disabled)).toBe(true);
  await act(async () => answer.release());
  await settle(6);
  expect(options().some((o) => o.disabled)).toBe(false);
});

test("the worst a ref can say still holds a card's shape: a title that wraps, six options, five questions; a vote too", async () => {
  const api = createFakeApi();
  api.artifacts.get = () => new Promise<never>(() => {});
  const title =
    "Placas da feira para todas as quarenta mesas, com os nomes das editoras conferidos e revisados por alguém da equipe";
  await renderPage(
    <ArtifactViewerProvider>
      <div className="artifact-cards">
        <ArtifactCard artifact={{ id: "card-2", version: 1, title, kind: "choices", options: 6, questions: 5 }} />
        <ArtifactCard artifact={{ id: "poll-1", version: 1, title, kind: "poll", options: 8 }} />
        <ArtifactCard artifact={{ id: "block-1", version: 1, title, kind: "block" }} />
      </div>
    </ArtifactViewerProvider>,
    { api, org: true },
  );
  await settle(4);
  const [choices, poll, block] = [...document.querySelectorAll('.live-block[aria-busy="true"]')];
  expect(choices?.querySelectorAll(".choices__option")).toHaveLength(7);
  expect(choices?.querySelector(".choices__foot")).not.toBeNull();
  expect(poll?.querySelectorAll(".poll__option")).toHaveLength(8);
  expect(block?.querySelector(".live-block__room")).not.toBeNull();
  for (const card of [choices, poll, block]) expect(card?.textContent).toContain(title);
  expect(document.querySelector(".artifact-tile")).toBeNull();
});
