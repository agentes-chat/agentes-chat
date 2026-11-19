import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { dark as darkTokens } from "@agenteschat/tokens";
import { DEFAULT_SKY, setSkyColors } from "@agenteschat/ui/agent/engine";
import {
  LAUNCH,
  LOGO,
  LOGO_LOOK,
  launchesAtOnce,
  launchLookOf,
  launchPose,
  launchSkyTones,
  SPRITES,
  spriteBlinks,
  spriteY,
  waitLine,
} from "../../src/features/launch/logic";
import { iconGradient } from "../../src/features/me/app-icon-names";

describe("launch splash", () => {
  test("the agent's body is the logo's in a 120 pt image: 400 of its 512 px", () => {
    expect(LOGO).toBeCloseTo(93.75, 5);
  });

  test("the native launch image is the background alone, in light and dark, and the agent pops in over it", () => {
    // Every pixel transparent: no mascot fixed at build time shows before the icon in use.
    const png = readFileSync(join(import.meta.dir, "../../assets/images/splash-icon.png"));
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    const idat: Buffer[] = [];
    for (let at = 8; at < png.length; ) {
      const size = png.readUInt32BE(at);
      if (png.toString("ascii", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + size));
      at += size + 12;
    }
    const rows = inflateSync(Buffer.concat(idat));
    const alpha = [...rows].filter((_, i) => i % (512 * 4 + 1) !== 0 && (i % (512 * 4 + 1)) % 4 === 0);
    expect(alpha.length).toBe(512 * 512);
    expect(alpha.every((a) => a === 0)).toBe(true);
    // Its background is the app's in both themes, so the hand-over to the splash's first frame doesn't show.
    const config = readFileSync(join(import.meta.dir, "../../app.config.ts"), "utf8");
    expect(config).toContain('backgroundColor: "#ffffff",');
    expect(config).toContain(`dark: { image: "./assets/images/splash-icon.png", backgroundColor: "${darkTokens.bg}" }`);
    const splash = readFileSync(join(import.meta.dir, "../../src/features/launch/LaunchSplash.tsx"), "utf8");
    expect(splash).toContain("const arrive = useSharedValue(reduced ? 1 : 0);");
    expect(LAUNCH.pop).toBeLessThan(LAUNCH.rise);
  });

  test("one line only once it's late: why it waits", () => {
    expect(waitLine(false, true)).toBeNull();
    expect(waitLine(true, false)).toBe("slow");
    expect(waitLine(true, true)).toBe("offline");
  });

  test("the agent looks down at the sky, back up, smiles; closes its eyes offline; smiles leaving", () => {
    // First frame: facing ahead, eyes open, as it pops in.
    expect(launchPose(0)).toEqual({ turn: [0, 0], blink: false });
    expect(launchPose(0.4).turn?.[1]).toBeGreaterThan(0.5);
    expect(launchPose(0.89).turn?.[1]).toBeLessThan(0);
    expect(launchPose(1.2).expression).toBe("happy");
    expect(launchPose(LAUNCH.lineAfter + 0.1, { offline: true }).expression).toBe("closed");
    expect(launchPose(1, { offline: true }).expression).not.toBe("closed");
    expect(launchPose(3, { offline: true, leaving: true }).expression).toBe("happy");
  });

  test("the sprites stay inside the sky as they rise, and wait while it is low", () => {
    for (const s of SPRITES) {
      expect(spriteY(s, 1, 0.1)).toBeNull();
      for (let t = 0; t < 30; t += 0.7) {
        const y = spriteY(s, t, LAUNCH.sky);
        expect(y).not.toBeNull();
        // From near the bottom up to a little under the sky's top (it starts at 1 - 0.5).
        expect(y as number).toBeLessThanOrEqual(0.95);
        expect(y as number).toBeGreaterThan(1 - LAUNCH.sky + 0.05);
      }
    }
    // They move up over time.
    const s = SPRITES[0];
    expect(spriteY(s, 0.5, LAUNCH.sky) as number).toBeLessThan(spriteY(s, 0, LAUNCH.sky) as number);
  });

  test("waiting on the person, the sprites rise only above the panel at the bottom", () => {
    const bottom = 0.6;
    for (const s of SPRITES)
      for (let t = 0; t < 30; t += 0.7) {
        const y = spriteY(s, t, LAUNCH.waitingSky, bottom);
        expect(y).not.toBeNull();
        expect(y as number).toBeLessThanOrEqual(bottom);
        expect(y as number).toBeGreaterThan(1 - LAUNCH.waitingSky + 0.05);
      }
    // No room between the sky's top and the panel: none.
    expect(spriteY(SPRITES[0], 1, LAUNCH.waitingSky, 0.48)).toBeNull();
  });

  test("a sprite blinks for a moment every 3.6 s", () => {
    const s = SPRITES[0];
    const blinks = Array.from({ length: 360 }, (_, i) => spriteBlinks(s, i / 100)).filter(Boolean).length;
    expect(blinks).toBeGreaterThan(5);
    expect(blinks).toBeLessThan(20);
  });

  test("ready within its first frames it leaves at once; later its rise plays the minimum", () => {
    expect(launchesAtOnce(0)).toBe(true);
    expect(launchesAtOnce(LAUNCH.quick * 1000)).toBe(true);
    expect(launchesAtOnce(LAUNCH.quick * 1000 + 1)).toBe(false);
    expect(LAUNCH.quick).toBeLessThan(LAUNCH.min);
    const splash = readFileSync(join(import.meta.dir, "../../src/features/launch/LaunchSplash.tsx"), "utf8");
    expect(splash).toContain("if (!played && !launchesAtOnce(Date.now() - startedAt)) return;");
    // Leaving, the agent holds its last pose: no frames of it on the JS thread while the app arrives under it.
    expect(splash).toContain("const now = useFrameTime(!reduced && !leaving, heldAt);");
  });

  test("the sky starts from the screen's own background", () => {
    expect(launchSkyTones("#ffffff", false)[0]).toBe("#ffffff");
    expect(launchSkyTones("#0f0f0e", true)[0]).toBe("#0f0f0e");
    expect(launchSkyTones("#ffffff", false).length).toBeLessThanOrEqual(8);
  });

  test("the agent and the sky are the app icon's in use; nothing kept or unknown is the logo's", () => {
    expect(launchLookOf(null)).toEqual(LOGO_LOOK);
    expect(launchLookOf("not-an-icon")).toEqual(LOGO_LOOK);
    expect(launchLookOf("peekNight")).toEqual(LOGO_LOOK);
    expect(launchLookOf("moon").sky).toBe("night");
    expect(launchLookOf("peekSky")).toEqual({ ...LOGO_LOOK, sky: "sky" });
    expect(launchLookOf("made-sky-rose-heart")).toEqual({
      color: "rose",
      eyes: "round",
      expression: "heart",
      accessory: "none",
      sky: "sky",
    });
    expect(launchLookOf("made-night-teal-sleepy-peek")).toEqual({
      color: "teal",
      eyes: "sleepy",
      accessory: "none",
      sky: "night",
    });
    expect(launchLookOf("made-night-amber-crown")).toMatchObject({ color: "amber", eyes: "round", accessory: "crown" });
  });

  test("the agent is drawn in the icon's own colors: sky stays the landing's blue under any accent", () => {
    setSkyColors(["#ff8cff", "#d100d1"]);
    try {
      expect(iconGradient(launchLookOf(null).color)).toEqual(DEFAULT_SKY);
      expect(iconGradient(launchLookOf("made-night-sky-round-peek").color)).toEqual(DEFAULT_SKY);
    } finally {
      setSkyColors(null);
    }
  });

  test("a day sky's icon rises in its day blues in light; the night's keeps the logo's sky", () => {
    expect(launchSkyTones("#ffffff", false, false, "night")).toEqual(launchSkyTones("#ffffff", false));
    const day = launchSkyTones("#ffffff", false, false, "sky");
    expect(day[0]).toBe("#ffffff");
    expect(day).not.toEqual(launchSkyTones("#ffffff", false));
    expect(launchSkyTones("#0f0f0e", true, false, "sky")).toEqual(launchSkyTones("#0f0f0e", true));
  });
});
