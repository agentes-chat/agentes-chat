import { describe, expect, test } from "bun:test";
import { videoSize } from "../src/video-size";

/** An ISO base media box: its 32-bit size, its type, then its content. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const bytes = (n: number) => new Uint8Array(n);
const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
/** A quarter turn, as a phone writes its upright video: a = d = 0, b = 1, c = -1. */
const QUARTER = [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000];

function tkhd(width: number, height: number, { version = 0, matrix = IDENTITY } = {}) {
  const head = version === 1 ? 4 + 32 + 16 : 4 + 20 + 16; // version/flags, times and ids, reserved/layer/volume
  const body = bytes(head + 36 + 8);
  const v = new DataView(body.buffer);
  body[0] = version;
  for (const [i, m] of matrix.entries()) v.setInt32(head + i * 4, m);
  v.setUint32(head + 36, width * 65536);
  v.setUint32(head + 40, height * 65536);
  return box("tkhd", body);
}
function hdlr(handler: string) {
  const body = bytes(24);
  body.set(new TextEncoder().encode(handler), 8);
  return box("hdlr", body);
}
const trak = (handler: string, header: Uint8Array) =>
  box("trak", header, box("mdia", box("mdhd", bytes(24)), hdlr(handler)));
const file = (...top: Uint8Array[]) => {
  const parts = [box("ftyp", new TextEncoder().encode("isom"), bytes(8)), ...top];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("videoSize: a video's shape before it loads", () => {
  test("an upright video and a wide one, as their first video track says", () => {
    expect(videoSize(file(box("moov", trak("vide", tkhd(720, 1280)))))).toEqual({ width: 720, height: 1280 });
    expect(videoSize(file(box("moov", trak("vide", tkhd(1920, 1080)))))).toEqual({ width: 1920, height: 1080 });
  });

  test("a phone's upright video stored wide with a quarter-turn matrix shows upright", () => {
    expect(videoSize(file(box("moov", trak("vide", tkhd(1920, 1080, { matrix: QUARTER })))))).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  test("a version 1 track header (64-bit times) is read at its own offsets", () => {
    expect(videoSize(file(box("moov", trak("vide", tkhd(640, 480, { version: 1 })))))).toEqual({
      width: 640,
      height: 480,
    });
  });

  test("the sound track before it is skipped, and its moov may come after the media", () => {
    const moov = box("moov", trak("soun", tkhd(0, 0)), trak("vide", tkhd(1080, 1350)));
    expect(videoSize(file(box("mdat", bytes(64)), moov))).toEqual({ width: 1080, height: 1350 });
  });

  test("nothing it can trust: no video track, no moov, a cut file, not a video at all", () => {
    expect(videoSize(file(box("moov", trak("soun", tkhd(0, 0)))))).toBeNull();
    expect(videoSize(file(box("mdat", bytes(64))))).toBeNull();
    const whole = file(box("moov", trak("vide", tkhd(720, 1280))));
    expect(videoSize(whole.slice(0, whole.length - 20))).toBeNull();
    expect(videoSize(new TextEncoder().encode("this is a text file, not a video at all"))).toBeNull();
    expect(videoSize(bytes(0))).toBeNull();
  });
});
