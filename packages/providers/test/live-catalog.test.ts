import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { listedModels, modelInfo } from "../src/catalog";
import {
  enableLiveCatalog,
  ensureLiveCatalog,
  liveCatalogLoaded,
  parseModelsDevCatalog,
  resetLiveCatalog,
  xaiLiveEffortsOf,
} from "../src/live-catalog";
import { resetLearnedFastModels, speedFits } from "../src/plans";

afterEach(() => {
  setSystemTime();
  resetLiveCatalog();
  resetLearnedFastModels();
});

const SAMPLE_API = {
  openai: {
    models: {
      "gpt-6.9-nova": {
        id: "gpt-6.9-nova",
        name: "GPT-6.2 Astra",
        tool_call: true,
        reasoning: true,
        release_date: "2026-11-17",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_050_000, output: 128_000 },
        cost: {
          input: 8,
          output: 40,
          cache_read: 0.4,
          cache_write: 10,
          tiers: [
            { input: 16, output: 60, cache_read: 0.8, cache_write: 20, tier: { type: "context", size: 272_000 } },
          ],
        },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
        experimental: { modes: { fast: { provider: { body: { service_tier: "priority" } } } } },
      },
      "gpt-6.1-terra": {
        id: "gpt-6.1-terra",
        name: "GPT-6.1 Terra",
        tool_call: true,
        reasoning: true,
        release_date: "2026-10-26",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1_050_000, output: 128_000 },
        cost: { input: 1, output: 5, cache_read: 0.05, cache_write: 1.25 },
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        experimental: { modes: { fast: {} } },
      },
      "gpt-realtime-2.1": {
        id: "gpt-realtime-2.1",
        name: "GPT Realtime",
        tool_call: true,
        reasoning: false,
        release_date: "2026-07-06",
        modalities: { input: ["text", "audio"], output: ["text", "audio"] },
        limit: { context: 128_000, output: 8_192 },
        cost: { input: 4, output: 16 },
      },
    },
  },
  anthropic: {
    models: {
      "claude-fable-5-2": {
        id: "claude-fable-5-2",
        name: "Claude Fable 5.2",
        tool_call: true,
        reasoning: true,
        release_date: "2026-11-09",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 8, output: 40, cache_read: 0.2, cache_write: 10 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      },
    },
  },
  google: {
    models: {
      "gemini-4-hydrogen": {
        id: "gemini-4-hydrogen",
        name: "Gemini 4 Hydrogen",
        tool_call: true,
        reasoning: true,
        release_date: "2026-11-12",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_048_576, output: 65_536 },
        cost: { input: 1.5, output: 7.5, cache_read: 0.075 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
      },
    },
  },
  xai: {
    models: {
      "grok-4.7": {
        id: "grok-4.7",
        name: "Grok 4.7",
        tool_call: true,
        reasoning: true,
        release_date: "2026-09-21",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 500_000, output: 500_000 },
        cost: { input: 2, output: 6, cache_read: 0.5 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
      },
    },
  },
};

describe("live-catalog (models.dev)", () => {
  test("stays offline until enableLiveCatalog is called", async () => {
    await ensureLiveCatalog();
    expect(liveCatalogLoaded()).toBe(false);
    expect(modelInfo("gpt-6.9-nova")).toBeUndefined();
  });

  test("parses frontier models, efforts, pricing tiers, fast mode, and xAI efforts", () => {
    const parsed = parseModelsDevCatalog(SAMPLE_API);
    const ids = parsed.active.map(([id]) => id);
    expect(ids).toContain("gpt-6.9-nova");
    expect(ids).toContain("claude-fable-5-2");
    expect(ids).toContain("gemini-4-hydrogen");
    expect(ids).not.toContain("gpt-realtime-2.1");

    const terra = parsed.known.get("gpt-6.1-terra");
    expect(terra?.efforts).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(parsed.known.get("gpt-6.9-nova")?.longContext).toEqual({
      aboveInputTokens: 272_000,
      prices: { input: 16_000, output: 60_000, cacheRead: 800, cacheWrite: 20_000 },
    });
    expect(parsed.xaiEfforts.get("grok-4.7")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(parsed.fastModels).toEqual(["gpt-6.9-nova", "gpt-6.1-terra"]);
  });

  test("populates listedModels, modelInfo, xaiLiveEffortsOf, and speedFits when enabled", async () => {
    let reads = 0;
    enableLiveCatalog((async () => {
      reads++;
      return new Response(JSON.stringify(SAMPLE_API), { status: 200 });
    }) as unknown as typeof fetch);

    await Promise.all([ensureLiveCatalog(), ensureLiveCatalog("gpt-6.9-nova")]);
    expect(reads).toBe(1);
    expect(liveCatalogLoaded()).toBe(true);
    expect(modelInfo("gpt-6.9-nova")?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(modelInfo("gemini-4-hydrogen")?.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(listedModels().some(([id]) => id === "claude-fable-5-2")).toBe(true);
    // Preserves static catalog recommended/tier flags on merged entries
    expect(modelInfo("gpt-6.2-sol")?.recommended).toBe(true);
    expect(xaiLiveEffortsOf("grok-4.7")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(speedFits({ kind: "codex", model: "gpt-6.9-nova" })).toBe(true);
  });
});
