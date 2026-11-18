import { describe, expect, test } from "bun:test";
import {
  firstSpeechProvider,
  SPEECH_PROVIDERS,
  speechKeyInput,
  speechProviderName,
} from "../../src/features/settings/voice";

describe("Configurações › Voz on the phone (ADR 0100), as the web's", () => {
  test("the providers with a key, in the web's order, by their own names", () => {
    expect(SPEECH_PROVIDERS.map((p) => p.name)).toEqual([
      "AssemblyAI",
      "ElevenLabs",
      "Soniox",
      "Groq",
      "OpenAI",
      "DeepInfra",
    ]);
    expect(speechProviderName("groq")).toBe("Groq");
    // A server of one's own is named in the person's words, never by a provider's name.
    expect(speechProviderName("local")).toBe("");
    expect(speechProviderName(null)).toBe("");
  });

  test("the screen starts on the saved provider, else the first", () => {
    expect(firstSpeechProvider({ provider: "soniox" })).toBe("soniox");
    expect(firstSpeechProvider({ provider: null })).toBe("assemblyai");
    expect(firstSpeechProvider(undefined)).toBe("assemblyai");
  });

  test("Testar sends a provider's key, or a server of one's own's address, trimmed; nothing while empty", () => {
    expect(speechKeyInput("openai", "  sk-123  ")).toEqual({ provider: "openai", apiKey: "sk-123" });
    expect(speechKeyInput("local", " http://speech:8000/v1 ")).toEqual({
      provider: "local",
      baseUrl: "http://speech:8000/v1",
    });
    expect(speechKeyInput("groq", "   ")).toBeNull();
  });
});
