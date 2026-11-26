import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import type { OrgStanding } from "../src/api/types";
import { ApiError } from "../src/index";
import { aiAppAsk, aiAppImport } from "../src/lib/apps";
import { errorText, hasWordsFor } from "../src/lib/errors";

const translator = (lng: string): TFunction => {
  const instance = i18next.createInstance();
  void instance.init({ lng, fallbackLng: "en", resources, initAsync: false });
  return instance.t;
};
const en = translator("en");
const pt = translator("pt-BR");

describe("asking my own AI for the first agents (aiAppAsk, ADR 0253)", () => {
  const open = { serverUrl: "https://app.example.com/mcp", serverPublic: true };
  const firstPlan: OrgStanding = { state: "hold", reason: "payment" };

  test("nothing while the list loads; a private server can't be reached by an app on the internet", () => {
    expect(aiAppAsk(en, undefined, undefined)).toBeNull();
    expect(aiAppAsk(en, { serverUrl: "http://10.0.0.5/mcp", serverPublic: false }, firstPlan)).toEqual({
      available: false,
      note: "Connect with MCP isn't available on this server, because apps on the internet only reach a public https address.",
    });
  });

  test("a workspace waiting for its first plan is open to the ask, which comes before Checkout (ADR 0119 addendum)", () => {
    expect(aiAppAsk(en, open, firstPlan)).toEqual({ available: true, url: "https://app.example.com/mcp" });
    // The import's way in stays closed on that hold: only `propose_first_agents` is taken there.
    expect(aiAppImport(en, open, firstPlan)?.available).toBe(false);
    for (const standing of [undefined, null, { state: "active" as const, reason: null }])
      expect(aiAppAsk(en, open, standing)).toEqual({ available: true, url: "https://app.example.com/mcp" });
  });

  test("any other hold or a suspension still refuses, saying which", () => {
    const held = { available: false as const, note: en("onboarding.import.aiApp.held") };
    const paused = { available: false as const, note: en("onboarding.import.aiApp.paused") };
    expect(held.note).toBe(
      "Connect with MCP works once the workspace's plan is active. Bring the agents this way for now.",
    );
    expect(aiAppAsk(en, open, { state: "hold", reason: "unpaid" })).toEqual(held);
    expect(aiAppAsk(en, open, { state: "hold", reason: "ended" })).toEqual(held);
    // A hold whose reason isn't billing's, or none told, and a suspension: paused.
    expect(aiAppAsk(en, open, { state: "hold", reason: "review" })).toEqual(paused);
    expect(aiAppAsk(en, open, { state: "hold", reason: null })).toEqual(paused);
    expect(aiAppAsk(en, open, { state: "suspended", reason: "payment" })).toEqual(paused);
    expect(aiAppAsk(pt, open, { state: "suspended", reason: null })).toEqual({
      available: false,
      note: "Conectar com MCP fica desligado enquanto este workspace está pausado. Por enquanto, traga os agentes por aqui.",
    });
  });
});

describe("the first agents' refusals in the person's words (ADR 0253)", () => {
  const refusals = [
    new ApiError(403, "create_agents_required", "Creating agents in this workspace needs an admin"),
    new ApiError(400, "first_agents.invalid", "options.0.tasks: Too big"),
    new ApiError(409, "first_agents.picking", "This agent is being created"),
    new ApiError(429, "first_agents.rate_limited", "Too many proposals for now.", { retryAfter: 600 }),
  ];

  test("each code has its own line in English and Portuguese, never the server's words", () => {
    expect(refusals.map((e) => hasWordsFor(e.code))).toEqual([true, true, true, true]);
    expect(refusals.map((e) => errorText(en, e))).toEqual([
      "Creating agents in this workspace needs an admin. Ask one to create it for you.",
      "This answer isn't in the format we asked for. Copy the request again and paste your AI's whole answer.",
      "This agent is already being created. Wait a moment.",
      "Too many tries for now. Try again in a little while.",
    ]);
    expect(refusals.map((e) => errorText(pt, e))).toEqual([
      "Criar agentes neste workspace precisa de um admin. Peça a um admin para criar por você.",
      "Essa resposta não está no formato pedido. Copie o pedido de novo e cole a resposta inteira da sua IA.",
      "Esse agente já está sendo criado. Espere um instante.",
      "Muitas tentativas por agora. Tente de novo daqui a pouco.",
    ]);
  });

  test("a proposal or an option that isn't there reads as gone", () => {
    for (const t of [en, pt]) {
      const gone = t("errors.said.gone");
      expect(errorText(t, new ApiError(404, "first_agents.not_found", "Proposal not found"))).toBe(gone);
      expect(errorText(t, new ApiError(400, "first_agents.no_option", "Pick an option from 0 to 2."))).toBe(gone);
    }
  });
});
