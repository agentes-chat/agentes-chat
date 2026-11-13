import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle, showIn } from "./render";

afterEach(() => cleanup());

const MESSAGE = "Approve api.calendar.calendars.calendarEventsPatch? It moves the standup to 10:00.";

/** The channel's card is a connected server's own request (ADR 0180), through an Executor connected by address. */
async function serverAsks() {
  const state = seedState();
  const api = createFakeApi(state);
  const done = await api.customConnectors.connect(ORG_ID, {
    serverUrl: "https://mcp.executor.example/mcp",
    apiKey: "k",
    label: "Executor",
    returnTo: "/settings/connectors",
  });
  if (done.status !== "connected") throw new Error("not connected");
  const merge = state.approvals[0];
  if (!merge) throw new Error("no approval");
  state.approvals[0] = {
    ...merge,
    tool: "executor_resume",
    scope: `custom:${done.server.id}:write`,
    connector: `custom:${done.server.id}`,
    title: "Executor: api.calendar.calendars.calendarEventsPatch",
    detail: MESSAGE,
    params: { requestId: "apr_8f2c1", response: { action: "accept" } },
    serverRequest: { server: "Executor", action: "api.calendar.calendars.calendarEventsPatch", message: MESSAGE },
  };
  return api;
}

describe("a server's own approval request (ADR 0180)", () => {
  test("the chat's card reads as the server's request and says it asked, never as its resume call", async () => {
    const r = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: await serverAsks() });
    await showIn(r.services, "en");
    const card = document.querySelector(".rq") as HTMLElement;
    expect(card.textContent).toContain("Executor: api.calendar.calendars.calendarEventsPatch");
    expect(card.textContent).toContain(MESSAGE);
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: /see details/i })));
    await settle(4);
    expect(card.textContent).toContain("Executor asked for this approval itself.");
    // The resume call's values aren't what it does: only its technical details hold them.
    expect(card.querySelector(".ap-exact__rows")).toBeNull();
  });

  test("the review names the server under Asked by and shows what it asks", async () => {
    const r = await renderApp(`/org/${ORG_ID}/approvals`, { api: await serverAsks() });
    await showIn(r.services, "en");
    await act(async () => fireEvent.click(document.querySelector('.ap-li[data-id="ap-merge"]') as HTMLElement));
    await settle(4);
    const review = document.querySelector(".ap-review") as HTMLElement;
    expect(review.textContent).toContain("Asked byExecutor");
    expect(review.querySelector(".ap-review__asks")?.textContent).toBe(MESSAGE);
    expect(review.querySelector(".ap-exact__rows")).toBeNull();
  });
});
