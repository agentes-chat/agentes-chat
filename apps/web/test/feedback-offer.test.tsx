import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { FeedbackOffer, Message } from "@agenteschat/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ATLAS_ID, createFakeApi, ENG_ID, NOW, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

/**
 * ADR 0160 §12, amended 2026-11-11: a report the agent offered on its own carries the run's side, and its row lists
 * all of it under the report, before the person sends it in their name.
 */

const offerOf = (over: Partial<FeedbackOffer> = {}): FeedbackOffer => ({
  id: "offer-1",
  forUserId: "u-walter",
  summary: "o navegador fechou ao abrir a página",
  text: "Eu abria o relatório e o navegador fechou.",
  state: "offered",
  ...over,
});

const reply = (offer: FeedbackOffer): Message => ({
  id: "m-offer",
  channelId: ENG_ID,
  threadId: null,
  author: { type: "agent", id: ATLAS_ID },
  body: "Não consegui abrir o relatório agora.",
  mentionedAgentIds: [],
  agentRunId: "r-offer",
  meta: { feedbackOffer: offer },
  createdAt: new Date(NOW.getTime() + 60_000).toISOString(),
});

const openRow = async (offer: FeedbackOffer) => {
  const state = seedState();
  state.messages.push(reply(offer));
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
  await settle(5);
  const row = screen().getByRole("group", { name: "Relato sobre o app" });
  await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Ver o relato" })));
  await settle(2);
  return row;
};

test("the report opened: its words, then what goes along with it, label and value", async () => {
  const row = await openRow(
    offerOf({
      facts: [
        ["Brain", "Claude Code"],
        ["Tool error", "browser_do: The browser closed"],
      ],
    }),
  );
  expect(row.querySelector(".ag-fb__text")?.textContent).toBe("Eu abria o relatório e o navegador fechou.");
  const along = within(row).getByRole("region", { name: "O que vai junto" });
  expect([...along.querySelectorAll(".fb-facts__row")].map((r) => r.textContent)).toEqual([
    "BrainClaude Code",
    "Tool errorbrowser_do: The browser closed",
  ]);
});

test("an offer from before, with nothing along: the report alone", async () => {
  const row = await openRow(offerOf());
  expect(row.querySelector(".ag-fb__text")).not.toBeNull();
  expect(within(row).queryByRole("region", { name: "O que vai junto" })).toBeNull();
});
