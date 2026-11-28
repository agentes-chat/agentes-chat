import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Android's keyboard, the sideways screen's system chrome, the header pill at large text sizes, and one buzz a press. */
const src = (path: string) => readFileSync(join(import.meta.dir, "../../src/features", path), "utf8");

describe("a field on a pushed page clears Android's keyboard", () => {
  test("a large-title page with a field takes the keyboard library's scroll view on Android, iOS keeps the system's", () => {
    const page = src("shared/PushedLargeTitle.tsx");
    // With the library's provider on, Android's window no longer shrinks for the keyboard, and the inset is iOS's alone.
    expect(page).toContain("aware={keyboard && !IOS}");
    expect(page).toContain(
      "return aware ? <KeyboardAwareScrollView {...props} bottomOffset={FIELD_ROOM} /> : <ScrollView {...props} />;",
    );
    expect(page).toContain("automaticallyAdjustKeyboardInsets={keyboard && IOS}");
    // Android has no interactive dismissal (it reads as "none"): a drag takes the keyboard away there.
    expect(page).toContain('keyboardDismissMode={keyboard && IOS ? "interactive" : "on-drag"}');
    // Answering a question and refusing with a reason are the pages that need it.
    expect(src("activity/QuestionScreen.tsx")).toContain('<PushedLargeTitle title="" collapsed grouped keyboard');
  });

  test("the AI connection's steps (a key, an address, a sign-in's code) scroll clear of the keyboard on both systems", () => {
    const flow = src("ai/ConnectAi.tsx");
    const steps = flow.slice(flow.indexOf("<PushedHeader title={title} solid={false} grouped />"));
    expect(steps).toContain("<KeyboardAwareScrollView");
    expect(steps).toContain("bottomOffset={FIELD_CLEARANCE}");
    expect(steps).not.toContain("automaticallyAdjustKeyboardInsets");
  });
});

test("Atividade's rows draw the lists' own hairline, as strong as every other list's", () => {
  const activity = src("activity/ActivityScreen.tsx");
  expect(activity.match(/<View style=\{\[styles\.divider, \{ backgroundColor: c\.separator \}\]\} \/>/g)).toHaveLength(
    2,
  );
  expect(activity).not.toContain("styles.divider, { backgroundColor: c.line2 }");
});

describe("the agent's screen in control on Android", () => {
  const screen = src("computer/AgentScreen.tsx");

  test("sideways the status bar goes too, so the clock doesn't sit on the picture and the dock", () => {
    expect(screen).toContain("{wide ? <StatusBar hidden animated /> : null}");
  });

  test("Android's back (an edge swipe the trackpad reaches) never leaves mid-control; sideways it stands up first", () => {
    const back = screen.slice(screen.indexOf("const focused = useIsFocused();"));
    expect(back).toContain('if (Platform.OS !== "android" || !inControl || !focused) return;');
    expect(back).toContain("if (wide && sideways.forced) sideways.standUp();");
    expect(back).toContain("return () => sub.remove();");
  });
});

test("the header pill's words stop growing where they still fit its fixed height, and its line box grows with them", () => {
  const pill = src("chat/HeaderPill.tsx");
  expect(pill).toContain("const PILL_MAX = 1.2;");
  // The name and the line, and the copies that measure them, under the same cap.
  expect(pill.match(/maxFontSizeMultiplier=\{PILL_MAX\}/g)).toHaveLength(4);
  expect(pill).toContain("const height = Math.ceil(LINE * Math.min(useFontScale(), PILL_MAX));");
  expect(pill).toContain("<View style={[styles.lineBox, { height }]}>");
  // The name's 20 and the line's 16, grown by the cap, fit in the 44-point pill.
  expect(20 * 1.2 + 16 * 1.2).toBeLessThanOrEqual(44);
});

test("the agent's tasks button buzzes once: PressScale's own haptic", () => {
  const button = src("task-manager/AgentTasksButton.tsx");
  expect(button).not.toContain("tapHaptic");
  expect(button).toContain("onPress={onPress}");
});
