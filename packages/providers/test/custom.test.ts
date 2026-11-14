import { afterEach, describe, expect, test } from "bun:test";
import {
  boundedFetch,
  costNanoUsd,
  createCustomProvider,
  createModelProviders,
  createOpenRouterProvider,
  customModelId,
  customModelOf,
  isOpenRouterModel,
  listEndpointModels,
  maxCostNanoUsd,
  modelInfo,
  modelProvider,
  outputTokensWithin,
  ProviderError,
  parseCustomModel,
  parseEndpointModels,
  setCustomModels,
} from "../src";
import { scripted, sse } from "./scripted";

const CRED = "0b9c8a52-4c1f-4f7e-9a11-7d0f2b6c3e10";
const ORG = "org-a";
const id = customModelId(CRED, "meta-llama/llama-4:70b");

afterEach(() => setCustomModels(ORG, {}));

const unpriced = {
  provider: "custom" as const,
  label: "llama",
  prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  serverSideFallback: false,
  unpriced: true as const,
};

describe("ids and the registry", () => {
  test("a custom id keeps its credential and the endpoint's own id, slashes and colons included", () => {
    expect(parseCustomModel(id)).toEqual({ credentialId: CRED, model: "meta-llama/llama-4:70b" });
    expect(parseCustomModel("claude-sonnet-5-5")).toBeNull();
    expect(modelProvider(id)).toBe("custom");
    expect(isOpenRouterModel(id)).toBe(false);
    expect(isOpenRouterModel("~z-ai/glm-latest")).toBe(true);
  });

  test("an organization's models are its own; an unpriced one costs 0 and never limits the output by money", () => {
    setCustomModels(ORG, { [id]: unpriced });
    expect(customModelOf(ORG, id)?.label).toBe("llama");
    expect(customModelOf("org-b", id)).toBeUndefined();
    expect(modelInfo(id)?.unpriced).toBe(true);
    const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costNanoUsd(id, usage)).toBe(0);
    expect(maxCostNanoUsd(id, 1000, 4000)).toBe(0);
    expect(outputTokensWithin(id, 1000, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(outputTokensWithin(id, 1000, 0)).toBe(0);
    setCustomModels(ORG, {});
    expect(customModelOf(ORG, id)).toBeUndefined();
    // A call that started before the model was removed still settles its cost.
    expect(costNanoUsd(id, usage)).toBe(0);
  });

  test("the server registers one custom adapter", () => {
    expect(createModelProviders().custom?.id).toBe("custom");
  });
});

describe("model lists", () => {
  test("OpenAI's and Anthropic's shape, Ollama's own, junk and repeats dropped", () => {
    expect(
      parseEndpointModels({
        data: [{ id: "gpt-x" }, { id: "claude-y", display_name: "Claude Y" }, { id: "bad id" }, { id: "gpt-x" }, 3],
      }),
    ).toEqual([{ id: "gpt-x" }, { id: "claude-y", label: "Claude Y" }]);
    expect(parseEndpointModels({ models: [{ name: "llama3:8b" }, { model: "qwen3" }] })).toEqual([
      { id: "llama3:8b" },
      { id: "qwen3" },
    ]);
    expect(parseEndpointModels("nope")).toEqual([]);
  });

  test("the list's address and key by style; a refusal and an oversized list fail with words", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const answer = (body: string, status = 200) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response(body, { status });
      }) as unknown as typeof fetch;
    const ok = answer(JSON.stringify({ data: [{ id: "m1" }] }));
    expect(await listEndpointModels({ style: "openai", baseURL: "https://gw.example/v1" }, "k-123456789", ok)).toEqual([
      { id: "m1" },
    ]);
    await listEndpointModels({ style: "anthropic", baseURL: "https://gw.example/anthropic" }, "k-123456789", ok);
    expect(seen[0]?.url).toBe("https://gw.example/v1/models");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer k-123456789");
    expect(seen[1]?.url).toBe("https://gw.example/anthropic/v1/models");
    expect(seen[1]?.headers.get("x-api-key")).toBe("k-123456789");
    const refused = listEndpointModels({ style: "openai", baseURL: "https://gw.example/v1" }, "k", answer("", 401));
    await expect(refused).rejects.toThrow("the provider answered 401");
    const huge = answer(JSON.stringify({ data: [{ id: "x".repeat(2_100_000) }] }));
    await expect(listEndpointModels({ style: "openai", baseURL: "https://gw.example/v1" }, "k", huge)).rejects.toThrow(
      "too large",
    );
  });
});

const chat = (chunks: Record<string, unknown>[]) =>
  `${chunks.map((c) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, ...c })}\n\n`).join("")}data: [DONE]\n\n`;

describe("calls", () => {
  test.each([
    ["https://resource.openai.azure.com/openai/v1", "gpt-6.1-sol"],
    ["https://resource.cognitiveservices.azure.com/openai/v1", "gpt-6.1-sol-2026-09-29"],
  ])("Azure GPT-6.1 Sol preserves reasoning and tools on Responses at %s", async (baseURL, model) => {
    const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "test-encrypted-reasoning" };
    const tool = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "report_status",
      arguments: '{"ok":true}',
      status: "completed",
    };
    const response = {
      id: "resp_1",
      object: "response",
      created_at: 1,
      model: "gpt-6.1-sol-2026-09-29",
      status: "completed",
      output: [reasoning, tool],
      usage: { input_tokens: 10, output_tokens: 8, input_tokens_details: { cached_tokens: 2 } },
    };
    const { fetcher, requests } = scripted(
      sse([
        { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: reasoning },
        { type: "response.output_item.done", output_index: 0, item: reasoning },
        { type: "response.output_item.added", output_index: 1, item: { ...tool, arguments: "" } },
        { type: "response.output_item.done", output_index: 1, item: tool },
        { type: "response.completed", response },
      ]),
    );
    const provider = createCustomProvider({ fetch: fetcher, maxRetries: 0 });
    const modelId = customModelId(CRED, model);
    const request = {
      model: modelId,
      system: "Check the connection.",
      messages: [{ role: "user" as const, content: "Call report_status with ok true." }],
      maxTokens: 1024,
      tools: [
        {
          name: "report_status",
          description: "Report connection status.",
          inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        },
      ],
      effort: "high" as const,
    };
    const options = { apiKey: "test-key", endpoint: { style: "openai" as const, baseURL }, onDelta: () => {} };
    const result = await provider.stream(request, options);
    expect(requests[0]?.url).toBe(`${baseURL}/responses`);
    expect(requests[0]?.body).toMatchObject({
      model,
      instructions: request.system,
      max_output_tokens: 1024,
      store: false,
      include: ["reasoning.encrypted_content"],
      tools: [{ type: "function", name: "report_status" }],
    });
    for (const field of ["max_tokens", "max_completion_tokens", "reasoning_effort"]) {
      expect(requests[0]?.body).not.toHaveProperty(field);
    }
    if (model === "gpt-6.1-sol") expect(requests[0]?.body.reasoning).toEqual({ effort: "high" });
    expect(result.model).toBe(modelId);
    expect(result.stopReason).toBe("tool_use");
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 8, cacheReadTokens: 2, cacheWriteTokens: 0 });
    expect(result.content).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "report_status",
      input: { ok: true },
    });
    await provider.stream(
      {
        ...request,
        tools: [],
        messages: [
          ...request.messages,
          { role: "assistant", content: result.content },
          { role: "user", content: [{ type: "tool_result", toolUseId: "call_1", content: "ok" }] },
        ],
      },
      options,
    );
    expect(requests[1]?.url).toBe(`${baseURL}/responses`);
    expect(requests[1]?.body.input).toContainEqual(reasoning);
    expect(requests[1]?.body.input).toContainEqual({ type: "function_call_output", call_id: "call_1", output: "ok" });
    expect(requests[1]?.body).not.toHaveProperty("tools");
  });

  test.each(["gpt-5", "gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-sol-2026-09-29"])(
    "Chat Completions: %s uses completion tokens without changing its deployment id",
    async (model) => {
      const { fetcher, requests } = scripted(
        chat([
          {
            model: "gpt-6.1-sol",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "report_status", arguments: '{"ok":true}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      );
      const modelId = customModelId(CRED, model);
      const result = await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
        {
          model: modelId,
          system: "You are checking that a connection works.",
          messages: [{ role: "user", content: "Call report_status with ok set to true." }],
          maxTokens: 1024,
          tools: [
            {
              name: "report_status",
              description: "Report that the connection works.",
              inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
            },
          ],
        },
        {
          apiKey: "test-key",
          endpoint: { style: "openai", baseURL: "https://gw.example/v1" },
          onDelta: () => {},
        },
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://gw.example/v1/chat/completions");
      expect(requests[0]?.body).toMatchObject({
        model,
        max_completion_tokens: 1024,
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: "function", function: { name: "report_status" } }],
      });
      for (const field of ["max_tokens", "temperature", "top_p", "reasoning", "provider", "cache_control"]) {
        expect(requests[0]?.body).not.toHaveProperty(field);
      }
      expect(requests[0]?.body).not.toHaveProperty("reasoning_effort");
      expect(result.model).toBe(modelId);
      expect(result.stopReason).toBe("tool_use");
      expect(result.content).toContainEqual({
        type: "tool_use",
        id: "call_1",
        name: "report_status",
        input: { ok: true },
      });
    },
  );

  test.each([false, true])(
    "GPT-6.1 Sol keeps default reasoning without tools (explicit empty tools: %s)",
    async (explicit) => {
      const { fetcher, requests } = scripted(
        chat([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]),
      );
      await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
        {
          model: customModelId(CRED, "gpt-6.1-sol"),
          system: "s",
          messages: [{ role: "user", content: "hi" }],
          maxTokens: 100,
          ...(explicit ? { tools: [] } : {}),
        },
        { apiKey: "test-key", endpoint: { style: "openai", baseURL: "https://gw.example/v1" }, onDelta: () => {} },
      );
      expect(requests[0]?.body).toMatchObject({ model: "gpt-6.1-sol", max_completion_tokens: 100 });
      expect(requests[0]?.body).not.toHaveProperty("reasoning_effort");
    },
  );

  test.each(["gpt-4.1", "gpt-4o", "meta-llama/llama-4:70b", "production", "gpt-60", "gpt-6ish"])(
    "Chat Completions: %s keeps the legacy token field",
    async (model) => {
      const { fetcher, requests } = scripted(
        chat([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]),
      );
      const modelId = customModelId(CRED, model);
      const result = await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
        { model: modelId, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
        { apiKey: "test-key", endpoint: { style: "openai", baseURL: "https://gw.example/v1" }, onDelta: () => {} },
      );
      expect(requests[0]?.body).toMatchObject({ model, max_tokens: 100 });
      expect(requests[0]?.body).not.toHaveProperty("max_completion_tokens");
      expect(result.model).toBe(modelId);
    },
  );

  test("OpenRouter keeps its own token field for GPT models", async () => {
    const { fetcher, requests } = scripted(
      chat([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]),
    );
    await createOpenRouterProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { model: "openai/gpt-6-luna", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      { apiKey: "test-key", onDelta: () => {} },
    );
    expect(requests[0]?.body).toMatchObject({ model: "openai/gpt-6-luna", max_tokens: 100 });
    expect(requests[0]?.body).not.toHaveProperty("max_completion_tokens");
  });

  test("Chat Completions: the endpoint's address and model id, no OpenRouter extras, usage asked, its cost ignored", async () => {
    const { fetcher, requests } = scripted(
      chat([
        { model: "claude-sonnet-5-5", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 9 } },
      ]),
    );
    const result = await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { model: id, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100, effort: "high" },
      { apiKey: "k-123456789", endpoint: { style: "openai", baseURL: "https://gw.example/v1" }, onDelta: () => {} },
    );
    const req = requests[0];
    expect(req?.url).toBe("https://gw.example/v1/chat/completions");
    expect(req?.headers.get("http-referer")).toBeNull();
    expect(req?.body).toMatchObject({ model: "meta-llama/llama-4:70b", stream_options: { include_usage: true } });
    expect(req?.body.reasoning).toBeUndefined();
    expect(req?.body.provider).toBeUndefined();
    // The endpoint said a catalog id answered: the full id comes back, so the catalog's prices never apply.
    expect(result.model).toBe(id);
    expect(result.costNanoUsd).toBeUndefined();
    expect(result.usage.inputTokens).toBe(10);
    // Any other endpoint: no session of ours, the SDK's own User-Agent.
    expect(req?.headers.get("x-opencode-session")).toBeNull();
    expect(req?.headers.get("user-agent")).not.toStartWith("agentes.chat/");
  });

  test("OpenCode (its Go plan): our User-Agent and the conversation's session on every call, both APIs", async () => {
    const done = chat([
      { choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const go = scripted(done);
    const provider = createCustomProvider({ fetch: go.fetcher, maxRetries: 0, version: "2026.11.07.9" });
    const call = (session?: string) =>
      provider.stream(
        {
          model: customModelId(CRED, "deepseek-v4.1-flash"),
          system: "s",
          messages: [{ role: "user", content: "hi" }],
          maxTokens: 100,
        },
        {
          apiKey: "oc_sk_test-key",
          endpoint: { style: "openai", baseURL: "https://opencode.ai/zen/go/v1" },
          ...(session ? { session } : {}),
          onDelta: () => {},
        },
      );
    await call("5f0c2c1e-0000-5000-8000-000000000001");
    await call();
    const [first, second] = go.requests;
    expect(first?.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(first?.headers.get("x-opencode-session")).toBe("5f0c2c1e-0000-5000-8000-000000000001");
    expect(first?.headers.get("user-agent")).toBe("agentes.chat/2026.11.07.9");
    // A call of no conversation (the connect dialog's test of each model) is a session of its own.
    expect(second?.headers.get("x-opencode-session")).toMatch(/^[0-9a-f-]{36}$/);
    expect(second?.headers.get("user-agent")).toBe("agentes.chat/2026.11.07.9");
    const messages = scripted(
      sse([
        {
          type: "message_start",
          message: {
            id: "m",
            type: "message",
            role: "assistant",
            model: "x",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]),
    );
    await createCustomProvider({ fetch: messages.fetcher, maxRetries: 0 }).stream(
      {
        model: customModelId(CRED, "minimax-m3"),
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      },
      {
        apiKey: "oc_sk_test-key",
        endpoint: { style: "anthropic", baseURL: "https://opencode.ai/inference/go/anthropic" },
        session: "conversation-1",
        onDelta() {},
      },
    );
    expect(messages.requests[0]?.headers.get("x-opencode-session")).toBe("conversation-1");
    expect(messages.requests[0]?.headers.get("user-agent")).toBe("agentes.chat/dev");
  });

  test("Anthropic Messages in its compatible mode; a refusal keeps the server's words", async () => {
    const { fetcher, requests } = scripted(
      sse([
        {
          type: "message_start",
          message: {
            id: "m",
            type: "message",
            role: "assistant",
            model: "x",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 5, output_tokens: 1 },
          },
        },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]),
    );
    await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { model: id, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      {
        apiKey: "k-123456789",
        endpoint: { style: "anthropic", baseURL: "https://gw.example/anthropic" },
        onDelta() {},
      },
    );
    expect(requests[0]?.url).toStartWith("https://gw.example/anthropic/v1/messages");
    expect(requests[0]?.body.model).toBe("meta-llama/llama-4:70b");
    expect(requests[0]?.body.cache_control).toBeUndefined();

    const refused = scripted(JSON.stringify({ error: { message: "model llama-9 not found" } }), 404);
    const error = await createCustomProvider({ fetch: refused.fetcher, maxRetries: 0 })
      .stream(
        { model: id, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
        { apiKey: "k-123456789", endpoint: { style: "openai", baseURL: "https://gw.example/v1" }, onDelta() {} },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain("model llama-9 not found");
  });

  test("a tool result's image goes to Claude on an Anthropic-compatible endpoint, never to another company's model", async () => {
    const reply = sse([
      {
        type: "message_start",
        message: {
          id: "m",
          type: "message",
          role: "assistant",
          model: "x",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]);
    const messages = [
      { role: "user" as const, content: "what is in the file?" },
      { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "t1", name: "read_file", input: {} }] },
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            toolUseId: "t1",
            content: "shot.png",
            images: [{ mediaType: "image/png", data: "UE5H" }],
          },
        ],
      },
    ];
    const send = async (model: string) => {
      const { fetcher, requests } = scripted(reply);
      const result = await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
        { model: customModelId(CRED, model), system: "s", messages, maxTokens: 100 },
        {
          apiKey: "k-123456789",
          endpoint: { style: "anthropic", baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com/anthropic" },
          onDelta() {},
        },
      );
      return { body: JSON.stringify(requests[0]?.body.messages), leftOut: result.imagesLeftOut };
    };
    const claude = await send("global.anthropic.claude-sonnet-5-5");
    expect(claude.body).toContain('"type":"image"');
    expect(claude.leftOut).toBeUndefined();
    const other = await send("moonshotai.kimi-k2.5");
    expect(other.leftOut).toBe(true);
    expect(other.body).not.toContain('"type":"image"');
    expect(other.body).toContain(
      "The picture is not shown to you: this agent's AI (moonshotai.kimi-k2.5) reads text only",
    );
  });

  test("tool calls without an index, or with object arguments, stay apart and readable", async () => {
    const { fetcher } = scripted(
      chat([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { id: "a", function: { name: "one", arguments: { x: 1 } } },
                  { id: "b", function: { name: "two", arguments: '{"y":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            { index: 0, delta: { tool_calls: [{ function: { arguments: "2}" } }] }, finish_reason: "tool_calls" },
          ],
        },
      ]),
    );
    const result = await createCustomProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { model: id, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      { apiKey: "k-123456789", endpoint: { style: "openai", baseURL: "https://gw.example/v1" }, onDelta: () => {} },
    );
    expect(result.content.filter((b) => b.type === "tool_use")).toEqual([
      { type: "tool_use", id: "a", name: "one", input: { x: 1 } },
      { type: "tool_use", id: "b", name: "two", input: { y: 2 } },
    ]);
  });

  test("an endpoint's reply is cut past its size and its time", async () => {
    const endless = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (init?.signal?.aborted) controller.error(init.signal.reason);
            else controller.enqueue(new Uint8Array(1000));
          },
        }),
      )) as unknown as typeof fetch;
    const big = await boundedFetch(endless, { maxBytes: 5000, timeoutMs: 60_000 })("https://gw.example/v1");
    await expect(big.text()).rejects.toThrow("too large");
    const silent = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        }),
      )) as unknown as typeof fetch;
    const slow = await boundedFetch(silent, { maxBytes: 5000, timeoutMs: 20 })("https://gw.example/v1");
    await expect(slow.text()).rejects.toThrow();
  });

  test("a call without an endpoint fails", async () => {
    const call = createCustomProvider().stream(
      { model: id, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 1 },
      { apiKey: "k", onDelta() {} },
    );
    await expect(call).rejects.toThrow("no endpoint");
  });
});
