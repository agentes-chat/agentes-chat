import { expect, test } from "bun:test";
import { createOpenAIProvider, ProviderError } from "../src";

async function reply(args: string) {
  const response = {
    id: "response-tool",
    object: "response",
    created_at: 1,
    model: "gpt-6-sol",
    status: "completed",
    output: [
      { type: "function_call", id: "fc1", call_id: "call1", name: "read_file", arguments: args, status: "completed" },
    ],
  };
  const events = [
    { type: "response.created", response: { ...response, output: [], status: "in_progress" } },
    { type: "response.completed", response },
  ];
  const body = events
    .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
    .join("");
  const fetcher = (async () =>
    new Response(body, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  return createOpenAIProvider({ fetch: fetcher, maxRetries: 0 }).stream(
    { model: "gpt-6-sol", system: "", messages: [{ role: "user", content: "read the file" }], maxTokens: 100 },
    { apiKey: "test-key", onDelta() {} },
  );
}

test.each(["{", "null", "[]", "42", '"file.txt"'])(
  "invalid tool arguments are retried, never replaced with empty defaults: %s",
  async (args) => {
    const error = await reply(args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  },
);

test("valid tool argument objects and empty argument strings still work", async () => {
  expect((await reply('{"path":"file.txt"}')).content).toEqual([
    { type: "tool_use", id: "call1", name: "read_file", input: { path: "file.txt" } },
  ]);
  expect((await reply("")).content).toEqual([{ type: "tool_use", id: "call1", name: "read_file", input: {} }]);
});
