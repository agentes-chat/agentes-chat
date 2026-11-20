import type {
  LocalAudioTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  Participant,
  RemoteTrack,
  Room,
  Track as TrackNS,
  VideoTrack,
} from "livekit-client";
import { type GateReading, type GateSettings, VoiceGate } from "./gate";
import { type ScreenPrefs, screenSetup, setVoicePrefs, subscribePrefs, type VoicePrefs, voicePrefs } from "./prefs";

/*
 * VPS Zen: the voice call this tab is in (one at a time, like Discord: joining another channel leaves the first).
 * The LiveKit client loads only on the first join. Everything the screens draw comes from `snapshot()`, a new object
 * after every change, read with `useSyncExternalStore` (`useVoiceCall`).
 *
 * The microphone goes through the gate (`gate.ts`) before it is sent; the devices, volumes and the gate follow the
 * person's choices (`prefs.ts`) live, in the call. Who is speaking is read here, not waited on from the server: my own
 * from the gate, the others' from their sound as it arrives.
 */

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";
export type VoiceError = "off" | "forbidden" | "failed" | "mic" | "camera" | "screen" | "device";

export interface VoiceMember {
  sid: string;
  userId: string | null;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  camera: VideoTrack | null;
  screen: VideoTrack | null;
}

export interface VoiceSnapshot {
  status: VoiceStatus;
  orgId: string | null;
  channelId: string | null;
  channelName: string;
  micOn: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** Push to talk: the key is held now. */
  talking: boolean;
  /** The browser held the audio back (autoplay): a click on "Ativar áudio" lets it play. */
  audioBlocked: boolean;
  /** The last failure, as a key under `voiceRooms.errors`. */
  error: VoiceError | null;
  members: VoiceMember[];
}

const IDLE: VoiceSnapshot = {
  status: "idle",
  orgId: null,
  channelId: null,
  channelName: "",
  micOn: false,
  deafened: false,
  cameraOn: false,
  screenOn: false,
  talking: false,
  audioBlocked: false,
  error: null,
  members: [],
};

let state: VoiceSnapshot = IDLE;
let room: Room | null = null;
let lk: typeof import("livekit-client") | null = null;
const listeners = new Set<() => void>();
const audioEls = new Map<string, HTMLMediaElement[]>();
let audioBox: HTMLDivElement | null = null;

export const subscribeVoice = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const voiceSnapshot = () => state;

function set(patch: Partial<VoiceSnapshot>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

// ── The gate's live reading: the meter in the settings and my own "speaking" ──

let reading: GateReading = { level: -100, open: false, threshold: -50 };
const readingListeners = new Set<() => void>();
export const subscribeReading = (cb: () => void) => {
  readingListeners.add(cb);
  return () => readingListeners.delete(cb);
};
export const gateReading = () => reading;
export function publishReading(r: GateReading) {
  const flipped = r.open !== reading.open;
  reading = r;
  for (const cb of readingListeners) cb();
  if (flipped && room) refresh();
}

let gate: VoiceGate | null = null;
let ctx: AudioContext | null = null;
const audioCtx = () => {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
};

export const gateSettings = (p: VoicePrefs, ptt = false): GateSettings => ({
  mode: p.detect,
  auto: p.autoSensitivity,
  threshold: p.threshold,
  ptt,
  gain: p.inputVolume / 100,
});

// ── Who speaks: the others' sound as it arrives, mine from the gate ──

interface Meter {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  buf: Float32Array<ArrayBuffer>;
  lastLoud: number;
}
const meters = new Map<string, Meter>();
const speakingNow = new Set<string>();
let meterTimer: ReturnType<typeof setInterval> | null = null;
const LOUD_DB = -52;
const SPEAK_HOLD_MS = 300;

function watchSpeaking(identity: string, track: RemoteTrack) {
  try {
    const c = audioCtx();
    const source = c.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    meters.get(identity)?.source.disconnect();
    meters.set(identity, { analyser, source, buf: new Float32Array(analyser.fftSize), lastLoud: 0 });
  } catch {
    // No Web Audio: the server's "speaking" stays.
  }
  meterTimer ??= setInterval(readMeters, 80);
}

function unwatchSpeaking(identity: string) {
  meters.get(identity)?.source.disconnect();
  meters.delete(identity);
  speakingNow.delete(identity);
}

function readMeters() {
  if (typeof document !== "undefined" && document.hidden) return;
  const now = performance.now();
  let changed = false;
  for (const [id, m] of meters) {
    m.analyser.getFloatTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) sum += v * v;
    const db = 10 * Math.log10(sum / m.buf.length + 1e-12);
    if (db > LOUD_DB) m.lastLoud = now;
    const on = now - m.lastLoud < SPEAK_HOLD_MS;
    if (on !== speakingNow.has(id)) {
      if (on) speakingNow.add(id);
      else speakingNow.delete(id);
      changed = true;
    }
  }
  if (changed) refresh();
}

function stopMeters() {
  for (const m of meters.values()) m.source.disconnect();
  meters.clear();
  speakingNow.clear();
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = null;
}

const userOf = (identity: string) => (identity.startsWith("u:") ? identity.slice(2) : null);

function memberOf(p: Participant, isLocal: boolean): VoiceMember {
  const L = lk as typeof import("livekit-client");
  const video = (source: TrackNS.Source) => {
    const pub = p.getTrackPublication(source);
    return pub && !pub.isMuted && pub.track ? (pub.track as VideoTrack) : null;
  };
  const micOn = p.isMicrophoneEnabled;
  const speaking = isLocal
    ? micOn && !state.deafened && (gate ? reading.open : p.isSpeaking)
    : meters.has(p.identity)
      ? speakingNow.has(p.identity)
      : p.isSpeaking;
  return {
    sid: p.sid || p.identity,
    userId: userOf(p.identity),
    name: p.name || p.identity,
    isLocal,
    speaking: micOn && speaking,
    micOn,
    camera: video(L.Track.Source.Camera),
    screen: video(L.Track.Source.ScreenShare),
  };
}

function refresh() {
  if (!room) return;
  const local = room.localParticipant;
  set({
    members: [memberOf(local, true), ...[...room.remoteParticipants.values()].map((p) => memberOf(p, false))],
    micOn: local.isMicrophoneEnabled,
    cameraOn: local.isCameraEnabled,
    screenOn: local.isScreenShareEnabled,
    audioBlocked: !room.canPlaybackAudio,
  });
}

// ── Sounds: two notes, up when someone comes in, down when someone goes ──
function chime(up: boolean) {
  try {
    const c = audioCtx();
    const now = c.currentTime;
    const notes = up ? [523.25, 783.99] : [659.25, 440];
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      const peak = 0.12 * (voicePrefs().outputVolume / 100);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    });
  } catch {
    // No audio output: no chime.
  }
}

/** "Testar som": the two notes, on the speakers picked. */
export const playTestSound = () => chime(true);

type SinkEl = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
export const canPickOutput = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

async function applySink(el: HTMLMediaElement, deviceId: string) {
  const s = el as SinkEl;
  if (s.setSinkId) await s.setSinkId(deviceId === "default" ? "" : deviceId).catch(() => {});
}

async function applyContextSink(deviceId: string) {
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (c?.setSinkId) await c.setSinkId(deviceId === "default" ? "" : deviceId).catch(() => {});
}

function attachAudio(track: RemoteTrack, key: string, identity: string) {
  audioBox ??= Object.assign(document.createElement("div"), { hidden: true });
  if (!audioBox.isConnected) document.body.appendChild(audioBox);
  const el = track.attach();
  const p = voicePrefs();
  el.muted = state.deafened;
  el.volume = p.outputVolume / 100;
  void applySink(el, p.output);
  audioBox.appendChild(el);
  audioEls.set(key, [...(audioEls.get(key) ?? []), el]);
  watchSpeaking(identity, track);
}

function detachAudio(track: RemoteTrack, key: string, identity: string) {
  for (const el of track.detach()) el.remove();
  audioEls.delete(key);
  unwatchSpeaking(identity);
}

/** The server said no to a join: voice is off here, or this person may not join; the reason is ours, not its text. */
class JoinRefused extends Error {
  constructor(readonly reason: "off" | "forbidden" | "failed") {
    super(reason);
  }
}

async function voiceToken(orgId: string, channelId: string) {
  const res = await fetch(`/api/app/organizations/${orgId}/channels/${channelId}/voice-token`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
    throw new JoinRefused(code === "voice.off" ? "off" : res.status === 403 ? "forbidden" : "failed");
  }
  return (await res.json()) as { url: string; token: string };
}

const device = (id: string) => (id && id !== "default" ? { deviceId: id } : {});
export const micOptions = (p: VoicePrefs) => ({
  ...device(p.input),
  echoCancellation: p.echoCancellation,
  noiseSuppression: p.noiseSuppression,
  autoGainControl: p.autoGainControl,
});

/** The microphone on, through the gate. */
async function openMicrophone(r: Room) {
  const L = lk as typeof import("livekit-client");
  await r.localParticipant.setMicrophoneEnabled(true, micOptions(voicePrefs()), {
    dtx: true,
    red: true,
    audioPreset: L.AudioPresets.speech,
  });
  await gateTheMicrophone(r);
}

async function gateTheMicrophone(r: Room) {
  const L = lk as typeof import("livekit-client");
  const track = r.localParticipant.getTrackPublication(L.Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
  if (!track || track.getProcessor()?.name === "vps-zen-gate") return;
  try {
    await track.setAudioContext(audioCtx());
    gate = new VoiceGate(gateSettings(voicePrefs(), pttDown), publishReading);
    await track.setProcessor(gate);
  } catch {
    // No AudioWorklet (an old browser): the raw microphone goes, with the server's "speaking".
    gate = null;
  }
}

/** Joins a channel's voice room, leaving any other first; the microphone opens at once (it asks the first time). */
export async function joinVoice(orgId: string, channelId: string, channelName: string) {
  if (state.channelId === channelId && state.status !== "idle") return;
  if (room) await leaveVoice(true);
  set({ ...IDLE, status: "connecting", orgId, channelId, channelName });
  // Inside the click: the browser lets the sound start now.
  audioCtx();
  try {
    lk ??= await import("livekit-client");
    const L = lk;
    const { url, token } = await voiceToken(orgId, channelId);
    if (state.channelId !== channelId) return;
    const p = voicePrefs();
    const r = new L.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: micOptions(p),
      videoCaptureDefaults: { ...device(p.camera), resolution: L.VideoPresets.h720.resolution },
      audioOutput: p.output !== "default" ? { deviceId: p.output } : undefined,
      publishDefaults: {
        screenShareEncoding: { maxBitrate: screenSetup(p.screen).bitrate, maxFramerate: screenSetup(p.screen).fps },
      },
    });
    room = r;
    const E = L.RoomEvent;
    for (const ev of [
      E.ParticipantConnected,
      E.ParticipantDisconnected,
      E.TrackSubscribed,
      E.TrackUnsubscribed,
      E.TrackMuted,
      E.TrackUnmuted,
      E.LocalTrackPublished,
      E.LocalTrackUnpublished,
      E.ActiveSpeakersChanged,
      E.AudioPlaybackStatusChanged,
      E.ParticipantNameChanged,
    ])
      r.on(ev, refresh);
    r.on(E.TrackSubscribed, (track, pub, part) => {
      if (track.kind === L.Track.Kind.Audio) attachAudio(track, `${part.identity}:${pub.trackSid}`, part.identity);
    });
    r.on(E.TrackUnsubscribed, (track, pub, part) => {
      if (track.kind === L.Track.Kind.Audio) detachAudio(track, `${part.identity}:${pub.trackSid}`, part.identity);
    });
    r.on(E.ParticipantConnected, () => chime(true));
    r.on(E.ParticipantDisconnected, (part) => {
      unwatchSpeaking(part.identity);
      chime(false);
    });
    // A screen share stopped from the browser's own "Stop sharing" bar.
    r.on(E.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.source === L.Track.Source.ScreenShare) refresh();
    });
    // A headset unplugged: the call moves to what the system uses now, and the list follows.
    r.on(E.MediaDevicesChanged, () => void refreshDevices());
    r.on(E.Reconnecting, () => set({ status: "reconnecting" }));
    r.on(E.Reconnected, () => {
      set({ status: "connected" });
      refresh();
    });
    r.on(E.Disconnected, () => {
      if (room === r) cleanup(null);
    });
    await r.connect(url, token);
    set({ status: "connected" });
    chime(true);
    await applyContextSink(p.output);
    await r.startAudio().catch(() => {});
    try {
      await openMicrophone(r);
    } catch {
      set({ error: "mic" });
    }
    listenPtt();
    refresh();
  } catch (e) {
    const code: VoiceError = e instanceof JoinRefused ? e.reason : "failed";
    const r = room;
    room = null;
    await r?.disconnect().catch(() => {});
    set({ ...IDLE, error: code, channelId });
  }
}

function cleanup(error: VoiceError | null) {
  for (const els of audioEls.values()) for (const el of els) el.remove();
  audioEls.clear();
  stopMeters();
  unlistenPtt();
  gate = null;
  reading = { level: -100, open: false, threshold: reading.threshold };
  room = null;
  set({ ...IDLE, error });
}

export async function leaveVoice(quiet = false) {
  const r = room;
  if (!r) return set({ ...IDLE });
  room = null;
  if (!quiet) chime(false);
  await r.disconnect().catch(() => {});
  cleanup(null);
}

export async function toggleMic() {
  if (!room) return;
  const next = !room.localParticipant.isMicrophoneEnabled;
  // Speaking undeafens, as Discord.
  if (next && state.deafened) setDeafened(false);
  try {
    if (next) await openMicrophone(room);
    else await room.localParticipant.setMicrophoneEnabled(false);
    set({ error: null });
  } catch {
    set({ error: "mic" });
  }
  refresh();
}

function setDeafened(on: boolean) {
  for (const els of audioEls.values()) for (const el of els) el.muted = on;
  set({ deafened: on });
}

/** Deafened: hears nobody and the microphone closes too; undeafening opens it again. */
export async function toggleDeafen() {
  if (!room) return;
  const on = !state.deafened;
  setDeafened(on);
  if (on) await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  else await openMicrophone(room).catch(() => set({ error: "mic" }));
  refresh();
}

export async function toggleCamera() {
  if (!room) return;
  try {
    const on = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(on, on ? device(voicePrefs().camera) : undefined);
    set({ error: null });
  } catch {
    set({ error: "camera" });
  }
  refresh();
}

/** Shares a screen with the quality picked (`prefs.screen`), or stops sharing. */
export async function toggleScreen(choice?: ScreenPrefs) {
  if (!room) return;
  const on = !room.localParticipant.isScreenShareEnabled;
  if (choice) setVoicePrefs({ screen: choice });
  const s = screenSetup(choice ?? voicePrefs().screen);
  try {
    await room.localParticipant.setScreenShareEnabled(
      on,
      {
        audio: (choice ?? voicePrefs().screen).audio,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
        resolution: { width: s.width, height: s.height, frameRate: s.fps },
        contentHint: s.hint,
      },
      { screenShareEncoding: { maxBitrate: s.bitrate, maxFramerate: s.fps }, degradationPreference: degradation(s) },
    );
    set({ error: null });
  } catch (e) {
    // Closing the browser's picker isn't an error.
    if (!(e instanceof Error && e.name === "NotAllowedError")) set({ error: "screen" });
  }
  refresh();
}

/** Text keeps its sharpness and drops frames; motion keeps its frames and drops sharpness. */
const degradation = (s: { hint: "detail" | "motion" }): RTCDegradationPreference =>
  s.hint === "motion" ? "maintain-framerate" : "maintain-resolution";

/** A new quality for the screen being shared, without picking it again. */
export async function changeScreenQuality(choice: ScreenPrefs) {
  setVoicePrefs({ screen: choice });
  const L = lk;
  if (!room || !L) return;
  const track = room.localParticipant.getTrackPublication(L.Track.Source.ScreenShare)?.track as
    | LocalVideoTrack
    | undefined;
  if (!track) return;
  const s = screenSetup(choice);
  try {
    const media = track.mediaStreamTrack;
    media.contentHint = s.hint;
    await media.applyConstraints({ width: { max: s.width }, height: { max: s.height }, frameRate: { max: s.fps } });
    const sender = track.sender;
    if (sender) {
      const params = sender.getParameters();
      for (const enc of params.encodings ?? []) {
        enc.maxFramerate = s.fps;
        enc.maxBitrate = s.bitrate;
      }
      params.degradationPreference = degradation(s);
      await sender.setParameters(params);
    }
  } catch {
    set({ error: "screen" });
  }
}

/** After the browser held the audio back: a click lets it play. */
export async function allowAudio() {
  await room?.startAudio().catch(() => {});
  audioCtx();
  refresh();
}

export const clearVoiceError = () => set({ error: null });

// ── Devices: the lists, and the call following a change of choice at once ──

export interface DeviceLists {
  input: MediaDeviceInfo[];
  output: MediaDeviceInfo[];
  camera: MediaDeviceInfo[];
  /** The browser hides names until the microphone was allowed once. */
  named: boolean;
}

let devices: DeviceLists = { input: [], output: [], camera: [], named: false };
const deviceListeners = new Set<() => void>();
export const subscribeDevices = (cb: () => void) => {
  deviceListeners.add(cb);
  if (deviceListeners.size === 1) void refreshDevices();
  return () => deviceListeners.delete(cb);
};
export const deviceLists = () => devices;

export async function refreshDevices() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  // "default" and "communications" are Chrome's aliases: the first is our "Padrão do sistema".
  const real = (kind: MediaDeviceKind) =>
    all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
  devices = {
    input: real("audioinput"),
    output: real("audiooutput"),
    camera: real("videoinput"),
    named: all.some((d) => d.label),
  };
  for (const cb of deviceListeners) cb();
}

/** Asks the browser once, so the lists get their names. */
export async function allowDevices() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of s.getTracks()) t.stop();
  } catch {
    set({ error: "mic" });
  }
  await refreshDevices();
}

if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener)
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshDevices());

/** The call follows what changed in the settings, without leaving it. */
let applied: VoicePrefs = voicePrefs();
subscribePrefs(() => {
  const p = voicePrefs();
  const was = applied;
  applied = p;
  gate?.update(gateSettings(p, pttDown));
  if (p.detect !== was.detect) {
    unlistenPtt();
    listenPtt();
  }
  if (p.outputVolume !== was.outputVolume)
    for (const els of audioEls.values()) for (const el of els) el.volume = p.outputVolume / 100;
  if (p.output !== was.output) {
    for (const els of audioEls.values()) for (const el of els) void applySink(el, p.output);
    void applyContextSink(p.output);
    if (room) void room.switchActiveDevice("audiooutput", p.output === "default" ? "default" : p.output);
  }
  const r = room;
  const L = lk;
  if (!r || !L) return;
  if (p.input !== was.input) void r.switchActiveDevice("audioinput", p.input).catch(() => set({ error: "device" }));
  else if (
    p.echoCancellation !== was.echoCancellation ||
    p.noiseSuppression !== was.noiseSuppression ||
    p.autoGainControl !== was.autoGainControl
  ) {
    const track = r.localParticipant.getTrackPublication(L.Track.Source.Microphone)?.track as
      | LocalAudioTrack
      | undefined;
    void track?.restartTrack(micOptions(p)).catch(() => set({ error: "device" }));
  }
  if (p.camera !== was.camera && r.localParticipant.isCameraEnabled)
    void r.switchActiveDevice("videoinput", p.camera).catch(() => set({ error: "device" }));
});

// ── Push to talk: the microphone opens while the key is held (this tab in front) ──

let pttDown = false;
let pttRelease: ReturnType<typeof setTimeout> | null = null;

const typingIn = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
/** A letter or the backquote, typed in a box, is writing, not talking; a function or modifier key talks anywhere. */
const writes = (code: string) =>
  /^(Key|Digit|Backquote|Space|Minus|Equal|Bracket|Semicolon|Quote|Comma|Period|Slash)/.test(code);

function setTalking(on: boolean) {
  pttDown = on;
  gate?.update({ ptt: on });
  set({ talking: on });
}

function onKeyDown(e: KeyboardEvent) {
  const p = voicePrefs();
  if (p.detect !== "ptt" || e.code !== p.pttKey || e.repeat) return;
  if (writes(e.code) && typingIn(e.target)) return;
  if (pttRelease) clearTimeout(pttRelease);
  pttRelease = null;
  setTalking(true);
}

function onKeyUp(e: KeyboardEvent) {
  const p = voicePrefs();
  if (e.code !== p.pttKey || !pttDown) return;
  if (pttRelease) clearTimeout(pttRelease);
  pttRelease = setTimeout(() => setTalking(false), p.pttRelease);
}

const onBlur = () => pttDown && setTalking(false);

function listenPtt() {
  if (typeof window === "undefined" || voicePrefs().detect !== "ptt" || !room) return;
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
}

function unlistenPtt() {
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("keyup", onKeyUp, true);
  window.removeEventListener("blur", onBlur);
  if (pttDown) setTalking(false);
}

/** In the call now (the settings' meter reads the live gate instead of opening a test). */
export const inCall = () => room !== null && state.status !== "idle";

// Closing the tab leaves the room at once, so the others don't see a ghost for 20 s.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => void room?.disconnect());
