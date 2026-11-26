import { initialsOf, personCropFor, recipeOfUrl, renderPerson, teamSky } from "@agenteschat/ui";
import { accessoryTop, drawAccessory, drawAgent } from "@agenteschat/ui/agent/engine";
import { ditherIndex, pixelOf } from "@agenteschat/ui/sky/math";
import { fileSaver } from "@/components/artifacts/fileSaver";
import { confettiBits, type ShellFace } from "./Shell";

/*
 * The team's photo as a picture to keep (ADR 0162, the celebration after Checkout): what `Photo` shows, drawn on a
 * canvas in the browser and saved through the app's saver, nothing sent anywhere. The day sky with its confetti, the
 * right hand saying hello, the person beside it and the other agents, each drawn by the agent engine in its own look,
 * then the photo's words under it and the product's name, small. Always in the light theme's colors: a picture shared
 * looks the same wherever it opens.
 */

export interface TeamPhotoInput {
  /** The right hand first, then the other agents. */
  cast: readonly ShellFace[];
  person: { name: string; image: string | null };
  /** What the right hand says over its face. */
  say?: string;
  /** The words under the photo: the team and since when, the welcome, who is in it. */
  eyebrow: string;
  title: string;
  lead: string;
}

/** The picture's size in its own pixels, drawn at twice that so edges and words stay sharp when it is zoomed. */
const W = 1600;
const H = 1000;
const DPR = 2;
/** The celebration's photo, this many times larger: its CSS pixels in the picture's. */
const K = 3;
/** One pixel of the sky: 4 CSS pixels in the app. */
const SKY_PX = 4 * K;
/** The words' margin at the sides and the bottom. */
const PAD = 96;
/** The light theme's surfaces and inks (packages/ui tokens.css). */
const RAISED = "#ffffff";
const SUNKEN = "#f3f3f0";
const INK = "#151514";
const MUTED = "#5c5c58";
const FAINT = "#6f6f6a";
const LINE = "rgba(23, 23, 22, 0.07)";
/** The wordmark (the `Logo` component's): a brand name, never translated. */
const WORD = "agentes";
const TLD = ".chat";

/** The words under the photo: size, weight, line height and color, the app's box title, eyebrow and lead scaled up. */
const EYEBROW = { size: 32, weight: 600, line: 44, color: FAINT, max: 1 };
const TITLE = { size: 62, weight: 700, line: 74, color: INK, max: 2 };
const LEAD = { size: 38, weight: 400, line: 52, color: MUTED, max: 3 };
/** The bubble over the right hand (`.onb-photo__say`): its words, padding, corners and widest. */
const SAY = { size: 40, weight: 600, line: 56, padX: 36, padY: 24, radius: 42, tail: 12, max: 720 };
/** The wordmark under the words: the mark's side and the name's size. */
const MARK = 32;
const BRAND = 26;

type Ctx = CanvasRenderingContext2D;
type Fonts = { sans: string; brand: string; dot: string };

const canvasOf = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const context = (c: HTMLCanvasElement) => {
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  return g;
};

/** The app's own faces (`--font-sans`, the wordmark's and its dot matrix), as the page has them now. */
function fontsOf(): Fonts {
  const css = getComputedStyle(document.documentElement);
  const sans = css.getPropertyValue("--font-sans").trim() || "sans-serif";
  return {
    sans,
    brand: css.getPropertyValue("--font-brand").trim() || sans,
    dot: css.getPropertyValue("--font-dot").trim() || sans,
  };
}

const fontOf = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

/** The faces loaded for these words before anything is measured: a canvas draws with what is there. */
async function loadFonts(specs: readonly string[], text: string) {
  if (typeof document.fonts?.load !== "function") return;
  await Promise.all(specs.map((spec) => document.fonts.load(spec, text).catch(() => [])));
}

/**
 * `text` in lines at most `max` wide: by words, and a word wider than the line (or a language written without spaces)
 * between its characters. Past `limit` lines the last one ends in an ellipsis.
 */
function linesOf(g: Ctx, text: string, max: number, limit: number): string[] {
  const fits = (s: string) => g.measureText(s).width <= max;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    let rest = [...word];
    while (rest.length > 1 && !fits(rest.join(""))) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut).join(""))) cut--;
      out.push(rest.slice(0, cut).join(""));
      rest = rest.slice(cut);
    }
    line = rest.join("");
  }
  if (line) out.push(line);
  if (out.length <= limit) return out;
  let last = [...out.slice(limit - 1).join(" ")];
  while (last.length > 1 && !fits(`${last.join("").trimEnd()}…`)) last = last.slice(0, -1);
  return [...out.slice(0, limit - 1), `${last.join("").trimEnd()}…`];
}

/** Where the capitals of a line `line` tall, starting at `top`, put their baseline: their middle on the line's. */
function baselineOf(g: Ctx, top: number, line: number) {
  const cap = g.measureText("H").actualBoundingBoxAscent || line * 0.5;
  return top + (line + cap) / 2;
}

/**
 * The team's sky in daylight as `PixelSky` draws a still frame of it: the field dithered between its tones, then the
 * clouds painted over. Without the pointer's light and the passing agents: the team's sky has neither.
 */
function skyOf(cols: number, rows: number) {
  const options = teamSky(1, 0);
  const c = canvasOf(cols, rows);
  const g = context(c);
  const palette = typeof options.palette === "function" ? options.palette(RAISED) : options.palette;
  const tones = palette.map(pixelOf);
  const levels = tones.length - 1;
  const img = g.createImageData(cols, rows);
  const buf = new Uint32Array(img.data.buffer);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      buf[y * cols + x] = tones[ditherIndex(options.base(x / cols, y / rows, 0), levels, x, y)] ?? 0;
  options.after?.({ buf, w: cols, h: rows, t: 0, tones });
  g.putImageData(img, 0, 0);
  return c;
}

/** A rounded rectangle's path (corners from the top left, clockwise), for a fill, a clip or a shadow. */
function rounded(g: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * A CSS box shadow under a rounded shape: `y` down, `blur`, and a negative `spread` as the shape drawn smaller. A canvas
 * shadow ignores the transform, so its lengths are in device pixels.
 */
function shadowUnder(
  g: Ctx,
  box: { x: number; y: number; w: number; h: number; r: number | number[] },
  shadow: { y: number; blur: number; spread: number; color: string },
) {
  const s = shadow.spread;
  const shrink = (r: number) => Math.max(0, r + s);
  g.save();
  g.shadowColor = shadow.color;
  g.shadowOffsetY = shadow.y * DPR;
  g.shadowBlur = shadow.blur * DPR;
  g.fillStyle = shadow.color;
  rounded(
    g,
    box.x - s,
    box.y - s,
    box.w + 2 * s,
    box.h + 2 * s,
    Array.isArray(box.r) ? box.r.map(shrink) : shrink(box.r),
  );
  g.fill();
  g.restore();
}

/**
 * The person's face as `Avatar` shows it, in a tile `side` wide: their drawn portrait (ADR 0166) cell by cell, their
 * photo filling it, else nothing (the initials are drawn then). A photo another site won't share with the page would
 * leave the picture unsaveable: then the initials too.
 */
async function faceOf(image: string | null, side: number): Promise<HTMLCanvasElement | null> {
  if (!image) return null;
  const px = side * DPR;
  const recipe = recipeOfUrl(image);
  if (recipe) {
    const c = canvasOf(px, px);
    return renderPerson(c, recipe, { crop: personCropFor(side), px }) ? c : null;
  }
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = image;
    await img.decode();
    const c = canvasOf(px, px);
    const g = context(c);
    // As `object-fit: cover`.
    const k = Math.max(px / img.naturalWidth, px / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
    g.getImageData(0, 0, 1, 1);
    return c;
  } catch {
    return null;
  }
}

/** The cast's sizes in the picture (the app's 58, 44 and 50 px, three times), smaller when many stand in the row. */
function castSizes(others: number, lead: boolean) {
  const snap = (v: number) => Math.max(48, Math.floor(v / 16) * 16);
  let sizes = { lead: 176, agent: 128, me: 144, gap: 48 };
  const width = () => (lead ? sizes.lead + sizes.gap : 0) + sizes.me + others * (sizes.agent + sizes.gap);
  const room = W - 2 * PAD;
  const wide = width();
  if (wide > room) {
    const f = room / wide;
    sizes = {
      lead: snap(sizes.lead * f),
      agent: snap(sizes.agent * f),
      me: snap(sizes.me * f),
      gap: Math.round(48 * f),
    };
  }
  return { ...sizes, width: width() };
}

/** An agent standing with its box at (x, y), side `s`, happy, in its own look: as `Avatar` draws it unframed. */
function drawFace(g: Ctx, face: ShellFace, x: number, y: number, s: number) {
  const look = face.look;
  const accessory = look?.accessory && look.accessory !== "none" ? look.accessory : undefined;
  drawAgent(g, x, y, s, {
    color: look?.color,
    eyes: look?.eyes,
    pose: { expression: "happy" },
    cells: 16,
    after: accessory ? (ctx, side, frame) => drawAccessory(ctx, side, accessory, frame) : undefined,
  });
}

/** The person's tile (`.onb-photo__me`): a white ring and a soft shadow round it, their face or initials in it. */
async function drawPerson(g: Ctx, fonts: Fonts, person: TeamPhotoInput["person"], x: number, y: number, s: number) {
  const r = s * 0.3;
  const ring = 3 * K;
  shadowUnder(g, { x, y, w: s, h: s, r }, { y: 8 * K, blur: 18 * K, spread: -6 * K, color: "rgba(0, 20, 60, 0.45)" });
  g.fillStyle = "#ffffff";
  rounded(g, x - ring, y - ring, s + 2 * ring, s + 2 * ring, r + ring);
  g.fill();
  g.save();
  rounded(g, x, y, s, s, r);
  g.clip();
  g.fillStyle = SUNKEN;
  g.fillRect(x, y, s, s);
  const face = await faceOf(person.image, s);
  if (face) {
    // A portrait's cells stay whole pixels; a photo is smoothed.
    g.imageSmoothingEnabled = !recipeOfUrl(person.image);
    g.drawImage(face, x, y, s, s);
    g.imageSmoothingEnabled = false;
  } else {
    const initials = initialsOf(person.name);
    g.font = fontOf(700, Math.round((s * 20) / 56), fonts.sans);
    g.fillStyle = INK;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const m = g.measureText(initials);
    g.fillText(initials, x + s / 2, y + s / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    g.textAlign = "left";
  }
  // The tile's hairline (`.ac-avatar--framed`).
  g.strokeStyle = LINE;
  g.lineWidth = 2 * K;
  rounded(g, x, y, s, s, r);
  g.stroke();
  g.restore();
}

/** What the right hand says, as lines in its bubble and the bubble's size: measured before the sky is laid out. */
function sayBox(g: Ctx, fonts: Fonts, say: string) {
  g.font = fontOf(SAY.weight, SAY.size, fonts.sans);
  const lines = linesOf(g, say, SAY.max - 2 * SAY.padX, 2);
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 2 * SAY.padX;
  return { lines, w, h: lines.length * SAY.line + 2 * SAY.padY };
}

/** The bubble over the right hand's face (`.onb-photo__say`), its tail corner toward it. */
function drawSay(
  g: Ctx,
  fonts: Fonts,
  { lines, w, h }: ReturnType<typeof sayBox>,
  leadX: number,
  leadY: number,
  leadS: number,
) {
  g.font = fontOf(SAY.weight, SAY.size, fonts.sans);
  const x = Math.round(Math.min(leadX + leadS * 0.46, W - PAD / 2 - w));
  const y = Math.round(leadY - 8 * K - h);
  const r = [SAY.radius, SAY.radius, SAY.radius, SAY.tail];
  shadowUnder(g, { x, y, w, h, r }, { y: 10 * K, blur: 30 * K, spread: -10 * K, color: "rgba(0, 20, 60, 0.45)" });
  g.fillStyle = RAISED;
  rounded(g, x, y, w, h, r);
  g.fill();
  g.fillStyle = INK;
  lines.forEach((l, i) => {
    g.fillText(l, x + SAY.padX, baselineOf(g, y + SAY.padY + i * SAY.line, SAY.line));
  });
}

/** Draws the photo and its words: a PNG of `W`×`H` at twice the pixels. */
export async function drawTeamPhoto(input: TeamPhotoInput): Promise<Blob> {
  const fonts = fontsOf();
  const words = [input.eyebrow, input.title, input.lead, input.say ?? "", input.person.name].join(" ");
  await loadFonts(
    [
      fontOf(EYEBROW.weight, EYEBROW.size, fonts.sans),
      fontOf(TITLE.weight, TITLE.size, fonts.sans),
      fontOf(LEAD.weight, LEAD.size, fonts.sans),
      fontOf(SAY.weight, SAY.size, fonts.sans),
      fontOf(700, 51, fonts.sans),
    ],
    words,
  );
  await loadFonts([fontOf(300, BRAND, fonts.brand), fontOf(600, BRAND, fonts.dot)], WORD + TLD);

  const canvas = canvasOf(W * DPR, H * DPR);
  const g = context(canvas);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = RAISED;
  g.fillRect(0, 0, W, H);

  // The sky holds at least the team and the bubble over the right hand and what it wears on its head, 24 under the
  // picture's top.
  const [lead, ...rest] = input.cast;
  const sizes = castSizes(rest.length, Boolean(lead));
  const say = lead && input.say ? sayBox(g, fonts, input.say) : null;
  const worn = lead ? Math.round(sizes.lead * accessoryTop(lead.look?.accessory)) : 0;
  const least = Math.ceil((22 * K + (lead ? sizes.lead + worn : sizes.me) + (say ? 8 * K + say.h : 0) + 24) / SKY_PX);
  // The words, measured: 64 under the sky, 48 over the product's name. Where even the least sky leaves them too
  // little room, the lead gives up a line; the sky takes what they leave, in whole sky pixels.
  const markTop = H - 56 - MARK;
  const GAPS = [10, 16];
  const measure = (leadMax: number) =>
    [EYEBROW, TITLE, { ...LEAD, max: leadMax }].map((style, i) => {
      g.font = fontOf(style.weight, style.size, fonts.sans);
      const text = [input.eyebrow, input.title, input.lead][i] ?? "";
      return { style, lines: text ? linesOf(g, text, W - 2 * PAD, style.max) : [] };
    });
  const heightOf = (words: ReturnType<typeof measure>) =>
    words.reduce(
      (sum, b, i) => sum + b.lines.length * b.style.line + (i > 0 && b.lines.length ? (GAPS[i - 1] ?? 0) : 0),
      0,
    );
  let block = measure(LEAD.max);
  for (let max = LEAD.max - 1; max >= 1 && heightOf(block) > markTop - 48 - 64 - least * SKY_PX; max--)
    block = measure(max);
  const room = markTop - 48 - heightOf(block) - 64;
  const skyH = Math.max(least, Math.min(52, Math.floor(room / SKY_PX))) * SKY_PX;

  // The sky, its pixels whole.
  g.imageSmoothingEnabled = false;
  const cols = Math.ceil(W / SKY_PX);
  const rows = skyH / SKY_PX;
  g.drawImage(skyOf(cols, rows), 0, 0, cols * SKY_PX, skyH);

  // The confetti over it, under the team.
  for (const bit of confettiBits()) {
    const side = bit.size * K;
    g.save();
    g.translate((bit.left / 100) * W + side / 2, (bit.top / 100) * skyH + side / 2);
    g.rotate((bit.turn * Math.PI) / 180);
    g.fillStyle = "rgba(0, 0, 0, 0.08)";
    g.fillRect(-side / 2, -side / 2 + K, side, side);
    g.fillStyle = bit.color;
    g.fillRect(-side / 2, -side / 2, side, side);
    g.restore();
  }

  // The team on the sky's ground: the right hand, the person beside it, then the others, their feet on one line.
  const ground = skyH - 22 * K;
  let x = Math.round((W - sizes.width) / 2);
  const leadAt = lead ? { x, y: ground - sizes.lead, s: sizes.lead } : null;
  if (lead && leadAt) {
    drawFace(g, lead, leadAt.x, leadAt.y, leadAt.s);
    x += sizes.lead + sizes.gap;
  }
  await drawPerson(g, fonts, input.person, x, ground - sizes.me, sizes.me);
  x += sizes.me + sizes.gap;
  for (const face of rest) {
    drawFace(g, face, x, ground - sizes.agent, sizes.agent);
    x += sizes.agent + sizes.gap;
  }
  // The bubble over what the right hand wears (a headset, a cap), never over its accessory.
  if (leadAt && say) drawSay(g, fonts, say, leadAt.x, leadAt.y - worn, leadAt.s);

  // The words under it.
  let top = skyH + 64;
  block.forEach((b, i) => {
    if (!b.lines.length) return;
    if (i > 0) top += GAPS[i - 1] ?? 0;
    g.font = fontOf(b.style.weight, b.style.size, fonts.sans);
    g.fillStyle = b.style.color;
    for (const line of b.lines) {
      g.fillText(line, PAD, baselineOf(g, top, b.style.line));
      top += b.style.line;
    }
  });

  // The product's name, small: the agent mark and the wordmark, ".chat" in its dot matrix.
  drawAgent(g, PAD, markTop, MARK, { cells: 16 });
  g.font = fontOf(300, BRAND, fonts.brand);
  g.fillStyle = INK;
  const nameX = PAD + MARK + 8;
  const nameY = baselineOf(g, markTop, MARK);
  g.fillText(WORD, nameX, nameY);
  const wordW = g.measureText(WORD).width;
  g.font = fontOf(600, Math.round(BRAND * 0.62), fonts.dot);
  g.fillStyle = MUTED;
  g.fillText(TLD, nameX + wordW + 2, nameY);

  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("png"))), "image/png"),
  );
}

/** The photo's drawing, swappable for tests (their DOM has no 2D canvas). */
export const teamPhoto = { draw: drawTeamPhoto };

/** Draws the photo and saves it as `name` through the app's saver: a download (the desktop app's goes to Downloads). */
export async function saveTeamPhoto(input: TeamPhotoInput, name: string) {
  const png = await teamPhoto.draw(input);
  const url = URL.createObjectURL(png);
  fileSaver.save(url, name);
  // The download reads the address after the click returns: it stays a minute.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
