import { bodyTones, mixHex, spriteBody, toneAt } from "../agent/engine.js";
import { cx } from "../cx";
import { reduced, token, useCanvas } from "./RunPixels";

/** The closed set of tool pictures an empty place can show in place of the waving agent. */
export const EMPTY_SCENES = ["files", "team", "approval", "routine", "board", "tasks"] as const;
export type EmptyScene = (typeof EMPTY_SCENES)[number];

/** Every picture is a 16×16 grid of cells, drawn in whole device pixels like the agent's dither. */
const GRID = 16;

type Paint = (x: number, y: number, color: string) => void;
interface Palette {
  ink: string;
  raised: string;
  muted: string;
  ok: string;
  warn: string;
  tones: string[];
}

/**
 * Letters of a small sprite: K ink, W the surface, m muted, o ok, w warn, b/c/d the agent's body tones (deep to
 * light), `~` a checker of c and d (the dither). Any other character is empty.
 */
function sprite(paint: Paint, p: Palette, rows: string[], at: readonly [number, number]) {
  const color: Record<string, string> = {
    K: p.ink,
    W: p.raised,
    m: p.muted,
    o: p.ok,
    w: p.warn,
    b: p.tones[1] ?? p.ink,
    c: p.tones[2] ?? p.ink,
    d: p.tones[3] ?? p.ink,
  };
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = ch === "~" ? ((x + y) % 2 ? color.c : color.d) : color[ch];
      if (fill) paint(at[0] + x, at[1] + y, fill);
    });
  });
}

/** A disc on the grid: the rim in ink, the inside as the callback says. */
function disc(paint: Paint, p: Palette, cx: number, cy: number, r: number, inside: (x: number, y: number) => string) {
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r - 1) paint(x, y, inside(x, y));
      else if (d <= r) paint(x, y, p.ink);
    }
}

const FOLDER_BACK = ["KKKKK.........", "KbbbKKKKKKKKKK", "KbbbbbbbbbbbbK", "KbbbbbbbbbbbbK"];
const FOLDER_FRONT = [
  "KKKKKKKKKKKKKK",
  "K~~~~~~~~~~~~K",
  "K~~~~~~~~~~~~K",
  "K~~~~~~~~~~~~K",
  "K~~~~~~~~~~~~K",
  "K~~~~~~~~~~~~K",
  "KKKKKKKKKKKKKK",
];
const PAPER = ["KKKKKKKKK", "KWWWWWWWK", "KWmmmmmWK", "KWWWWWWWK", "KWmmmmWWK", "KWWWWWWWK", "KWWWWWWWK"];
const BUST = [".KKK.", "KdddK", "KdKdK", "KdddK", ".KKK.", "KbbbK", "KbbbK", "KKKKK"];
const BUST_BLINK = [".KKK.", "KdddK", "KdddK", "KdddK", ".KKK.", "KbbbK", "KbbbK", "KKKKK"];

const sceneFiles = (paint: Paint, p: Palette, t: number) => {
  sprite(paint, p, FOLDER_BACK, [1, 4]);
  // The sheet peeks out of the folder and rises a cell now and then.
  sprite(paint, p, PAPER, [3, t % 2.4 > 1.6 ? 1 : 2]);
  sprite(paint, p, FOLDER_FRONT, [1, 8]);
};

const sceneTeam = (paint: Paint, p: Palette, t: number) => {
  const lift = (i: number) => (Math.floor(t * 1.2) % 3 === i ? -1 : 0);
  // Three separate silhouettes side by side, the middle one higher.
  sprite(paint, p, BUST, [0, 7 + lift(0)]);
  sprite(paint, p, BUST, [10, 7 + lift(2)]);
  sprite(paint, p, t % 4.3 > 4.15 ? BUST_BLINK : BUST, [5, 3 + lift(1)]);
};

const sceneApproval = (paint: Paint, p: Palette, t: number) => {
  // A seal stamped on a sheet: it lifts a cell, then presses.
  const pressed = t % 2.6 > 2.2;
  const y = pressed ? 1 : 0;
  for (let x = 2; x < 14; x++) paint(x, 15, p.ink);
  const tint = mixHex(p.ok, p.raised, 0.4);
  disc(paint, p, 8, 7.5 + y, 7, (px, py) => ((px + py) % 2 ? p.ok : tint));
  for (const [x, cy] of [
    [4, 8],
    [5, 9],
    [6, 10],
    [7, 9],
    [8, 8],
    [9, 7],
    [10, 6],
  ] as const) {
    paint(x, cy + y, p.raised);
    paint(x, cy - 1 + y, p.raised);
  }
};

const HANDS: ReadonlyArray<readonly [number, number]> = [
  [0, -5],
  [3, -4],
  [4, -2],
  [5, 0],
  [4, 3],
  [2, 4],
  [0, 5],
  [-2, 4],
  [-4, 3],
  [-5, 0],
  [-4, -2],
  [-3, -4],
];

const sceneRoutine = (paint: Paint, p: Palette, t: number) => {
  disc(paint, p, 8, 8, 7.5, () => p.raised);
  for (const [x, y] of [
    [7, 2],
    [8, 2],
    [7, 13],
    [8, 13],
    [2, 7],
    [2, 8],
    [13, 7],
    [13, 8],
  ] as const)
    paint(x, y, p.muted);
  // The hand steps round (twelve stops); the short one stays on the agent's tone.
  const stop = HANDS[Math.floor(t * 1.5) % HANDS.length] ?? HANDS[0];
  if (stop) {
    for (let k = 0; k <= 5; k++) {
      const x = 7 + Math.round((stop[0] * k) / 5);
      const y = 7 + Math.round((stop[1] * k) / 5);
      paint(x, y, p.ink);
      paint(x + 1, y, p.ink);
    }
  }
  for (const [x, y] of [
    [8, 8],
    [9, 9],
    [10, 9],
  ] as const) {
    paint(x, y, p.tones[1] ?? p.ink);
  }
};

const BARS: ReadonlyArray<readonly [number, number]> = [
  [2, 4],
  [5, 7],
  [8, 5],
  [11, 9],
];

const sceneBoard = (paint: Paint, p: Palette, t: number) => {
  // A plot with four bars, one growing a cell in turn, in the body's dither.
  sprite(paint, p, ["KKKKKKKKKKKKKKK", ...Array(11).fill("KWWWWWWWWWWWWWK"), "KKKKKKKKKKKKKKK"], [0, 1]);
  const hot = Math.floor(t * 1.2) % BARS.length;
  BARS.forEach(([x, h], i) => {
    const top = 12 - h - (i === hot ? 1 : 0);
    for (let y = top; y <= 12; y++)
      for (let w = 0; w < 2; w++) paint(x + w, y, p.tones[toneAt(x + w, y, 8) % 5] ?? p.ink);
  });
};

const sceneTasks = (paint: Paint, p: Palette, t: number) => {
  // A task list: the first is done, the second ticks itself now and then, the third waits.
  const second = t % 3 > 1.5 ? "o" : "m";
  const row = (box: string, line: string) => [`KW${box}${box}W${line}WK`, `KW${box}${box}WWWWWWK`];
  const rows = [
    "KKKKKKKKKKKK",
    "KWWWWWWWWWWK",
    ...row("o", "mmmmm"),
    "KWWWWWWWWWWK",
    ...row(second, "mmmmm"),
    "KWWWWWWWWWWK",
    ...row("m", "mmmWW"),
    "KWWWWWWWWWWK",
    "KWWWWWWWWWWK",
    "KKKKKKKKKKKK",
  ];
  sprite(paint, p, rows, [0, 1]);
};

const SCENES: Record<EmptyScene, (paint: Paint, p: Palette, t: number) => void> = {
  files: sceneFiles,
  team: sceneTeam,
  approval: sceneApproval,
  routine: sceneRoutine,
  board: sceneBoard,
  tasks: sceneTasks,
};

/**
 * Lodi as the right hand wears it (teal body, happy eyes, headset): the rounded 5×5 body, the corner cut at its
 * bottom left, and the headset's earpiece on each side (K). X body, o eyes.
 */
const LODI = ["..XXX..", ".XXXXX.", "KXoXoXK", "KXXXXXK", "..XXXX."];
const LODI_AT = [9, 11] as const;
const WITH_LODI = new Set<EmptyScene>(["files", "routine", "board", "tasks"]);

function drawLodi(paint: Paint, p: Palette, t: number) {
  const tones = bodyTones("teal");
  const eyes = spriteBody("teal");
  const blink = t % 4.3 > 4.15;
  for (let y = -1; y <= LODI.length; y++)
    for (let x = -1; x <= 7; x++)
      if (LODI[y]?.[x] === undefined || LODI[y]?.[x] === ".") paint(LODI_AT[0] + x, LODI_AT[1] + y, p.raised);
  LODI.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const color =
        ch === "K" ? p.ink : ch === "o" ? (blink ? (tones[2] ?? eyes) : eyes) : (tones[toneAt(x, y, 5)] ?? eyes);
      paint(LODI_AT[0] + x, LODI_AT[1] + y, color);
    });
  });
}

/**
 * What a tool is about, drawn on a 16×16 grid of cells in the product's pixel idiom: the colors are the theme's
 * (ink, surface, muted, ok) and the agent's body tones, so it reads in both themes. It moves a little (a sheet rising,
 * a seal pressing, a clock's hand, a bar growing) and stands still with reduced motion. Same frame as the agent's
 * sticker (`size` in CSS pixels, whole cells). Decorative: the frame around it is aria-hidden and the words beside it say it.
 */
export function ToolScene({ scene, size = 128, className }: { scene: EmptyScene; size?: number; className?: string }) {
  const ref = useCanvas((ctx, canvas, tt) => {
    const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
    const P = Math.max(1, Math.round((size / GRID) * dpr));
    if (canvas.width !== GRID * P) {
      canvas.width = GRID * P;
      canvas.height = GRID * P;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = reduced() ? 0 : tt;
    const pal: Palette = {
      ink: token(canvas, "--ink", "#151514"),
      raised: token(canvas, "--raised", "#ffffff"),
      muted: token(canvas, "--muted", "#5c5c58"),
      ok: token(canvas, "--ok", "#1f7a45"),
      warn: token(canvas, "--warn", "#9a5b00"),
      tones: bodyTones("sky"),
    };
    const paint: Paint = (x, y, color) => {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
      ctx.fillStyle = color;
      ctx.fillRect(x * P, y * P, P, P);
    };
    SCENES[scene](paint, pal, t);
    if (WITH_LODI.has(scene)) drawLodi(paint, pal, t);
  }, true);
  return (
    <canvas
      ref={ref}
      className={cx("ac-sticker", "ac-toolscene", className)}
      data-scene={scene}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}
