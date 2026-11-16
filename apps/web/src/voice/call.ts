import type {
  LocalTrackPublication,
  Participant,
  RemoteTrack,
  Room,
  Track as TrackNS,
  VideoTrack,
} from "livekit-client";

/*
 * VPS Zen: the voice call this tab is in (one at a time, like Discord: joining another channel leaves the first).
 * The LiveKit client loads only on the first join. Everything the screens draw comes from `snapshot()`, a new object
 * after every change, read with `useSyncExternalStore` (`useVoiceCall`).
 */

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";
export type VoiceError = "off" | "forbidden" | "failed" | "mic" | "camera" | "screen";

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

const userOf = (identity: string) => (identity.startsWith("u:") ? identity.slice(2) : null);

function memberOf(p: Participant, isLocal: boolean): VoiceMember {
  const L = lk as typeof import("livekit-client");
  const video = (source: TrackNS.Source) => {
    const pub = p.getTrackPublication(source);
    return pub && !pub.isMuted && pub.track ? (pub.track as VideoTrack) : null;
  };
  return {
    sid: p.sid || p.identity,
    userId: userOf(p.identity),
    name: p.name || p.identity,
    isLocal,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
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

// ── Sounds: Discord's two notes, up when someone comes in, down when someone goes ──
let ctx: AudioContext | null = null;
function chime(up: boolean) {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const notes = up ? [523.25, 783.99] : [659.25, 440];
    notes.forEach((freq, i) => {
      const c = ctx as AudioContext;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.12, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    });
  } catch {
    // No audio output: no chime.
  }
}

function attachAudio(track: RemoteTrack, key: string) {
  audioBox ??= Object.assign(document.createElement("div"), { hidden: true });
  if (!audioBox.isConnected) document.body.appendChild(audioBox);
  const el = track.attach();
  el.muted = state.deafened;
  audioBox.appendChild(el);
  audioEls.set(key, [...(audioEls.get(key) ?? []), el]);
}

function detachAudio(track: RemoteTrack, key: string) {
  for (const el of track.detach()) el.remove();
  audioEls.delete(key);
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
    throw new Error(code === "voice.off" ? "off" : res.status === 403 ? "forbidden" : "failed");
  }
  return (await res.json()) as { url: string; token: string };
}

/** Joins a channel's voice room, leaving any other first; the microphone opens at once (it asks the first time). */
export async function joinVoice(orgId: string, channelId: string, channelName: string) {
  if (state.channelId === channelId && state.status !== "idle") return;
  if (room) await leaveVoice(true);
  set({ ...IDLE, status: "connecting", orgId, channelId, channelName });
  try {
    lk ??= await import("livekit-client");
    const L = lk;
    const { url, token } = await voiceToken(orgId, channelId);
    if (state.channelId !== channelId) return;
    const r = new L.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: { screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } },
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
    r.on(E.TrackSubscribed, (track, pub, p) => {
      if (track.kind === L.Track.Kind.Audio) attachAudio(track, `${p.identity}:${pub.trackSid}`);
    });
    r.on(E.TrackUnsubscribed, (track, pub, p) => {
      if (track.kind === L.Track.Kind.Audio) detachAudio(track, `${p.identity}:${pub.trackSid}`);
    });
    r.on(E.ParticipantConnected, () => chime(true));
    r.on(E.ParticipantDisconnected, () => chime(false));
    // A screen share stopped from the browser's own "Stop sharing" bar.
    r.on(E.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.source === L.Track.Source.ScreenShare) refresh();
    });
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
    await r.startAudio().catch(() => {});
    try {
      await r.localParticipant.setMicrophoneEnabled(true);
    } catch {
      set({ error: "mic" });
    }
    refresh();
  } catch (e) {
    const code: VoiceError =
      e instanceof Error && (e.message === "off" || e.message === "forbidden") ? e.message : "failed";
    const r = room;
    room = null;
    await r?.disconnect().catch(() => {});
    set({ ...IDLE, error: code, channelId });
  }
}

function cleanup(error: VoiceError | null) {
  for (const els of audioEls.values()) for (const el of els) el.remove();
  audioEls.clear();
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
    await room.localParticipant.setMicrophoneEnabled(next);
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
  await room.localParticipant.setMicrophoneEnabled(!on).catch(() => {});
  refresh();
}

export async function toggleCamera() {
  if (!room) return;
  try {
    await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    set({ error: null });
  } catch {
    set({ error: "camera" });
  }
  refresh();
}

export async function toggleScreen() {
  if (!room) return;
  const on = !room.localParticipant.isScreenShareEnabled;
  try {
    await room.localParticipant.setScreenShareEnabled(on, {
      audio: true,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "include",
      resolution: { width: 1920, height: 1080, frameRate: 30 },
      contentHint: "detail",
    });
    set({ error: null });
  } catch (e) {
    // Closing the browser's picker isn't an error.
    if (!(e instanceof Error && e.name === "NotAllowedError")) set({ error: "screen" });
  }
  refresh();
}

/** After the browser held the audio back: a click lets it play. */
export async function allowAudio() {
  await room?.startAudio().catch(() => {});
  refresh();
}

export const clearVoiceError = () => set({ error: null });

// Closing the tab leaves the room at once, so the others don't see a ghost for 20 s.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => void room?.disconnect());
