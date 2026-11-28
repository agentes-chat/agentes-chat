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
// What the take needs of iOS's session (a native module, which needs React Native): nothing here.
mock.module("../../src/lib/voice-session", () => ({
  allowFeedbackWhileRecording: () => undefined,
  playSystemSound: () => false,
  systemSounds: false,
}));
// The app's one shared player, counting the speeds it is given. A test moves its clock (`currentTime`, of a 9 s clip),
// sets the length it reads (`duration`), says it ended (`finish`), and can hold its seeks until it lets them land.
const rates: number[] = [];
const clock = {
  currentTime: 0,
  duration: 9,
  state: "ready",
  holdSeeks: false,
  land: null as null | (() => void),
  status: null as null | ((status: { didJustFinish?: boolean; error?: string }) => void),
};
const finish = () => clock.status?.({ didJustFinish: true });
// What the player says of itself (the system's controls pause and play it), and what it gave the system to show.
const status: { isLoaded?: boolean; playing?: boolean; isBuffering?: boolean } = {};
const shown: { active: boolean; title?: string; artist?: string }[] = [];
mock.module("expo-audio", () => ({
  setAudioModeAsync: async () => undefined,
  createAudioPlayer: () => ({
    addListener: (_: string, listener: typeof clock.status) => {
      clock.status = listener;
    },
    replace: () => undefined,
    setPlaybackRate: (rate: number) => void rates.push(rate),
    seekTo: (seconds: number) =>
      new Promise<void>((done) => {
        const land = () => {
          clock.currentTime = seconds;
          done();
        };
        if (clock.holdSeeks) clock.land = land;
        else land();
      }),
    play: () => undefined,
    pause: () => undefined,
    setActiveForLockScreen: (active: boolean, metadata?: { title?: string; artist?: string }) =>
      void shown.push({ active, ...metadata }),
    clearLockScreenControls: () => void shown.push({ active: false }),
    get currentStatus() {
      return { ...status, didJustFinish: false, playbackState: clock.state };
    },
    get currentTime() {
      return clock.currentTime;
    },
    get duration() {
      return clock.duration;
    },
  }),
}));

const { STORAGE_PREFIX } = await import("../../src/config");
const { STORED } = await import("../../src/lib/storage");
const { setVoiceSpeed, subscribeVoiceSpeed, voiceSpeed } = await import("../../src/features/voice/speed");
const { placeOf, playingId, seekPlayback, setPlaybackSpeed, startingId, startPlayback, stopPlayback, subscribePlace } =
  await import("../../src/features/voice/playback");

/** A few of the player's 50 ms ticks. */
const ticks = () => Bun.sleep(160);
const request = (id: string, from = 0) => ({
  id,
  source: null,
  durationMs: 9000,
  from,
  speed: 1,
  onError: () => undefined,
});

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

describe("where a voice message stands lives in the playback module, not in its row", () => {
  test("each tick moves the clip's place and is heard with its id; another clip starting keeps it for the next play", async () => {
    clock.currentTime = 0;
    const heard = new Set<string>();
    const unsubscribe = subscribePlace((id) => heard.add(id));
    await startPlayback(request("clip-a"));
    clock.currentTime = 3;
    await ticks();
    // A row drawn again while it plays (the list recycles rows) reads this, whatever its row saw before.
    expect(placeOf("clip-a")).toBeCloseTo(1 / 3, 5);
    expect(heard.has("clip-a")).toBe(true);
    await startPlayback(request("clip-b"));
    expect(playingId()).toBe("clip-b");
    expect(placeOf("clip-a")).toBeCloseTo(1 / 3, 5);
    stopPlayback();
    unsubscribe();
  });

  test("a seek places the clip at once and holds the player's stale ticks back until it lands", async () => {
    clock.currentTime = 0;
    clock.holdSeeks = true;
    await startPlayback(request("clip-c"));
    clock.currentTime = 1;
    await ticks();
    expect(placeOf("clip-c")).toBeCloseTo(1 / 9, 5);
    seekPlayback("clip-c", 0.8);
    expect(placeOf("clip-c")).toBe(0.8);
    // The player still reads where it was: the handle doesn't jump back.
    clock.currentTime = 1.1;
    await ticks();
    expect(placeOf("clip-c")).toBe(0.8);
    clock.land?.();
    await ticks();
    expect(placeOf("clip-c")).toBeCloseTo(0.8, 5);
    clock.holdSeeks = false;
    stopPlayback();
    // A clip not playing takes the seek as its place: its next play starts there.
    seekPlayback("clip-c", 0.5);
    expect(placeOf("clip-c")).toBe(0.5);
  });

  test("the play button spins from the tap until the clip moves; a stop while starting plays nothing", async () => {
    clock.currentTime = 0;
    const started = startPlayback(request("clip-d"));
    // At once, before the audio mode and the file are ready.
    expect(startingId()).toBe("clip-d");
    await started;
    expect(playingId()).toBe("clip-d");
    expect(startingId()).toBe("clip-d");
    clock.currentTime = 0.5;
    await ticks();
    expect(startingId()).toBeNull();
    stopPlayback();
    const again = startPlayback(request("clip-e"));
    expect(startingId()).toBe("clip-e");
    stopPlayback();
    await again;
    expect(startingId()).toBeNull();
    expect(playingId()).toBeNull();
  });

  test("a clip that ends goes back to its start", async () => {
    clock.currentTime = 0;
    let ended = 0;
    await startPlayback({ ...request("clip-f"), onEnd: () => ended++ });
    clock.currentTime = 4.5;
    await ticks();
    expect(placeOf("clip-f")).toBeCloseTo(0.5, 5);
    clock.currentTime = 9;
    finish();
    await ticks();
    expect([placeOf("clip-f"), playingId(), ended]).toEqual([0, null, 1]);
  });

  test("a clip keeps playing to its own end when the player reads a shorter length (a file a browser recorded)", async () => {
    // Android's player reads 1.2 s of a 17 s recording whose header carries no full length.
    clock.currentTime = 0;
    clock.duration = 1.2;
    let ended = 0;
    await startPlayback({ ...request("clip-g"), durationMs: 17_000, onEnd: () => ended++ });
    clock.currentTime = 1.2;
    await ticks();
    expect(playingId()).toBe("clip-g");
    expect(placeOf("clip-g")).toBeCloseTo(1.2 / 17, 5);
    clock.currentTime = 16.9;
    await ticks();
    expect([playingId(), ended]).toEqual(["clip-g", 0]);
    // Its end is the player's: Android's state says it before the event comes.
    clock.state = "ended";
    await ticks();
    expect([placeOf("clip-g"), playingId(), ended]).toEqual([0, null, 1]);
    clock.state = "ready";
    clock.duration = 9;
  });

  test("an audio file with no length of its own plays by the player's", async () => {
    clock.currentTime = 0;
    await startPlayback({ ...request("clip-h"), durationMs: 0 });
    clock.currentTime = 4.5;
    await ticks();
    expect(placeOf("clip-h")).toBeCloseTo(0.5, 5);
    stopPlayback();
  });
});

describe("what plays is the system's: its controls, who said it, paused there and played again", () => {
  test("a message's clip goes to the system with who said it; a take heard back stays in the app; a stop takes it away", async () => {
    clock.currentTime = 0;
    shown.length = 0;
    await startPlayback({ ...request("clip-i"), nowPlaying: { title: "Ana Souza", artist: "Mensagem de voz" } });
    expect(shown).toEqual([{ active: true, title: "Ana Souza", artist: "Mensagem de voz" }]);
    stopPlayback();
    expect(shown.at(-1)).toEqual({ active: false });
    shown.length = 0;
    await startPlayback(request("voice-take"));
    expect(shown.filter((s) => s.active)).toEqual([]);
    stopPlayback();
  });

  test("paused from the Lock Screen it shows stopped where it is, keeps its controls, and plays on from there", async () => {
    clock.currentTime = 0;
    shown.length = 0;
    await startPlayback({ ...request("clip-j"), nowPlaying: { title: "Bruno Lima" } });
    clock.currentTime = 3;
    Object.assign(status, { isLoaded: true, playing: true, isBuffering: false });
    await ticks();
    expect(playingId()).toBe("clip-j");
    // The system paused it: the row shows play, its place kept, the controls still there.
    status.playing = false;
    await ticks();
    expect(playingId()).toBeNull();
    expect(placeOf("clip-j")).toBeCloseTo(1 / 3, 5);
    expect(shown.some((s) => !s.active)).toBe(false);
    // Played again there: it is the clip playing again.
    status.playing = true;
    await Bun.sleep(400);
    expect(playingId()).toBe("clip-j");
    stopPlayback();
    expect(shown.at(-1)).toEqual({ active: false });
    Object.assign(status, { isLoaded: undefined, playing: undefined, isBuffering: undefined });
  });

  test("a clip that ends just after it read as paused (it stops playing at its end) leaves the Lock Screen with its end", async () => {
    for (const end of ["event", "state"] as const) {
      clock.currentTime = 0;
      shown.length = 0;
      let ended = 0;
      await startPlayback({ ...request(`clip-end-${end}`), nowPlaying: { title: "Bruno Lima" }, onEnd: () => ended++ });
      Object.assign(status, { isLoaded: true, playing: true, isBuffering: false });
      clock.currentTime = 8.9;
      await ticks();
      // At its end it stops playing, which a tick takes for a pause from the system before the end is said.
      status.playing = false;
      clock.currentTime = 9;
      await ticks();
      expect(playingId()).toBeNull();
      // iOS says it in the event; Android's state says it, read while it waits.
      if (end === "event") finish();
      else clock.state = "ended";
      await Bun.sleep(400);
      expect([placeOf(`clip-end-${end}`), ended, shown.at(-1)]).toEqual([0, 1, { active: false }]);
      clock.state = "ready";
      Object.assign(status, { isLoaded: undefined, playing: undefined, isBuffering: undefined });
    }
  });

  test("the audio mode keeps a playing voice going in the background, never a take", () => {
    const mode = readFileSync(join(import.meta.dir, "../../src/lib/audio-mode.ts"), "utf8");
    expect(mode).toContain("shouldPlayInBackground: !recording,");
    const config = readFileSync(join(import.meta.dir, "../../app.config.ts"), "utf8");
    expect(config).toContain("enableBackgroundPlayback: true,");
    expect(config).toContain('["expo-video", { supportsBackgroundPlayback: true, supportsPictureInPicture: false }]');
    // Android's media-playback service needs its permission: never blocked again.
    expect(config).not.toContain('"android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",');
    const video = readFileSync(join(import.meta.dir, "../../src/features/files/VideoPlayer.tsx"), "utf8");
    expect(video).toContain("p.staysActiveInBackground = true;");
    expect(video).toContain("p.showNowPlayingNotification = true;");
    // One thing plays at a time: a video stops a voice, a voice pauses a video.
    expect(video).toContain("onVoiceStarts(pauseCurrent);");
    expect(video).toMatch(/current = player;\s*stopPlayback\(\);/);
  });
});
