import { afterEach, expect, test } from "bun:test";
import { costNanoUsd, parseOpenRouterModels, setOpenRouterModels } from "../src";

afterEach(() => setOpenRouterModels({}, 0));

const raw = {
  name: "Test model",
  context_length: 1_000_000,
  endpoints: ["/api/v1/chat/completions"],
  supported_parameters: ["tools"],
  architecture: { output_modalities: ["text"] },
};

test("an alias combines its long-context prices and threshold with its target's", () => {
  const models = parseOpenRouterModels({
    data: [
      {
        ...raw,
        id: "~test/latest",
        alias_target: { slug: "test/model" },
        pricing: {
          prompt: "0.000001",
          completion: "0.000002",
          overrides: [
            {
              min_prompt_tokens: 200_000,
              prompt: "0.000003",
              completion: "0.000009",
              input_cache_read: "0.0000003",
              input_cache_write: "0.0000035",
            },
          ],
        },
      },
      {
        ...raw,
        id: "test/model",
        pricing: {
          prompt: "0.000002",
          completion: "0.000003",
          input_cache_read: "0.0000002",
          input_cache_write: "0.0000025",
          overrides: [
            {
              min_prompt_tokens: 100_000,
              prompt: "0.000004",
              completion: "0.000007",
              input_cache_read: "0.0000004",
              input_cache_write: "0.000005",
            },
          ],
        },
      },
    ],
  });
  expect(models["~test/latest"]?.longContext).toEqual({
    aboveInputTokens: 99_999,
    prices: { input: 4000, output: 9000, cacheRead: 1000, cacheWrite: 5000 },
  });
  setOpenRouterModels(models);
  expect(
    costNanoUsd("~test/latest", { inputTokens: 150_000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  ).toBe(600_090_000);
});
