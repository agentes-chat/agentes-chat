import { type AudioPlayer, type AudioSource, createAudioPlayer } from "expo-audio";
import { releaseVoiceAudio, voiceAudio } from "@/lib/audio-mode";

/**
 * One voice plays at a time, in the whole app: a single player that rows take turns on, so a list scrolling past
 * never holds one per message. Where each clip stands lives here too (`placeOf`), moved by a timer outside React.
 *
 * What plays belongs to the system, as a messaging app's voice notes do: it goes on when the person leaves the
 * conversation or the app, and the system shows it with its own controls (iOS: Now Playing on the Lock Screen, in
 * Control Center and the Dynamic Island; Android: the media notification and the lock screen), with who said it.
 * Paused there, the clip keeps its place and its controls (`held`), and playing again there brings it back; a stop of
 * ours, an end, or another clip takes the system's entry away. Nothing plays with no way to stop it.
 */

/** What the system shows for a clip while it plays: who said it (or the file's name), and what it is. */
export interface NowPlaying {
  title: string;
  artist?: string;
}
export interface PlayRequest {
  id: string;
  source: AudioSource;
  durationMs: number;
  from: number;
  speed: number;
  /** Each tick of the timer with where the clip is (0–1); a seek on its way holds the ticks back. */
  onProgress?: (fraction: number) => void;
  onEnd?: () => void;
  /** It didn't load or play: playback stopped, and the row says so (`reason`: the player's own words, when it said). */
  onError: (reason?: string) => void;
  /** Shown by the system while it plays (`NowPlaying`). */
  nowPlaying?: NowPlaying;
}

const TICK_MS = 50;
/** Paused from the system, the player is asked whether it plays again every this many ticks. */
const HELD_EVERY = 6;
/** Moved this far past where it started (s), the clip is playing: its button stops showing it starting. */
const MOVED_S = 0.05;
let player: AudioPlayer | null = null;
let now: PlayRequest | null = null;
/** Paused from the system's controls (the Lock Screen, a headset, a call): its controls stay, to play it again. */
let held: PlayRequest | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** Goes up with every stop (each start begins with one): a start that waited sees it was overtaken. */
let turn = 0;
/** The clip asked to play that hasn't moved yet (the audio mode, the file loading, its first frames), or null. */
let starting: string | null = null;
/** The seek on its way: until the player lands on it, it still reads its old place, which would pull the wave back. */
let seeking: Promise<unknown> | null = null;
/**
 * What else plays and gives way to a voice (a video in the viewer): told when a clip starts, so one thing plays at a
 * time across the app. Set once by the video player's module.
 */
let otherMedia: (() => void) | null = null;
export const onVoiceStarts = (pause: () => void) => {
  otherMedia = pause;
};
const listeners = new Set<() => void>();
const say = () => {
  for (const listener of listeners) listener();
};

export const subscribePlayback = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const playingId = () => now?.id ?? null;
/** The clip whose play button spins: asked to play, not moving yet. */
export const startingId = () => starting;

/**
 * Where each clip stands (0–1), here and not in its row: the one playing moves on the timer and with a seek, a stopped
 * one keeps its place for its next play, an ended one goes back to its start. The list recycles rows, and a row drawn
 * again reads this whatever happened while it was away (a clip that played on, ended, or was paused by another).
 */
const places = new Map<string, number>();
const placeListeners = new Set<(id: string) => void>();
/** Hears every move of any clip's place, with its id: per tick while one plays, so a row keeps it off React. */
export const subscribePlace = (listener: (id: string) => void) => {
  placeListeners.add(listener);
  return () => {
    placeListeners.delete(listener);
  };
};
export const placeOf = (id: string) => places.get(id) ?? 0;
/** A sound's length (ms) as its player read it, for one whose length wasn't known before it played (an audio file). */
const lengths = new Map<string, number>();
export const lengthOf = (id: string) => lengths.get(id) ?? 0;
function setPlace(id: string, at: number) {
  if (at > 0) places.set(id, at);
  else places.delete(id);
  for (const listener of placeListeners) listener(id);
}

const fraction = (p: AudioPlayer, durationMs: number) => {
  const total = p.duration > 0 ? p.duration : durationMs / 1000;
  return total > 0 ? Math.min(1, p.currentTime / total) : 0;
};

export function stopPlayback() {
  turn++;
  if (timer) clearInterval(timer);
  timer = null;
  seeking = null;
  player?.pause();
  if (!now && !starting && !held) return;
  // The system's entry goes with it: nothing stays on the Lock Screen or in the notifications for a clip that stopped.
  player?.clearLockScreenControls();
  now = null;
  held = null;
  starting = null;
  // The app's own sounds get the session back (silent in silent mode, with the music), unless a voice takes it again.
  releaseVoiceAudio();
  say();
}

function makePlayer() {
  const p = createAudioPlayer(null, { updateInterval: 100 });
  // A source that fails says so only in this event: `currentStatus`, which the timer reads, never carries the error
  // (expo-audio 58). Without it a row would stay on pause with its wave still.
  p.addListener("playbackStatusUpdate", (status) => {
    if (!status.error || !now) return;
    const { onError } = now;
    stopPlayback();
    // The player's own words go with it: a phone where clips don't play says why in the error reports.
    onError(String(status.error));
  });
  return p;
}

/**
 * Plays a clip, from `from`. Its button shows it starting at once (`startingId`, before the audio mode and the file are
 * ready) and until the clip moves; a start overtaken by another, or by a stop, plays nothing.
 */
export async function startPlayback(request: PlayRequest) {
  stopPlayback();
  otherMedia?.();
  const mine = turn;
  starting = request.id;
  say();
  const from = (request.from * request.durationMs) / 1000;
  let p: AudioPlayer;
  try {
    await voiceAudio(false);
    // Stopped, or another one started, while this waited: that one has the player (and the one timer).
    if (mine !== turn) return;
    p = player ?? makePlayer();
    player = p;
    p.replace(request.source);
    p.setPlaybackRate(request.speed);
    if (request.from > 0) await p.seekTo(from);
    if (mine !== turn) return;
    p.play();
    // A message's clip is the system's, with its controls (the audio mode keeps it going in the background:
    // `voiceAudio`); a take heard back before sending stays in the composer.
    if (request.nowPlaying) {
      p.setActiveForLockScreen(true, request.nowPlaying, { showSeekForward: false, showSeekBackward: false });
    }
  } catch (error) {
    // Its button stops spinning; the caller says why.
    if (mine === turn) stopPlayback();
    throw error;
  }
  now = request;
  say();
  let idle = 0;
  timer = setInterval(() => {
    // Paused from the system: played again there, it is the clip playing again, from where it is (asked a few times a
    // second, not on every tick, while it waits).
    if (!now) {
      if (held && ++idle % HELD_EVERY === 0 && p.currentStatus.playing) {
        now = held;
        held = null;
        say();
      }
      return;
    }
    const status = p.currentStatus;
    const done = status.didJustFinish;
    const at = fraction(p, now.durationMs);
    if (done || at >= 0.998) {
      const { onEnd, id } = now;
      stopPlayback();
      setPlace(id, 0);
      onEnd?.();
      return;
    }
    if (
      starting === now.id &&
      (p.currentTime > from + MOVED_S || (status.isLoaded && status.playing && !status.isBuffering))
    ) {
      starting = null;
      say();
    }
    if (now.durationMs <= 0 && p.duration > 0 && !lengths.has(now.id)) {
      lengths.set(now.id, p.duration * 1000);
      say();
    }
    if (seeking) return;
    setPlace(now.id, at);
    now.onProgress?.(at);
    // Paused from the system's controls (or by a call): its row shows it stopped where it is, and the system keeps
    // its controls to play it again.
    if (starting !== now.id && status.isLoaded === true && status.playing === false && status.isBuffering !== true) {
      held = now;
      now = null;
      say();
    }
  }, TICK_MS);
}

/**
 * Moves a clip to `at` (0–1): its place at once, so the next play starts there too; the player when it holds that clip,
 * and until it has landed the timer reports nothing (it would read the old place for a moment).
 */
export function seekPlayback(id: string, at: number) {
  setPlace(id, at);
  if (now?.id !== id || !player) return;
  const total = now.durationMs > 0 ? now.durationMs / 1000 : player.duration;
  const seek = player.seekTo(at * total).catch(() => undefined);
  seeking = seek;
  void seek.then(() => {
    if (seeking === seek) seeking = null;
  });
}

export function setPlaybackSpeed(id: string, speed: number) {
  if (now?.id === id) player?.setPlaybackRate(speed);
}
