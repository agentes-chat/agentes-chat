/**
 * A video's width and height as it shows, from its MP4 or QuickTime boxes, so a conversation draws its tile in the
 * video's own proportions before it loads (`FileContent.width`/`height`), as `imageSize` does for a picture. The size
 * is the first video track's `tkhd` (presentation size, 16.16 fixed point), turned by that track's matrix when it is a
 * quarter turn (a phone's upright video is stored landscape with a 90° matrix). Null for anything else (WebM, a file
 * whose `moov` is missing or cut) or a size it can't trust.
 */
export function videoSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (i: number) => (i + 4 <= b.length ? view.getUint32(i) : 0);
  const s32 = (i: number) => (i + 4 <= b.length ? view.getInt32(i) : 0);
  const type = (i: number) => String.fromCharCode(b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0);
  // An ISO base media file starts with a box whose type is `ftyp` (a few old QuickTime files start with `moov`/`mdat`).
  if (b.length < 16 || !["ftyp", "moov", "mdat", "wide", "free"].includes(type(4))) return null;

  /** The boxes between `start` and `end`: their type, where their content starts and where they end. */
  function* boxes(start: number, end: number) {
    let at = start;
    while (at + 8 <= end) {
      let size = u32(at);
      let head = 8;
      if (size === 1) {
        // A 64-bit size: past 4 GiB nothing here is read whole anyway, so its high word must be 0.
        if (u32(at + 8) !== 0) return;
        size = u32(at + 12);
        head = 16;
      } else if (size === 0) size = end - at;
      if (size < head || at + size > end) return;
      yield { type: type(at + 4), body: at + head, end: at + size };
      at += size;
    }
  }
  const child = (start: number, end: number, name: string) => {
    for (const box of boxes(start, end)) if (box.type === name) return box;
    return null;
  };

  const moov = child(0, b.length, "moov");
  if (!moov) return null;
  for (const trak of boxes(moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    // Only a video track: its media handler is `vide` (a sound track's tkhd has no size; a text one may).
    const mdia = child(trak.body, trak.end, "mdia");
    const hdlr = mdia && child(mdia.body, mdia.end, "hdlr");
    if (!hdlr || type(hdlr.body + 8) !== "vide") continue;
    const tkhd = child(trak.body, trak.end, "tkhd");
    if (!tkhd) continue;
    // Version 1 has 64-bit times: the matrix and the size come 12 bytes later.
    const v1 = b[tkhd.body] === 1;
    const matrix = tkhd.body + (v1 ? 52 : 40);
    const size = matrix + 36;
    if (size + 8 > tkhd.end) continue;
    const width = Math.round(u32(size) / 65536);
    const height = Math.round(u32(size + 4) / 65536);
    if (width <= 0 || height <= 0 || width > 100_000 || height > 100_000) continue;
    // A quarter turn: the matrix's a and d are 0 (b and c are ±1 in 16.16).
    const quarter = s32(matrix) === 0 && s32(matrix + 16) === 0 && s32(matrix + 4) !== 0;
    return quarter ? { width: height, height: width } : { width, height };
  }
  return null;
}
