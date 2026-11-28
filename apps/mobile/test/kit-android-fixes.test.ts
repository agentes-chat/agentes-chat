import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
/** A function's text, from its signature to the next top-level declaration. */
const body = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  return source.slice(from, source.indexOf(end, from + start.length));
};

describe("the kit on Android and iOS alike", () => {
  test("Android's touch feedback is the system's own, never the vibration motor, with older phones' equals", () => {
    const haptics = src("ui/haptics.ts");
    expect(haptics).toContain("Haptics.performAndroidHapticsAsync(played as Haptics.AndroidHaptics).catch(() => {});");
    // A constant newer than the phone plays its older equal (expo-haptics rejects one the phone doesn't have).
    expect(haptics).toContain('"segment-tick": { api: 34, older: "context-click" },');
    expect(haptics).toContain('confirm: { api: 30, older: "virtual-key" },');
    expect(haptics).toContain('reject: { api: 30, older: "long-press" },');
    expect(haptics).toContain("const played = since && ANDROID_API < since.api ? since.older : haptic;");
    // Every kind answers on Android before the iOS generators (impact, selection, notification) are reached.
    const kinds = body(haptics, "export const haptics = {", "\n};");
    for (const [kind, android] of [
      ["light", "context-click"],
      ["firm", "virtual-key"],
      ["medium", "long-press"],
      ["selection", "segment-tick"],
      ["success", "confirm"],
      ["warning", "reject"],
      ["error", "reject"],
    ] as const) {
      const one = body(kinds, `  ${kind}: () => {`, "\n  },");
      expect({ kind, android: one.includes(`if (ANDROID) return android("${android}");`) }).toEqual({
        kind,
        android: true,
      });
    }
  });

  test("a press reaches as far as its hitSlop on iOS too: the wrapper around the Pressable carries it", () => {
    expect(src("ui/PressScale.tsx")).toContain("<Animated.View hitSlop={rest.hitSlop} style={[style, animated]}>");
  });

  test("a bar's capsule on Android keeps its ring and shadow whole inside the bar's clipping view", () => {
    expect(src("ui/IconButton.tsx")).toContain(
      "export const PLATE_EDGE_ROOM = { paddingHorizontal: 2, paddingVertical: 3 } as const;",
    );
    const bar = src("ui/headerActions.tsx");
    const capsule = body(bar, "export function HeaderCapsule(", "\n}\n");
    expect(capsule).toMatch(/<View style=\{styles\.edgeRoom\}>\s*<View style=\{\[styles\.row, styles\.capsule,/);
    expect(bar).toContain("edgeRoom: PLATE_EDGE_ROOM,");
  });

  test("the formatting bar's outline isn't cut along its top by its scroll view; the bar stays where it was", () => {
    const composer = src("ui/Composer.tsx");
    expect(composer).toContain("formatBleed: { marginHorizontal: -10, marginTop: -2 },");
    expect(composer).toContain("formatRow: { paddingHorizontal: 10, paddingTop: 2, paddingBottom: 8 },");
  });

  test("a tab root's pull on Android comes down under the clear bar, in the theme's colors", () => {
    const screen = src("ui/LargeTitleScreen.tsx");
    const drawn = screen.slice(screen.indexOf("function DrawnTitleScreen("));
    expect(drawn).toContain(
      "{ progressViewOffset: headerHeight, colors: [colors.ink], progressBackgroundColor: colors.raised }",
    );
    // Only on Android: iOS keeps its inset list and its hidden wheel.
    expect(drawn).toMatch(/\{\.\.\.\(IOS\s*\?\s*\{\}\s*:\s*\{ progressViewOffset: headerHeight/);
  });

  test("the app's Light/Dark choice reaches the system: keyboard, menus, sheets; Android's window under the screens", () => {
    const theme = src("ui/theme.tsx");
    expect(theme).toContain('Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);');
    expect(theme).toContain('if (Platform.OS === "android") SystemUI.setBackgroundColorAsync(bg).catch(() => {});');
  });

  test("a drag down a form puts the keyboard away on Android too (React Native's 'interactive' is iOS only)", () => {
    expect(src("ui/auth/AuthScaffold.tsx")).toContain(
      'export const DRAG_DISMISS = Platform.OS === "ios" ? "interactive" : "on-drag";',
    );
    for (const file of ["ui/auth/AuthScaffold.tsx", "features/settings/parts.tsx"]) {
      const s = src(file);
      expect({ file, drag: s.includes("keyboardDismissMode={DRAG_DISMISS}") }).toEqual({ file, drag: true });
      expect({ file, iosOnly: s.includes('keyboardDismissMode="interactive"') }).toEqual({ file, iosOnly: false });
    }
  });
});
