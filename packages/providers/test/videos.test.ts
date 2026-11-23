import { describe, expect, test } from "bun:test";
import {
  createGeminiProvider,
  createOpenRouterProvider,
  isVideoBlocked,
  MODEL_CATALOG,
  maxVideoCostNanoUsd,
  ProviderError,
  VIDEO_CATALOG,
  type VideoRequest,
  videoCostNanoUsd,
  videoSeconds,
  videoTypeOf,
} from "../src";
import { fakeVideoMp4 } from "../src/fake";

const MP4 = fakeVideoMp4();
const MP4_B64 = Buffer.from(MP4).toString("base64");

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/** A transport answering each request with the next scripted answer (the last one repeats). No network. */
function answers(...replies: (() => Response)[]) {
  const sent: Sent[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = init?.body;
    sent.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : null,
    });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (!reply) throw new Error("no scripted answer");
    return reply();
  }) as unknown as typeof fetch;
  return { fetcher, sent };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (data: Uint8Array) => () => new Response(data);

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  model: "gemini-omni-1.2-flash",
  prompt: "a paper boat on a rainy street",
  seconds: 8,
  aspect: "16:9",
  ...over,
});

const failure = (p: Promise<unknown> | undefined) =>
  Promise.resolve(p)
    .then(() => null)
    .catch((e: unknown) => e as ProviderError);

describe("catalog", () => {
  test("video models stay out of the chat models", () => {
    for (const id of Object.keys(VIDEO_CATALOG)) expect(MODEL_CATALOG[id]).toBeUndefined();
  });

  test("seconds within the model's range, 8 by default", () => {
    const info = { minSeconds: 3, maxSeconds: 15 };
    expect(videoSeconds(info)).toBe(8);
    expect(videoSeconds(info, 1)).toBe(3);
    expect(videoSeconds(info, 40)).toBe(15);
    expect(videoSeconds(info, 5.4)).toBe(5);
  });

  test("reserved at the worst per second, settled at what the provider reported or the catalog's price", () => {
    expect(maxVideoCostNanoUsd("gemini-omni-1.2-flash", 10)).toBe(695_040_000);
    expect(videoCostNanoUsd("gemini-omni-1.2-flash", 10, 1)).toBe(695_040_000);
    expect(maxVideoCostNanoUsd("openrouter:x-ai/grok-imagine-video", 10)).toBe(800_000_000);
    expect(videoCostNanoUsd("openrouter:x-ai/grok-imagine-video", 10, 500_000_000)).toBe(500_000_000);
    expect(videoCostNanoUsd("openrouter:x-ai/grok-imagine-video", 10)).toBe(700_000_000);
  });

  test("a video's type from its bytes", () => {
    expect(videoTypeOf(MP4)).toBe("video/mp4");
    expect(videoTypeOf(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe("video/webm");
    expect(videoTypeOf(new TextEncoder().encode("<html>nope</html>"))).toBeNull();
  });
});

describe("Gemini (Interactions API)", () => {
  test("the video response format, the start picture before the prompt, the video inline", async () => {
    const { fetcher, sent } = answers(
      json({
        status: "completed",
        model: "gemini-omni-1.2-flash",
        steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: MP4_B64 }] }],
      }),
    );
    const result = await createGeminiProvider({ fetch: fetcher }).generateVideo?.(
      request({ aspect: "9:16", seconds: 5, startImage: { mediaType: "image/png", data: "AAAA" } }),
      { apiKey: "AQ.key" },
    );
    expect(result?.video.mediaType).toBe("video/mp4");
    expect(result?.video.bytes).toEqual(MP4);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(sent[0]?.headers.get("x-goog-api-key")).toBe("AQ.key");
    expect(sent[0]?.body).toEqual({
      model: "gemini-omni-1.2-flash",
      input: [
        { type: "image", mime_type: "image/png", data: "AAAA" },
        { type: "text", text: "a paper boat on a rainy street" },
      ],
      response_format: { type: "video", aspect_ratio: "9:16", duration: "5s", resolution: "720p" },
      store: false,
    });
  });

  test("a video delivered as a file is waited for and downloaded", async () => {
    const { fetcher, sent } = answers(
      json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", uri: "files/abc" }] }] }),
      json({ state: "ACTIVE" }),
      bytes(MP4),
    );
    const result = await createGeminiProvider({ fetch: fetcher }).generateVideo?.(request(), { apiKey: "k" });
    expect(result?.video.bytes).toEqual(MP4);
    expect(sent.map((s) => s.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      "https://generativelanguage.googleapis.com/v1beta/files/abc",
      "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media",
    ]);
  });

  test("words and no video are a refusal; a bad key is a bad key", async () => {
    const refused = await failure(
      createGeminiProvider({
        fetch: answers(
          json({
            status: "completed",
            steps: [{ type: "model_output", content: [{ type: "text", text: "I can't make that." }] }],
          }),
        ).fetcher,
      }).generateVideo?.(request(), { apiKey: "k" }),
    );
    expect(isVideoBlocked(refused)).toBe(true);
    const bad = await failure(
      createGeminiProvider({
        fetch: answers(json({ error: { code: "authentication", message: "bad key" } }, 401)).fetcher,
      }).generateVideo?.(request(), { apiKey: "k" }),
    );
    expect(bad?.message).toBe("invalid provider API key");
  });
});

describe("OpenRouter (Video API)", () => {
  test("submits, polls until completed, downloads with the key, priced at what it charged", async () => {
    const { fetcher, sent } = answers(
      json({ id: "job1", status: "pending" }),
      json({ id: "job1", status: "in_progress" }),
      json({ id: "job1", status: "completed", usage: { cost: 0.56, is_byok: false } }),
      bytes(MP4),
    );
    const result = await createOpenRouterProvider({ fetch: fetcher, videoPollMs: 0 }).generateVideo?.(
      request({
        model: "x-ai/grok-imagine-video",
        startImage: { mediaType: "image/jpeg", data: "BBBB" },
      }),
      { apiKey: "sk-or-test" },
    );
    expect(result?.video.bytes).toEqual(MP4);
    expect(result?.costNanoUsd).toBe(560_000_000);
    expect(sent.map((s) => s.url)).toEqual([
      "https://openrouter.ai/api/v1/videos",
      "https://openrouter.ai/api/v1/videos/job1",
      "https://openrouter.ai/api/v1/videos/job1",
      "https://openrouter.ai/api/v1/videos/job1/content?index=0",
    ]);
    expect(sent[3]?.headers.get("authorization")).toBe("Bearer sk-or-test");
    expect(sent[0]?.body).toEqual({
      model: "x-ai/grok-imagine-video",
      prompt: "a paper boat on a rainy street",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "720p",
      frame_images: [
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" }, frame_type: "first_frame" },
      ],
    });
  });

  test("a job failed by the content policy is a refusal", async () => {
    const { fetcher } = answers(
      json({ id: "job2", status: "pending" }),
      json({ id: "job2", status: "failed", error: "Content policy violation" }),
    );
    const error = await failure(
      createOpenRouterProvider({ fetch: fetcher, videoPollMs: 0 }).generateVideo?.(
        request({ model: "x-ai/grok-imagine-video" }),
        { apiKey: "k" },
      ),
    );
    expect(isVideoBlocked(error)).toBe(true);
  });

  test("a download that isn't a video fails", async () => {
    const { fetcher } = answers(json({ id: "job3", status: "completed" }), bytes(new TextEncoder().encode("<html>")));
    const error = await failure(
      createOpenRouterProvider({ fetch: fetcher, videoPollMs: 0 }).generateVideo?.(
        request({ model: "x-ai/grok-imagine-video" }),
        { apiKey: "k" },
      ),
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error?.message).toBe("could not read the provider's video");
  });
});
