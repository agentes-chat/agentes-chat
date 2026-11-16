/*
 * VPS Zen: what this device keeps for calls (Discord's "Voz e vídeo"): which microphone, speakers and camera, their
 * volumes, how the microphone opens (voice detection with an automatic or a set sensitivity, or push to talk), the
 * browser's own processing, and how a screen is shared. One object in localStorage, read with `useVoicePrefs`.
 */

export type DetectMode = "voice" | "ptt";
export type ScreenPreset = "text" | "balanced" | "smooth" | "weak" | "custom";
export type ScreenResolution = "480" | "720" | "1080" | "1440" | "native";
export type ScreenFps = 5 | 10 | 15 | 30 | 60;

export interface ScreenPrefs {
  preset: ScreenPreset;
  /** Used by `custom` only; the presets carry their own. */
  resolution: ScreenResolution;
  fps: ScreenFps;
  /** The tab's or the system's sound along with the screen. */
  audio: boolean;
}

export interface VoicePrefs {
  /** Device ids; `default` follows the system's. */
  input: string;
  output: string;
  camera: string;
  /** 0–200 (%): the microphone's level before it is sent. */
  inputVolume: number;
  /** 0–100 (%): everyone's voice here. */
  outputVolume: number;
  detect: DetectMode;
  /** Voice detection finds the sensitivity by itself from the room's noise. */
  autoSensitivity: boolean;
  /** Set by hand: the level (dBFS, -80 to -10) the voice must pass to open the microphone. */
  threshold: number;
  /** Push to talk: `KeyboardEvent.code`, and how long the microphone stays open after the key is let go (ms). */
  pttKey: string;
  pttRelease: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  screen: ScreenPrefs;
}

export const DEFAULT_PREFS: VoicePrefs = {
  input: "default",
  output: "default",
  camera: "default",
  inputVolume: 100,
  outputVolume: 100,
  detect: "voice",
  autoSensitivity: true,
  threshold: -50,
  pttKey: "Backquote",
  pttRelease: 250,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  screen: { preset: "balanced", resolution: "1080", fps: 30, audio: true },
};

const KEY = "vps-zen.voice";
const listeners = new Set<() => void>();
let current: VoicePrefs = read();

function read(): VoicePrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<VoicePrefs>;
    return { ...DEFAULT_PREFS, ...saved, screen: { ...DEFAULT_PREFS.screen, ...(saved.screen ?? {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const voicePrefs = () => current;
export const subscribePrefs = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  current = { ...current, ...patch, screen: { ...current.screen, ...(patch.screen ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: kept for this tab only.
  }
  for (const cb of listeners) cb();
}

// Another tab changed them.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    for (const cb of listeners) cb();
  });

// ── Screen sharing: what each choice asks of the capture and the encoder ──

export interface ScreenSetup {
  width: number;
  height: number;
  fps: ScreenFps;
  /** bits per second */
  bitrate: number;
  hint: "detail" | "motion";
}

const SIZES: Record<Exclude<ScreenResolution, "native">, [number, number]> = {
  "480": [854, 480],
  "720": [1280, 720],
  "1080": [1920, 1080],
  "1440": [2560, 1440],
};

/** Bits per pixel per frame: a page of text needs less than a video to stay sharp. */
export function screenBitrate(width: number, height: number, fps: number, hint: "detail" | "motion") {
  const bpp = hint === "motion" ? 0.07 : 0.05;
  return Math.round(Math.min(8_000_000, Math.max(300_000, width * height * fps * bpp)) / 1000) * 1000;
}

export const SCREEN_PRESETS: Record<Exclude<ScreenPreset, "custom">, ScreenSetup> = {
  // Code, documents, spreadsheets: every letter sharp, few frames.
  text: { width: 1920, height: 1080, fps: 15, bitrate: 2_500_000, hint: "detail" },
  balanced: { width: 1280, height: 720, fps: 30, bitrate: 1_700_000, hint: "detail" },
  // Video, animation, a game: every frame.
  smooth: { width: 1920, height: 1080, fps: 60, bitrate: 6_000_000, hint: "motion" },
  // A weak connection: still readable, barely any upload.
  weak: { width: 1280, height: 720, fps: 5, bitrate: 500_000, hint: "detail" },
};

export function screenSetup(p: ScreenPrefs): ScreenSetup {
  if (p.preset !== "custom") return SCREEN_PRESETS[p.preset];
  const [width, height] = p.resolution === "native" ? [3840, 2160] : SIZES[p.resolution];
  const hint = p.fps >= 30 ? "motion" : "detail";
  const bitrate =
    p.resolution === "native"
      ? screenBitrate(2560, 1440, p.fps, hint)
      : screenBitrate(width as number, height as number, p.fps, hint);
  return { width: width as number, height: height as number, fps: p.fps, bitrate, hint };
}

/** A key's name for people: "Backquote" → "`", "KeyV" → "V", "ControlRight" → "Ctrl (right)". */
export function keyName(code: string, words: { space: string; left: string; right: string }) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Backquote") return "`";
  if (code === "Space") return words.space;
  const side = code.match(/^(Control|Alt|Shift|Meta)(Left|Right)$/);
  if (side) {
    const base = side[1] === "Control" ? "Ctrl" : side[1] === "Meta" ? "⌘" : (side[1] as string);
    return `${base} (${side[2] === "Left" ? words.left : words.right})`;
  }
  return code;
}
