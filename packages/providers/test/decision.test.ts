import { describe, expect, test } from "bun:test";
import {
  decisionStateOf,
  geminiDecision,
  openAIDecision,
  parseRuntimeModels,
  recommendLocalModel,
  systemOneCall,
} from "../src";

const call = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  state: { text: "hello" },
  questions: {
    yes: {
      type: "noul" as const,
      instructions: "Is it a greeting?",
      criteria: { true: "A greeting", false: "Not one" },
    },
  },
  ...extra,
});

describe("OpenAI Decisions", () => {
  test("predicate, choices and levels, answers by name", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the fake transport's request body is JSON, read field by field.
    let seen: { url: string; auth: string | null; body: any } | null = null;
    const http = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
      return Response.json({
        model: "gpt-6-luna",
        answers: [
          { type: "predicate", name: "yes", probability: 0.92 },
          {
            type: "choice",
            name: "kind",
            choice: "billing",
            probabilities: [{ value: "billing", probability: 0.8 }],
            confidence: 0.7,
          },
          { type: "score", name: "urgent", score: 1.2, probabilities: [{ value: 1, probability: 0.6 }] },
        ],
        usage: { input_tokens: 40 },
      });
    }) as unknown as typeof fetch;
    const result = await openAIDecision(
      { apiKey: "sk-test", http },
      {
        model: "gpt-6-luna",
        state: { text: "I was charged twice" },
        questions: {
          yes: { type: "noul", instructions: "Is it billing?", criteria: { true: "Billing", false: "Other" } },
          kind: { type: "choice", instructions: "Which?", criteria: { billing: "money", technical: "errors" } },
          urgent: { type: "score", instructions: "How urgent?", criteria: ["Routine", "Soon", "Urgent"] },
        },
      },
    );
    expect(seen!.url).toBe("https://api.openai.com/v1/decisions");
    expect(seen!.auth).toBe("Bearer sk-test");
    expect(seen!.body.model).toBe("gpt-6-luna");
    const [yes, kind, urgent] = seen!.body.questions;
    expect(yes).toMatchObject({ type: "predicate", name: "yes" });
    expect(yes.instructions).toContain("Yes: Billing");
    expect(kind.choices).toEqual([
      { value: "billing", description: "money" },
      { value: "technical", description: "errors" },
    ]);
    expect(urgent.levels.map((l: { label: string }) => l.label)).toEqual(["0", "1", "2"]);
    expect(result.answers.yes!).toEqual({ noul: 0.92 });
    expect(result.answers.kind!.choice).toBe("billing");
    expect(result.answers.kind!.probabilities).toEqual({ billing: 0.8 });
    expect(result.answers.urgent!.score).toBe(1.2);
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 0 });
  });

  test("a picture rides as a data URL, a refused key is invalid", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the fake transport's request body is JSON, read field by field.
    let body: any = null;
    const http = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ answers: [{ type: "predicate", name: "yes", probability: 1 }] });
    }) as unknown as typeof fetch;
    await openAIDecision(
      { apiKey: "sk-test", http },
      call("gpt-6-luna", { assets: { shot: { mediaType: "image/png", data: "AAAA" } } }),
    );
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,AAAA" });
    const refused = (async () =>
      Response.json({ error: { message: "bad key" } }, { status: 401 })) as unknown as typeof fetch;
    await expect(openAIDecision({ apiKey: "sk-test", http: refused }, call("gpt-6-luna"))).rejects.toMatchObject({
      state: "invalid",
    });
  });
});

describe("Gemini Decisions", () => {
  test("noul criteria use true/false descriptions, input is multimodal, answers by id", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the fake transport's request body is JSON, read field by field.
    let seen: { url: string; key: string | null; body: any } | null = null;
    const http = (async (url: string, init: RequestInit) => {
      seen = { url, key: new Headers(init.headers).get("x-goog-api-key"), body: JSON.parse(String(init.body)) };
      return Response.json({
        model: "gemini-decision-1",
        answers: { yes: { type: "noul", noul: 0.99, confidence: 0.9 } },
        usage: { total_input_tokens: 120 },
      });
    }) as unknown as typeof fetch;
    const result = await geminiDecision(
      { apiKey: "AQ.test", http },
      call("gemini-decision-1", {
        assets: {
          shot: { mediaType: "image/jpeg", data: "BBBB" },
          claim: { mediaType: "application/pdf", data: "CCCC" },
        },
      }),
    );
    expect(seen!.url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
    expect(seen!.key).toBe("AQ.test");
    expect(seen!.body.questions.yes.criteria).toEqual({ true_description: "A greeting", false_description: "Not one" });
    expect(seen!.body.input.map((b: { type: string }) => b.type)).toEqual(["text", "image", "document"]);
    expect(seen!.body.input[2]).toMatchObject({ type: "document", mime_type: "application/pdf" });
    expect(result.answers.yes!).toEqual({ noul: 0.99, confidence: 0.9 });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 0 });
  });
});

describe("System One", () => {
  test("assets for a Jev-compatible runtime, images for llama.cpp, box and float scores", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the fake transport's request body is JSON, read field by field.
    let body: any = null;
    const http = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({
        model: "laya",
        answers: {
          yes: { type: "noul", noul: 0.7 },
          where: { type: "box", box: { top: 0.1, bottom: 0.5, left: 0.2, right: 0.6 }, confidence: 0.8 },
          level: { type: "score", score: 1.6 },
        },
        usage: { input_tokens: 30, output_tokens: 0 },
      });
    }) as unknown as typeof fetch;
    const result = await systemOneCall(
      { baseURL: "http://127.0.0.1:11434", http },
      {
        model: "laya",
        state: { shot: "the screen" },
        questions: {
          yes: { type: "noul", instructions: "ok?" },
          where: { type: "box", instructions: "where?" },
          level: { type: "score", instructions: "how?", criteria: ["a", "b", "c"] },
        },
        assets: { shot: { mediaType: "image/png", data: "DDDD" } },
      },
    );
    expect(body.assets.shot).toEqual({ data_base64: "DDDD", format: "png" });
    expect(result.answers.yes!.noul).toBe(0.7);
    expect(result.answers.where!.box).toEqual({ top: 0.1, left: 0.2, bottom: 0.5, right: 0.6 });
    expect(result.answers.level!.score).toBe(1.6);

    await systemOneCall(
      { baseURL: "http://127.0.0.1:8080", runtime: "llamacpp", http },
      {
        model: "laya",
        state: { x: "y" },
        questions: { yes: { type: "noul", instructions: "ok?" } },
        assets: { s: { mediaType: "image/png", data: "EEEE" } },
      },
    );
    expect(body.images).toEqual(["data:image/png;base64,EEEE"]);
  });
});

describe("runtime listing and recommendation", () => {
  test("llama.cpp rows carry modalities", () => {
    expect(
      parseRuntimeModels({
        data: [
          { id: "laya", architecture: { input_modalities: ["text"], output_modalities: ["decisions"] } },
          { id: "chatty", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
        ],
      }),
    ).toEqual([
      { id: "laya", inputs: ["text"] },
      { id: "chatty", inputs: ["text", "image"] },
    ]);
  });

  test("Laya is the only local model, and it fits a small server", () => {
    const small = recommendLocalModel({ cpus: 2, memoryGb: 8, diskGb: 50, diskFreeGb: 20 }, "llamacpp");
    expect(small.candidates.map((c) => c.id)).toEqual(["laya"]);
    expect(small.recommended?.id).toBe("laya");
    expect(small.recommended?.fits).toBe(true);
    const tiny = recommendLocalModel({ cpus: 1, memoryGb: 1, diskGb: 10, diskFreeGb: 5 }, "llamacpp");
    expect(tiny.recommended?.fits).toBe(false);
  });

  test("states", () => {
    expect(decisionStateOf(200, {})).toBe("ok");
    expect(decisionStateOf(401, {})).toBe("invalid");
    expect(decisionStateOf(429, {})).toBe("rate_limited");
    expect(decisionStateOf(500, {})).toBe("down");
    expect(decisionStateOf(402, {})).toBe("no_credit");
    expect(decisionStateOf(400, { detail: "bad request" })).toBeNull();
  });
});
