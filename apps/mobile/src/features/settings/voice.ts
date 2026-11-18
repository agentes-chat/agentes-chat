import type { SpeechKey, SpeechKeyInput, SpeechProvider } from "@agenteschat/client";

/*
 * Configurações › Voz on the phone (ADR 0100), as the web's `VoiceSettings`: who can turn voice into text, in the
 * order the web lists them, and what "Testar" sends. Pure, so it is unit-tested; the screen draws it.
 */

/** The providers that take a key, in the web's order. Their names are the providers' own. */
export const SPEECH_PROVIDERS: readonly { id: Exclude<SpeechProvider, "local">; name: string }[] = [
  { id: "assemblyai", name: "AssemblyAI" },
  { id: "elevenlabs", name: "ElevenLabs" },
  { id: "soniox", name: "Soniox" },
  { id: "groq", name: "Groq" },
  { id: "openai", name: "OpenAI" },
  { id: "deepinfra", name: "DeepInfra" },
];

/** A provider's own name; "" for "Servidor próprio" (`local`), which the screen names in the person's words. */
export const speechProviderName = (id: SpeechProvider | null | undefined): string =>
  SPEECH_PROVIDERS.find((p) => p.id === id)?.name ?? "";

/** The one the screen starts on: the saved one, else the web's first. */
export const firstSpeechProvider = (view: Pick<SpeechKey, "provider"> | undefined): SpeechProvider =>
  view?.provider ?? "assemblyai";

/**
 * What "Testar" sends: a provider's key, or a server of one's own's address (`local`), trimmed. Null while there is
 * nothing to try. The server tries it with the provider before it keeps it and never sends it back.
 */
export function speechKeyInput(provider: SpeechProvider, typed: string): SpeechKeyInput | null {
  const value = typed.trim();
  if (!value) return null;
  return provider === "local" ? { provider, baseUrl: value } : { provider, apiKey: value };
}
