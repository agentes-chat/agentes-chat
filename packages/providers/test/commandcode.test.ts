import { describe, expect, test } from "bun:test";
import {
  COMMANDCODE_API,
  commandCodeModelOf,
  costNanoUsd,
  createCommandCodeProvider,
  createModelProviders,
  isOpenRouterModel,
  modelProvider,
  ProviderError,
} from "../src";
import { scripted, sse } from "./scripted";

const chat = (chunks: Record<string, unknown>[]) =>
  `${chunks.map((c) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, ...c })}\n\n`).join("")}data: [DONE]\n\n`;

const message = (events: Record<string, unknown>[]) =>
  sse([
    {
      type: "message_start",
      message: {
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    },
    ...events,
    { type: "message_stop" },
  ]);

describe("Command Code's ids", () => {
  test("its own id after the prefix, slashes kept; never read as OpenRouter's", () => {
    expect(commandCodeModelOf("commandcode:zai-org/GLM-5.3")).toBe("zai-org/GLM-5.3");
    expect(commandCodeModelOf("commandcode:")).toBeNull();
    expect(commandCodeModelOf("glm-5.3")).toBeNull();
    expect(isOpenRouterModel("commandcode:deepseek/deepseek-v4.1-flash")).toBe(false);
    expect(isOpenRouterModel("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(modelProvider("commandcode:deepseek/deepseek-v4.1-flash")).toBe("commandcode");
    expect(modelProvider("commandcode:claude-sonnet-5-5")).toBe("commandcode");
  });

  test("the server registers its adapter", () => {
    expect(createModelProviders().commandcode?.id).toBe("commandcode");
  });
});

describe("calls (scripted transport)", () => {
  test("an open model: Chat Completions at Command Code, its own id sent, usage asked, priced at Command Code's rates", async () => {
    const { fetcher, requests } = scripted(
      chat([
        {
          model: "deepseek-v4.1-flash-dedicated",
          choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
        },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 10, cost: 9 } },
      ]),
    );
    const model = "commandcode:deepseek/deepseek-v4.1-flash";
    const result = await createCommandCodeProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { model, system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100, effort: "high" },
      { apiKey: "user_k123456789", onDelta: () => {} },
    );
    const req = requests[0];
    expect(req?.url).toBe(`${COMMANDCODE_API}/v1/chat/completions`);
    expect(req?.headers.get("authorization")).toBe("Bearer user_k123456789");
    expect(req?.headers.get("http-referer")).toBeNull();
    expect(req?.body).toMatchObject({ model: "deepseek/deepseek-v4.1-flash", stream_options: { include_usage: true } });
    expect(req?.body.provider).toBeUndefined();
    expect(req?.body.reasoning).toBeUndefined();
    // The full id comes back and Command Code's own cost field is ignored: the catalog prices the call.
    expect(result.model).toBe(model);
    expect(result.costNanoUsd).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(costNanoUsd(result.model, result.usage)).toBe(1000 * 150 + 10 * 600);
  });

  test("Claude: Anthropic Messages at Command Code with its key, its own id sent, the full id back", async () => {
    const { fetcher, requests } = scripted(
      message([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "oi" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
      ]),
    );
    const result = await createCommandCodeProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      {
        model: "commandcode:claude-sonnet-5-5",
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
      },
      { apiKey: "user_k123456789", onDelta: () => {} },
    );
    const req = requests[0];
    expect(req?.url).toStartWith(`${COMMANDCODE_API}/v1/messages`);
    expect(req?.headers.get("x-api-key")).toBe("user_k123456789");
    expect(req?.body.model).toBe("claude-sonnet-5-5");
    // Nothing only Anthropic's own API takes.
    for (const field of ["cache_control", "fallbacks"]) expect(req?.body).not.toHaveProperty(field);
    expect(result.model).toBe("commandcode:claude-sonnet-5-5");
    expect(result.content).toEqual([{ type: "text", text: "oi" }]);
  });

  test("Claude's later turns: plain 5-minute breakpoints everywhere, never a 1-hour one (Anthropic refuses 1h after 5m)", async () => {
    const { fetcher, requests } = scripted(
      message([
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      ]),
    );
    await createCommandCodeProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      {
        model: "commandcode:claude-haiku-5-5",
        cacheTtl: "1h",
        system: [{ text: "org", cache: true }, { text: "turn" }],
        tools: [{ name: "search", description: "s", inputSchema: { type: "object" } }],
        messages: [
          { role: "user", content: [{ type: "text", text: "first", cache: true }] },
          { role: "assistant", content: "ok" },
          { role: "user", content: [{ type: "text", text: "second", cache: true }] },
        ],
        maxTokens: 100,
      },
      { apiKey: "user_k123456789", onDelta: () => {} },
    );
    const sent = JSON.stringify(requests[0]?.body);
    expect(sent).toContain('"cache_control":{"type":"ephemeral"}');
    expect(sent).not.toContain('"ttl"');
  });

  test("structured output on Claude (the router's pick) is a forced tool, thinking off; its input is the reply", async () => {
    const { fetcher, requests } = scripted(
      message([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "structured_output", input: {} },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"ok":true}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
      ]),
    );
    const result = await createCommandCodeProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      {
        model: "commandcode:claude-haiku-5-5",
        system: "s",
        messages: [{ role: "user", content: "ok?" }],
        maxTokens: 100,
        effort: "none",
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      },
      { apiKey: "user_k123456789", onDelta: () => {} },
    );
    const body = requests[0]?.body;
    expect(body?.tool_choice).toEqual({ type: "any" });
    expect(body?.output_config).toBeUndefined();
    expect(JSON.parse(result.content.map((b) => (b.type === "text" ? b.text : "")).join(""))).toEqual({ ok: true });
  });

  test("a refusal keeps Command Code's words; an id that isn't its own fails before any call", async () => {
    const refused = scripted(
      JSON.stringify({
        error: { message: 'Model "x" is not supported on this endpoint.', type: "invalid_request_error" },
      }),
      400,
    );
    const error = await createCommandCodeProvider({ fetch: refused.fetcher, maxRetries: 0 })
      .stream(
        { model: "commandcode:x/y", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 10 },
        { apiKey: "user_k123456789", onDelta() {} },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain("is not supported on this endpoint");

    const none = scripted("");
    const wrong = await createCommandCodeProvider({ fetch: none.fetcher, maxRetries: 0 })
      .stream(
        { model: "glm-5.3", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 10 },
        { apiKey: "user_k123456789", onDelta() {} },
      )
      .catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ProviderError);
    expect(none.requests).toHaveLength(0);
  });
});
