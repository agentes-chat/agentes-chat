import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coverScale,
  fitIn,
  frameAt,
  growTransforms,
  pulledFrame,
  tileFrame,
} from "../../src/features/files/grow-geometry";

const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");
const screen = { width: 400, height: 800 };

describe("a picture growing out of its tile", () => {
  test("whole on the screen, in its middle", () => {
    expect(fitIn(2, screen)).toEqual({ x: 0, y: 300, width: 400, height: 200 });
    expect(fitIn(0.25, screen)).toEqual({ x: 100, y: 0, width: 200, height: 800 });
    expect(fitIn(0.4, screen)).toEqual({ x: 40, y: 0, width: 320, height: 800 });
  });

  test("from a tile that shows it whole, only the scale changes; from a deck's square card, it uncrops", () => {
    const whole = fitIn(2, screen); // 400 × 200
    // A message's single picture: its tile has its shape.
    const single = { x: 20, y: 500, width: 200, height: 100 };
    const a = growTransforms(tileFrame(single, whole), whole);
    expect(a.window.scaleX).toBeCloseTo(0.5, 9);
    expect(a.window.scaleY).toBeCloseTo(0.5, 9);
    expect([a.picture.scaleX, a.picture.scaleY]).toEqual([1, 1]);
    // A deck's square card covers it (cropped): the picture inside is scaled evenly to cover the square.
    const card = { x: 50, y: 400, width: 150, height: 150 };
    expect(coverScale(card, whole)).toBeCloseTo(0.75, 9);
    const b = growTransforms(tileFrame(card, whole), whole);
    expect(b.window.scaleX * b.picture.scaleX).toBeCloseTo(0.75, 9);
    expect(b.window.scaleY * b.picture.scaleY).toBeCloseTo(0.75, 9);
    // The window sits on the card: its middle moved from the whole picture's to the card's.
    expect(b.window.translateX).toBeCloseTo(125 - 200, 9);
    expect(b.window.translateY).toBeCloseTo(475 - 400, 9);
    // At the end, the picture whole with nothing moved.
    const end = growTransforms(frameAt(tileFrame(card, whole), { rect: whole, scale: 1 }, 1), whole);
    expect(end).toEqual({
      window: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
      picture: { scaleX: 1, scaleY: 1 },
    });
  });

  test("a closing pull's place is where the picture shrinks back from", () => {
    const whole = fitIn(2, screen);
    const pulled = pulledFrame(whole, { x: 10, y: 120 }, 0.8);
    expect(pulled).toEqual({ rect: { x: 50, y: 440, width: 320, height: 160 }, scale: 0.8 });
    expect(frameAt(pulled, pulled, 0.5)).toEqual(pulled);
  });
});

describe("the wiring", () => {
  test("a message's single picture, its video and its deck's top card grow out of their tiles where the system's zoom doesn't open them", () => {
    const link = src("features/files/MediaLink.tsx");
    expect(link).toContain(
      "growOpen({ ...grow, open: () => openFile(file, siblings, { grow: true }), reduced }, plain)",
    );
    expect(src("features/files/MessageFiles.tsx")).toContain("const tile = useGrowTile(growKey);");
    expect(src("features/files/VideoPlayer.tsx")).toContain("const grownTile = useGrowTile(growKey);");
    const deck = src("features/files/ImageStack.tsx");
    expect(deck).toContain("open: () => openFile(tapped, all, { from: key, grow: true }),");
    // The tile hides while its picture is out on the layer.
    for (const file of ["MessageFiles.tsx", "VideoPlayer.tsx", "ImageStack.tsx"])
      expect([file, src(`features/files/${file}`).includes("lifted: { opacity: 0 },")]).toEqual([file, true]);
  });

  test("the viewer is pushed and popped under the layer with no animation, and shrinks back on every close", () => {
    const layout = readFileSync(join(import.meta.dir, "../../app/(app)/(main)/_layout.tsx"), "utf8");
    expect(layout).toContain('return { ...options, animation: "none", gestureEnabled: false };');
    expect(readFileSync(join(import.meta.dir, "../../app/(app)/_layout.tsx"), "utf8")).toContain("<GrowLayer />");
    const viewer = src("features/files/ImageViewer.tsx");
    expect(viewer).toContain("if (!shrink()) goBack();");
    expect(viewer).toContain("if (!shrink(at)) goBack();");
    expect(viewer).toContain('BackHandler.addEventListener("hardwareBackPress"');
    // A closing pull, grown out of a tile: the picture stays where the finger left it.
    expect(viewer).toContain(
      "scheduleOnRN(onPulledClose, pulledPlacement(pullX.value, pullY.value, screen, grab.value));",
    );
    // The layer goes once the same picture (or the video's cover) is drawn in the viewer.
    expect(viewer.match(/growReady\(/g)?.length).toBe(2);
    const layer = src("features/files/grow.tsx");
    // The tile hides in the frame the picture is drawn on the layer, and shows again in the frame it lands.
    expect(layer).toContain("drawn: () => setLifted(key),");
    expect(layer).toContain("setLifted(null);\n      layer?.clear();");
  });
});
