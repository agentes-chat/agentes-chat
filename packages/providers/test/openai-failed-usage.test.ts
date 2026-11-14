import { expect, test } from "bun:test";
import { createOpenAIProvider, ProviderError } from "../src";

async function failed(usage: unknown) {
  const response = {
    id: "resp_failed",
    object: "response",
    created_at: 1,
    model: "gpt-6-sol",
    output: [],
  };
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress", usage: null } },
    {
      type: "response.failed",
      response: {
        ...response,
        status: "failed",
        error: { code: "server_error", message: "Failed after processing" },
        usage,
      },
    },
  ];
  const body = events
    .map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
    .join("");
  const fetcher = (async () =>
    new Response(body, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  return createOpenAIProvider({ fetch: fetcher, maxRetries: 0 })
    .stream(
      { model: "gpt-6-sol", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
      { apiKey: "sk-test", onDelta: () => {} },
    )
    .then(
      () => null,
      (error: unknown) => {
        expect(error).toBeInstanceOf(ProviderError);
        return error as ProviderError;
      },
    );
}

test("a failed response retains reported usage even before any visible output", async () => {
  const error = await failed({
    input_tokens: 1000,
    input_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 },
    output_tokens: 50,
    total_tokens: 1050,
  });
  expect(error?.partial).toEqual({
    inputTokens: 300,
    cacheReadTokens: 600,
    cacheWriteTokens: 100,
    outputTokens: 50,
    outputChars: 0,
  });
});

test("a failure without reported usage or output does not invent partial usage", async () => {
  expect((await failed(null))?.partial).toBeUndefined();
});
