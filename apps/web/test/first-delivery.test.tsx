import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { Message } from "@agenteschat/client";
import { FIRST_AREAS } from "@agenteschat/client/lib/first-areas";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { deliveryMessage } from "@/lib/first-delivery";
import { ADA_ID, createFakeApi, type FakeState, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/*
 * The first delivery on the welcome wizard's last step (ADR 0264, addendum of 2026-11-27; ADR 0160): once it fired, its
 * row leads the list, still being made (the working sign, where it will say it's done) or done (its one-line summary,
 * from the reply the server marked `meta.firstDelivery`); the main button then leads to its conversation. Not fired
 * yet (no plan or no AI), no row: the wizard ends as it always did.
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const IARA = "agent-iara";
const DM = "dm-iara";
const SUMMARY = "12 e-mails pedem resposta. 3 com rascunho.";

const wizard = () => screen().getByRole("dialog") as HTMLElement;
const press = async (name: string | RegExp, rounds = 4) => {
  await act(async () => fireEvent.click(within(wizard()).getByRole("button", { name })));
  await settle(rounds);
};
const row = () => wizard().querySelector(".wiz-board__delivery") as HTMLElement | null;

/** Acme right after Walter's onboarding: Iara, his first agent, in his DM; her first delivery `fired` or not. */
const after = (fired: boolean, reply?: string) => {
  const state = withRightHand(seedState());
  const ada = state.agents.find((a) => a.id === ADA_ID) as FakeState["agents"][number];
  state.agents.push({
    ...ada,
    id: IARA,
    name: "Iara",
    handle: "iara",
    role: "Atendimento",
    ownerUserId: "u-walter",
    appearance: FIRST_AREAS.support.look,
  });
  state.dms.push({ channelId: DM, with: { type: "agent", id: IARA, name: "Iara", handle: "iara" }, unread: 0 });
  state.channelMembers[DM] = [
    { type: "person", id: "u-walter" },
    { type: "agent", id: IARA },
  ];
  const at = new Date().toISOString();
  state.firstDelivery = {
    agentId: IARA,
    area: "support",
    task: "Leia os e-mails dos últimos 7 dias.",
    armedAt: at,
    firedAt: fired ? at : null,
    runId: fired ? "run-first" : null,
  };
  if (reply !== undefined)
    state.messages.push({
      id: "m-first",
      channelId: DM,
      threadId: null,
      author: { type: "agent", id: IARA },
      body: "Oi, Walter. Li os e-mails dos últimos 7 dias: 12 pedem resposta.",
      mentionedAgentIds: [],
      agentRunId: "run-first",
      createdAt: at,
      meta: { firstDelivery: { summary: reply } },
    });
  return state;
};
/** The onboarding's landing: the DM with the first agent, on the welcome wizard alone, taken to its last step. */
const land = async (state: FakeState) => {
  const r = await renderApp(`/org/${ORG_ID}/dm/agent/${IARA}?arrival=beta`, { api: createFakeApi(state) });
  await settle(10);
  for (let n = 1; n < 7; n++) await press(/^Próximo/, n === 6 ? 8 : 2);
  return r;
};

describe("the first delivery on the welcome wizard's last step (ADR 0264)", () => {
  test("still being made: the agent at work, where it will say so, and the button to its conversation", async () => {
    await land(after(true));
    expect(wizard().querySelector(".wiz__title")?.textContent).toBe("Tudo pronto para começar");
    const delivery = row();
    expect(delivery?.getAttribute("data-state")).toBe("working");
    // First in the list, the agent's face beside it, the working sign at its end.
    expect(wizard().querySelector(".wiz-board > li")).toBe(delivery);
    expect(delivery?.querySelector(".wiz-board__face")).not.toBeNull();
    expect(delivery?.querySelector(".ac-pixspin")).not.toBeNull();
    expect(delivery?.querySelector(".wiz-board__text")?.textContent).toBe(
      "A Iara ainda está trabalhandoEla avisa nesta conversa quando terminar.",
    );
    expect(within(wizard()).getByRole("button", { name: /^Ir para a conversa/ })).toBeTruthy();
  });

  test("done: its summary from the reply marked as the first delivery; Ver a entrega closes the wizard on it", async () => {
    const { router } = await land(after(true, SUMMARY));
    const delivery = row();
    expect(delivery?.getAttribute("data-state")).toBe("done");
    expect(delivery?.querySelector(".ac-pixspin")).toBeNull();
    expect(delivery?.querySelector(".wiz-board__text")?.textContent).toBe(
      `A primeira entrega da Iara está pronta${SUMMARY}`,
    );
    await press(/^Ver a entrega/, 10);
    expect(screen().queryByRole("dialog")).toBeNull();
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/dm/agent/${IARA}`);
  });

  test("not fired yet (no plan or no AI): no row, and the wizard ends on its own button", async () => {
    await land(after(false));
    expect(row()).toBeNull();
    expect(within(wizard()).getByRole("button", { name: /^Começar/ })).toBeTruthy();
    expect(within(wizard()).queryByRole("button", { name: /^Ir para a conversa/ })).toBeNull();
  });

  test("the reply that is the delivery: the agent's newest one the server marked, never a person's", () => {
    const message = (id: string, author: Message["author"], meta?: Message["meta"]): Message => ({
      id,
      channelId: DM,
      threadId: null,
      author,
      body: "…",
      mentionedAgentIds: [],
      agentRunId: null,
      createdAt: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    });
    const marked = { firstDelivery: { summary: SUMMARY } };
    const list = [
      message("a", { type: "agent", id: IARA }, marked),
      message("b", { type: "person", id: "u-walter" }, marked),
      message("c", { type: "agent", id: IARA }),
      message("d", { type: "agent", id: ADA_ID }, marked),
    ];
    expect(deliveryMessage(list, IARA)?.id).toBe("a");
    expect(deliveryMessage([...list, message("e", { type: "agent", id: IARA }, marked)], IARA)?.id).toBe("e");
    expect(deliveryMessage(undefined, IARA)).toBeNull();
    expect(deliveryMessage(list, "agent-other")).toBeNull();
  });
});
