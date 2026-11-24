import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { cleanup } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle } from "./render";

/*
 * A reply Gemini gave without agentes.chat's tools (`meta.mcpOff`, ADR 0143): the Antigravity CLI dropped our MCP
 * server, as on a Gemini Enterprise seat whose admin turned MCP servers off. A line under the reply says where the
 * admin turns them on; a reply with the tools has none.
 */

afterEach(() => cleanup());

const NOTE = "o admin precisa ativar os servidores MCP";

test("a reply without our tools says what the Gemini Enterprise admin must turn on; others say nothing", async () => {
  const state = seedState();
  const reply = (id: string, body: string, meta: Record<string, unknown>) => ({
    id,
    channelId: ENG_ID,
    threadId: null,
    author: { type: "agent" as const, id: ADA_ID },
    body,
    mentionedAgentIds: [],
    agentRunId: `r-${id}`,
    meta,
    createdAt: new Date().toISOString(),
  });
  state.messages.push(reply("msg-mcp-off", "Não consigo ler o documento daqui.", { mcpOff: true }));
  state.messages.push(reply("msg-tools", "Li o documento.", {}));
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
  await settle(8);
  const lines = [...document.querySelectorAll(".cn-pill")].filter((p) => p.textContent?.includes(NOTE));
  expect(lines).toHaveLength(1);
  expect(lines[0]?.textContent).toContain(
    "Google Cloud console → Gemini Enterprise → Configurações → Ferramentas para desenvolvedores de IA",
  );
  expect(lines[0]?.closest("[data-message-id]")?.getAttribute("data-message-id")).toBe("msg-mcp-off");
});
