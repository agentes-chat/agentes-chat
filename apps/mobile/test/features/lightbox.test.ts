import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AT_REST,
  CLOSE_DISTANCE,
  fitIn,
  frameAt,
  PULL_MIN_SCALE,
  pullCloses,
  pulledPlacement,
  restingFrame,
  rubberBand,
  shownBox,
} from "../../src/features/lightbox/geometry";
import { freshLink, TILE_LINK_MS } from "../../src/features/lightbox/link";

const SRC = join(import.meta.dir, "../../src");
const src = (path: string) => readFileSync(join(SRC, path), "utf8");
const screen = { x: 0, y: 0, width: 400, height: 800 };

/** Where the window's middle and size land on the screen for a frame (the area moved and scaled about its middle). */
function windowOnScreen(frame: ReturnType<typeof frameAt>, area: typeof screen, aspect: number) {
  const whole = fitIn(aspect, area);
  return {
    x: area.x + area.width / 2 + frame.translateX,
    y: area.y + area.height / 2 + frame.translateY,
    width: whole.width * frame.cropX * frame.scale,
    height: whole.height * frame.cropY * frame.scale,
  };
}

describe("lightbox geometry", () => {
  test("a picture fits whole in the middle of the screen, by its own shape", () => {
    expect(fitIn(2, screen)).toEqual({ x: 0, y: 300, width: 400, height: 200 });
    expect(fitIn(0.25, screen)).toEqual({ x: 100, y: 0, width: 200, height: 800 });
    // An unknown shape fills the screen.
    expect(fitIn(0, screen)).toEqual({ x: 0, y: 0, width: 400, height: 800 });
    expect(fitIn(Number.NaN, screen)).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });

  test("a tile that draws its picture whole shows it in its own box; one that covers shows all of the tile", () => {
    const tile = { x: 10, y: 100, width: 200, height: 200 };
    expect(shownBox(tile, 2, true)).toEqual({ x: 10, y: 150, width: 200, height: 100 });
    expect(shownBox(tile, 2, false)).toEqual(tile);
  });

  test("at 0 the picture covers its tile exactly as the tile cropped it; at 1 it is whole on the screen", () => {
    // A wide picture in a square card that covers it: cropped to the card's square.
    const tile = { x: 20, y: 500, width: 120, height: 120 };
    const aspect = 2;
    const start = frameAt(0, tile, screen, aspect, AT_REST, 20);
    const at0 = windowOnScreen(start, screen, aspect);
    expect(at0.x).toBeCloseTo(80);
    expect(at0.y).toBeCloseTo(560);
    expect(at0.width).toBeCloseTo(120);
    expect(at0.height).toBeCloseTo(120);
    // The picture inside covers the card: its height is the card's, its width twice that.
    expect(fitIn(aspect, screen).height * start.scale).toBeCloseTo(120);
    // Its corners on the screen are the card's.
    expect(start.radius * start.scale * Math.min(start.cropX, start.cropY)).toBeCloseTo(20);
    const end = frameAt(1, tile, screen, aspect, AT_REST, 20);
    for (const [key, value] of Object.entries({
      translateX: 0,
      translateY: 0,
      scale: 1,
      cropX: 1,
      cropY: 1,
      radius: 0,
    }))
      expect(end[key as keyof typeof end]).toBeCloseTo(value);
    // Halfway, between the two.
    const half = windowOnScreen(frameAt(0.5, tile, screen, aspect, AT_REST, 20), screen, aspect);
    expect(half.x).toBeCloseTo((80 + 200) / 2);
    expect(half.y).toBeCloseTo((560 + 400) / 2);
  });

  test("a video grows into its room between the bars, not the whole screen", () => {
    const room = { x: 0, y: 100, width: 400, height: 550 };
    const tile = { x: 50, y: 300, width: 160, height: 90 };
    const aspect = 16 / 9;
    const at0 = windowOnScreen(frameAt(0, tile, room, aspect, AT_REST, 14), room, aspect);
    expect(at0.x).toBeCloseTo(130);
    expect(at0.y).toBeCloseTo(345);
    expect(at0.width).toBeCloseTo(160);
    expect(at0.height).toBeCloseTo(90);
  });

  test("closing from a pull lands from where the pull left it", () => {
    const placed = pulledPlacement(0, 240, screen, 14);
    const tile = { x: 20, y: 500, width: 200, height: 100 };
    const from = frameAt(1, tile, screen, 2, placed, 14);
    expect(from.translateY).toBeCloseTo(placed.translateY);
    expect(from.scale).toBeCloseTo(placed.scale);
    expect(restingFrame(placed).scale).toBe(placed.scale);
  });

  test("a pull follows the finger, shrinks as it goes, and rounds to the tile's corners by the time it would close", () => {
    expect(pulledPlacement(0, 0, screen, 14)).toEqual({ translateX: 0, translateY: 0, scale: 1, radius: 0 });
    const half = pulledPlacement(0, 400, screen, 14);
    expect(half.scale).toBeCloseTo(PULL_MIN_SCALE);
    expect(half.translateY).toBeGreaterThan(0);
    expect(half.translateY).toBeLessThan(400);
    expect(pulledPlacement(0, CLOSE_DISTANCE, screen, 14).radius).toBe(14);
    // Up as well as down.
    expect(pulledPlacement(0, -400, screen, 14).translateY).toBeLessThan(0);
    // Damped, never past its limit.
    expect(Math.abs(rubberBand(10_000, 200, 0.8))).toBeLessThan(200);
    expect(rubberBand(-50, 200, 0.8)).toBeCloseTo(-rubberBand(50, 200, 0.8));
  });

  test("let go fast, the direction decides; slow, the distance", () => {
    expect(pullCloses(30, 900)).toBe(true);
    expect(pullCloses(-30, -900)).toBe(true);
    // A flick back the other way keeps it open.
    expect(pullCloses(150, -900)).toBe(false);
    expect(pullCloses(150, 50)).toBe(true);
    expect(pullCloses(60, 50)).toBe(false);
  });
});

describe("lightbox video link", () => {
  test("a tile's link plays while it has life ahead; an old one is read again", () => {
    const link = { uri: "https://files.example/v.mp4", headers: { cookie: "s" }, readAt: 1_000 };
    expect(freshLink(link, 2_000)).toEqual({ uri: link.uri, headers: link.headers });
    expect(freshLink({ uri: link.uri, readAt: 0 }, TILE_LINK_MS - 1)).toEqual({ uri: link.uri });
    expect(freshLink(link, 1_000 + TILE_LINK_MS)).toBeNull();
    // A tile that never read one (its `linkReadAt` 0) never hands it.
    expect(freshLink({ uri: link.uri, readAt: 0 }, Date.now())).toBeNull();
    expect(freshLink(null, 0)).toBeNull();
  });
});

describe("lightbox on the UI thread", () => {
  const lightbox = src("features/lightbox/Lightbox.tsx");
  const geometry = src("features/lightbox/geometry.ts");
  const declaredAt = (source: string, name: string) => source.indexOf(`function ${name}(`);

  test("each worklet's helpers are declared above it (a module's worklet captures them when it is defined)", () => {
    const order = ["setTileHidden", "showTiles", "measureIn", "startOpening", "startClosing", "LightboxView", "Page"];
    const at = order.map((name) => declaredAt(lightbox, name));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const helpers = [
      "fitIn",
      "shownBox",
      "rubberBand",
      "pullProgress",
      "pulledPlacement",
      "pullCloses",
      "mix",
      "frameAt",
    ];
    const inGeometry = helpers.map((name) => declaredAt(geometry, name));
    expect(inGeometry.every((i) => i >= 0)).toBe(true);
    expect([...inGeometry].sort((a, b) => a - b)).toEqual(inGeometry);
  });

  test("nothing on the UI thread throws: a view that went away is skipped", () => {
    for (const name of ["setTileHidden", "measureIn"]) {
      const at = declaredAt(lightbox, name);
      const body = lightbox.slice(at, lightbox.indexOf("\n}\n", at));
      expect({ name, guarded: body.includes("try {") && body.includes("catch") }).toEqual({ name, guarded: true });
    }
    // The opening's spring never starts once a close was asked for.
    expect(lightbox).toContain("if (closing.value) return;\n      progress.value = box ? withSpring(1, SPRING)");
  });

  test("the app's worklets hand the JS thread only functions made there, never one made on the UI thread", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(SRC);
    walk(join(import.meta.dir, "../../app"));
    const made = files.filter((file) =>
      /(scheduleOnRN|runOnJS)\(\s*(\(|async\s*\(|function\b|[a-zA-Z_$][\w$]*\s*=>)/.test(readFileSync(file, "utf8")),
    );
    expect(made).toEqual([]);
  });
});
