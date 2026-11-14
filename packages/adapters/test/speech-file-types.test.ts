import { expect, test } from "bun:test";
import { createSpeechEngine } from "../src/speech";

test.each([
  ["audio/ogg; codecs=opus", "ogg"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/x-flac", "flac"],
  ["Audio/WebM; codecs=opus", "webm"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/mp4", "m4a"],
])("speech uploads preserve the format of %s", async (contentType, extension) => {
  let uploaded: File | undefined;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error("expected multipart audio");
    uploaded = form.get("file") as File;
    return Response.json({ text: "hello" });
  }) as typeof fetch;
  const engine = createSpeechEngine("local", { baseUrl: "https://speech.example/v1" }, { fetch: fetcher });
  const audio = new Uint8Array([1, 2, 3]);
  expect(await engine?.file({ audio, contentType, language: null, terms: [] })).toEqual({ text: "hello" });
  expect(uploaded?.name).toBe(`voice.${extension}`);
  if (!uploaded) throw new Error("no audio was uploaded");
  expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(audio);
});
