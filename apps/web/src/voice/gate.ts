import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";

/*
 * VPS Zen: the microphone's gate, Discord's "sensibilidade de entrada". It runs on the audio thread (an AudioWorklet),
 * so a call in a background tab keeps opening and closing on time, where a timer would be held back to once a second.
 *
 * Each 128-sample block: the level of the voice band (80 Hz to 4 kHz, so a fan's hum or a desk knock weighs less),
 * then the gate. Voice detection opens when the level passes the threshold for 30 ms (a key click is shorter), stays
 * open 350 ms after the last syllable and fades out in 60 ms; the sound goes out 30 ms late, so the first syllable
 * that opened it is not cut. The automatic sensitivity follows the room's noise floor: quick to drop, slow to rise (the
 * gaps between syllables keep it at the noise, not at the voice), threshold 10 dB over it. Push to talk opens while the key is held. Closed, the microphone sends silence, so the
 * server's "who is speaking" sees only real voice too.
 */

const WORKLET = `
class VpsZenGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "voice"; this.auto = true; this.threshold = -50; this.ptt = false; this.gain = 1; this.open = false;
    this.floor = -60; this.level = -100; this.above = 0; this.hold = 0; this.g = 0;
    this.delay = new Float32Array(4096); this.w = 0; this.lag = Math.round(sampleRate * 0.03);
    // Voice band: a high-pass at 80 Hz and a low-pass at 4 kHz, one pole each.
    this.hpA = Math.exp(-2 * Math.PI * 80 / sampleRate); this.hpX = 0; this.hpY = 0;
    this.lpA = Math.exp(-2 * Math.PI * 4000 / sampleRate); this.lpY = 0;
    this.tick = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0];
    if (!input) { for (const ch of out) ch.fill(0); return true; }
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i] * this.gain;
      const hp = this.hpA * (this.hpY + x - this.hpX); this.hpX = x; this.hpY = hp;
      this.lpY = (1 - this.lpA) * hp + this.lpA * this.lpY;
      sum += this.lpY * this.lpY;
    }
    const db = 10 * Math.log10(sum / input.length + 1e-12);
    // A meter that rises at once and falls smoothly.
    this.level = db > this.level ? db : this.level * 0.9 + db * 0.1;
    const blockMs = (input.length / sampleRate) * 1000;
    if (this.auto) {
      // Minimum statistics: the gaps between syllables pull it down at once, it creeps up 4 dB a second otherwise.
      if (db < this.floor) this.floor = this.floor * 0.9 + db * 0.1;
      else this.floor += Math.min(db - this.floor, 0.01);
      this.floor = Math.max(-90, Math.min(this.floor, -25));
    }
    const threshold = this.auto ? Math.max(this.floor + 10, -65) : this.threshold;
    let want;
    if (this.mode === "ptt") want = this.ptt;
    else if (this.mode === "open") want = true;
    else {
      this.above = db > threshold ? this.above + blockMs : 0;
      if (this.above >= 30) this.hold = 350;
      else this.hold = Math.max(0, this.hold - blockMs);
      want = this.hold > 0;
    }
    this.open = want;
    const target = want ? 1 : 0;
    const step = want ? blockMs / 5 : blockMs / 60;
    for (let i = 0; i < input.length; i++) {
      this.delay[this.w] = input[i] * this.gain;
      const r = (this.w - this.lag + this.delay.length) % this.delay.length;
      this.w = (this.w + 1) % this.delay.length;
      if (i % 16 === 0) this.g = target > this.g ? Math.min(1, this.g + step / 8) : Math.max(0, this.g - step / 8);
      const y = this.delay[r] * this.g;
      for (const ch of out) ch[i] = y;
    }
    if (++this.tick % 12 === 0) this.port.postMessage({ level: this.level, open: this.open, threshold });
    return true;
  }
}
registerProcessor("vps-zen-gate", VpsZenGate);
`;

export interface GateReading {
  /** dBFS of the voice band. */
  level: number;
  open: boolean;
  /** The threshold in use (the automatic one when it finds it). */
  threshold: number;
}

export interface GateSettings {
  mode: "voice" | "ptt" | "open";
  auto: boolean;
  threshold: number;
  ptt: boolean;
  /** 0–2 */
  gain: number;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklet(ctx: AudioContext) {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}

/** A microphone track through the gate: `processedTrack` is what is sent, `onReading` what the meter shows. */
export class VoiceGate implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "vps-zen-gate";
  processedTrack?: MediaStreamTrack;
  private nodes: AudioNode[] = [];
  private node: AudioWorkletNode | null = null;

  constructor(
    private settings: GateSettings,
    private onReading: (r: GateReading) => void,
  ) {}

  async init({ track, audioContext }: AudioProcessorOptions) {
    await loadWorklet(audioContext);
    if (audioContext.state === "suspended") await audioContext.resume().catch(() => {});
    const src = audioContext.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(audioContext, "vps-zen-gate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const dest = audioContext.createMediaStreamDestination();
    src.connect(node).connect(dest);
    node.port.onmessage = (e: MessageEvent<GateReading>) => this.onReading(e.data);
    node.port.postMessage(this.settings);
    this.node = node;
    this.nodes = [src, node, dest];
    this.processedTrack = dest.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    if (this.node) this.node.port.onmessage = null;
    this.node = null;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }

  update(patch: Partial<GateSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.node?.port.postMessage(patch);
  }
}

/**
 * The microphone tested outside a call (Configurações › Voz e vídeo): the same gate, played back to the person when
 * they ask to hear themselves, sent nowhere.
 */
export async function testMicrophone(
  constraints: MediaTrackConstraints,
  settings: GateSettings,
  onReading: (r: GateReading) => void,
  hear: { on: boolean; sinkId: string },
) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const ctx = new AudioContext();
  const track = stream.getAudioTracks()[0] as MediaStreamTrack;
  const gate = new VoiceGate(settings, onReading);
  await gate.init({ kind: "audio" as Track.Kind.Audio, track, audioContext: ctx });
  let el: HTMLAudioElement | null = null;
  const setHear = async (on: boolean, sinkId: string) => {
    if (!on) {
      el?.pause();
      el = null;
      return;
    }
    el ??= new Audio();
    el.srcObject = new MediaStream(gate.processedTrack ? [gate.processedTrack] : []);
    const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId !== "default") await sink.setSinkId?.(sinkId).catch(() => {});
    await el.play().catch(() => {});
  };
  await setHear(hear.on, hear.sinkId);
  return {
    gate,
    setHear,
    stop: async () => {
      el?.pause();
      await gate.destroy();
      for (const t of stream.getTracks()) t.stop();
      await ctx.close().catch(() => {});
    },
  };
}
