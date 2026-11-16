import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The phone's storage helper over SecureStore, held in memory here: what the app kept when it last closed.
const kept = new Map<string, string>([["agenteschat.voice-speed", "1.5"]]);
mock.module("expo-secure-store", () => ({
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  getItemAsync: async (key: string) => kept.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void kept.set(key, value),
  deleteItemAsync: async (key: string) => void kept.delete(key),
}));
mock.module("expo-constants", () => ({ default: {} }));
// The app's one shared player, counting the speeds it is given.
const rates: number[] = [];
mock.module("expo-audio", () => ({
  setAudioModeAsync: async () => undefined,
  createAudioPlayer: () => ({
    addListener: () => undefined,
    replace: () => undefined,
    setPlaybackRate: (rate: number) => void rates.push(rate),
    seekTo: async () => undefined,
    play: () => undefined,
    pause: () => undefined,
    currentStatus: { didJustFinish: false },
    currentTime: 0,
    duration: 9,
  }),
}));

const { STORAGE_PREFIX } = await import("../../src/config");
const { STORED } = await import("../../src/lib/storage");
const { setVoiceSpeed, subscribeVoiceSpeed, voiceSpeed } = await import("../../src/features/voice/speed");
const { setPlaybackSpeed, startPlayback, stopPlayback } = await import("../../src/features/voice/playback");

describe("voice messages remember the speed picked on this phone", () => {
  test("the speed kept when the app closed is where every voice message starts", () => {
    expect(`${STORAGE_PREFIX}.${STORED.voiceSpeed}`).toBe("agenteschat.voice-speed");
    expect(voiceSpeed()).toBe(1.5);
  });

  test("a new pick is kept on the phone and reaches every player on screen", async () => {
    let told = 0;
    const stop = subscribeVoiceSpeed(() => told++);
    setVoiceSpeed(2);
    stop();
    expect(voiceSpeed()).toBe(2);
    expect(told).toBe(1);
    await Promise.resolve();
    expect(kept.get("agenteschat.voice-speed")).toBe("2");
  });

  test("a new speed reaches only the voice message playing, never the listen-back of a take", async () => {
    const play = (id: string) =>
      startPlayback({
        id,
        source: null,
        durationMs: 9000,
        from: 0,
        speed: 1,
        onProgress: () => undefined,
        onEnd: () => undefined,
        onError: () => undefined,
      });
    await play("voice-take");
    rates.length = 0;
    setPlaybackSpeed("clip-other", 2);
    expect(rates).toEqual([]);
    stopPlayback();
    await play("clip-playing");
    rates.length = 0;
    setPlaybackSpeed("clip-playing", 2);
    expect(rates).toEqual([2]);
    stopPlayback();
    // The playing row applies the shared speed itself, so a pick on another row, or one made while it was starting,
    // reaches it.
    const row = readFileSync(join(import.meta.dir, "../../src/features/voice/VoiceMessage.tsx"), "utf8");
    expect(row).toContain("if (playing) setPlaybackSpeed(clipId, rate);");
    expect(row).toContain("}, [playing, rate, clipId]);");
  });
});
